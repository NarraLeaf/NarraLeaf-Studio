import { AppHost, AppProtocol } from "@shared/types/constants";
import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";
import { WindowAppType } from "@shared/types/window";
import path from "path";

function pathsEqual(a: string, b: string): boolean {
    return path.normalize(a) === path.normalize(b);
}

export class DevModeLaunchHandler extends IPCHandler<IPCEventType.devModeLaunch> {
    readonly name = IPCEventType.devModeLaunch;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath, entry }: IPCEvents[IPCEventType.devModeLaunch]["data"],
    ): Promise<RequestStatus<{ status: IPCEvents[IPCEventType.devModeLaunch]["response"]["status"] }>> {
        return this.tryUse(async () => {
            const status = await window.getApp().getDevModeManager().launch(projectPath, entry);
            return { status };
        });
    }
}

export class DevModeStopHandler extends IPCHandler<IPCEventType.devModeStop> {
    readonly name = IPCEventType.devModeStop;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath }: IPCEvents[IPCEventType.devModeStop]["data"],
    ): Promise<RequestStatus<{ status: IPCEvents[IPCEventType.devModeStop]["response"]["status"] }>> {
        const status = await window.getApp().getDevModeManager().stop(projectPath);
        return this.success({ status });
    }
}

/**
 * Fullscreen acts on the Dev Mode window itself, so the calling window is the
 * target. The packaged runtime has its own equivalent over the runtime preload.
 */
export class DevModeFullscreenGetHandler extends IPCHandler<IPCEventType.devModeFullscreenGet> {
    readonly name = IPCEventType.devModeFullscreenGet;
    readonly type = IPCMessageType.request;

    public handle(window: AppWindow): RequestStatus<{ isFullscreen: boolean }> {
        return this.success({ isFullscreen: window.isFullScreen() });
    }
}

export class DevModeFullscreenSetHandler extends IPCHandler<IPCEventType.devModeFullscreenSet> {
    readonly name = IPCEventType.devModeFullscreenSet;
    readonly type = IPCMessageType.request;

    public handle(
        window: AppWindow,
        { fullscreen }: IPCEvents[IPCEventType.devModeFullscreenSet]["data"],
    ): RequestStatus<void> {
        if (fullscreen) {
            window.enterFullScreen();
        } else {
            window.exitFullScreen();
        }
        return this.success();
    }
}

export class DevModeReloadHandler extends IPCHandler<IPCEventType.devModeReload> {
    readonly name = IPCEventType.devModeReload;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath }: IPCEvents[IPCEventType.devModeReload]["data"],
    ): Promise<RequestStatus<{ status: IPCEvents[IPCEventType.devModeReload]["response"]["status"] }>> {
        return this.tryUse(async () => {
            const status = await window.getApp().getDevModeManager().reload(projectPath);
            return { status };
        });
    }
}

export class DevModeGetStatusHandler extends IPCHandler<IPCEventType.devModeGetStatus> {
    readonly name = IPCEventType.devModeGetStatus;
    readonly type = IPCMessageType.request;

    public handle(
        window: AppWindow,
        { projectPath }: IPCEvents[IPCEventType.devModeGetStatus]["data"],
    ): RequestStatus<{ status: IPCEvents[IPCEventType.devModeGetStatus]["response"]["status"] }> {
        const status = window.getApp().getDevModeManager().getStatus(projectPath);
        return this.success({ status });
    }
}

export class DevModeResolveAssetUrlHandler extends IPCHandler<IPCEventType.devModeResolveAssetUrl> {
    readonly name = IPCEventType.devModeResolveAssetUrl;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow<WindowAppType.DevMode>,
        { assetId, assetType }: IPCEvents[IPCEventType.devModeResolveAssetUrl]["data"],
    ): Promise<RequestStatus<{ url: string }>> {
        return resolveDevModeAssetUrl(window, assetId, assetType);
    }
}

export class DevModeResolveImageAssetUrlHandler extends IPCHandler<IPCEventType.devModeResolveImageAssetUrl> {
    readonly name = IPCEventType.devModeResolveImageAssetUrl;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow<WindowAppType.DevMode>,
        { assetId }: IPCEvents[IPCEventType.devModeResolveImageAssetUrl]["data"],
    ): Promise<RequestStatus<{ url: string }>> {
        return resolveDevModeAssetUrl(window, assetId, "image");
    }
}

async function resolveDevModeAssetUrl(
    window: AppWindow<WindowAppType.DevMode>,
    assetId: string,
    assetType?: string,
): Promise<RequestStatus<{ url: string }>> {
        const props = window.getProps();
        const workspaceWindow = window.getApp().windowManager
            .getWindows()
            .find(
                w =>
                    w.getWindowType() === WindowAppType.Workspace &&
                    !w.isDestroyed() &&
                    w.getProps().projectPath === props.projectPath,
            ) as AppWindow<WindowAppType.Workspace> | undefined;

        if (!workspaceWindow) {
            return { success: false, error: "Workspace window not available" };
        }

        try {
            const workspaceResult = await workspaceWindow.invokeIpcRequest(
                IPCEventType.workspaceResolveAssetUrl,
                { assetId, assetType },
            );
            if (!workspaceResult.success) {
                return { success: false, error: workspaceResult.error ?? "Failed to resolve asset" };
            }
            promoteDevModeAssetGrant(window, workspaceResult.data.url);
            return { success: true, data: workspaceResult.data };
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
}

/**
 * Local assets resolve to one-shot app://fs/{hash} grants (the workspace-side
 * resolver requests a single read). The game engine, however, re-fetches the
 * same URL whenever its per-scene cache evicts an entry, so a one-shot grant
 * 404s on scene revisit. Promote the grant to a session-lived repeatable read
 * owned by the Dev Mode window: it survives re-fetches and is revoked when the
 * window closes (Dev Mode stop/relaunch always closes the window).
 */
function promoteDevModeAssetGrant(window: AppWindow<WindowAppType.DevMode>, url: string): void {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return; // Remote/opaque URLs are not hash grants
    }
    if (parsed.protocol !== `${AppProtocol}:` || parsed.hostname !== AppHost.Fs) {
        return;
    }
    const hash = parsed.pathname.replace(/^\/+/, "");
    if (!hash) {
        return;
    }
    window.app.storageManager.promoteToSessionRead(hash, window.getWebContents().id);
}

export class DevModeOpenBlueprintInWorkspaceHandler extends IPCHandler<IPCEventType.devModeOpenBlueprintInWorkspace> {
    readonly name = IPCEventType.devModeOpenBlueprintInWorkspace;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        data: IPCEvents[IPCEventType.devModeOpenBlueprintInWorkspace]["data"],
    ): Promise<RequestStatus<void>> {
        if (window.getWindowType() !== WindowAppType.DevMode) {
            return this.failed("Invalid window");
        }
        const devWindow = window as AppWindow<WindowAppType.DevMode>;
        const props = devWindow.getProps();
        if (!pathsEqual(props.projectPath, data.projectPath)) {
            return this.failed("Project mismatch");
        }
        if (data.ownerKind !== "surfaceMain" && data.ownerKind !== "widgetMain" && data.ownerKind !== "widgetValue") {
            return this.failed("Unsupported owner");
        }

        const workspaceWindow = window
            .getApp()
            .windowManager.getWindows()
            .find(
                w =>
                    w.getWindowType() === WindowAppType.Workspace &&
                    !w.isDestroyed() &&
                    !w.isClosed() &&
                    pathsEqual(w.getProps().projectPath, data.projectPath),
            );

        if (!workspaceWindow) {
            return this.failed("No workspace for project");
        }

        const { projectPath: _p, ...nav } = data;
        workspaceWindow.sendIpcEvent(IPCEventType.workspaceBlueprintNavigateFromPreview, nav);
        workspaceWindow.getBrowserWindow().show();
        workspaceWindow.getBrowserWindow().focus();

        return this.success();
    }
}

export class DevModeForwardBlueprintDebugEventHandler extends IPCHandler<IPCEventType.devModeForwardBlueprintDebugEvent> {
    readonly name = IPCEventType.devModeForwardBlueprintDebugEvent;
    readonly type = IPCMessageType.message;

    public handle(
        window: AppWindow,
        data: IPCEvents[IPCEventType.devModeForwardBlueprintDebugEvent]["data"],
    ): RequestStatus<never> {
        if (window.getWindowType() !== WindowAppType.DevMode) {
            return this.failed("Invalid window");
        }

        const devWindow = window as AppWindow<WindowAppType.DevMode>;
        const props = devWindow.getProps();
        if (!pathsEqual(props.projectPath, data.projectPath)) {
            return this.failed("Project mismatch");
        }

        const workspaceWindow = window
            .getApp()
            .windowManager.getWindows()
            .find(
                w =>
                    w.getWindowType() === WindowAppType.Workspace &&
                    !w.isDestroyed() &&
                    !w.isClosed() &&
                    pathsEqual(w.getProps().projectPath, data.projectPath),
            );

        if (!workspaceWindow) {
            return this.success(void 0 as never);
        }

        workspaceWindow.sendIpcEvent(IPCEventType.workspaceBlueprintDebugEvent, data.event);
        return this.success(void 0 as never);
    }
}
