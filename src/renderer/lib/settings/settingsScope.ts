import { getAllAppSettings } from "@/lib/settings/registry";
import { SettingValueType } from "@/lib/settings/types";
import type { AppSettingDefinition } from "@/lib/settings/models";
import {
    isProtectedStateKey,
    isWorkspaceLayoutKey,
    NON_REGISTRY_PREFERENCE_KEYS,
    PERSONAL_PREFERENCE_KEYS,
    WALLPAPER_PREFERENCE_KEYS,
} from "@shared/constants/settingsScopes";
import type { SettingsValueSpec } from "@shared/utils/settingsDocument";

/**
 * Which keys "my settings" means, resolved against the live registry.
 *
 * The scope has to be computed here rather than listed in `@shared`: the registry is what knows
 * which settings this build actually has, and it is a renderer module (its entries carry preview
 * callbacks and i18n keys). What `@shared` holds is the parts the registry cannot know - the keys
 * that are preferences without having a row, and the keys that are not preferences at all.
 */

/** Entries that store a value. Actions and panels own their storage or have none. */
function isStored(setting: AppSettingDefinition): boolean {
    return setting.type !== SettingValueType.Action && setting.type !== SettingValueType.Custom;
}

/**
 * Every preference key: the registry's, plus the ones set by a gesture rather than a field.
 *
 * Panel-backed entries are included by key even though the panel owns the storage - the key is
 * still a preference, and a reset that skipped the keybinding overrides because their editor is a
 * table would be surprising in exactly the way a reset must not be.
 */
export function preferenceKeys(): string[] {
    const keys = new Set<string>();
    for (const setting of getAllAppSettings()) {
        if (setting.type === SettingValueType.Action) {
            continue;
        }
        keys.add(setting.key);
    }
    for (const key of NON_REGISTRY_PREFERENCE_KEYS) {
        keys.add(key);
    }
    // Belt and braces with the host's own refusal: nothing here should be protected, and if a
    // future key is both, the host's list wins and this keeps the UI from offering it.
    return [...keys].filter(key => !isProtectedStateKey(key));
}

/** Preference keys in one settings category, for the per-category reset. */
export function preferenceKeysInCategory(category: string): string[] {
    return getAllAppSettings()
        .filter(setting => setting.category === category && setting.type !== SettingValueType.Action)
        .map(setting => setting.key)
        .filter(key => !isProtectedStateKey(key));
}

/**
 * The workspace's shape, as stored keys.
 *
 * Read out of the live store rather than declared, because these are per-project
 * (`ui.editor.session.project.<id>`) and there is no list of them anywhere but the store itself.
 */
export function workspaceLayoutKeys(stored: Record<string, unknown>): string[] {
    return Object.keys(stored).filter(key => isWorkspaceLayoutKey(key) && !isProtectedStateKey(key));
}

/** Map a registry entry's type onto what an import can check a value against. */
function specForSetting(setting: AppSettingDefinition): SettingsValueSpec {
    const base = { key: setting.key };
    switch (setting.type) {
        case SettingValueType.Boolean:
            return { ...base, kind: "boolean" };
        case SettingValueType.Number:
        case SettingValueType.Integer:
        case SettingValueType.Slider:
            return {
                ...base,
                kind: "number",
                ...(setting.min !== undefined ? { min: setting.min } : {}),
                ...(setting.max !== undefined ? { max: setting.max } : {}),
            };
        case SettingValueType.Enum:
            return { ...base, kind: "enum", ...(setting.options ? { options: setting.options } : {}) };
        case SettingValueType.Color:
            // Not `enum`: the presets are ids, but `allowCustomColor` stores a hex that is in no
            // option list, so checking membership would reject a value the picker itself wrote.
            return { ...base, kind: "string" };
        case SettingValueType.String:
            return { ...base, kind: "string" };
        default:
            return { ...base, kind: "json" };
    }
}

/**
 * What an import is allowed to write, and how each value is checked.
 *
 * Keys outside this list are reported and skipped - see `planSettingsImport`.
 */
export function settingsValueSpecs(): SettingsValueSpec[] {
    const specs = getAllAppSettings()
        .filter(isStored)
        .map(specForSetting);
    // The panel-backed and gesture-set keys hold shapes the registry does not describe. Their own
    // readers normalize whatever they find (`normalizeRewriteRules`, `sanitizeKeybindingOverrides`,
    // `readBackgroundSettings`), which is what makes accepting them safe.
    const described = new Set(specs.map(spec => spec.key));
    for (const key of preferenceKeys()) {
        if (!described.has(key)) {
            specs.push({ key, kind: "json" });
        }
    }
    return specs;
}

export { PERSONAL_PREFERENCE_KEYS, WALLPAPER_PREFERENCE_KEYS };
