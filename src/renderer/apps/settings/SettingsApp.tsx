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

export function SettingsApp() {
    const categories = useMemo<SettingCategory[]>(() => getAppSettingCategories(), []);
    const [values, setValues] = useState<Record<string, SettingValue>>({});
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedCategory, setSelectedCategory] = useState<string>(categories[0]?.key ?? "");

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
            label: setting.label,
            description: setting.description,
            defaultValue: setting.defaultValue,
            options: setting.options,
        }),
        [],
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
                value as GlobalStateValue<GlobalStateKeys>,
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
    }, []);

    return (
        <AppLayout title="Settings" iconSrc="/favicon.ico">
            <div className="flex h-full overflow-hidden rounded-md border border-white/10 bg-[#0f1115] shadow-xl">
                <aside className="w-64 shrink-0 border-r border-white/5 bg-black/50 p-4 space-y-4">
                    <div>
                        <p className="text-lg font-semibold text-white">Settings</p>
                        <p className="text-xs text-gray-400">
                            Editor Settings
                        </p>
                    </div>
                    <SearchBox
                        value={searchQuery}
                        onChange={setSearchQuery}
                        placeholder="Search settings..."
                        className="w-full"
                    />
                    <div className="flex-1 space-y-2 overflow-y-auto pr-1">
                        {categories.map((category) => {
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
                </aside>
                <section className="flex-1 p-4">
                    <SettingsExplorer
                        categories={categories}
                        getSettingsForCategory={(category) => getSettingsByCategory(category as AppSettingCategoryKey)}
                    describeSetting={describeAppSetting}
                    getValue={(setting, _descriptor) => getSettingValue(setting)}
                        onCommit={commitSetting}
                        searchQuery={searchQuery}
                        onSearchChange={setSearchQuery}
                        showSearch={false}
                        loading={loading}
                        selectedCategory={selectedCategory}
                        onCategoryChange={(categoryKey) => categoryKey && setSelectedCategory(categoryKey)}
                    />
                </section>
            </div>
        </AppLayout>
    );
}

export default SettingsApp;