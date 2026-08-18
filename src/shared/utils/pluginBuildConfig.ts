import {
  resolveAppTagPluginConfigValue,
  type AppTagPluginConfig,
  type ProjectAppTag
} from "../types/appTag";
import type { GameBuildPlatform } from "../types/gameBuild";
import {
  holdsPluginBuildConfigValue,
  isPlatformScopedBuildConfig,
  pluginBuildConfigStorageKey,
  type PluginBuildConfigField,
  type PluginBuildConfigFieldContribution,
  type PluginBuildConfigValueField
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
  platforms: readonly GameBuildPlatform[]
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
        pluginName: plugin.manifest.name?.trim() || plugin.pluginId
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
  platforms: readonly GameBuildPlatform[]
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
        storageKey: pluginBuildConfigStorageKey(field.key, platform)
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
 *  - A platform-scoped field whose value is not the same for every platform this artifact serves.
 *    One compiled artifact is not one platform: the desktop compile serves every desktop target in
 *    the request, and the web compile serves the browser export and both mobile repacks. Where the
 *    served platforms agree - which is every single-platform build, and every field the author filled
 *    in once - there is one answer and it travels. Where they disagree there is no answer this
 *    artifact could give, so the key is left out and named in {@link ShippedPluginBuildConfig.ambiguousKeys}
 *    rather than resolved to whichever platform happened to be first.
 *
 * A blank value is left out rather than carried as an empty string: never filled in and filled in
 * with nothing are the same fact to a reader, and one absent key says it without the reader having
 * to test for two.
 *
 * Everything that survives is readable by anyone who opens the package - it sits in the pack beside
 * the manifest. That is what `secret` is for.
 */
export type ShippedPluginBuildConfig = {
  /** What the pack carries for this plugin, keyed by field key. */
  values: Record<string, string>;
  /**
   * Platform-scoped keys the served platforms disagree about, so nothing was carried for them.
   *
   * Reported rather than silent: a plugin reading its own field back as absent looks exactly like
   * an author who never filled it in, and the author is the only one who can resolve the
   * disagreement (by building the platforms separately, or by making the values match).
   */
  ambiguousKeys: string[];
};

export function resolveShippedPluginBuildConfig(
  plugin: Omit<PluginBuildConfigDeclaringPlugin, "enabled">,
  tag: ProjectAppTag,
  base: AppTagPluginConfig,
  /** The build targets this artifact serves. Absent - Dev Mode, the preview - is "no platform". */
  platforms?: readonly GameBuildPlatform[]
): ShippedPluginBuildConfig {
  const values: Record<string, string> = {};
  const ambiguousKeys: string[] = [];
  for (const contribution of plugin.manifest.contributes?.buildConfig ?? []) {
    const field: PluginBuildConfigField = {
      ...contribution,
      pluginId: plugin.pluginId,
      pluginName: plugin.manifest.name?.trim() || plugin.pluginId
    };
    if (!holdsPluginBuildConfigValue(field)) {
      continue;
    }
    if (!isPlatformScopedBuildConfig(field.scope)) {
      const value = shippedValue(field, tag, base);
      if (value) {
        values[field.key] = value;
      }
      continue;
    }
    const answer = platformScopedValue(field, tag, base, platforms ?? []);
    if (answer.kind === "agreed" && answer.value) {
      values[field.key] = answer.value;
    } else if (answer.kind === "disagreed") {
      ambiguousKeys.push(field.key);
    }
  }
  return { values, ambiguousKeys };
}

/**
 * What a platform-scoped field comes to for the platforms one artifact serves.
 *
 * `agreed` covers the ordinary cases in one rule: a single-platform build, and a field the author
 * filled in with the same string everywhere. Blank counts as a value here - a field cleared on one
 * platform and set on another is a disagreement, not an absence - which is why the blank is dropped
 * by the caller instead.
 */
function platformScopedValue(
  field: PluginBuildConfigValueField,
  tag: ProjectAppTag,
  base: AppTagPluginConfig,
  platforms: readonly GameBuildPlatform[]
): { kind: "none" } | { kind: "agreed"; value: string } | { kind: "disagreed" } {
  const applicable = platforms.filter((platform) => appliesToPlatform(field, platform));
  if (applicable.length === 0) {
    return { kind: "none" };
  }
  const answers = new Set(
    applicable.map((platform) => resolveAppTagPluginConfigValue(tag, base, field, platform).value)
  );
  if (answers.size > 1) {
    return { kind: "disagreed" };
  }
  return { kind: "agreed", value: [...answers][0] ?? "" };
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
  base: AppTagPluginConfig
): string {
  return resolveAppTagPluginConfigValue(tag, base, field).value;
}

/** Whether the field is declared for this platform. A field with no `platforms` applies to all. */
export function appliesToPlatform(
  field: Pick<PluginBuildConfigFieldContribution, "platforms">,
  platform: GameBuildPlatform
): boolean {
  return !field.platforms || field.platforms.includes(platform);
}

function appliesToAnyPlatform(
  field: Pick<PluginBuildConfigFieldContribution, "platforms">,
  platforms: readonly GameBuildPlatform[]
): boolean {
  return platforms.some((platform) => appliesToPlatform(field, platform));
}
