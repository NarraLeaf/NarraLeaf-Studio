import { AppHost, AppProtocol } from "@shared/types/constants";
import { weatherBakeKey } from "@shared/weather/bakeKey";
import { WeatherBakeOwner } from "../../weather/WeatherBakeManager";
import { devModeScreenEffectQuality, screenEffectBakeThreads } from "../../weather/screenEffectQuality";
import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";
import { WindowAppType } from "@shared/types/window";
import { requireWindowProject } from "../../../utils/windowProject";

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

/**
 * Every asset the workspace can resolve, promoted for this Dev Mode window in one pass.
 *
 * The single-asset handler above is three IPC hops, and a story compile needs one per asset the
 * script references - awaited one at a time, because the compiler resolves as it walks. On a medium
 * project that was a thousand round trips and most of the time a launch took. The grants are the
 * same grants: this window already holds a declared recursive read over the project directory, so
 * nothing becomes reachable that was not already.
 */
/**
 * How many asset grants are promoted at once.
 *
 * Each one is a `stat` and nothing else, so the useful width is whatever the filesystem will
 * answer in parallel rather than anything about CPU. Thirty-two matches the width the workspace
 * side and the read-grant batch beneath it already work at.
 */
const GRANT_PROMOTION_CONCURRENCY = 32;

export class DevModeResolveAllAssetUrlsHandler extends IPCHandler<IPCEventType.devModeResolveAllAssetUrls> {
    readonly name = IPCEventType.devModeResolveAllAssetUrls;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow<WindowAppType.DevMode>,
    ): Promise<RequestStatus<{ urls: Record<string, string> }>> {
        const workspaceWindow = findWorkspaceWindowFor(window);
        if (!workspaceWindow) {
            return { success: false, error: "Workspace window not available" };
        }
        try {
            const resolved = await workspaceWindow.invokeIpcRequest(IPCEventType.workspaceResolveAllAssetUrls, {});
            if (!resolved.success) {
                return { success: false, error: resolved.error ?? "Failed to resolve assets" };
            }
            const entries = Object.entries(resolved.data.urls);
            const urls: Record<string, string> = {};
            // A pool rather than a loop. Each promotion stats the file it grants - the token is
            // derived from path, size and mtime so that a URL written into a save still opens
            // after a restart - and awaiting a project's worth of those one at a time is the
            // shape that made the resolve underneath this the longest step of a Dev Mode boot.
            // Measured at about 90ms for 954 assets here, which is what it should be.
            let index = 0;
            await Promise.all(Array.from({ length: Math.min(GRANT_PROMOTION_CONCURRENCY, entries.length) }, async () => {
                while (index < entries.length) {
                    const [assetId, url] = entries[index]!;
                    index += 1;
                    urls[assetId] = await promoteDevModeAssetGrant(window, url);
                }
            }));
            return { success: true, data: { urls } };
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    }
}

/**
 * The workspace window showing the same project as `window`, which is where an asset id is resolved.
 *
 * Delegates rather than walking the window list itself. `App.findWorkspaceForProject` is the lookup
 * the one-project-one-window rule is built on and it folds two spellings of a path the way the rest
 * of the app does; a comparison written here would be a second opinion about what "the same project"
 * is, and a second opinion eventually disagrees. This used to compare the two props with `===`,
 * which is the strictest disagreement available: a workspace remembered under a differently-cased
 * path would simply not be found, and every asset in the preview would fail to resolve with
 * "Workspace window not available".
 */
function findWorkspaceWindowFor(
    window: AppWindow<WindowAppType.DevMode>,
): AppWindow<WindowAppType.Workspace> | undefined {
    return window.getApp().findWorkspaceForProject(window.getProps().projectPath);
}

async function resolveDevModeAssetUrl(
    window: AppWindow<WindowAppType.DevMode>,
    assetId: string,
    assetType?: string,
): Promise<RequestStatus<{ url: string }>> {
        const workspaceWindow = findWorkspaceWindowFor(window);

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
            return { success: true, data: { url: await promoteDevModeAssetGrant(window, workspaceResult.data.url) } };
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
}

/**
 * Turn the workspace's one-shot `app://fs/{hash}` grant into the URL Dev Mode actually serves.
 *
 * Two things happen, and the second is the reason this returns a URL rather than mutating in place.
 *
 * 1. The grant becomes session-lived and owned by the Dev Mode window. The game engine re-fetches
 *    the same URL whenever its per-scene cache evicts an entry, so a one-shot grant 404s on scene
 *    revisit. It is revoked when the window closes (Dev Mode stop/relaunch always closes it).
 *
 * 2. The token is re-derived from the file it points at, so the SAME asset yields the SAME URL in
 *    every run. This is what makes a save loadable. The engine writes resolved URLs into the
 *    SavedGame (`Image.state.currentSrc`) and `deserialize` puts them back over the fresh compile's
 *    - with a random per-read token, every stage image in a save written before the last restart
 *    404s and the stage comes up empty. See {@link StorageManager.stabilizeSessionRead}.
 *
 * Falls back to the original URL whenever the grant cannot be stabilized (a remote/opaque URL, an
 * unreadable target): repeatable reads still work, only the cross-restart property is lost.
 */
async function promoteDevModeAssetGrant(window: AppWindow<WindowAppType.DevMode>, url: string): Promise<string> {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return url; // Remote/opaque URLs are not hash grants
    }
    if (parsed.protocol !== `${AppProtocol}:` || parsed.hostname !== AppHost.Fs) {
        return url;
    }
    // Only the first segment is the grant - a model bundle resolves to
    // `app://fs/{hash}/{entry}`, whose trailing path is a file *inside* the grant.
    const pathname = parsed.pathname.replace(/^\/+/, "");
    const separator = pathname.indexOf("/");
    const hash = separator === -1 ? pathname : pathname.slice(0, separator);
    if (!hash) {
        return url;
    }
    const webContentsId = window.getWebContents().id;
    const stable = await window.app.storageManager.stabilizeSessionRead(hash, webContentsId);
    if (!stable) {
        window.app.storageManager.promoteToSessionRead(hash, webContentsId);
        return url;
    }
    // The remainder is a path *inside* a directory grant and belongs to the bundle, not the token,
    // so it is carried across verbatim - this is the sibling arithmetic a model's manifest relies on.
    const remainder = separator === -1 ? "" : pathname.slice(separator);
    return `${AppProtocol}://${AppHost.Fs}/${stable}${remainder}`;
}

/**
 * The clip a weather seed describes, produced on demand and granted to this window.
 *
 * Two things happen here that could not happen anywhere else. The bake needs main - it spawns an
 * encoder - and the grant needs this window, because `app://fs` tokens are capabilities held by a
 * webContents rather than addresses anyone can use.
 *
 * The token is STABILIZED rather than freshly allocated, for the same reason every other Dev Mode
 * asset is: the engine writes resolved URLs into a save, and a one-shot token in a save is a stage
 * that comes back empty. A clip's token is derived from the file, so the same weather yields the
 * same URL in every run.
 */
export class DevModeResolveWeatherClipHandler extends IPCHandler<IPCEventType.devModeResolveWeatherClip> {
    readonly name = IPCEventType.devModeResolveWeatherClip;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow<WindowAppType.DevMode>,
        { spec, attempt }: IPCEvents[IPCEventType.devModeResolveWeatherClip]["data"],
    ): Promise<RequestStatus<{ url: string }>> {
        const projectPath = window.getProps().projectPath;
        if (!projectPath) {
            return { success: false, error: "No project is open" };
        }
        const manager = window.getApp().getWeatherBakeManager();
        // Claimed for this compile. Every row of one compile arrives here separately and under the
        // same attempt, so they never retire each other; a reload changes the attempt, and whatever
        // the compile before it was still waiting for is dropped on the spot. That is the difference
        // between an author who typed `120` waiting for one bake and waiting for three.
        const outcome = await manager.ensure({
            projectRoot: projectPath,
            specs: [spec],
            priority: "blocking",
            // The same reader the pre-baker uses. If these two ever disagreed the pre-bake would be a
            // different task from the one Dev Mode waits on, and the speculative work - which is the
            // whole point of pre-baking - would be silently thrown away every time.
            quality: devModeScreenEffectQuality(window.getApp()),
            threads: screenEffectBakeThreads(window.getApp()),
            claim: { owner: WeatherBakeOwner.devMode(projectPath), attempt },
        });
        const key = weatherBakeKey(spec);
        const clipPath = outcome.paths.get(key);
        if (!clipPath) {
            // The failure is the encoder's or the tool's, and it is already in the log; what travels
            // back is the one sentence a compile diagnostic can carry.
            return { success: false, error: outcome.failures.get(key) ?? "The weather could not be produced" };
        }
        const hash = window.app.storageManager.allocateHash(clipPath, true, "read");
        // A freshly allocated grant is `allocated`, and the protocol handler serves only `ready` -
        // every other allocator marks it after checking the file, and skipping it here yields a URL
        // that looks correct everywhere (the element carries it, the log shows the request arriving)
        // and answers 403 forever. The bake just wrote this file, so the existence check is done.
        window.app.storageManager.updateStatus(hash, "ready");
        const granted = await promoteDevModeAssetGrant(window, `${AppProtocol}://${AppHost.Fs}/${hash}`);
        return { success: true, data: { url: granted } };
    }
}

/**
 * The workspace window a preview is asking Studio to act in.
 *
 * The four handlers below are one shape - a Dev Mode window asking the workspace that has the same
 * project open to reveal something - so the three questions they share are asked here rather than
 * four times over: is the caller a preview at all, is the project it names its own, and is that
 * project open in a workspace.
 *
 * The middle one is {@link requireWindowProject}, which is the check the rest of the main process
 * asks. This file used to answer it with a `path.normalize` comparison of its own - a private copy
 * of the app's identity rule that does not fold case, so on Windows `D:\Game` and `d:\game` were
 * two projects here and one project everywhere else. It never misbehaved, because the payload is
 * the window's own props echoed back and the two sides were therefore the same string; that is luck
 * rather than a property, and the failure it was risking is the worse of the two available. A guard
 * that refuses the author's own project is worse than the hole it closes.
 *
 * The lookup is delegated for the same reason, and answers `undefined` rather than throwing: "no
 * workspace is open on this project" is an ordinary situation, and the four below do not all give
 * it the same answer.
 *
 * Throws rather than returning a refusal so the code {@link requireWindowProject} raises travels
 * with it - each caller catches and hands it to `failed`, which reads `error.code`. The catching
 * cannot be left to the registry: it discards what a message handler returns and does not catch
 * what one throws.
 */
function requireWorkspaceForPreview(
    window: AppWindow,
    named: string,
): AppWindow<WindowAppType.Workspace> | undefined {
    if (window.getWindowType() !== WindowAppType.DevMode) {
        throw new Error("Invalid window");
    }
    return window.getApp().findWorkspaceForProject(requireWindowProject(window, named));
}

export class DevModeOpenBlueprintInWorkspaceHandler extends IPCHandler<IPCEventType.devModeOpenBlueprintInWorkspace> {
    readonly name = IPCEventType.devModeOpenBlueprintInWorkspace;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        data: IPCEvents[IPCEventType.devModeOpenBlueprintInWorkspace]["data"],
    ): Promise<RequestStatus<void>> {
        let workspaceWindow: AppWindow<WindowAppType.Workspace> | undefined;
        try {
            workspaceWindow = requireWorkspaceForPreview(window, data.projectPath);
        } catch (error) {
            return this.failed(error);
        }
        if (data.ownerKind !== "surfaceMain" && data.ownerKind !== "widgetMain" && data.ownerKind !== "widgetValue") {
            return this.failed("Unsupported owner");
        }
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
        let workspaceWindow: AppWindow<WindowAppType.Workspace> | undefined;
        try {
            workspaceWindow = requireWorkspaceForPreview(window, data.projectPath);
        } catch (error) {
            return this.failed(error);
        }
        if (!workspaceWindow) {
            return this.success(void 0 as never);
        }

        workspaceWindow.sendIpcEvent(IPCEventType.workspaceBlueprintDebugEvent, data.event);
        return this.success(void 0 as never);
    }
}

export class DevModeForwardStoryRowHandler extends IPCHandler<IPCEventType.devModeForwardStoryRow> {
    readonly name = IPCEventType.devModeForwardStoryRow;
    readonly type = IPCMessageType.message;

    public handle(
        window: AppWindow,
        data: IPCEvents[IPCEventType.devModeForwardStoryRow]["data"],
    ): RequestStatus<never> {
        let workspaceWindow: AppWindow<WindowAppType.Workspace> | undefined;
        try {
            workspaceWindow = requireWorkspaceForPreview(window, data.projectPath);
        } catch (error) {
            return this.failed(error);
        }
        if (!workspaceWindow) {
            return this.success(void 0 as never);
        }

        // Deliberately no show()/focus(): the play head follows execution in place, it does not
        // yank the workspace forward.
        workspaceWindow.sendIpcEvent(IPCEventType.workspaceStoryRowHighlight, {
            storyId: data.storyId,
            sceneId: data.sceneId,
            blockId: data.blockId,
        });
        return this.success(void 0 as never);
    }
}

/**
 * "Open this row in Studio", from the Dev Mode error banner.
 *
 * The sibling of {@link DevModeForwardStoryRowHandler} that is allowed to be rude: it opens the
 * scene editor and pulls the workspace forward, because unlike the play head it only ever runs
 * because the author clicked something asking for exactly that. A request rather than a message so
 * the banner can say "no workspace open for this project" instead of appearing to do nothing.
 */
export class DevModeOpenStoryRowInWorkspaceHandler extends IPCHandler<IPCEventType.devModeOpenStoryRowInWorkspace> {
    readonly name = IPCEventType.devModeOpenStoryRowInWorkspace;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        data: IPCEvents[IPCEventType.devModeOpenStoryRowInWorkspace]["data"],
    ): Promise<RequestStatus<void>> {
        let workspaceWindow: AppWindow<WindowAppType.Workspace> | undefined;
        try {
            workspaceWindow = requireWorkspaceForPreview(window, data.projectPath);
        } catch (error) {
            return this.failed(error);
        }
        if (!workspaceWindow) {
            return this.failed("No workspace for project");
        }

        workspaceWindow.sendIpcEvent(IPCEventType.workspaceStoryRowOpen, {
            storyId: data.storyId,
            sceneId: data.sceneId,
            blockId: data.blockId,
        });
        workspaceWindow.getBrowserWindow().show();
        workspaceWindow.getBrowserWindow().focus();

        return this.success();
    }
}
