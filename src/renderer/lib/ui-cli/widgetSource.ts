/**
 * Where the widget catalogue gets its widget modules from.
 *
 * The catalogue (`catalog.ts`) and the compiler that consults it answer for "every widget this run
 * knows": Studio's own, plus whatever plugins have registered. Which plugins those are depends on
 * who is asking. The command line knows the ones `--plugin` loaded (`plugins.ts` registers them into
 * the shared `widgetModuleRegistry`, owned by the plugin); Studio's agent bridge knows the ones the
 * open workspace has loaded, which live in that same registry. So the default source reads the
 * registry, and a caller with a different set - a test, or a bridge that wants a frozen view - runs
 * its query inside {@link withWidgetModuleSource}.
 *
 * Kept apart from `plugins.ts` because that file transpiles a plugin's entry with esbuild and reads
 * it off disk, and nothing the renderer bundles may import it.
 *
 * Comments in English per project convention.
 */

import { BuiltinWidgetModules } from "@/lib/ui-editor/widget-modules/builtin";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import type { UIWidgetModule } from "@/lib/ui-editor/widget-modules/types";

export type WidgetModuleSource = {
    /** Every widget module the catalogue should answer for, Studio's and plugins' alike. */
    list(): readonly UIWidgetModule[];
    /** The plugin that owns a widget type, or undefined for one of Studio's own. */
    pluginOwnerOf(type: string): string | undefined;
};

/** The plugin widgets in the shared registry: those registered with an owning plugin. */
export function listCliPluginWidgetModules(): UIWidgetModule[] {
    return widgetModuleRegistry.list().filter(module => widgetModuleRegistry.getOwner(module.type) !== undefined);
}

/** The plugin that registered a widget type, or undefined for one of Studio's own. */
export function cliPluginOwnerOf(type: string): string | undefined {
    return widgetModuleRegistry.getOwner(type);
}

/**
 * Studio's built-in modules, then every plugin-owned module in the shared registry.
 *
 * The built-ins come from the static list rather than from the registry, because the registry is
 * seeded with them lazily (`ensureWidgetModulesRegistered`) and a command-line run never seeds it.
 * In a running workspace the two agree.
 */
export const registryWidgetModuleSource: WidgetModuleSource = {
    list: () => [...BuiltinWidgetModules, ...listCliPluginWidgetModules()],
    pluginOwnerOf: cliPluginOwnerOf,
};

let active: WidgetModuleSource = registryWidgetModuleSource;

/** The source the catalogue reads right now. */
export function activeWidgetModuleSource(): WidgetModuleSource {
    return active;
}

/**
 * Run `query` with the catalogue reading `source`, then put the previous source back.
 *
 * Synchronous on purpose: every catalogue, compile and check call is, and a scope that could span an
 * `await` would leak the source into whatever else ran in between. `undefined` runs `query` against
 * the current source unchanged.
 */
export function withWidgetModuleSource<T>(source: WidgetModuleSource | undefined, query: () => T): T {
    if (!source || source === active) {
        return query();
    }
    const previous = active;
    active = source;
    try {
        return query();
    } finally {
        active = previous;
    }
}
