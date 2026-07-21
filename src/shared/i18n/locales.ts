/**
 * Locale registry for NarraLeaf Studio.
 *
 * Adding a language:
 *   1. Append its code to {@link SUPPORTED_LOCALES}.
 *   2. Add an entry to {@link LOCALE_META} (native/English name, BCP-47 tag, dir).
 *   3. Create `src/shared/i18n/catalog/<code>.ts` (typed with `satisfies LocaleMessages`).
 *   4. Register it in `src/shared/i18n/catalog/index.ts`.
 * Everything else (settings picker, bootstrap, formatters) reads from here, so
 * no other file needs editing.
 */

import { getOverlayMeta, listOverlayLocales } from "./registry";

export const SUPPORTED_LOCALES = ["en", "zh"] as const;

/** The built-in locale union. Used for typed catalog authoring and the baseline maps. */
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/**
 * The dynamic public locale type. Any string may be an active locale at runtime
 * because plugins register additional locales (see {@link registry}). Use this
 * wherever an *active* / user-selected locale is handled; use {@link Locale}
 * only for the static built-in baseline.
 */
export type LocaleCode = string;

/** Source of truth: every key exists here. Other locales may be partial. */
export const SOURCE_LOCALE: Locale = "en";

/** Resolves any key missing from the active locale. */
export const FALLBACK_LOCALE: Locale = "en";

/** Applied when no preference is stored or the stored value is unknown. */
export const DEFAULT_LOCALE: Locale = "en";

export interface LocaleMeta {
    /** Endonym shown in language pickers. Never translated. */
    nativeName: string;
    /** English name, for docs and logs. */
    englishName: string;
    /** BCP-47 tag handed to the `Intl.*` APIs for this locale. */
    intl: string;
    /** Writing direction of the script. */
    dir: "ltr" | "rtl";
}

export const LOCALE_META: Record<Locale, LocaleMeta> = {
    en: { nativeName: "English", englishName: "English", intl: "en-US", dir: "ltr" },
    zh: { nativeName: "中文", englishName: "Chinese (Simplified)", intl: "zh-CN", dir: "ltr" },
};

/** Whether `value` is one of the static built-in locales. */
export function isLocale(value: unknown): value is Locale {
    return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** Every locale code available right now: the built-in baseline plus plugin overlays. */
export function getRegisteredLocales(): LocaleCode[] {
    const seen = new Set<string>(SUPPORTED_LOCALES);
    const all: LocaleCode[] = [...SUPPORTED_LOCALES];
    for (const code of listOverlayLocales()) {
        if (!seen.has(code)) {
            seen.add(code);
            all.push(code);
        }
    }
    return all;
}

/** Whether `value` is a currently registered locale (built-in or plugin-provided). */
export function isRegisteredLocale(value: unknown): value is LocaleCode {
    return typeof value === "string" && getRegisteredLocales().includes(value);
}

const DEFAULT_META_DIR: LocaleMeta["dir"] = "ltr";

/**
 * Resolve display/formatting metadata for any locale code. Built-in locales use
 * {@link LOCALE_META}; plugin locales use their registered overlay meta, filled
 * with safe defaults (endonym = code, `intl` tag = code, `ltr`). Never throws on
 * an unknown code, unlike direct `LOCALE_META[code]` indexing.
 */
export function getLocaleMeta(code: LocaleCode): LocaleMeta {
    if (isLocale(code)) {
        return LOCALE_META[code];
    }
    const overlay = getOverlayMeta(code);
    return {
        nativeName: overlay?.nativeName ?? code,
        englishName: overlay?.englishName ?? overlay?.nativeName ?? code,
        intl: overlay?.intl ?? code,
        dir: overlay?.dir ?? DEFAULT_META_DIR,
    };
}

/**
 * Coerce an arbitrary stored/env value to an available locale. A currently
 * registered locale (built-in or plugin-provided) passes through unchanged, so a
 * persisted plugin locale like "ja" survives once its plugin is loaded.
 * Region-tagged inputs ("zh-CN", "en_GB") match on their primary subtag.
 * Falls back to {@link DEFAULT_LOCALE} for unknown/garbage input — including a
 * plugin locale whose plugin is no longer installed.
 */
export function normalizeLocale(value: unknown): LocaleCode {
    if (isRegisteredLocale(value)) {
        return value;
    }
    if (typeof value === "string") {
        const primary = value.toLowerCase().split(/[-_]/)[0];
        if (isRegisteredLocale(primary)) {
            return primary;
        }
    }
    return DEFAULT_LOCALE;
}
