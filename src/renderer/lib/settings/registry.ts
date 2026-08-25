import { AppSettingCategories, AppSettings } from "@/lib/settings/appSettings";
import { AppSettingCategoryKey, AppSettingDefinition, SettingCategory } from "@/lib/settings/models";

const sortedCategories = [...AppSettingCategories].sort((a, b) => a.order - b.order);

const settingsIndex = sortedCategories.reduce<Record<AppSettingCategoryKey, AppSettingDefinition[]>>((acc, category) => {
    const key = category.key as AppSettingCategoryKey;
    acc[key] = AppSettings.filter(setting => setting.category === key);
    return acc;
}, {} as Record<AppSettingCategoryKey, AppSettingDefinition[]>);

/**
 * Provide ordered metadata for rendering navigation.
 */
export function getAppSettingCategories(): SettingCategory[] {
    return sortedCategories;
}

/**
 * Get definitions that belong to a specific category.
 *
 * Rows whose `visible` predicate says no are dropped here rather than at each call site, because
 * this is what both halves of the Settings window read - the navigation tree and the list. Filtered
 * on every call, not folded into `settingsIndex` above: that index is built when this module loads,
 * which for a platform check is before the window bootstrap has the answer.
 */
export function getSettingsByCategory(category: AppSettingCategoryKey): AppSettingDefinition[] {
    return (settingsIndex[category] ?? []).filter(setting => setting.visible?.() !== false);
}

/**
 * Lookup a definition by its key.
 */
export function getSettingByKey(key: AppSettingDefinition["key"]): AppSettingDefinition | undefined {
    return AppSettings.find(setting => setting.key === key);
}

/**
 * Iterate every registered app-wide setting, `visible` included.
 *
 * Unfiltered on purpose. The callers are the scope walker (export, import, reset) and the Settings
 * window's value loader, and for all of them a key is a preference whether or not this machine
 * draws a row for it - hiding ⌘Q on Windows must not make a settings file written on macOS lose
 * the value on its way through.
 */
export function getAllAppSettings(): AppSettingDefinition[] {
    return AppSettings;
}
