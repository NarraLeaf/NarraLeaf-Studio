import type { LocalizationConfiguration } from "@shared/types/localization";

/**
 * The run menu's Language row: which languages it offers, and how the choice is stored.
 *
 * Kept apart from `RunControl` so the rules can be read and tested without a workspace standing
 * behind them. The main process reads the same key (`runLocale.ts`) when it assembles a Dev Mode
 * bundle; the two are kept in sync by name only, because they mean the same setting.
 */
export const RUN_LOCALE_SETTINGS_KEY = "ui.runLocaleByProject";

/** One entry of the Language submenu, named the way the Localization panel names it. */
export type RunLanguageOption = { code: string; displayName: string };

/**
 * The languages the row offers, source language first, or null when the row is not shown.
 *
 * Shown only where there is something to pick: a project with one language - or with none, or with
 * no source language, which reads its keys and nothing else - has one answer, and a row offering it
 * would be a control that cannot do anything. The same rule the edition row follows for a project
 * with no variants.
 */
export function runLanguageOptions(config: LocalizationConfiguration | null): RunLanguageOption[] | null {
    if (!config || !config.sourceLocale || config.locales.length < 2) {
        return null;
    }
    const source = config.locales.filter(locale => locale.code === config.sourceLocale);
    const rest = config.locales.filter(locale => locale.code !== config.sourceLocale);
    return [...source, ...rest].map(locale => ({
        code: locale.code,
        displayName: locale.displayName || locale.code,
    }));
}

function settingsRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? { ...value as Record<string, unknown> }
        : {};
}

/** The code this machine picked for the project under `projectKey`, or null for none. */
export function readRunLocaleChoice(value: unknown, projectKey: string): string | null {
    const stored = settingsRecord(value)[projectKey];
    return typeof stored === "string" && stored.trim() ? stored.trim() : null;
}

/**
 * The settings value after choosing `code` for the project under `projectKey`.
 *
 * Null deletes the entry rather than storing a marker, so "the game decides" and "never chose" are
 * one state - the same rule the edition and DLC choices follow.
 */
export function writeRunLocaleChoice(value: unknown, projectKey: string, code: string | null): Record<string, unknown> {
    const record = settingsRecord(value);
    if (code) {
        record[projectKey] = code;
    } else {
        delete record[projectKey];
    }
    return record;
}

/**
 * Whether a stored choice names a language the project no longer has.
 *
 * Asked of the project's configuration, not of the options above: a project brought down to one
 * language hides the row, and a choice left pointing at the language it lost must still be found
 * and cleared - the run would otherwise refuse to start with nowhere on screen to change it.
 */
export function isRunLocaleChoiceGone(choice: string | null, config: LocalizationConfiguration | null): boolean {
    if (!choice || !config) {
        return false;
    }
    return !config.locales.some(locale => locale.code === choice);
}
