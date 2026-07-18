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
import { SettingValueType } from "@/lib/settings/types";
import { getInterface } from "@/lib/app/bridge";
import { GlobalStateKeys, GlobalStateValue } from "@shared/types/state/globalState";
import { useTranslation } from "@/lib/i18n";
import type { TranslationKey } from "@shared/i18n";

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
                    // Actions store nothing; their `key` is an identity, not a state key.
                    if (setting.type === SettingValueType.Action) {
                        return;
                    }
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

    // Settings can move without this window touching them — Cmd/Ctrl +/-/0 write
    // `ui.zoomPercent` from the main process, and any other window may write a
    // global key. Follow the broadcast so the fields show what is actually stored
    // instead of a snapshot from mount.
    useEffect(() => {
        const keys = new Set<string>(getAllAppSettings().map(setting => setting.key));
        const token = getInterface().app.state.onGlobalStateChanged?.((change) => {
            if (!keys.has(change.key)) {
                return;
            }
            setValues((prev) => ({
                ...prev,
                [change.key]: change.value as SettingValue,
            }));
        });
        return () => token?.cancel();
    }, []);

    // Availability of workspace-bound actions, keyed by setting key. Evaluated on mount and
    // whenever this window regains focus — the user may have opened or closed a workspace since.
    const [availability, setAvailability] = useState<Record<string, { enabled: boolean; reasonKey?: TranslationKey }>>({});
    useEffect(() => {
        let mounted = true;
        const evaluate = async () => {
            const entries = await Promise.all(
                getAllAppSettings()
                    .filter(setting => setting.availability)
                    .map(async setting => {
                        try {
                            return [setting.key, await setting.availability!()] as const;
                        } catch {
                            return [setting.key, { enabled: true }] as const;
                        }
                    }),
            );
            if (mounted) {
                setAvailability(Object.fromEntries(entries));
            }
        };
        void evaluate();
        const handleFocus = () => void evaluate();
        window.addEventListener("focus", handleFocus);
        return () => {
            mounted = false;
            window.removeEventListener("focus", handleFocus);
        };
    }, []);

    const describeAppSetting = useCallback(
        (setting: AppSettingDefinition): SettingDescriptor => {
            const settingAvailability = availability[setting.key];
            const unavailable = settingAvailability ? !settingAvailability.enabled : false;
            return {
            id: setting.key,
            type: setting.type,
            label: setting.labelKey ? t(setting.labelKey) : setting.label,
            description: unavailable && settingAvailability?.reasonKey
                ? t(settingAvailability.reasonKey)
                : setting.descriptionKey
                    ? t(setting.descriptionKey, setting.descriptionParams)
                    : setting.description,
            defaultValue: setting.defaultValue,
            options: setting.options,
            optionLabels: setting.optionLabelKeys
                ? Object.fromEntries(
                    Object.entries(setting.optionLabelKeys).map(([option, key]) => [option, t(key)]),
                )
                : setting.optionLabels,
            min: setting.min,
            max: setting.max,
            step: setting.step,
            unit: setting.unit,
            actionLabel: setting.actionLabelKey ? t(setting.actionLabelKey) : setting.actionLabel,
            confirmLabel: setting.confirmLabelKey ? t(setting.confirmLabelKey) : undefined,
            danger: setting.danger,
            skipConfirm: setting.skipConfirm,
            disabled: unavailable,
            };
        },
        [t, availability],
    );

    const invokeSettingAction = useCallback(
        async (setting: AppSettingDefinition) => {
            await setting.onInvoke?.();
        },
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
                value as unknown as GlobalStateValue<GlobalStateKeys>,
            );
            if (!response.success) {
                const errorText = response.error ?? t("settings.persistFailed");
                throw new Error(errorText);
            }
            setValues((prev) => ({
                ...prev,
                [key]: value,
            }));
        },
        [t],
    );

    const handleCategoryClick = useCallback((categoryKey: string) => {
        setSelectedCategory(categoryKey);
        setCategoryScrollSignal(value => value + 1);
    }, []);

    return (
        <AppLayout title={t("settings.title")} iconSrc="/favicon.ico">
            <div className="flex h-full overflow-hidden rounded-md border border-edge bg-surface shadow-xl">
                <aside className="w-64 shrink-0 border-r border-edge-subtle bg-surface-sunken p-4 space-y-4">
                    <div>
                        <p className="text-lg font-semibold text-fg">{t("settings.title")}</p>
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
                                            className={`w-full rounded-md px-3 py-2 text-left transition-colors ${isActive ? "bg-fill text-fg" : "text-fg-muted hover:bg-fill hover:text-fg"}`}
                                        >
                                            <div className="text-sm font-medium">{category.label}</div>
                                        </button>
                                    );
                                })}
                            </div>
                        </>
                    ) : (
                        <p className="text-xs text-fg-subtle">
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
                        onInvokeAction={invokeSettingAction}
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
