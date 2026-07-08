import { useCallback, useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/lib/components/layout";
import { SearchBox } from "@/apps/workspace/modules/assets/components/SearchBox";
import { SettingsExplorer, SettingValue } from "./components/SettingsExplorer";
import {
    getAllAppSettings,
    getAppSettingCategories,
    getSettingsByCategory,
} from "@/lib/settings/registry";
import { AppSettingDefinition, AppSettingCategoryKey, SettingCategory, SettingDescriptor } from "@/lib/settings/models";
import { getInterface } from "@/lib/app/bridge";
import { GlobalStateKeys, GlobalStateValue } from "@shared/types/state/globalState";
import { useTranslation } from "@/lib/i18n";

export function SettingsApp() {
    const { t } = useTranslation();
    const categories = useMemo<SettingCategory[]>(() => getAppSettingCategories(), []);

    // Resolve category chrome to the active language (falls back to static label).
    const localizedCategories = useMemo<SettingCategory[]>(
        () => categories.map((category) => ({
            ...category,
            label: category.labelKey ? t(category.labelKey) : category.label,
            description: category.descriptionKey ? t(category.descriptionKey) : category.description,
        })),
        [categories, t],
    );
    const [values, setValues] = useState<Record<string, SettingValue>>({});
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedCategory, setSelectedCategory] = useState<string>(categories[0]?.key ?? "");
    const [categoryScrollSignal, setCategoryScrollSignal] = useState(0);

    useEffect(() => {
        let mounted = true;
        const loadSettings = async () => {
            const nextValues: Record<string, SettingValue> = {};
            await Promise.all(
                getAllAppSettings().map(async (setting) => {
                    try {
                        const result = await getInterface().app.state.getGlobalState(setting.key);
                        const storedValue = result.success
                            ? (result.data.value ?? setting.defaultValue)
                            : setting.defaultValue;
                        nextValues[setting.key] = storedValue as SettingValue;
                    } catch (error) {
                        console.error("Failed to load setting", setting.key, error);
                        nextValues[setting.key] = setting.defaultValue;
                    }
                }),
            );
            if (!mounted) {
                return;
            }
            setValues(nextValues);
            setLoading(false);
        };

        loadSettings();
        return () => {
            mounted = false;
        };
    }, []);

    const describeAppSetting = useCallback(
        (setting: AppSettingDefinition): SettingDescriptor => ({
            id: setting.key,
            type: setting.type,
            label: setting.labelKey ? t(setting.labelKey) : setting.label,
            description: setting.descriptionKey ? t(setting.descriptionKey) : setting.description,
            defaultValue: setting.defaultValue,
            options: setting.options,
            optionLabels: setting.optionLabels,
        }),
        [t],
    );

    const getSettingValue = useCallback(
        (setting: AppSettingDefinition) => {
            return values[setting.key] ?? setting.defaultValue;
        },
        [values],
    );

    const commitSetting = useCallback(
        async (setting: AppSettingDefinition, _descriptor: SettingDescriptor, value: SettingValue) => {
            const key = setting.key;
            const response = await getInterface().app.state.setGlobalState(
                key as GlobalStateKeys,
                value as unknown as GlobalStateValue<GlobalStateKeys>,
            );
            if (!response.success) {
                const errorText = response.error ?? "Failed to persist setting";
                throw new Error(errorText);
            }
            setValues((prev) => ({
                ...prev,
                [key]: value,
            }));
        },
        [],
    );

    const handleCategoryClick = useCallback((categoryKey: string) => {
        setSelectedCategory(categoryKey);
        setCategoryScrollSignal(value => value + 1);
    }, []);

    return (
        <AppLayout title={t("settings.title")} iconSrc="/favicon.ico">
            <div className="flex h-full overflow-hidden rounded-md border border-white/10 bg-[#0f1115] shadow-xl">
                <aside className="w-64 shrink-0 border-r border-white/5 bg-black/50 p-4 space-y-4">
                    <div>
                        <p className="text-lg font-semibold text-white">{t("settings.title")}</p>
                        <p className="text-xs text-gray-400">
                            {t("settings.subtitle")}
                        </p>
                    </div>
                    {localizedCategories.length > 0 ? (
                        <>
                            <SearchBox
                                value={searchQuery}
                                onChange={setSearchQuery}
                                placeholder={t("settings.searchPlaceholder")}
                                className="w-full"
                            />
                            <div className="flex-1 space-y-2 overflow-y-auto pr-1">
                                {localizedCategories.map((category) => {
                                    const isActive = selectedCategory === category.key;
                                    return (
                                        <button
                                            key={category.key}
                                            onClick={() => handleCategoryClick(category.key)}
                                            className={`w-full rounded-md px-3 py-2 text-left transition-colors ${isActive ? "bg-white/10 text-white" : "text-gray-300 hover:bg-white/10 hover:text-white"}`}
                                        >
                                            <div className="text-sm font-medium">{category.label}</div>
                                            <p className="text-xs text-gray-500">{category.description}</p>
                                        </button>
                                    );
                                })}
                            </div>
                        </>
                    ) : (
                        <p className="text-xs text-gray-500">
                            {t("settings.noneExposed")}
                        </p>
                    )}
                </aside>
                <section className="flex-1 p-4">
                    <SettingsExplorer
                        categories={localizedCategories}
                        getSettingsForCategory={(category) => getSettingsByCategory(category as AppSettingCategoryKey)}
                        describeSetting={describeAppSetting}
                        getValue={(setting, _descriptor) => getSettingValue(setting)}
                        onCommit={commitSetting}
                        searchQuery={searchQuery}
                        onSearchChange={setSearchQuery}
                        showSearch={false}
                        loading={loading}
                        emptyStateMessage={t("settings.empty")}
                        selectedCategory={selectedCategory}
                        selectedCategoryScrollSignal={categoryScrollSignal}
                    />
                </section>
            </div>
        </AppLayout>
    );
}

export default SettingsApp;
