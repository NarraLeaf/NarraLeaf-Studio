import { CATALOGS, PluralKey, TranslationKey } from "./catalog";
import { flattenCatalog, type FlatMessages } from "./flatten";
import { FALLBACK_LOCALE, getLocaleMeta, isLocale, LocaleCode } from "./locales";
import { getLocaleRegistryVersion, getOverlayMessages } from "./registry";

export type InterpolationParams = Record<string, string | number>;

const flatCache = new Map<LocaleCode, FlatMessages>();
const warnedMissing = new Set<string>();
let cachedRegistryVersion = getLocaleRegistryVersion();

/**
 * Flatten a locale into a `dotted.key -> string` map, memoized. Merges the
 * built-in catalog (if any) with the plugin overlay for that code. The cache is
 * invalidated whenever the locale registry changes, so a newly registered or
 * removed language pack is reflected on the next call.
 */
function getFlat(locale: LocaleCode): FlatMessages {
    const registryVersion = getLocaleRegistryVersion();
    if (registryVersion !== cachedRegistryVersion) {
        flatCache.clear();
        cachedRegistryVersion = registryVersion;
    }
    let flat = flatCache.get(locale);
    if (!flat) {
        flat = isLocale(locale)
            ? flattenCatalog(CATALOGS[locale])
            : new Map();
        const overlay = getOverlayMessages(locale);
        if (overlay) {
            for (const [key, value] of overlay) {
                flat.set(key, value);
            }
        }
        flatCache.set(locale, flat);
    }
    return flat;
}

const INTERPOLATION = /\{(\w+)\}/g;

function interpolate(template: string, params?: InterpolationParams): string {
    if (!params) {
        return template;
    }
    return template.replace(INTERPOLATION, (match, name: string) =>
        name in params ? String(params[name]) : match,
    );
}

export interface Translator {
    readonly locale: LocaleCode;
    /** Translate a key, filling `{placeholders}` from `params`. */
    t(key: TranslationKey, params?: InterpolationParams): string;
    /**
     * Translate a pluralized key: picks `${base}.${category}` via the locale's
     * `Intl.PluralRules`, falling back to `${base}.other`. `count` is available
     * as the `{count}` placeholder.
     */
    tn(base: PluralKey, count: number, params?: InterpolationParams): string;
    /** Whether a key resolves in this locale or the fallback. */
    has(key: string): boolean;
    formatNumber(value: number, options?: Intl.NumberFormatOptions): string;
    formatDate(value: Date | number, options?: Intl.DateTimeFormatOptions): string;
    formatList(items: string[], options?: Intl.ListFormatOptions): string;
}

/**
 * Build a translator for a locale. Cheap to call - catalogs are flattened once
 * and cached - so the renderer store can recreate one on every language switch.
 */
export function createTranslator(locale: LocaleCode): Translator {
    const primary = getFlat(locale);
    const fallback = getFlat(FALLBACK_LOCALE);
    const tag = getLocaleMeta(locale).intl;
    const pluralRules = new Intl.PluralRules(tag);

    const resolve = (key: string): string | undefined => primary.get(key) ?? fallback.get(key);

    const t: Translator["t"] = (key, params) => {
        const template = resolve(key);
        if (template === undefined) {
            if (!warnedMissing.has(key)) {
                warnedMissing.add(key);
                console.warn(`[i18n] Missing translation key: "${key}"`);
            }
            return key;
        }
        return interpolate(template, params);
    };

    const tn: Translator["tn"] = (base, count, params) => {
        const category = pluralRules.select(count);
        const categorized = `${base}.${category}`;
        const key = resolve(categorized) !== undefined ? categorized : `${base}.other`;
        return t(key as TranslationKey, { count, ...params });
    };

    return {
        locale,
        t,
        tn,
        has: (key) => resolve(key) !== undefined,
        formatNumber: (value, options) => new Intl.NumberFormat(tag, options).format(value),
        formatDate: (value, options) => new Intl.DateTimeFormat(tag, options).format(value),
        formatList: (items, options) => new Intl.ListFormat(tag, options).format(items),
    };
}
