/**
 * Loader for plugin runtime entries, shared by every game execution
 * environment (Dev Mode window, standalone Preview/Production runtime).
 *
 * The loader exposes the `narraleaf-studio/runtime` module implementation on a
 * frozen global; the per-environment protocol handler serves an ESM shim that
 * re-exports from that global. Importing the module outside a game runtime
 * therefore fails with a clear error.
 */

import type { RuntimePluginDescriptor } from "@shared/types/plugins";
import { behaviorNodeRegistry } from "../../behavior-graph/BehaviorNodeRegistry";
import {
    defineRuntimePlugin,
    isRuntimePluginDefinition,
    type RuntimeBlueprintNodeDef,
    type RuntimePluginApp,
    type RuntimePluginLogLevel,
} from "./runtimePluginApi";

export const RUNTIME_PLUGIN_MODULE_GLOBAL = "__NLS_RUNTIME_PLUGIN_MODULE__";

export type RuntimePluginLoadResult =
    | { pluginId: string; ok: true }
    | { pluginId: string; ok: false; error: string };

export type RuntimePluginLoaderOptions = {
    log: (level: RuntimePluginLogLevel, message: string) => void;
};

type RuntimePluginModule = {
    default?: unknown;
    plugin?: unknown;
};

type RuntimePluginModuleGlobal = {
    defineRuntimePlugin: typeof defineRuntimePlugin;
};

/** Owner plugin id per registered node type; guards cross-plugin collisions. */
const runtimeNodeOwners = new Map<string, string>();

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
    // that later-loading plugins import (mirrors exposePluginModule).
    const moduleValue: RuntimePluginModuleGlobal = Object.freeze({
        defineRuntimePlugin,
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
    return Promise.all(descriptors.map(descriptor => {
        const cacheKey = `${descriptor.plugin.id}@${descriptor.manifest.version}:${descriptor.entryUrl}`;
        let pending = loadCache.get(cacheKey);
        if (!pending) {
            pending = loadRuntimePlugin(descriptor, options);
            loadCache.set(cacheKey, pending);
        }
        return pending;
    }));
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
    const register = (def: RuntimeBlueprintNodeDef): void => {
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
            execute: def.execute,
        }, { quietOverwrite: existingOwner === pluginId });
        runtimeNodeOwners.set(type, pluginId);
    };

    return {
        plugin: descriptor.plugin,
        manifest: descriptor.manifest,
        game: {
            blueprintNodes: {
                register,
                registerMany: defs => {
                    for (const def of defs) {
                        register(def);
                    }
                },
            },
            log: (level, message) => options.log(level, `[plugin:${pluginId}] ${message}`),
        },
    };
}
