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
import { ProjectDependencyService } from "@/lib/workspace/services/core/ProjectDependencyService";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import type { WorkspacePluginDescriptor } from "@shared/types/plugins";
import { FsRejectErrorCode } from "@shared/types/os";
import { pluginStoreNamespace } from "@shared/utils/pluginStorage";

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

    // Skip plugins this project's dependency resolution flagged as incompatible
    // (e.g. a built-in plugin whose major version changed across a Studio update).
    // Suppressing them here — before import()/setup() — keeps their nodes, widgets,
    // and actions from registering and corrupting the open project.
    const suppressed = new Set(
        ctx.services.get<ProjectDependencyService>(Services.ProjectDependency).getSuppressedPluginIds(),
    );
    const descriptors = result.data.plugins;
    const eligible = descriptors.filter(descriptor => !suppressed.has(descriptor.plugin.id));

    const skipped = descriptors.filter(descriptor => suppressed.has(descriptor.plugin.id));
    if (skipped.length > 0) {
        const names = skipped.map(descriptor => descriptor.manifest.name).join(", ");
        ctx.services.get<UIService>(Services.UI).notifications.warning(
            `Disabled plugin(s) incompatible with this project: ${names}. Update or re-enable them from the plugins manager.`,
        );
    }

    const loadResults = await Promise.all(
        eligible.map(descriptor => loadWorkspacePlugin(ctx, descriptor)),
    );

    return loadResults;
}

async function loadWorkspacePlugin(
    ctx: WorkspaceContext,
    descriptor: WorkspacePluginDescriptor,
): Promise<WorkspacePluginLoadResult> {
    const runtime = createPluginPrivilegedFacade(descriptor.plugin);
    const { app, dispose } = createPluginApp(ctx, descriptor, runtime.app);
    try {
        const mod = await import(descriptor.entryUrl) as PluginModule;
        const definition = resolvePluginDefinition(mod);

        const setupResult = await definition.setup(app);
        const cleanup = async () => {
            if (typeof setupResult === "function") {
                try {
                    await setupResult();
                } catch (error) {
                    console.error(`[plugin:${descriptor.plugin.id}] cleanup failed:`, error);
                }
            }
            dispose();
            runtime.revoke();
        };

        await getInterface().plugins.reportLoadError(descriptor.plugin.id, null);
        return {
            pluginId: descriptor.plugin.id,
            ok: true,
            cleanup,
        };
    } catch (error) {
        // Reclaim any registrations made before setup failed.
        dispose();
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

type PluginModuleGlobal = {
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

export function exposePluginModule(): void {
    const global = globalThis as typeof globalThis & {
        __NLS_PLUGIN_MODULE__?: PluginModuleGlobal;
    };
    if (global.__NLS_PLUGIN_MODULE__) {
        return;
    }
    // Frozen and defined non-writable/non-configurable so no plugin can
    // replace or poison the module that later-loading plugins import.
    // ESM namespace objects (React etc.) are spec-immutable already; freezing
    // the wrapper objects is sufficient. pluginUi is frozen at its source.
    const moduleValue: PluginModuleGlobal = Object.freeze({
        definePlugin,
        ui: pluginUi,
        AssetType: Object.freeze(AssetType),
        AssetSource: Object.freeze(AssetSource),
        PanelPosition: Object.freeze(PanelPosition),
        externals: Object.freeze({
            react: React,
            reactDom: ReactDOM,
            reactDomClient: ReactDOMClient,
            jsxRuntime: ReactJsxRuntime,
            jsxDevRuntime: ReactJsxDevRuntime,
        }),
    });
    Object.defineProperty(global, "__NLS_PLUGIN_MODULE__", {
        value: moduleValue,
        writable: false,
        configurable: false,
        enumerable: false,
    });
}

export function createPluginApp(
    ctx: WorkspaceContext,
    descriptor: WorkspacePluginDescriptor,
    privileged: PluginApp["privileged"],
): { app: PluginApp; dispose: () => void } {
    const ui = ctx.services.get<UIService>(Services.UI);
    const assets = ctx.services.get<AssetsService>(Services.Assets);
    const storage = ctx.services.get<ServiceAssetsService>(Services.ServiceAssets);
    const blueprintNodes = ctx.services.get<BlueprintNodeCatalogService>(Services.BlueprintNodeCatalog);

    // Every registration a plugin makes through this app object is recorded
    // so the host can reclaim it on unload, even if the plugin's own cleanup
    // forgets to (or setup() throws halfway through).
    const disposables: Array<() => void> = [];
    const track = (disposer: () => void): void => {
        disposables.push(disposer);
    };
    const dispose = (): void => {
        for (const disposer of disposables.splice(0).reverse()) {
            try {
                disposer();
            } catch (error) {
                console.error(`[plugin:${descriptor.plugin.id}] failed to dispose registration:`, error);
            }
        }
    };

    const app: PluginApp = {
        plugin: descriptor.plugin,
        manifest: descriptor.manifest,
        privileged,
        services: {
            storage: {
                readJson: async namespace => {
                    const result = await storage.readStore(pluginStoreNamespace(descriptor.plugin.id, namespace));
                    if (result.ok) {
                        return result.data as any;
                    }
                    if (result.error.code === FsRejectErrorCode.NOT_FOUND) {
                        return null;
                    }
                    throw new Error(result.error.message);
                },
                writeJson: async (namespace, data) => {
                    const result = await storage.writeStore(pluginStoreNamespace(descriptor.plugin.id, namespace), data);
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
                    register: panel => {
                        track(ui.panels.register(panel as any));
                    },
                    unregister: id => ui.panels.unregister(id),
                },
                actions: {
                    register: action => {
                        ui.getStore().registerAction(action);
                        track(() => ui.getStore().unregisterAction(action.id));
                    },
                    unregister: id => ui.getStore().unregisterAction(id),
                    registerGroup: group => {
                        ui.getStore().registerActionGroup(group);
                        track(() => ui.getStore().unregisterActionGroup(group.id));
                    },
                    unregisterGroup: id => ui.getStore().unregisterActionGroup(id),
                },
                editors: {
                    // Opened tabs are deliberately not auto-closed on unload:
                    // they are user-visible state and force-closing is hostile UX.
                    open: (tab, groupId) => ui.editor.open(tab as any, groupId),
                    close: (tabId, groupId) => ui.getStore().closeEditorTabInGroup(tabId, groupId),
                },
                keybindings: {
                    register: keybinding => {
                        const disposer = ui.keybindings.register(keybinding);
                        track(disposer);
                        return disposer;
                    },
                    registerMany: keybindings => {
                        const disposer = ui.keybindings.registerMany(keybindings);
                        track(disposer);
                        return disposer;
                    },
                },
                notifications: {
                    info: message => ui.notifications.info(message),
                    success: message => ui.notifications.success(message),
                    warning: message => ui.notifications.warning(message),
                    error: message => ui.notifications.error(message),
                },
            },
            widgets: {
                register: module => {
                    widgetModuleRegistry.register(module, { ownerPluginId: descriptor.plugin.id });
                    track(() => {
                        if (widgetModuleRegistry.get(module.type) === module) {
                            widgetModuleRegistry.unregister(module.type);
                        }
                    });
                },
                registerMany: modules => {
                    for (const module of modules) {
                        widgetModuleRegistry.register(module, { ownerPluginId: descriptor.plugin.id });
                        track(() => {
                            if (widgetModuleRegistry.get(module.type) === module) {
                                widgetModuleRegistry.unregister(module.type);
                            }
                        });
                    }
                },
                get: type => widgetModuleRegistry.get(type),
                list: () => widgetModuleRegistry.list(),
                has: type => widgetModuleRegistry.has(type),
            },
            blueprintNodes: {
                // Node defs are deliberately not auto-removed on unload: the
                // catalog enforces per-plugin ownership with replaceExisting
                // semantics, and removing defs would break open documents
                // that reference them.
                register: def => blueprintNodes.register(def, {
                    ownerPluginId: descriptor.plugin.id,
                    replaceExisting: true,
                }),
                registerMany: defs => blueprintNodes.registerMany(defs, {
                    ownerPluginId: descriptor.plugin.id,
                    replaceExisting: true,
                }),
                registerDynamicSelectOptionsSource: (sourceId, provider) => {
                    const disposer = blueprintNodes.registerDynamicSelectOptionsSource(sourceId, provider, {
                        ownerPluginId: descriptor.plugin.id,
                        replaceExisting: true,
                    });
                    track(disposer);
                    return disposer;
                },
                notifyDynamicSelectOptionsChanged: () => blueprintNodes.notifyDynamicSelectOptionsChanged(),
            },
        },
    };

    return { app, dispose };
}
