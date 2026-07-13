/**
 * Public surface of the `narraleaf-studio/runtime` host API.
 *
 * Runtime plugin entries are prebundled ESM files loaded in every game
 * execution environment (Dev Mode window, Preview, Production). They are game
 * code: no Studio services, no privileged facade. This module must stay inside
 * `@/lib/ui-editor/` so the standalone game runtime bundle can include it
 * (see project/build/build-runtime.js allowedPrefixes).
 */

import type { ReactElement } from "react";
import type { PluginIdentity } from "@shared/types/pluginPermissions";
import type { NormalizedPluginManifestV2 } from "@shared/types/plugins";
import type { BehaviorNodeDefinition } from "../../behavior-graph/BehaviorNodeRegistry";
import type { ElementRendererProps } from "../ElementRendererRegistry";

export type RuntimePluginLogLevel = "info" | "warning" | "error";

/**
 * Runtime-side blueprint node binding: only the execute half. Plugin authors
 * can pass their full editor `BlueprintNodeDef` objects (a superset shape)
 * from a module shared with the studio entry; extra fields are ignored.
 */
export type RuntimeBlueprintNodeDef = {
    type: string;
    displayName?: string;
    execute: BehaviorNodeDefinition["execute"];
};

/**
 * Runtime-side widget binding: the game-facing render function for a widget
 * element type. Receives the same props the host passes built-in element
 * renderers, so a plugin can reuse its studio widget module's render function
 * from a shared module.
 */
export type RuntimeWidgetRendererDef = {
    type: string;
    render: (props: ElementRendererProps) => ReactElement | null;
};

export type RuntimePluginApp = {
    plugin: PluginIdentity;
    manifest: NormalizedPluginManifestV2;
    game: {
        blueprintNodes: {
            register(def: RuntimeBlueprintNodeDef): void;
            registerMany(defs: RuntimeBlueprintNodeDef[]): void;
        };
        widgets: {
            register(def: RuntimeWidgetRendererDef): void;
            registerMany(defs: RuntimeWidgetRendererDef[]): void;
        };
        log(level: RuntimePluginLogLevel, message: string): void;
    };
};

/**
 * Game environments load once per process; there is no unload lifecycle, so
 * setup has no cleanup return (unlike the studio entry's PluginSetup).
 */
export type RuntimePluginSetup = (app: RuntimePluginApp) => void | Promise<void>;

export type RuntimePluginDefinition = {
    setup: RuntimePluginSetup;
};

const RUNTIME_PLUGIN_DEFINITION_MARKER = "__nlsRuntimePluginDefinition";

export function defineRuntimePlugin(definition: RuntimePluginDefinition): RuntimePluginDefinition {
    if (!definition || typeof definition.setup !== "function") {
        throw new Error("Runtime plugin definition requires a setup(app) function");
    }
    return Object.freeze({
        ...definition,
        [RUNTIME_PLUGIN_DEFINITION_MARKER]: true,
    });
}

export function isRuntimePluginDefinition(value: unknown): value is RuntimePluginDefinition {
    return (
        typeof value === "object" &&
        value !== null &&
        (value as Record<string, unknown>)[RUNTIME_PLUGIN_DEFINITION_MARKER] === true &&
        typeof (value as RuntimePluginDefinition).setup === "function"
    );
}
