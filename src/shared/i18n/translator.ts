import { CATALOGS, PluralKey, TranslationKey } from "./catalog";
import { FALLBACK_LOCALE, Locale, LOCALE_META } from "./locales";

export type InterpolationParams = Record<string, string | number>;

type FlatMessages = Map<string, string>;

const flatCache = new Map<Locale, FlatMessages>();
const warnedMissing = new Set<string>();

function flatten(node: unknown, prefix: string, out: FlatMessages): void {
    if (typeof node === "string") {
        out.set(prefix, node);
        return;
    }
    if (node && typeof node === "object") {
        for (const [key, value] of Object.entries(node)) {
            flatten(value, prefix ? `${prefix}.${key}` : key, out);
        }
    }
}

/** Flatten a locale's nested catalog into a `dotted.key -> string` map, memoized. */
function getFlat(locale: Locale): FlatMessages {
    let flat = flatCache.get(locale);
    if (!flat) {
        flat = new Map();
        flatten(CATALOGS[locale], "", flat);
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
    readonly locale: Locale;
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
export function createTranslator(locale: Locale): Translator {
    const primary = getFlat(locale);
    const fallback = getFlat(FALLBACK_LOCALE);
    const tag = LOCALE_META[locale].intl;
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
