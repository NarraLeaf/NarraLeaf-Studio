import { getInterface } from "@/lib/app/bridge";
import { createPluginPrivilegedFacade } from "@/lib/app/privilegedFacade";
import * as React from "react";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import * as ReactJsxRuntime from "react/jsx-runtime";
import * as ReactJsxDevRuntime from "react/jsx-dev-runtime";
import {
    isPluginDefinition,
    definePlugin,
    ui as pluginUi,
    AssetSource,
    AssetType,
    PanelPosition,
    type PluginApp,
    type PluginCleanup,
} from "@/plugin";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { ServiceAssetsService } from "@/lib/workspace/services/core/ServiceAssetsService";
import { BlueprintNodeCatalogService } from "@/lib/workspace/services/ui-editor/BlueprintNodeCatalogService";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import type { WorkspacePluginDescriptor } from "@shared/types/plugins";
import { FsRejectErrorCode } from "@shared/types/os";

type PluginModule = {
    default?: unknown;
    plugin?: unknown;
};

export type WorkspacePluginLoadResult =
    | {
        pluginId: string;
        ok: true;
        cleanup?: PluginCleanup;
    }
    | {
        pluginId: string;
        ok: false;
        error: string;
    };

const workspacePluginLoadQueues = new WeakMap<WorkspaceContext, Promise<void>>();

export async function loadWorkspacePlugins(ctx: WorkspaceContext): Promise<WorkspacePluginLoadResult[]> {
    exposePluginModule();
    const previous = workspacePluginLoadQueues.get(ctx) ?? Promise.resolve();
    const loadTask = previous.then(() => loadWorkspacePluginsNow(ctx));
    workspacePluginLoadQueues.set(ctx, loadTask.then(
        () => undefined,
        () => undefined,
    ));
    return loadTask;
}

async function loadWorkspacePluginsNow(ctx: WorkspaceContext): Promise<WorkspacePluginLoadResult[]> {
    const result = await getInterface().plugins.getWorkspacePlugins();
    if (!result.success) {
        throw new Error(result.error ?? "Failed to load workspace plugins");
    }

    const loadResults = await Promise.all(
        result.data.plugins.map(descriptor => loadWorkspacePlugin(ctx, descriptor)),
    );

    return loadResults;
}

async function loadWorkspacePlugin(
    ctx: WorkspaceContext,
    descriptor: WorkspacePluginDescriptor,
): Promise<WorkspacePluginLoadResult> {
    const runtime = createPluginPrivilegedFacade(descriptor.plugin);
    try {
        const mod = await import(descriptor.entryUrl) as PluginModule;
        const definition = resolvePluginDefinition(mod);

        const setupResult = await definition.setup(createPluginApp(ctx, descriptor, runtime.app));
        const cleanup = typeof setupResult === "function"
            ? async () => {
                await setupResult();
                runtime.revoke();
            }
            : () => runtime.revoke();

        await getInterface().plugins.reportLoadError(descriptor.plugin.id, null);
        return {
            pluginId: descriptor.plugin.id,
            ok: true,
            cleanup,
        };
    } catch (error) {
        runtime.revoke();
        const message = error instanceof Error ? error.message : String(error);
        await getInterface().plugins.reportLoadError(descriptor.plugin.id, message);
        return {
            pluginId: descriptor.plugin.id,
            ok: false,
            error: message,
        };
    }
}

export function resolvePluginDefinition(mod: PluginModule) {
    const definition = mod.default ?? mod.plugin;
    if (!isPluginDefinition(definition)) {
        throw new Error("Plugin entry must default-export definePlugin({ setup })");
    }
    return definition;
}

function exposePluginModule(): void {
    const global = globalThis as typeof globalThis & {
        __NLS_PLUGIN_MODULE__?: {
            definePlugin: typeof definePlugin;
            ui: typeof pluginUi;
            AssetType: typeof AssetType;
            AssetSource: typeof AssetSource;
            PanelPosition: typeof PanelPosition;
            externals: {
                react: typeof React;
                reactDom: typeof ReactDOM;
                reactDomClient: typeof ReactDOMClient;
                jsxRuntime: typeof ReactJsxRuntime;
                jsxDevRuntime: typeof ReactJsxDevRuntime;
            };
        };
    };
    global.__NLS_PLUGIN_MODULE__ = {
        definePlugin,
        ui: pluginUi,
        AssetType,
        AssetSource,
        PanelPosition,
        externals: {
            react: React,
            reactDom: ReactDOM,
            reactDomClient: ReactDOMClient,
            jsxRuntime: ReactJsxRuntime,
            jsxDevRuntime: ReactJsxDevRuntime,
        },
    };
}

function createPluginApp(
    ctx: WorkspaceContext,
    descriptor: WorkspacePluginDescriptor,
    privileged: PluginApp["privileged"],
): PluginApp {
    const ui = ctx.services.get<UIService>(Services.UI);
    const assets = ctx.services.get<AssetsService>(Services.Assets);
    const storage = ctx.services.get<ServiceAssetsService>(Services.ServiceAssets);
    const blueprintNodes = ctx.services.get<BlueprintNodeCatalogService>(Services.BlueprintNodeCatalog);

    return {
        plugin: descriptor.plugin,
        manifest: descriptor.manifest,
        privileged,
        services: {
            get: <T,>(service: Services) => ctx.services.get(service) as T,
            workspace: ctx,
            storage: {
                readJson: async namespace => {
                    const result = await storage.readStore(namespace);
                    if (result.ok) {
                        return result.data as any;
                    }
                    if (result.error.code === FsRejectErrorCode.NOT_FOUND) {
                        return null;
                    }
                    throw new Error(result.error.message);
                },
                writeJson: async (namespace, data) => {
                    const result = await storage.writeStore(namespace, data);
                    if (!result.ok) {
                        throw new Error(result.error.message);
                    }
                },
            },
            assets: {
                getMap: () => assets.getAssets(),
                list: type => Object.values(assets.getAssets()[type] ?? {}) as any,
                get: (type, assetId) => assets.getAssets()[type]?.[assetId] as any,
                fetch: async asset => {
                    const result = await assets.fetch(asset as any);
                    if (!result.success || !result.data) {
                        throw new Error(result.error ?? `Failed to fetch asset: ${asset.id}`);
                    }
                    return result.data as any;
                },
                createObjectUrl: async asset => {
                    if (asset.source === AssetSource.Remote) {
                        const url = (asset.meta as { url?: unknown }).url;
                        if (typeof url === "string" && url.trim()) {
                            return url;
                        }
                    }
                    const result = await assets.fetch(asset as any);
                    if (!result.success || !result.data) {
                        throw new Error(result.error ?? `Failed to fetch asset: ${asset.id}`);
                    }
                    const data = (result.data as { data: unknown }).data;
                    const bytes = data instanceof Uint8Array
                        ? data
                        : new TextEncoder().encode(JSON.stringify(data ?? null));
                    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
                    return URL.createObjectURL(new Blob([buffer]));
                },
                revokeObjectUrl: url => {
                    if (url.startsWith("blob:")) {
                        URL.revokeObjectURL(url);
                    }
                },
            },
            ui: {
                panels: {
                    register: panel => ui.panels.register(panel as any),
                    unregister: id => ui.panels.unregister(id),
                },
                actions: {
                    register: action => ui.getStore().registerAction(action),
                    unregister: id => ui.getStore().unregisterAction(id),
                    registerGroup: group => ui.getStore().registerActionGroup(group),
                    unregisterGroup: id => ui.getStore().unregisterActionGroup(id),
                },
                editors: {
                    open: (tab, groupId) => ui.editor.open(tab as any, groupId),
                    close: (tabId, groupId) => ui.getStore().closeEditorTabInGroup(tabId, groupId),
                },
                keybindings: {
                    register: keybinding => ui.keybindings.register(keybinding),
                    registerMany: keybindings => ui.keybindings.registerMany(keybindings),
                },
                notifications: {
                    info: message => ui.notifications.info(message),
                    success: message => ui.notifications.success(message),
                    warning: message => ui.notifications.warning(message),
                    error: message => ui.notifications.error(message),
                },
            },
            widgets: {
                register: module => widgetModuleRegistry.register(module),
                registerMany: modules => widgetModuleRegistry.registerMany(modules),
                get: type => widgetModuleRegistry.get(type),
                list: () => widgetModuleRegistry.list(),
                has: type => widgetModuleRegistry.has(type),
            },
            blueprintNodes: {
                register: def => blueprintNodes.register(def, {
                    ownerPluginId: descriptor.plugin.id,
                    replaceExisting: true,
                }),
                registerMany: defs => blueprintNodes.registerMany(defs, {
                    ownerPluginId: descriptor.plugin.id,
                    replaceExisting: true,
                }),
                registerDynamicSelectOptionsSource: (sourceId, provider) =>
                    blueprintNodes.registerDynamicSelectOptionsSource(sourceId, provider, {
                        ownerPluginId: descriptor.plugin.id,
                        replaceExisting: true,
                    }),
                notifyDynamicSelectOptionsChanged: () => blueprintNodes.notifyDynamicSelectOptionsChanged(),
            },
        },
    };
}
