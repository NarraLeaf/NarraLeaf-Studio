/**
 * Loader for plugin runtime entries, shared by every game execution
 * environment (Dev Mode window, standalone Preview/Production runtime).
 *
 * The loader exposes the `narraleaf-studio/runtime` module implementation on a
 * frozen global; the per-environment protocol handler serves an ESM shim that
 * re-exports from that global. Importing the module outside a game runtime
 * therefore fails with a clear error. React externals are exposed on the same
 * global so plugin widget renderers resolve the host's React instance.
 */

import * as React from "react";
import * as ReactDOM from "react-dom";
import * as ReactJsxRuntime from "react/jsx-runtime";
import * as ReactJsxDevRuntime from "react/jsx-dev-runtime";
import type { RuntimePluginDescriptor } from "@shared/types/plugins";
import type { PluginRuntimeCapability } from "@shared/types/pluginPermissions";
import { behaviorNodeRegistry } from "../../behavior-graph/BehaviorNodeRegistry";
import type { ElementRendererRegistry } from "../ElementRendererRegistry";
import {
    defineRuntimePlugin,
    isRuntimePluginDefinition,
    type RuntimeBlueprintNodeDef,
    type RuntimePluginApp,
    type RuntimePluginGame,
    type RuntimePluginLogLevel,
    type RuntimePluginSidecarHandle,
    type RuntimeWidgetRendererDef,
} from "./runtimePluginApi";
import { registerStoryCompilePass, type StoryCompilePass } from "../game/storyCompilePass";
import type { RuntimePluginHost } from "./runtimePluginHost";

export const RUNTIME_PLUGIN_MODULE_GLOBAL = "__NLS_RUNTIME_PLUGIN_MODULE__";

export type RuntimePluginLoadResult =
    | { pluginId: string; ok: true }
    | { pluginId: string; ok: false; error: string };

export type RuntimePluginLoaderOptions = {
    log: (level: RuntimePluginLogLevel, message: string) => void;
    /**
     * Host element renderer registry. When provided, every widget renderer
     * collected so far (including ones from cache-hit plugins loaded for an
     * earlier registry) is applied to it after loading completes.
     */
    elementRenderers?: ElementRendererRegistry;
    /**
     * Capability backends this environment can serve. Anything absent here is
     * absent from `app.game` too, no matter what the manifest declared — a
     * shell that cannot spawn processes must not hand out a sidecar API that
     * fails at the first call.
     */
    host?: RuntimePluginHost;
};

type RuntimePluginModule = {
    default?: unknown;
    plugin?: unknown;
};

type RuntimePluginModuleGlobal = {
    defineRuntimePlugin: typeof defineRuntimePlugin;
    externals: {
        react: typeof React;
        reactDom: typeof ReactDOM;
        jsxRuntime: typeof ReactJsxRuntime;
        jsxDevRuntime: typeof ReactJsxDevRuntime;
    };
};

/** Owner plugin id per registered node type; guards cross-plugin collisions. */
const runtimeNodeOwners = new Map<string, string>();

/** Widget renderers collected from plugin setup, keyed by widget type. */
const runtimeWidgetRenderers = new Map<string, { ownerPluginId: string; def: RuntimeWidgetRendererDef }>();

/**
 * Load-once cache keyed by plugin id + version + entry URL. Game environments
 * never unload plugins, and React StrictMode double-invokes effects, so the
 * loader must be idempotent per page.
 */
const loadCache = new Map<string, Promise<RuntimePluginLoadResult>>();

export function exposeRuntimePluginModule(): void {
    const global = globalThis as typeof globalThis & {
        [RUNTIME_PLUGIN_MODULE_GLOBAL]?: RuntimePluginModuleGlobal;
    };
    if (global[RUNTIME_PLUGIN_MODULE_GLOBAL]) {
        return;
    }
    // Frozen and non-writable so no plugin can replace or poison the module
    // that later-loading plugins import (mirrors exposePluginModule). ESM
    // namespace objects (React etc.) are spec-immutable already.
    const moduleValue: RuntimePluginModuleGlobal = Object.freeze({
        defineRuntimePlugin,
        externals: Object.freeze({
            react: React,
            reactDom: ReactDOM,
            jsxRuntime: ReactJsxRuntime,
            jsxDevRuntime: ReactJsxDevRuntime,
        }),
    });
    Object.defineProperty(global, RUNTIME_PLUGIN_MODULE_GLOBAL, {
        value: moduleValue,
        writable: false,
        configurable: false,
        enumerable: false,
    });
}

export async function loadRuntimePlugins(
    descriptors: RuntimePluginDescriptor[],
    options: RuntimePluginLoaderOptions,
): Promise<RuntimePluginLoadResult[]> {
    exposeRuntimePluginModule();
    const results = await Promise.all(descriptors.map(descriptor => {
        const cacheKey = `${descriptor.plugin.id}@${descriptor.manifest.version}:${descriptor.entryUrl}`;
        let pending = loadCache.get(cacheKey);
        if (!pending) {
            pending = loadRuntimePlugin(descriptor, options);
            loadCache.set(cacheKey, pending);
        }
        return pending;
    }));
    if (options.elementRenderers) {
        applyRuntimeWidgetRenderers(options.elementRenderers);
    }
    return results;
}

/**
 * Register every collected plugin widget renderer into the host registry.
 * Idempotent; never overrides a type the host (built-in) already provides.
 */
function applyRuntimeWidgetRenderers(registry: ElementRendererRegistry): void {
    for (const { def } of runtimeWidgetRenderers.values()) {
        const existing = registry.get(def.type);
        if (existing && existing.render !== def.render) {
            // Built-in renderers win; plugin types are prefix-namespaced so this
            // only happens on a stale registry re-application.
            continue;
        }
        registry.register({ type: def.type, render: def.render });
    }
}

async function loadRuntimePlugin(
    descriptor: RuntimePluginDescriptor,
    options: RuntimePluginLoaderOptions,
): Promise<RuntimePluginLoadResult> {
    const pluginId = descriptor.plugin.id;
    try {
        const mod = await import(descriptor.entryUrl) as RuntimePluginModule;
        const definition = mod.default ?? mod.plugin;
        if (!isRuntimePluginDefinition(definition)) {
            throw new Error("Runtime plugin entry must default-export defineRuntimePlugin({ setup })");
        }
        await definition.setup(createRuntimePluginApp(descriptor, options));
        options.log("info", `[plugin:${pluginId}] runtime entry loaded`);
        return { pluginId, ok: true };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        options.log("error", `[plugin:${pluginId}] runtime entry failed: ${message}`);
        return { pluginId, ok: false, error: message };
    }
}

function createRuntimePluginApp(
    descriptor: RuntimePluginDescriptor,
    options: RuntimePluginLoaderOptions,
): RuntimePluginApp {
    const pluginId = descriptor.plugin.id;
    const registerNode = (def: RuntimeBlueprintNodeDef): void => {
        const type = typeof def?.type === "string" ? def.type.trim() : "";
        if (!type || typeof def.execute !== "function") {
            throw new Error("Runtime blueprint node requires a type and an execute function");
        }
        if (!type.startsWith(`${pluginId}.`)) {
            throw new Error(`Blueprint node type must be prefixed with plugin id: ${pluginId}`);
        }
        if (!descriptor.manifest.contributes.blueprintNodes.includes(type)) {
            throw new Error(
                `Blueprint node type is not declared in manifest contributes.blueprintNodes: ${type}. ` +
                "Declare it so Studio can statically validate projects that use it.",
            );
        }
        const existingOwner = runtimeNodeOwners.get(type);
        if (behaviorNodeRegistry.get(type) && existingOwner !== pluginId) {
            throw new Error(`Blueprint node type already registered by another owner: ${type}`);
        }
        behaviorNodeRegistry.register({
            type,
            displayName: def.displayName ?? type,
            // The host context is narrowed on the way in. Passing it through
            // would hand the plugin `hostAdapter`, and with it every host API,
            // none of which its manifest declared or the user approved.
            execute: hostCtx => def.execute({
                params: hostCtx.params,
                resolveInput: hostCtx.resolveInput,
                eventName: hostCtx.eventName,
                eventPayload: hostCtx.eventPayload,
                signal: hostCtx.signal,
                game,
            }),
        }, { quietOverwrite: existingOwner === pluginId });
        runtimeNodeOwners.set(type, pluginId);
    };

    const registerWidget = (def: RuntimeWidgetRendererDef): void => {
        const type = typeof def?.type === "string" ? def.type.trim() : "";
        if (!type || typeof def.render !== "function") {
            throw new Error("Runtime widget renderer requires a type and a render function");
        }
        if (!type.startsWith(`${pluginId}.`)) {
            throw new Error(`Widget type must be prefixed with plugin id: ${pluginId}`);
        }
        if (!descriptor.manifest.contributes.widgets.includes(type)) {
            throw new Error(
                `Widget type is not declared in manifest contributes.widgets: ${type}. ` +
                "Declare it so Studio can statically validate projects that use it.",
            );
        }
        const existing = runtimeWidgetRenderers.get(type);
        if (existing && existing.ownerPluginId !== pluginId) {
            throw new Error(`Widget type already registered by another owner: ${type}`);
        }
        runtimeWidgetRenderers.set(type, {
            ownerPluginId: pluginId,
            def: { type, render: def.render },
        });
    };

    const registerPass = (pass: StoryCompilePass): void => {
        const id = typeof pass?.id === "string" ? pass.id.trim() : "";
        if (!id || typeof pass.scene !== "function") {
            throw new Error("Runtime compile pass requires an id and a scene function");
        }
        if (id !== pluginId && !id.startsWith(`${pluginId}.`)) {
            throw new Error(`Compile pass id must be the plugin id or prefixed with it: ${pluginId}`);
        }
        registerStoryCompilePass(pass, pluginId);
    };

    const readData = <T,>(namespace: string): T | null => {
        const key = typeof namespace === "string" ? namespace.trim() : "";
        if (!key) {
            return null;
        }
        // Mirror the registration guards: reading an undeclared namespace is an
        // authoring mistake, but unlike registration it must not kill the game -
        // surface it as a warning and degrade to "no data".
        if (!descriptor.manifest.contributes.runtimeData.includes(key)) {
            options.log(
                "warning",
                `[plugin:${pluginId}] storage namespace is not declared in manifest contributes.runtimeData: ${key}. ` +
                "Declare it so Studio publishes it with the game.",
            );
            return null;
        }
        const value = descriptor.data?.[key];
        return value === undefined ? null : (value as T);
    };

    const log = (level: RuntimePluginLogLevel, message: string): void =>
        options.log(level, `[plugin:${pluginId}] ${message}`);

    const game: RuntimePluginGame = {
        blueprintNodes: {
            register: registerNode,
            registerMany: defs => {
                for (const def of defs) {
                    registerNode(def);
                }
            },
        },
        widgets: {
            register: registerWidget,
            registerMany: defs => {
                for (const def of defs) {
                    registerWidget(def);
                }
            },
        },
        data: { readJson: readData },
        // Not capability-gated, unlike everything below. A compile pass can inject
        // engine actions into every scene, so by the rule this file exists to
        // enforce it ought to be declared — but it shipped ungated and plugins
        // already use it, and adding the gate here would break them silently as a
        // side effect of a merge. Gating it is its own decision, with a migration.
        story: { registerCompilePass: registerPass },
        log,
        ...buildCapabilityDomains(descriptor, options.host ?? {}, pluginId, log),
    };

    return {
        plugin: descriptor.plugin,
        manifest: descriptor.manifest,
        game,
    };
}

/**
 * Whether an unprefixed persistence key belongs to this plugin's own id
 * namespace.
 *
 * The `.` matters: a bare `startsWith(pluginId)` would let `acme.gallery` read
 * `acme.gallery-evil.secret`, which is a different plugin.
 */
function ownsLegacyKey(pluginId: string, key: string): boolean {
    return key === pluginId || key.startsWith(`${pluginId}.`);
}

/**
 * Assemble the capability-gated half of `app.game`.
 *
 * A domain appears only when the manifest declared it *and* this environment can
 * back it. Both halves matter: the first is the user's approval, the second is
 * physical reality (a browser has no child process). Anything missing is left
 * off the object entirely rather than stubbed with a thrower, so `if
 * (app.game.store)` is the honest test and a plugin written against a desktop
 * shell degrades on the web instead of crashing.
 */
function buildCapabilityDomains(
    descriptor: RuntimePluginDescriptor,
    host: RuntimePluginHost,
    pluginId: string,
    log: (level: RuntimePluginLogLevel, message: string) => void,
): Partial<RuntimePluginGame> {
    const declared = new Set<PluginRuntimeCapability>(descriptor.manifest.contributes.runtimeCapabilities);
    const domains: Partial<RuntimePluginGame> = {};

    /** Declared but unbacked is worth saying out loud — it is why nothing happens. */
    const unavailable = (capability: string): void => log(
        "warning",
        `capability "${capability}" is declared but not available in this environment; `
        + "the matching app.game namespace is absent",
    );

    if (declared.has("store")) {
        const backend = host.store;
        if (!backend) {
            unavailable("store");
        } else {
            // Keys are namespaced here rather than in every backend, so the
            // desktop file store and the web IndexedDB store stay dumb.
            const prefix = `${pluginId}:`;
            domains.store = {
                get: async <T,>(key: string) => {
                    const value = await backend.get(prefix + key);
                    if (value !== undefined && value !== null) {
                        return value as T;
                    }
                    // Before plugin storage existed, plugins wrote straight into
                    // the game's persistence under their own dotted key. Shipped
                    // games have players with data there — a gallery's unlocked
                    // artwork, for one — so a miss falls back to the unprefixed
                    // key. This widens nothing: the guard below only admits keys
                    // inside the plugin's own id namespace, which is exactly what
                    // the prefix already fences off.
                    if (!ownsLegacyKey(pluginId, key)) {
                        return null;
                    }
                    return (await backend.get(key) ?? null) as T | null;
                },
                set: (key, value) => backend.set(prefix + key, value),
                remove: async key => {
                    await backend.remove(prefix + key);
                    if (ownsLegacyKey(pluginId, key)) {
                        await backend.remove(key);
                    }
                },
                keys: async () => {
                    const stored = await backend.keys();
                    const own = stored
                        .filter(key => key.startsWith(prefix))
                        .map(key => key.slice(prefix.length));
                    const legacy = stored.filter(key => ownsLegacyKey(pluginId, key));
                    return [...new Set([...own, ...legacy])];
                },
            };
        }
    }

    if (declared.has("events")) {
        const backend = host.events;
        if (!backend) {
            unavailable("events");
        } else {
            domains.events = {
                on: (event, listener) => backend.on(event, listener),
                available: event => backend.supports(event),
            };
        }
    }

    if (declared.has("state.read")) {
        const backend = host.state;
        if (!backend) {
            unavailable("state.read");
        } else {
            domains.state = {
                get: <T,>(scope: Parameters<typeof backend.get>[0], key: string) =>
                    (backend.get(scope, key) ?? null) as T | null,
                onChange: listener => backend.onChange(listener),
                // Absent without `state.write`: reading a playthrough and
                // rewriting it are separate approvals.
                ...(declared.has("state.write")
                    ? { set: (scope, key, value) => backend.set(scope, key, value) }
                    : {}),
            };
        }
    }

    if (declared.has("saves.read")) {
        const backend = host.saves;
        if (!backend) {
            unavailable("saves.read");
        } else {
            const write = backend.write;
            const load = backend.load;
            domains.saves = {
                listIds: () => backend.listIds(),
                readMetadata: id => backend.readMetadata(id),
                // Both halves must line up: the capability approved *and* the
                // environment able to serve it.
                ...(declared.has("saves.write") && write ? { write: (id, metadata) => write(id, metadata) } : {}),
                ...(declared.has("saves.write") && load ? { load: (id: string) => load(id) } : {}),
            };
            if (declared.has("saves.write") && !(write && load)) {
                unavailable("saves.write");
            }
        }
    }

    if (declared.has("ui.overlay")) {
        const backend = host.overlay;
        if (!backend) {
            unavailable("ui.overlay");
        } else {
            domains.ui = { overlay: { mount: render => backend.mount(pluginId, render) } };
        }
    }

    if (declared.has("assets")) {
        const backend = host.assets;
        if (!backend) {
            unavailable("assets");
        } else {
            domains.assets = { url: assetId => backend.url(assetId) };
        }
    }

    if (declared.has("locale")) {
        const backend = host.locale;
        if (!backend) {
            unavailable("locale");
        } else {
            domains.locale = {
                get current() {
                    return backend.current();
                },
                onChange: listener => backend.onChange(listener),
            };
        }
    }

    // No capability string for sidecars: declaring one in `contributes.sidecars`
    // is the request, and the install prompt names it by id and platform.
    const sidecarIds = descriptor.manifest.contributes.sidecars.map(sidecar => sidecar.id);
    if (sidecarIds.length > 0) {
        const backend = host.sidecar;
        if (!backend) {
            log("info", "sidecars are not available in this environment (web and mobile shells have no child processes)");
        } else {
            domains.sidecar = {
                available: sidecarId => sidecarIds.includes(sidecarId) && backend.available(pluginId, sidecarId),
                start: async (sidecarId: string): Promise<RuntimePluginSidecarHandle> => {
                    if (!sidecarIds.includes(sidecarId)) {
                        throw new Error(
                            `Sidecar is not declared in manifest contributes.sidecars: ${sidecarId}`,
                        );
                    }
                    await backend.start(pluginId, sidecarId);
                    return {
                        request: <T,>(method: string, params?: unknown) =>
                            backend.request(pluginId, sidecarId, method, params) as Promise<T>,
                        notify: (method, params) => backend.notify(pluginId, sidecarId, method, params),
                        onEvent: listener => backend.onEvent(pluginId, sidecarId, listener),
                        onExit: listener => backend.onExit(pluginId, sidecarId, listener),
                        stop: () => backend.stop(pluginId, sidecarId),
                    };
                },
            };
        }
    }

    return domains;
}
