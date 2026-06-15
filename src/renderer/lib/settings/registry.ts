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
 */
export function getSettingsByCategory(category: AppSettingCategoryKey): AppSettingDefinition[] {
    return settingsIndex[category] ?? [];
}

/**
 * Lookup a definition by its key.
 */
export function getSettingByKey(key: AppSettingDefinition["key"]): AppSettingDefinition | undefined {
    return AppSettings.find(setting => setting.key === key);
}

/**
 * Iterate every registered app-wide setting.
 */
export function getAllAppSettings(): AppSettingDefinition[] {
    return AppSettings;
}
