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
    shownSettingValue,
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
import { onDictionariesChanged } from "./panels/dictionaryChanges";
import { useGlobalSettings } from "@/lib/settings/useGlobalSettings";

/**
 * What an installed dictionary is called, in itself, with its code kept.
 *
 * The autonym alone is not enough here, unlike the interface-language picker: the list can hold
 * several dictionaries per language (`en-GB` beside `en-US`) and `Intl.DisplayNames` gives regional
 * variants names that read alike. The code is what tells them apart, so it stays.
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
    const storedKeys = useMemo(() => getAllAppSettings().filter(isStoredSetting).map(setting => setting.key), []);
    const { values, loading } = useGlobalSettings(storedKeys);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedCategory, setSelectedCategory] = useState<string>(categories[0]?.key ?? "");
    // What the navigation lights: the category scrolled to, which follows the list as the author
    // scrolls. Apart from `selectedCategory`, which is where the list was last asked to jump - the
    // two would otherwise feed each other, a scroll lighting a row and the lit row scrolling again.
    const [activeCategory, setActiveCategory] = useState<string>(categories[0]?.key ?? "");
    const [selectedSettingId, setSelectedSettingId] = useState<string | undefined>(undefined);
    const [categoryScrollSignal, setCategoryScrollSignal] = useState(0);

    // Availability of workspace-bound actions, keyed by setting key. Evaluated on mount, whenever
    // this window regains focus — the user may have opened or closed a workspace since — and
    // whenever a stored value changes, because a row may open or close with another row's value
    // (the store's registry addresses are read only under the Custom store source).
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
    }, [values]);

    // The languages a dictionary is INSTALLED for. Read from the main process, which is the only
    // thing that knows: the list is whatever the author has downloaded, so it can be short or empty,
    // and one written down here would offer a language with nothing behind it. Dictionaries are
    // added and removed in the panel below this row (`DictionariesPanel`), which is why this is read
    // whenever the window regains focus rather than once on mount.
    const [spellcheckLanguages, setSpellcheckLanguages] = useState<string[] | null>(null);
    useEffect(() => {
        let mounted = true;
        const read = async () => {
            const result = await getInterface().app.spellcheck.getStatus();
            if (mounted && result.success) {
                setSpellcheckLanguages(result.data.available);
            }
        };
        void read();
        // Two ways the list changes under this row: the panel below it downloaded or removed one,
        // and another window did. The first is announced directly; the second arrives with focus.
        const offDictionaries = onDictionariesChanged(() => void read());
        const onFocus = () => void read();
        window.addEventListener("focus", onFocus);
        return () => {
            mounted = false;
            offDictionaries();
            window.removeEventListener("focus", onFocus);
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
            optionFontStacks: setting.optionFontStacks,
            optionImages: setting.optionImages,
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
            group: setting.group ? { key: setting.group, label: t(`settings.groups.${setting.group}` as TranslationKey) } : undefined,
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
            return shownSettingValue(setting, values[setting.key]) as SettingValue;
        },
        [values],
    );

    /**
     * Whether a row differs from its default, which is what decides if it offers a reset.
     *
     * Compared structurally because a few entries hold arrays and maps. A key stored *at* its
     * default reads as unmodified, which is right: deleting it would change nothing observable. So
     * does one the entry resolves to its default (`resolveStoredValue`), for the same reason.
     */
    const isSettingModified = useCallback(
        (setting: AppSettingDefinition) => {
            const stored = values[setting.key];
            if (stored === undefined) {
                return false;
            }
            return JSON.stringify(shownSettingValue(setting, stored)) !== JSON.stringify(setting.defaultValue);
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
        setActiveCategory(categoryKey);
        setSelectedSettingId(undefined);
        setCategoryScrollSignal(value => value + 1);
    }, []);

    /**
     * Jump to whatever the opener asked for. `highlight` is a setting key (the workspace's
     * "Customize keyboard shortcuts" sends `keybindings.overrides`) or a category key; anything
     * unrecognized is ignored and the window opens on its first category as usual.
     */
    const applyHighlight = useCallback((highlight: string | undefined): boolean => {
        if (!highlight) {
            return false;
        }
        const setting = getSettingByKey(highlight);
        if (setting) {
            setSearchQuery("");
            setSelectedCategory(setting.category);
            setActiveCategory(setting.category);
            setSelectedSettingId(setting.key);
            setCategoryScrollSignal(value => value + 1);
            return true;
        }
        if (categories.some(category => category.key === highlight)) {
            setSearchQuery("");
            setSelectedCategory(highlight);
            setActiveCategory(highlight);
            setSelectedSettingId(undefined);
            setCategoryScrollSignal(value => value + 1);
            return true;
        }
        return false;
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
        let pushed = false;
        const token = getInterface().app.onSettingsHighlight?.(highlight => {
            if (applyHighlight(highlight)) pushed = true;
        });
        void getInterface()
            .getWindowProps<WindowAppType.Settings>()
            .then(result => {
                if (mounted && !pushed && result.success) {
                    applyHighlight(result.data?.highlight);
                }
            })
            .catch(() => undefined);
        return () => {
            mounted = false;
            token?.cancel();
        };
    }, [applyHighlight]);

    return (
        <AppLayout title={t("settings.title")}>
            <div
                className="flex h-full overflow-hidden rounded-md border border-edge bg-surface shadow-xl"
                data-help-topic="studioSettings"
            >
                <aside className="group/help flex w-64 shrink-0 flex-col gap-3 border-r border-edge-subtle bg-surface-sunken p-4">
                    {/* No title of its own: the window's title bar already says Settings. The search
                        box takes the whole row, ending where the navigation's rows do; `pr-1` is the
                        gutter the tree keeps for its scrollbar. */}
                    {localizedCategories.length > 0 && (
                        <div className="pr-1">
                            <SearchBox
                                value={searchQuery}
                                onChange={setSearchQuery}
                                placeholder={t("settings.searchPlaceholder")}
                                className="w-full"
                            />
                        </div>
                    )}
                    {localizedCategories.length > 0 ? (
                        <SettingsNavTree
                            categories={navCategories}
                            selectedCategory={activeCategory}
                            onSelectCategory={handleCategoryClick}
                        />
                    ) : (
                        <p className="flex-1 text-xs text-fg-subtle">
                            {t("settings.noneExposed")}
                        </p>
                    )}
                    {/* The help `?` at the foot of the column, shown while the pointer is over it: this
                        window is where an author asks whether a setting belongs to Studio or to their
                        project, which nothing else here says. Beside the search box it held a slot that
                        stood empty until hovered, and the box came out short of the rows below it. */}
                    <div className="flex">
                        <HelpTrigger topic="studioSettings" />
                    </div>
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
                        onActiveCategoryChange={setActiveCategory}
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
