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
    type PluginBlueprintNodeDef,
    type PluginCleanup,
    type PluginMessageBundle,
    type PluginTranslator,
    type PluginVoiceUnitEntry,
} from "@/plugin";
import type { BlueprintNodeDef } from "@/lib/ui-editor/blueprint-nodes/types";
import type {
    RuntimePluginGame,
    RuntimePluginLogLevel,
} from "@/lib/ui-editor/runtime/plugins/runtimePluginApi";
import type { RuntimePluginHost } from "@/lib/ui-editor/runtime/plugins/runtimePluginHost";
import { i18nStore } from "@/lib/i18n/store";
import { isActionMenuAction, isActionMenuSeparator } from "@/apps/workspace/components/ui/actionMenuModel";
import type { ActionGroup, ActionMenuItem } from "@/apps/workspace/registry/types";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import { VoiceService } from "@/lib/workspace/services/voice/VoiceService";
import { CharacterService } from "@/lib/workspace/services/core/CharacterService";
import { extractVoiceableRows } from "@/lib/workspace/services/voice/voiceModel";
import { listSceneIdsInDocumentOrder } from "@shared/types/story/order";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { ServiceAssetsService } from "@/lib/workspace/services/core/ServiceAssetsService";
import { WorkspaceFreezeService } from "@/lib/workspace/services/core/WorkspaceFreezeService";
import { WorkspaceReloadService } from "@/lib/workspace/services/core/WorkspaceReloadService";
import { BlueprintNodeCatalogService } from "@/lib/workspace/services/ui-editor/BlueprintNodeCatalogService";
import { ProjectDependencyService } from "@/lib/workspace/services/core/ProjectDependencyService";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import { testRegistry } from "@/lib/testing/registry";
import { TEST_PROTOCOL_VERSION } from "@/lib/testing/types";
import type { WorkspacePluginDescriptor } from "@shared/types/plugins";
import { FsRejectErrorCode } from "@shared/types/os";
import { pluginStoreNamespace } from "@shared/utils/pluginStorage";

type PluginModule = {
    default?: unknown;
    plugin?: unknown;
};

const PLUGIN_INTERPOLATION = /\{(\w+)\}/g;

function pluginInterpolate(template: string, params?: Record<string, string | number>): string {
    if (!params) {
        return template;
    }
    return template.replace(PLUGIN_INTERPOLATION, (match, name: string) =>
        name in params ? String(params[name]) : match,
    );
}

/**
 * Build a translator over a plugin's own message bundle that follows the editor
 * locale live: `.locale` and `t()` read `i18nStore` at call time, so one
 * instance stays correct across language switches.
 */
function createPluginTranslator(bundle: PluginMessageBundle): PluginTranslator {
    const fallbackLocale = bundle.fallbackLocale ?? Object.keys(bundle.messages)[0] ?? "";
    const resolve = (key: string): string => {
        const active = i18nStore.getLocale();
        const primary = bundle.messages[active]?.[key];
        if (primary !== undefined) {
            return primary;
        }
        return bundle.messages[fallbackLocale]?.[key] ?? key;
    };
    return {
        get locale() {
            return i18nStore.getLocale();
        },
        t: (key, params) => pluginInterpolate(resolve(key), params),
    };
}

/** Enforce that a plugin-registered id/type is namespaced under the plugin id. */
function assertOwnedId(pluginId: string, id: string, kind: string): void {
    const trimmed = typeof id === "string" ? id.trim() : "";
    if (!trimmed.startsWith(`${pluginId}.`)) {
        throw new Error(`[plugin:${pluginId}] ${kind} id "${id}" must be prefixed with "${pluginId}."`);
    }
}

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
    // Suppressing them here - before import()/setup() - keeps their nodes, widgets,
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

/**
 * Blueprint node registrations must match the manifest's declarative
 * contributes list: the static project validation (pack compile) trusts
 * contributes to know which plugin provides a node's runtime execute, so an
 * undeclared registration would silently break packaged games.
 */
function assertDeclaredBlueprintNode(descriptor: WorkspacePluginDescriptor, type: string): void {
    if (!descriptor.manifest.contributes.blueprintNodes.includes(type)) {
        throw new Error(
            `Blueprint node type is not declared in manifest contributes.blueprintNodes: ${type}. ` +
            "Declare it so Studio can statically validate projects that use it.",
        );
    }
}

function assertDeclaredWidget(descriptor: WorkspacePluginDescriptor, type: string): void {
    if (!descriptor.manifest.contributes.widgets.includes(type)) {
        throw new Error(
            `Widget type is not declared in manifest contributes.widgets: ${type}. ` +
            "Declare it so Studio can statically validate projects that use it.",
        );
    }
}

/**
 * Test registrations must match `contributes.tests` for a reason the other two
 * do not share: the manifest is the only thing that can say what a plugin checks
 * *before its code runs*. The Launcher lists a plugin's tests from the manifest
 * alone, so a test that exists only at registration time is one the author is
 * never told about until they have already installed and loaded the plugin.
 */
function assertDeclaredTest(descriptor: WorkspacePluginDescriptor, id: string): void {
    if (!descriptor.manifest.contributes.tests.includes(id)) {
        throw new Error(
            `Test id is not declared in manifest contributes.tests: ${id}. ` +
            "Declare it so Studio can list what this plugin checks before loading it.",
        );
    }
}

/**
 * Build the `game` handed to a plugin node's execute while it runs in the editor.
 *
 * Studio is an environment that backs nothing. Game shells each pass the
 * {@link RuntimePluginHost} subset they can actually serve — the Dev Mode window,
 * the preview shell, the web export all differ — and the editor's subset is empty:
 * there is no playthrough to read state from, no save file, no game to draw an
 * overlay over. So every capability-gated domain is *absent from this object*,
 * indistinguishable from one the manifest never declared, and only the four
 * always-present members remain. Plugin nodes already have to survive that (the
 * web export has no sidecar either); running in the editor is the same situation.
 *
 * Nothing here closes over `hostAdapter`. Routing the host context back in through
 * a side door would undo exactly what narrowing the plugin execute achieved.
 */
function createEditorRuntimePluginGame(descriptor: WorkspacePluginDescriptor): RuntimePluginGame {
    const pluginId = descriptor.plugin.id;
    const log = (level: RuntimePluginLogLevel, message: string): void => {
        const line = `[plugin:${pluginId}] ${message}`;
        if (level === "error") {
            console.error(line);
        } else if (level === "warning") {
            console.warn(line);
        } else {
            console.info(line);
        }
    };
    // Registration belongs to `setup(app)` in a game environment. In Studio the
    // equivalent is `app.services.*`, which the plugin already used to get this
    // node registered - so a call here is a mistake worth naming, not a silent
    // no-op that drops a contribution on the floor.
    const registrationUnavailable = (namespace: string): never => {
        throw new Error(
            `[plugin:${pluginId}] app.game.${namespace} is only available in a game runtime entry; ` +
            `use app.services.${namespace} from the studio entry instead.`,
        );
    };

    return {
        blueprintNodes: {
            register: () => registrationUnavailable("blueprintNodes"),
            registerMany: () => registrationUnavailable("blueprintNodes"),
        },
        widgets: {
            register: () => registrationUnavailable("widgets"),
            registerMany: () => registrationUnavailable("widgets"),
        },
        data: {
            // In a game this reads the copy published with the pack, synchronously.
            // The editor's authored copy lives behind the async storage service, so
            // there is nothing to return in time; documented as "degrade gracefully
            // rather than assume authored data exists", which is what null means.
            readJson: () => {
                log(
                    "warning",
                    "app.game.data is not readable in the editor; read the authored copy through "
                    + "app.services.storage in the studio entry and pass it into the node.",
                );
                return null;
            },
        },
        log,
    };
}

/**
 * Adapt a plugin's node definition to the editor catalog's wider execute.
 *
 * The narrowing happens here, mirroring `registerNode` in the runtime loader:
 * the host context carries `hostAdapter`, and with it saves, localization and
 * quit - none of which the manifest declared or the user approved. Only the
 * fields of {@link RuntimeBlueprintNodeContext} cross over, plus the same
 * capability-gated `game` the plugin's runtime entry would see.
 */
function toEditorBlueprintNodeDef(
    def: PluginBlueprintNodeDef,
    game: RuntimePluginGame,
): BlueprintNodeDef {
    return {
        ...def,
        execute: hostCtx => def.execute({
            params: hostCtx.params,
            resolveInput: hostCtx.resolveInput,
            eventName: hostCtx.eventName,
            eventPayload: hostCtx.eventPayload,
            signal: hostCtx.signal,
            game,
        }),
    };
}

/**
 * Keep a plugin's group in a menu of its own.
 *
 * A group declares where it lands on the macOS menu bar, and two of those slots are load-bearing
 * for Studio itself: `edit` lets a group's items stand in for the system Copy/Cut/Paste (and so
 * inherit their Cmd shortcuts), and `window` sits among the standard window commands. Those
 * belong to the surfaces Studio ships. A plugin still gets a full top-level menu - it just
 * cannot quietly become the thing Cmd+V does.
 *
 * `menuRole` is dropped for the same reason: it only means anything in the `edit` slot.
 */
function confineToOwnMenu(group: ActionGroup): ActionGroup {
    return {
        ...group,
        menuSlot: group.menuSlot === "none" ? "none" : "top-level",
        actions: group.actions?.map(action =>
            isActionMenuSeparator(action) ? action : { ...action, menuRole: undefined },
        ),
        items: group.items?.map(stripMenuRole),
    };
}

function stripMenuRole(item: ActionMenuItem): ActionMenuItem {
    if (isActionMenuSeparator(item)) {
        return item;
    }
    if (isActionMenuAction(item)) {
        return { ...item, menuRole: undefined };
    }
    return { ...item, items: item.items.map(stripMenuRole) };
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
    const story = ctx.services.get<StoryService>(Services.Story);
    const freeze = ctx.services.get<WorkspaceFreezeService>(Services.WorkspaceFreeze);
    const workspaceReload = ctx.services.get<WorkspaceReloadService>(Services.WorkspaceReload);
    // One per plugin, shared by every node it registers - the runtime loader
    // hands a node's execute the same `game` object `setup(app)` received.
    const nodeGame = createEditorRuntimePluginGame(descriptor);

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
    // Track a disposer in the unload bag and hand it back to the plugin.
    const trackReturn = (disposer: PluginCleanup): PluginCleanup => {
        track(disposer);
        return disposer;
    };
    // One cleanup that disposes every disposer from a registerMany call (LIFO).
    const combine = (disposers: PluginCleanup[]): PluginCleanup => () => {
        for (const disposer of disposers.splice(0).reverse()) {
            try {
                void disposer();
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
                // Always a `blob:` URL over bytes read from the project, for remote assets too: a
                // plugin handed a project's `https:` URL could put it in the DOM, which is the one
                // thing renderers may not do with a remote address.
                createObjectUrl: async asset => {
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
            workspace: {
                get frozen() {
                    return freeze.isFrozen();
                },
                get freezeReason() {
                    return freeze.getReason()?.kind ?? null;
                },
                onFreezeChange: listener => trackReturn(
                    freeze.onChanged(reason => listener(reason !== null, reason?.kind ?? null)),
                ),
                // Keyed by plugin id, so a plugin that re-registers replaces its own reader rather
                // than stacking a second one that reads into a store nobody owns any more.
                registerReloader: reload => trackReturn(workspaceReload.registerReloader({
                    id: `plugin:${descriptor.plugin.id}`,
                    label: descriptor.manifest.name || descriptor.plugin.id,
                    reload,
                })),
            },
            i18n: {
                get locale() {
                    return i18nStore.getLocale();
                },
                onLocaleChange: listener => {
                    let last = i18nStore.getLocale();
                    const disposer = i18nStore.subscribe(() => {
                        const next = i18nStore.getLocale();
                        if (next !== last) {
                            last = next;
                            listener(next);
                        }
                    });
                    return trackReturn(disposer);
                },
                formatNumber: (value, options) => i18nStore.getTranslator().formatNumber(value, options),
                formatDate: (value, options) => i18nStore.getTranslator().formatDate(value, options),
                formatList: (items, options) => i18nStore.getTranslator().formatList(items, options),
                createTranslator: bundle => createPluginTranslator(bundle),
            },
            tests: {
                protocolVersion: TEST_PROTOCOL_VERSION,
                register: definition => {
                    assertOwnedId(descriptor.plugin.id, definition.id, "test");
                    assertDeclaredTest(descriptor, definition.id);
                    // `ownerPluginId` is taken from the descriptor, never from the definition:
                    // a plugin must not be able to attribute its test to somebody else.
                    return trackReturn(testRegistry.register(definition, {
                        ownerPluginId: descriptor.plugin.id,
                        replaceExisting: true,
                    }));
                },
                registerMany: definitions => {
                    // Validate the whole batch before registering any of it, so a typo in the
                    // last definition does not leave the first half installed.
                    for (const definition of definitions) {
                        assertOwnedId(descriptor.plugin.id, definition.id, "test");
                        assertDeclaredTest(descriptor, definition.id);
                    }
                    return combine(definitions.map(definition => trackReturn(
                        testRegistry.register(definition, {
                            ownerPluginId: descriptor.plugin.id,
                            replaceExisting: true,
                        }),
                    )));
                },
            },
            textEditor: {
                // Purely imperative, exactly like `ui.panels`: no manifest `contributes` key
                // backs these. Nothing outside the open editor session needs to know a preview
                // exists, so a static declaration would be bookkeeping with no reader - and it
                // would have to be mirrored into the out-of-repo plugin registry's schema.
                registerLanguage: def => {
                    assertOwnedId(descriptor.plugin.id, def.id, "text editor language");
                    return trackReturn(ui.textEditor.registerLanguage(def));
                },
                registerPreview: def => {
                    assertOwnedId(descriptor.plugin.id, def.id, "text editor preview");
                    return trackReturn(ui.textEditor.registerPreview(def));
                },
                registerAction: def => {
                    assertOwnedId(descriptor.plugin.id, def.id, "text editor action");
                    return trackReturn(ui.textEditor.registerAction(def));
                },
            },
            ui: {
                panels: {
                    register: panel => {
                        assertOwnedId(descriptor.plugin.id, panel.id, "panel");
                        return trackReturn(ui.panels.register(panel as any));
                    },
                    registerMany: panels => combine(panels.map(panel => {
                        assertOwnedId(descriptor.plugin.id, panel.id, "panel");
                        return trackReturn(ui.panels.register(panel as any));
                    })),
                },
                actions: {
                    register: action => {
                        assertOwnedId(descriptor.plugin.id, action.id, "action");
                        ui.getStore().registerAction(action);
                        return trackReturn(() => ui.getStore().unregisterAction(action.id));
                    },
                    registerMany: actions => combine(actions.map(action => {
                        assertOwnedId(descriptor.plugin.id, action.id, "action");
                        ui.getStore().registerAction(action);
                        return trackReturn(() => ui.getStore().unregisterAction(action.id));
                    })),
                    registerGroup: group => {
                        assertOwnedId(descriptor.plugin.id, group.id, "action group");
                        ui.getStore().registerActionGroup(confineToOwnMenu(group));
                        return trackReturn(() => ui.getStore().unregisterActionGroup(group.id));
                    },
                },
                editors: {
                    // Opened tabs are deliberately not auto-closed on unload:
                    // they are user-visible state and force-closing is hostile UX.
                    open: (tab, groupId) => ui.editor.open(tab as any, groupId),
                    close: (tabId, groupId) => ui.getStore().closeEditorTabInGroup(tabId, groupId),
                },
                keybindings: {
                    register: keybinding => {
                        assertOwnedId(descriptor.plugin.id, keybinding.id, "keybinding");
                        return trackReturn(ui.keybindings.register(keybinding));
                    },
                    registerMany: keybindings => {
                        for (const keybinding of keybindings) {
                            assertOwnedId(descriptor.plugin.id, keybinding.id, "keybinding");
                        }
                        return trackReturn(ui.keybindings.registerMany(keybindings));
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
                    assertDeclaredWidget(descriptor, module.type);
                    widgetModuleRegistry.register(module, { ownerPluginId: descriptor.plugin.id });
                    return trackReturn(() => {
                        if (widgetModuleRegistry.get(module.type) === module) {
                            widgetModuleRegistry.unregister(module.type);
                        }
                    });
                },
                registerMany: modules => {
                    for (const module of modules) {
                        assertDeclaredWidget(descriptor, module.type);
                    }
                    return combine(modules.map(module => {
                        widgetModuleRegistry.register(module, { ownerPluginId: descriptor.plugin.id });
                        return trackReturn(() => {
                            if (widgetModuleRegistry.get(module.type) === module) {
                                widgetModuleRegistry.unregister(module.type);
                            }
                        });
                    }));
                },
                get: type => widgetModuleRegistry.get(type),
                list: () => widgetModuleRegistry.list(),
                has: type => widgetModuleRegistry.has(type),
            },
            story: {
                listStories: () => story.listStories().map(entry => ({
                    id: entry.id,
                    name: entry.name,
                })),
                listScenes: async storyId => {
                    const id = storyId.trim();
                    if (!id) {
                        return [];
                    }
                    // A story the author has not opened yet is not in memory;
                    // load it rather than reporting it as having no scenes.
                    const document = await story.loadStory(id);
                    return listSceneIdsInDocumentOrder(document).flatMap(sceneId => {
                        const scene = document.scenes[sceneId];
                        return scene
                            ? [{ id: scene.id, name: scene.name || scene.runtimeName || scene.id, storyId: id }]
                            : [];
                    });
                },
                actions: {
                    register: registration => {
                        assertOwnedId(descriptor.plugin.id, registration.id ?? "", "story action");
                        return trackReturn(story.registerPluginAction(registration));
                    },
                    registerMany: registrations => combine(registrations.map(registration => {
                        assertOwnedId(descriptor.plugin.id, registration.id ?? "", "story action");
                        return trackReturn(story.registerPluginAction(registration));
                    })),
                },
            },
            voice: {
                /**
                 * Every recorded take, joined to the line it voices so the
                 * author recognises it by text rather than by unit id.
                 *
                 * A project with no voice configured yields an empty list, not
                 * an error: "no voice yet" is a normal state for a plugin panel
                 * offering to curate it.
                 */
                listUnits: async localeCode => {
                    const voice = ctx.services.get<VoiceService>(Services.Voice);
                    const locales = voice.getConfiguration().voicedLocales;
                    const wanted = localeCode?.trim()
                        ? locales.filter(entry => entry.code === localeCode.trim())
                        : locales;
                    if (wanted.length === 0) {
                        return [];
                    }
                    // Line text lives in the story documents, keyed by the same
                    // unit id the voice table uses.
                    const characters = ctx.services.get<CharacterService>(Services.Character);
                    // The row carries a character *id*; a plugin panel showing a
                    // UUID where a speaker's name belongs is unusable, so it is
                    // resolved here and falls back to the id only if the
                    // character was deleted.
                    const speakerName = (characterId: string | undefined): string | null => {
                        if (!characterId) {
                            return null;
                        }
                        return characters.getCharacter(characterId)?.profile.getName() || characterId;
                    };
                    const rowsByUnitId = new Map<string, { text: string; character: string | null }>();
                    for (const entry of story.listStories()) {
                        const document = await story.loadStory(entry.id);
                        for (const row of extractVoiceableRows(document)) {
                            rowsByUnitId.set(row.unitId, {
                                text: row.sourceText,
                                character: speakerName(row.characterId),
                            });
                        }
                    }
                    const units: PluginVoiceUnitEntry[] = [];
                    for (const locale of wanted) {
                        const document = await voice.loadDocument(locale.code);
                        for (const [unitId, unit] of Object.entries(document.units)) {
                            const line = rowsByUnitId.get(unitId);
                            units.push({
                                unitId,
                                locale: locale.code,
                                text: line?.text ?? "",
                                character: line?.character ?? null,
                                durationSec: unit.duration ?? null,
                            });
                        }
                    }
                    return units;
                },
            },
            blueprintNodes: {
                // Node defs are deliberately not auto-removed on unload: the
                // catalog enforces per-plugin ownership with replaceExisting
                // semantics, and removing defs would break open documents
                // that reference them.
                register: def => {
                    assertDeclaredBlueprintNode(descriptor, def.type);
                    blueprintNodes.register(toEditorBlueprintNodeDef(def, nodeGame), {
                        ownerPluginId: descriptor.plugin.id,
                        replaceExisting: true,
                    });
                },
                registerMany: defs => {
                    for (const def of defs) {
                        assertDeclaredBlueprintNode(descriptor, def.type);
                    }
                    blueprintNodes.registerMany(
                        defs.map(def => toEditorBlueprintNodeDef(def, nodeGame)),
                        {
                            ownerPluginId: descriptor.plugin.id,
                            replaceExisting: true,
                        },
                    );
                },
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
