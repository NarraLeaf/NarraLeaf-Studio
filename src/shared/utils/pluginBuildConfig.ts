import { resolveAppTagPluginConfigValue, type AppTagPluginConfig, type ProjectAppTag } from "../types/appTag";
import type { GameBuildPlatform } from "../types/gameBuild";
import {
    holdsPluginBuildConfigValue,
    isPlatformScopedBuildConfig,
    pluginBuildConfigStorageKey,
    type PluginBuildConfigField,
    type PluginBuildConfigFieldContribution,
    type PluginBuildConfigValueField,
} from "../types/plugins";

/**
 * What a build has to be told before it can ship, folded out of the installed plugins.
 *
 * Pure, and structurally typed on purpose: the plugin manager, the build dialog and the preflight
 * checks all need the same answer, and only one of them lives in a process that can ask a plugin
 * manager anything. Everything here takes the declarations it is handed and returns a list.
 */

/**
 * The shape this module reads a plugin as. `PluginListItem` satisfies it, which is what callers
 * actually pass - naming the field it reads rather than the type it comes from keeps this module
 * free of the plugin manager and testable with a literal.
 */
export type PluginBuildConfigDeclaringPlugin = {
    pluginId: string;
    enabled: boolean;
    manifest: {
        name?: string;
        contributes?: { buildConfig?: PluginBuildConfigFieldContribution[] };
    };
};

/** One value to be supplied: a field, and the platform it is being supplied for. */
export type PluginBuildConfigSlot = {
    field: PluginBuildConfigField;
    /** Absent unless the field's scope takes one value per platform. */
    platform?: GameBuildPlatform;
    /** Where the value sits in the store. See {@link pluginBuildConfigStorageKey}. */
    storageKey: string;
};

/**
 * Every field the plugins in `plugins` declare that applies to `platforms`, in plugin order and then
 * declaration order.
 *
 * Disabled plugins contribute nothing: a disabled plugin's code is not in the build, so a value it
 * asked for would be a question about something that is not going to happen. Their *stored* values
 * are untouched - only the questions go away, so enabling the plugin again brings back what was
 * already answered.
 *
 * `platforms` is what is being built. Pass every platform to list what the project can configure at
 * all; pass none and nothing is required, which is the honest answer for a build with no targets.
 */
export function collectPluginBuildConfigFields(
    plugins: readonly PluginBuildConfigDeclaringPlugin[],
    platforms: readonly GameBuildPlatform[],
): PluginBuildConfigField[] {
    const fields: PluginBuildConfigField[] = [];
    for (const plugin of plugins) {
        if (!plugin.enabled) {
            continue;
        }
        const declared = plugin.manifest.contributes?.buildConfig ?? [];
        for (const field of declared) {
            if (!appliesToAnyPlatform(field, platforms)) {
                continue;
            }
            fields.push({
                ...field,
                pluginId: plugin.pluginId,
                // The id is the fallback rather than an empty string: a surface grouping fields by
                // plugin has to print something, and the id is at least identifying.
                pluginName: plugin.manifest.name?.trim() || plugin.pluginId,
            });
        }
    }
    return fields;
}

/**
 * The individual values `fields` ask for across `platforms`.
 *
 * A platform-scoped field is one question per platform being built and one answer each, so it
 * expands here rather than at every caller - the dialog draws one row per slot, and the checks
 * refuse a build with a required slot left blank.
 */
export function pluginBuildConfigSlots(
    fields: readonly PluginBuildConfigField[],
    platforms: readonly GameBuildPlatform[],
): PluginBuildConfigSlot[] {
    const slots: PluginBuildConfigSlot[] = [];
    for (const field of fields) {
        if (!isPlatformScopedBuildConfig(field.scope)) {
            slots.push({ field, storageKey: pluginBuildConfigStorageKey(field.key) });
            continue;
        }
        for (const platform of platforms) {
            if (!appliesToPlatform(field, platform)) {
                continue;
            }
            slots.push({
                field,
                platform,
                storageKey: pluginBuildConfigStorageKey(field.key, platform),
            });
        }
    }
    return slots;
}

/**
 * What one plugin's declarations come out to for the variant being built, keyed by field key.
 *
 * This is the only route a build config value takes out of the project and into an artifact, so
 * everything that must not travel is decided here once rather than at each place a value is
 * handled. Two things do not travel:
 *
 *  - A `secret` field, structurally: {@link holdsPluginBuildConfigValue} narrows the field, and
 *    {@link shippedValue} takes only the narrowed type, so dropping the narrowing does not compile.
 *  - A platform-scoped field, for now. Its value is keyed by the platform it is for, and one
 *    compiled artifact is not one platform: the desktop compile serves every desktop target in the
 *    request, and the web compile serves the browser export and both mobile repacks. There is no
 *    platform here to resolve against, and answering with another platform's value would be worse
 *    than answering with nothing. A build that compiles per platform can pass one and lift this.
 *
 * A blank value is left out rather than carried as an empty string: never filled in and filled in
 * with nothing are the same fact to a reader, and one absent key says it without the reader having
 * to test for two.
 *
 * Everything that survives is readable by anyone who opens the package - it sits in the pack beside
 * the manifest. That is what `secret` is for.
 */
export function resolveShippedPluginBuildConfig(
    plugin: Omit<PluginBuildConfigDeclaringPlugin, "enabled">,
    tag: ProjectAppTag,
    base: AppTagPluginConfig,
): Record<string, string> {
    const shipped: Record<string, string> = {};
    for (const contribution of plugin.manifest.contributes?.buildConfig ?? []) {
        const field: PluginBuildConfigField = {
            ...contribution,
            pluginId: plugin.pluginId,
            pluginName: plugin.manifest.name?.trim() || plugin.pluginId,
        };
        if (!holdsPluginBuildConfigValue(field) || isPlatformScopedBuildConfig(field.scope)) {
            continue;
        }
        const value = shippedValue(field, tag, base);
        if (value) {
            shipped[field.key] = value;
        }
    }
    return shipped;
}

/**
 * The one read that produces a value an artifact will carry, typed on the field that has one.
 *
 * A wrapper around a resolver that would take any field, and that is the point: a `secret` handle
 * cannot reach this line, because the type it takes says so.
 */
function shippedValue(
    field: PluginBuildConfigValueField,
    tag: ProjectAppTag,
    base: AppTagPluginConfig,
): string {
    return resolveAppTagPluginConfigValue(tag, base, field).value;
}

/** Whether the field is declared for this platform. A field with no `platforms` applies to all. */
export function appliesToPlatform(
    field: Pick<PluginBuildConfigFieldContribution, "platforms">,
    platform: GameBuildPlatform,
): boolean {
    return !field.platforms || field.platforms.includes(platform);
}

function appliesToAnyPlatform(
    field: Pick<PluginBuildConfigFieldContribution, "platforms">,
    platforms: readonly GameBuildPlatform[],
): boolean {
    return platforms.some(platform => appliesToPlatform(field, platform));
}
