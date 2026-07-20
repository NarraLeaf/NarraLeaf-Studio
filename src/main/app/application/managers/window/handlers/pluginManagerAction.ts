import { dialog } from "electron";
import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import { PrivilegedCapability } from "@shared/types/privileged";
import type {
    PluginApproveResult,
    PluginInstallResult,
    PluginListItem,
    RuntimePluginDescriptor,
    WorkspacePluginDescriptor,
} from "@shared/types/plugins";
import { WindowAppType, WindowCloseResults } from "@shared/types/window";
import { resolveDependencies } from "@shared/utils/resolveDependencies";
import { readProjectConfigFromDir } from "../../../utils/projectConfigFile";
import { readPublishedPluginData } from "../../pluginRuntimeData";
import { authorizeActorCapabilityRequest } from "../actorAuthorization";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

function ensurePluginInstallCapability(window: AppWindow): RequestStatus<never> | null {
    const authorization = authorizeActorCapabilityRequest(
        window,
        { kind: "facade", id: "default" },
        PrivilegedCapability.PluginInstall,
    );
    if (!authorization.allowed) {
        return {
            success: false,
            error: authorization.reason ?? "Plugin management is not allowed",
        };
    }
    return null;
}

export class PluginListHandler extends IPCHandler<IPCEventType.pluginList> {
    readonly name = IPCEventType.pluginList;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow): Promise<RequestStatus<{ plugins: PluginListItem[] }>> {
        return this.success({ plugins: await window.app.pluginManager.listPlugins() });
    }
}

export class PluginInstallLocalHandler extends IPCHandler<IPCEventType.pluginInstallLocal> {
    readonly name = IPCEventType.pluginInstallLocal;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow): Promise<RequestStatus<PluginInstallResult>> {
        const denied = ensurePluginInstallCapability(window);
        if (denied) return denied;

        const result = await dialog.showOpenDialog(window.win, {
            title: "Install Plugin",
            properties: ["openDirectory"],
            buttonLabel: "Install Plugin",
        });
        if (result.canceled || result.filePaths.length === 0) {
            return this.success({ canceled: true });
        }

        return this.tryUse(() => window.app.pluginManager.installFromDirectory(result.filePaths[0]));
    }
}

export class PluginSetEnabledHandler extends IPCHandler<IPCEventType.pluginSetEnabled> {
    readonly name = IPCEventType.pluginSetEnabled;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        data: IPCEvents[IPCEventType.pluginSetEnabled]["data"],
    ): Promise<RequestStatus<PluginListItem>> {
        const denied = ensurePluginInstallCapability(window);
        if (denied) return denied;
        return this.tryUse(() => window.app.pluginManager.setPluginEnabled(data.pluginId, data.enabled));
    }
}

export class PluginApproveHandler extends IPCHandler<IPCEventType.pluginApprove> {
    readonly name = IPCEventType.pluginApprove;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        data: IPCEvents[IPCEventType.pluginApprove]["data"],
    ): Promise<RequestStatus<PluginApproveResult>> {
        const denied = ensurePluginInstallCapability(window);
        if (denied) return denied;

        const request = await window.app.pluginManager.buildInstallRequest(data.pluginId);
        const promptWindow = await window.getApp().launchPluginPermissionPrompt(window, { request });
        window.addChild(promptWindow);

        return new Promise<RequestStatus<PluginApproveResult>>(resolve => {
            promptWindow.setCloseResultResolver(async (result: WindowCloseResults[WindowAppType.PluginPermissionPrompt]) => {
                try {
                    const approval = await window.app.pluginManager.approvePlugin(data.pluginId, result ?? null);
                    resolve(this.success(approval));
                } catch (error) {
                    resolve(this.failed(error));
                }
            });
        });
    }
}

export class PluginUninstallHandler extends IPCHandler<IPCEventType.pluginUninstall> {
    readonly name = IPCEventType.pluginUninstall;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        data: IPCEvents[IPCEventType.pluginUninstall]["data"],
    ): Promise<RequestStatus<void>> {
        const denied = ensurePluginInstallCapability(window);
        if (denied) return denied;
        return this.tryUse(() => window.app.pluginManager.uninstallPlugin(data.pluginId));
    }
}

export class PluginRevokeHandler extends IPCHandler<IPCEventType.pluginRevoke> {
    readonly name = IPCEventType.pluginRevoke;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        data: IPCEvents[IPCEventType.pluginRevoke]["data"],
    ): Promise<RequestStatus<PluginListItem>> {
        const denied = ensurePluginInstallCapability(window);
        if (denied) return denied;
        return this.tryUse(() => window.app.pluginManager.revokePlugin(data.pluginId));
    }
}

export class PluginWorkspaceListHandler extends IPCHandler<IPCEventType.pluginWorkspaceList> {
    readonly name = IPCEventType.pluginWorkspaceList;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow): Promise<RequestStatus<{ plugins: WorkspacePluginDescriptor[] }>> {
        if (window.getWindowType() !== WindowAppType.Workspace) {
            return this.failed("Workspace plugins can only be requested by workspace windows");
        }
        return this.success({ plugins: await window.app.pluginManager.listWorkspacePlugins() });
    }
}

export class PluginRuntimeListHandler extends IPCHandler<IPCEventType.pluginRuntimeList> {
    readonly name = IPCEventType.pluginRuntimeList;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow): Promise<RequestStatus<{ plugins: RuntimePluginDescriptor[] }>> {
        if (window.getWindowType() !== WindowAppType.DevMode) {
            return this.failed("Runtime plugins can only be requested by Dev Mode windows");
        }
        const plugins = await window.app.pluginManager.listRuntimePlugins();
        const allowed = await this.filterSuppressed(window, plugins);
        return this.success({ plugins: await this.attachRuntimeData(window, allowed) });
    }

    /**
     * Dev Mode reads the live project rather than a pack, so publishable plugin
     * storage is loaded straight from `editor/services`. Best-effort: a project
     * without a resolvable path just gets descriptors with no data, and the
     * plugin degrades the same way it would in a game built before the data
     * channel existed.
     */
    private async attachRuntimeData(
        window: AppWindow,
        plugins: RuntimePluginDescriptor[],
    ): Promise<RuntimePluginDescriptor[]> {
        const projectPath = (window.getProps() as { projectPath?: unknown }).projectPath;
        if (typeof projectPath !== "string" || !projectPath.trim()) {
            return plugins;
        }
        return Promise.all(plugins.map(async descriptor => {
            try {
                const data = await readPublishedPluginData({
                    projectPath,
                    manifest: descriptor.manifest,
                    onWarning: message => console.warn("[PluginRuntimeListHandler]", message),
                });
                return data ? { ...descriptor, data } : descriptor;
            } catch (error) {
                console.warn(
                    `[PluginRuntimeListHandler] failed to read runtime data of plugin "${descriptor.plugin.id}":`,
                    error,
                );
                return descriptor;
            }
        }));
    }

    /**
     * Mirror the workspace's per-project dependency suppression: a plugin whose
     * installed version is incompatible with what the project was authored
     * against must not execute in that project's Dev Mode session either.
     * Resolution failures never block the session - suppression is best-effort.
     */
    private async filterSuppressed(
        window: AppWindow,
        plugins: RuntimePluginDescriptor[],
    ): Promise<RuntimePluginDescriptor[]> {
        const projectPath = (window.getProps() as { projectPath?: unknown }).projectPath;
        if (typeof projectPath !== "string" || !projectPath.trim()) {
            return plugins;
        }
        try {
            const projectConfig = await readProjectConfigFromDir(projectPath);
            const table = projectConfig?.dependencies;
            if (!table || table.plugins.length === 0) {
                return plugins;
            }
            const installed = (await window.app.pluginManager.listPlugins()).map(plugin => ({
                id: plugin.pluginId,
                version: plugin.manifest.version,
                enabled: plugin.enabled,
            }));
            const suppressed = new Set(resolveDependencies(table, installed).suppressedPluginIds);
            return plugins.filter(descriptor => !suppressed.has(descriptor.plugin.id));
        } catch (error) {
            console.warn("[PluginRuntimeListHandler] dependency suppression skipped:", error);
            return plugins;
        }
    }
}

export class PluginReportLoadErrorHandler extends IPCHandler<IPCEventType.pluginReportLoadError> {
    readonly name = IPCEventType.pluginReportLoadError;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        data: IPCEvents[IPCEventType.pluginReportLoadError]["data"],
    ): Promise<RequestStatus<PluginListItem>> {
        if (window.getWindowType() !== WindowAppType.Workspace) {
            return this.failed("Plugin load errors can only be reported by workspace windows");
        }
        return this.tryUse(() => window.app.pluginManager.reportLoadError(data.pluginId, data.error));
    }
}
