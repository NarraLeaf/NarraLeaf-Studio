import { useCallback, useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/lib/components/layout";
import { HelpOverlay, HelpTrigger, requestContextHelp } from "@/lib/help";
import { SearchBox } from "@/apps/workspace/modules/assets/components/SearchBox";
import { SettingsExplorer, SettingValue } from "./components/SettingsExplorer";
import { SettingsNavTree, SettingsNavCategory } from "./components/SettingsNavTree";
import {
    getAllAppSettings,
    getAppSettingCategories,
    getSettingByKey,
    getSettingsByCategory,
} from "@/lib/settings/registry";
import { AppSettingDefinition, AppSettingCategoryKey, SettingCategory, SettingDescriptor } from "@/lib/settings/models";
import { filterCategoryEntries } from "@/lib/settings/searchSettings";
import { resetSetting } from "@/lib/settings/resetSettings";
import { SettingValueType } from "@/lib/settings/types";
import { getInterface } from "@/lib/app/bridge";
import { GlobalStateKeys, GlobalStateValue } from "@shared/types/state/globalState";
import { WindowAppType } from "@shared/types/window";
import { useTranslation } from "@/lib/i18n";
import { getLocaleMeta, getRegisteredLocales, type TranslationKey } from "@shared/i18n";
import { localeAutonym } from "@shared/types/localization";
import { SPELLCHECK_LANGUAGE_KEY } from "@shared/types/spellcheck";

/**
 * What a Chromium dictionary is called, in itself, with its code kept.
 *
 * The autonym alone is not enough here, unlike the interface-language picker: the list holds several
 * dictionaries per language (`en-GB` beside `en-GB-oxendict`) and `Intl.DisplayNames` gives both of
 * those the same name. The code is what tells them apart, so it stays.
 */
function spellcheckLanguageLabel(code: string): string {
    const autonym = localeAutonym(code);
    return autonym === code ? code : `${autonym} (${code})`;
}

/** Entry kinds that own their storage; the value layer must not try to load or write them. */
function isStoredSetting(setting: AppSettingDefinition): boolean {
    return setting.type !== SettingValueType.Action && setting.type !== SettingValueType.Custom;
}

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
    const [selectedSettingId, setSelectedSettingId] = useState<string | undefined>(undefined);
    const [categoryScrollSignal, setCategoryScrollSignal] = useState(0);
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
        () => new Set(categories[0] ? [categories[0].key] : []),
    );

    useEffect(() => {
        let mounted = true;
        const loadSettings = async () => {
            const nextValues: Record<string, SettingValue> = {};
            await Promise.all(
                getAllAppSettings().map(async (setting) => {
                    // Actions and panels store nothing here; their `key` is an identity (or, for a
                    // panel, a key the panel itself owns), not something this layer reads.
                    if (!isStoredSetting(setting)) {
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
        const keys = new Set<string>(getAllAppSettings().filter(isStoredSetting).map(setting => setting.key));
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

    // The languages this build of Chromium has a dictionary for. Read once, from the session, which
    // is the only thing that knows: the list is not a constant this app can carry, and one written
    // down here would keep offering a dictionary Chromium had dropped.
    const [spellcheckLanguages, setSpellcheckLanguages] = useState<string[] | null>(null);
    useEffect(() => {
        let mounted = true;
        void (async () => {
            const result = await getInterface().app.spellcheck.getStatus();
            if (mounted && result.success) {
                setSpellcheckLanguages(result.data.available);
            }
        })();
        return () => {
            mounted = false;
        };
    }, []);

    const describeAppSetting = useCallback(
        (setting: AppSettingDefinition): SettingDescriptor => {
            const settingAvailability = availability[setting.key];
            const unavailable = settingAvailability ? !settingAvailability.enabled : false;
            // The language picker's options are dynamic: plugin language packs
            // register additional locales at runtime. Read the live registry here
            // (re-runs on locale change since `t` is a dependency), so a newly
            // installed pack appears and a removed one disappears.
            const isLanguage = setting.key === "app.language";
            const languageLocales = isLanguage ? getRegisteredLocales() : null;
            // The spellcheck row's two fixed answers ("follow the project", "off") plus every
            // dictionary the session reports. Appended rather than replacing, because the two fixed
            // answers are the ones that carry meaning and they lead the list.
            const spellcheckOptions = setting.key === SPELLCHECK_LANGUAGE_KEY && spellcheckLanguages
                ? [...(setting.options ?? []), ...spellcheckLanguages]
                : null;
            // Translated keys win over plain labels for the same option, so the fixed answers keep
            // their translation while the languages keep their autonym. Left `undefined` when there
            // is nothing to say, because an empty map is not the same argument as no map to the
            // controls that take it whole.
            const merged: Record<string, string> = {
                ...setting.optionLabels,
                ...(spellcheckOptions
                    ? Object.fromEntries(spellcheckLanguages!.map((code) => [code, spellcheckLanguageLabel(code)]))
                    : {}),
                ...(setting.optionLabelKeys
                    ? Object.fromEntries(
                        Object.entries(setting.optionLabelKeys).map(([option, key]) => [option, t(key)]),
                    )
                    : {}),
            };
            const optionLabels = Object.keys(merged).length > 0 ? merged : undefined;
            return {
            id: setting.key,
            type: setting.type,
            label: setting.labelKey ? t(setting.labelKey) : setting.label,
            // A reason states something true about the row whether or not the row is closed. Most
            // are why a control is disabled; the spellcheck language's is what following the
            // project's language amounts to when Chromium has no dictionary for it, on a control
            // that still works.
            description: settingAvailability?.reasonKey
                ? t(settingAvailability.reasonKey)
                : setting.descriptionKey
                    ? t(setting.descriptionKey, setting.descriptionParams)
                    : setting.description,
            defaultValue: setting.defaultValue,
            options: languageLocales ?? spellcheckOptions ?? setting.options,
            optionLabels: languageLocales
                ? Object.fromEntries(languageLocales.map((code) => [code, getLocaleMeta(code).nativeName]))
                : optionLabels,
            optionColors: setting.optionColors,
            allowCustomColor: setting.allowCustomColor,
            onPreview: setting.onPreview,
            min: setting.min,
            max: setting.max,
            step: setting.step,
            unit: setting.unit,
            actionLabel: setting.actionLabelKey ? t(setting.actionLabelKey) : setting.actionLabel,
            confirmLabel: setting.confirmLabelKey ? t(setting.confirmLabelKey) : undefined,
            danger: setting.danger,
            skipConfirm: setting.skipConfirm,
            disabled: unavailable,
            panel: setting.panel,
            };
        },
        [t, availability, spellcheckLanguages],
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

    /**
     * Whether a row differs from its default, which is what decides if it offers a reset.
     *
     * Compared structurally because a few entries hold arrays and maps. A key stored *at* its
     * default reads as unmodified, which is right: deleting it would change nothing observable.
     */
    const isSettingModified = useCallback(
        (setting: AppSettingDefinition) => {
            const stored = values[setting.key];
            if (stored === undefined) {
                return false;
            }
            return JSON.stringify(stored) !== JSON.stringify(setting.defaultValue);
        },
        [values],
    );

    /**
     * Put one row back by DELETING its key rather than writing the default over it.
     *
     * The distinction is load-bearing for the handful of settings whose default is not a constant
     * (`editor.slashAtAlias` answers per device locale; the `ui.background*` keys are clamped and
     * whitelisted on read) - only an absent value reaches those fallbacks.
     */
    const resetSettingRow = useCallback(
        async (setting: AppSettingDefinition) => {
            await resetSetting(setting.key);
            setValues((prev) => {
                const next = { ...prev };
                delete next[setting.key];
                return next;
            });
        },
        [],
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

    /** The tree mirrors the list exactly, search included — see `filterCategoryEntries`. */
    const navCategories = useMemo<SettingsNavCategory[]>(() => {
        return localizedCategories
            .map(category => {
                const entries = getSettingsByCategory(category.key as AppSettingCategoryKey)
                    .map(setting => ({ descriptor: describeAppSetting(setting) }));
                const matched = filterCategoryEntries(category, entries, searchQuery);
                return matched
                    ? { category, entries: matched.map(entry => entry.descriptor) }
                    : null;
            })
            .filter((entry): entry is SettingsNavCategory => entry !== null);
    }, [localizedCategories, describeAppSetting, searchQuery]);

    const handleCategoryClick = useCallback((categoryKey: string) => {
        setSelectedCategory(categoryKey);
        setSelectedSettingId(undefined);
        setExpandedCategories(prev => new Set(prev).add(categoryKey));
        setCategoryScrollSignal(value => value + 1);
    }, []);

    const handleSettingClick = useCallback((categoryKey: string, settingId: string) => {
        setSelectedCategory(categoryKey);
        setSelectedSettingId(settingId);
        setCategoryScrollSignal(value => value + 1);
    }, []);

    const handleToggleCategory = useCallback((categoryKey: string) => {
        setExpandedCategories(prev => {
            const next = new Set(prev);
            if (next.has(categoryKey)) {
                next.delete(categoryKey);
            } else {
                next.add(categoryKey);
            }
            return next;
        });
    }, []);

    /**
     * Jump to whatever the opener asked for. `highlight` is a setting key (the workspace's
     * "Customize keyboard shortcuts" sends `keybindings.overrides`) or a category key; anything
     * unrecognized is ignored and the window opens on its first category as usual.
     */
    const applyHighlight = useCallback((highlight: string | undefined) => {
        if (!highlight) {
            return;
        }
        const setting = getSettingByKey(highlight);
        if (setting) {
            setSelectedCategory(setting.category);
            setSelectedSettingId(setting.key);
            setExpandedCategories(prev => new Set(prev).add(setting.category));
            setCategoryScrollSignal(value => value + 1);
            return;
        }
        if (categories.some(category => category.key === highlight)) {
            setSelectedCategory(highlight);
            setSelectedSettingId(undefined);
            setExpandedCategories(prev => new Set(prev).add(highlight));
            setCategoryScrollSignal(value => value + 1);
        }
    }, [categories]);

    /**
     * `F1`, the same key as in the workspace.
     *
     * A plain listener rather than a registration: this window has no keybinding service, and the
     * one key it claims is the one key nothing else here uses. It falls back to the window's own
     * topic so the key always answers, which is what the workspace does with its browser.
     */
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "F1" || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
                return;
            }
            event.preventDefault();
            requestContextHelp();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, []);

    // On open, and again whenever an already-open Settings window is asked to show something else
    // (main focuses the existing window rather than stacking a second one).
    useEffect(() => {
        let mounted = true;
        void getInterface()
            .getWindowProps<WindowAppType.Settings>()
            .then(result => {
                if (mounted && result.success) {
                    applyHighlight(result.data?.highlight);
                }
            })
            .catch(() => undefined);
        const token = getInterface().app.onSettingsHighlight?.(highlight => applyHighlight(highlight));
        return () => {
            mounted = false;
            token?.cancel();
        };
    }, [applyHighlight]);

    return (
        <AppLayout title={t("settings.title")} iconSrc="/favicon.ico">
            <div
                className="flex h-full overflow-hidden rounded-md border border-edge bg-surface shadow-xl"
                data-help-topic="studioSettings"
            >
                <aside className="flex w-64 shrink-0 flex-col gap-3 border-r border-edge-subtle bg-surface-sunken p-4">
                    <div className="group/help flex items-center gap-1">
                        <p className="min-w-0 flex-1 text-lg font-semibold text-fg">{t("settings.title")}</p>
                        {/* This window is where an author asks whether a setting belongs to Studio
                            or to their project, which nothing else here says. */}
                        <HelpTrigger topic="studioSettings" />
                    </div>
                    {localizedCategories.length > 0 ? (
                        <>
                            <SearchBox
                                value={searchQuery}
                                onChange={setSearchQuery}
                                placeholder={t("settings.searchPlaceholder")}
                                className="w-full"
                            />
                            <SettingsNavTree
                                categories={navCategories}
                                expanded={expandedCategories}
                                onToggle={handleToggleCategory}
                                selectedCategory={selectedCategory}
                                selectedSettingId={selectedSettingId}
                                onSelectCategory={handleCategoryClick}
                                onSelectSetting={handleSettingClick}
                            />
                        </>
                    ) : (
                        <p className="text-xs text-fg-subtle">
                            {t("settings.noneExposed")}
                        </p>
                    )}
                </aside>
                {/* `min-w-0` is load-bearing. A flex item's default `min-width: auto` floors it at its
                    content's min-content width, so this column refused to shrink past ~435px however
                    narrow the window got — and the parent is `overflow-hidden`, so the surplus was
                    simply cut off with no horizontal scroll to go after it. At 200% UI zoom (600 CSS
                    px of window, 256 of it the nav) that put every control's right-hand column past
                    the edge, the zoom field that undoes it included. */}
                <section className="min-w-0 flex-1 p-4">
                    <SettingsExplorer
                        categories={localizedCategories}
                        getSettingsForCategory={(category) => getSettingsByCategory(category as AppSettingCategoryKey)}
                        describeSetting={describeAppSetting}
                        getValue={(setting, _descriptor) => getSettingValue(setting)}
                        onCommit={commitSetting}
                        onInvokeAction={invokeSettingAction}
                        isModified={isSettingModified}
                        onReset={resetSettingRow}
                        searchQuery={searchQuery}
                        onSearchChange={setSearchQuery}
                        showSearch={false}
                        loading={loading}
                        emptyStateMessage={t("settings.empty")}
                        selectedCategory={selectedCategory}
                        selectedSettingId={selectedSettingId}
                        selectedCategoryScrollSignal={categoryScrollSignal}
                    />
                </section>
            </div>
            {/* No browser link in the footer: this window has no editor tabs to open one in, and
                the popover with its `See also` links is the whole of help here. */}
            <HelpOverlay />
        </AppLayout>
    );
}

export default SettingsApp;
