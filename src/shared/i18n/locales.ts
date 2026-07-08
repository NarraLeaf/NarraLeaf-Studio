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

export const SUPPORTED_LOCALES = ["en", "zh", "ja"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

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
    ja: { nativeName: "日本語", englishName: "Japanese", intl: "ja-JP", dir: "ltr" },
};

export function isLocale(value: unknown): value is Locale {
    return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Coerce an arbitrary stored/env value to a supported locale.
 * Region-tagged inputs ("zh-CN", "en_GB") match on their primary subtag.
 */
export function normalizeLocale(value: unknown): Locale {
    if (isLocale(value)) {
        return value;
    }
    if (typeof value === "string") {
        const primary = value.toLowerCase().split(/[-_]/)[0];
        if (isLocale(primary)) {
            return primary;
        }
    }
    return DEFAULT_LOCALE;
}
