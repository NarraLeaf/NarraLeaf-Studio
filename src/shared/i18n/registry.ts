/**
 * Runtime locale registry: a process-wide overlay merged *over* the static
 * built-in baseline (`SUPPORTED_LOCALES` / `LOCALE_META` / `CATALOGS`).
 *
 * Plugins ship Studio language packs as static JSON catalogs declared in their
 * manifest (`contributes.locales`). The main process aggregates every enabled
 * plugin's catalogs and pushes them here via {@link setLocaleContributions};
 * each renderer fetches the same aggregate over IPC and pushes it into its own
 * copy of this registry. The translator and locale helpers read the overlay so
 * a plugin locale is a first-class locale everywhere: picker, formatters,
 * `<html lang>`, native menu.
 *
 * This module is deliberately dependency-light. It imports the English source
 * catalog and only the *type* of `LocaleMeta`, so `locales.ts` can import this
 * module without a runtime cycle. (`SUPPORTED_LOCALES` is read from `locales.ts`
 * only inside a function, at call time, which a cycle does not affect.)
 *
 * It also holds the built-in catalogs themselves - see {@link registerBuiltinCatalog}.
 */

import { en } from "./catalog/en";
import type { Locale } from "./locales";
import { SUPPORTED_LOCALES } from "./locales";
import type { LocaleMessages } from "./catalog/types";
import { flattenCatalog, type FlatMessages } from "./flatten";
import type { LocaleMeta } from "./locales";

/** Overlay metadata a plugin may supply for a locale it introduces. */
export type LocaleContributionMeta = {
    nativeName?: string;
    englishName?: string;
    intl?: string;
    dir?: "ltr" | "rtl";
};

/**
 * One plugin's contribution for one locale, already read from disk and
 * validated by the aggregator. `messages` is a flat `dotted.key -> string` map
 * keyed by Studio's own {@link TranslationKey}s.
 */
export type LocaleContribution = {
    pluginId: string;
    code: string;
    meta?: LocaleContributionMeta;
    messages: Record<string, string>;
};

type OverlayEntry = {
    meta: LocaleContributionMeta;
    messages: FlatMessages;
};

const overlay = new Map<string, OverlayEntry>();
const listeners = new Set<() => void>();
let version = 0;

/**
 * The built-in catalogs this process holds. English always: it is the source and every lookup's
 * fallback. The others are registered by `catalog/builtinCatalogs.ts` the moment anything imports
 * the catalog index - which is every process and every window, except the small renderer windows
 * whose build swaps that module for one that registers nothing up front and loads only the language
 * the window is shown in (see `catalog/loadBuiltinCatalog.ts` and `project/build/rendererLocales.js`).
 */
const builtinCatalogs = new Map<string, LocaleMessages>([["en", en]]);

/**
 * Add a built-in catalog. Bumps the registry version and notifies, exactly like a plugin pack
 * arriving, so cached translators drop their flattened maps and mounted UI re-renders in it.
 */
export function registerBuiltinCatalog(code: Locale, messages: LocaleMessages): void {
    if (builtinCatalogs.get(code) === messages) {
        return;
    }
    builtinCatalogs.set(code, messages);
    baselineFlatCache.delete(code);
    version += 1;
    for (const listener of listeners) {
        listener();
    }
}

/** The built-in catalog for a code, or `undefined` when it is not one or is not loaded here. */
export function getBuiltinCatalog(code: string): LocaleMessages | undefined {
    return builtinCatalogs.get(code);
}

/** Whether a built-in catalog is in this process yet. */
export function isBuiltinCatalogLoaded(code: string): boolean {
    return builtinCatalogs.has(code);
}

/** Built-in locale codes (the baseline). Overriding their satisfied keys is disallowed. */
function isBuiltinCode(code: string): boolean {
    return (SUPPORTED_LOCALES as readonly string[]).includes(code);
}

/**
 * Lazily-flattened baseline messages per built-in locale, for the collision check. A built-in
 * catalog that is not loaded yet reads as empty here; the translator still lets the baseline win
 * over the overlay once it arrives, so the policy holds either way - only the warning is skipped.
 */
const baselineFlatCache = new Map<string, FlatMessages>();
function baselineFlat(code: string): FlatMessages {
    let flat = baselineFlatCache.get(code);
    if (!flat) {
        const catalog = builtinCatalogs.get(code);
        if (!catalog) {
            return new Map();
        }
        flat = flattenCatalog(catalog);
        baselineFlatCache.set(code, flat);
    }
    return flat;
}

export type SetLocaleContributionsOptions = {
    /** Sink for collision warnings. Defaults to `console.warn`. */
    onWarn?: (message: string) => void;
};

/**
 * Replace the entire overlay from an aggregated contribution list (processed in
 * order = plugin load order). Applies the collision policy, bumps the registry
 * version, and notifies subscribers so caches invalidate and mounted UI
 * re-localizes.
 *
 * Collision policy (every violation is warned, never silent):
 *  - New locale (not a built-in): providing plugins own it; for a `(code, key)`
 *    last write wins, and overwriting another plugin's value warns.
 *  - Built-in locale (`en`/`zh`): a plugin may FILL any key the baseline does
 *    not itself provide (free). Overriding a baseline-satisfied key is
 *    DISALLOWED — the baseline wins and a warning is emitted.
 */
export function setLocaleContributions(
    contributions: readonly LocaleContribution[],
    options: SetLocaleContributionsOptions = {},
): void {
    const warn = options.onWarn ?? ((message: string) => console.warn(message));

    const next = new Map<string, OverlayEntry>();
    // code -> key -> owning pluginId, for plugin-vs-plugin overwrite warnings.
    const owners = new Map<string, Map<string, string>>();

    for (const contribution of contributions) {
        const code = contribution.code;
        if (!code) {
            continue;
        }
        const isBuiltin = isBuiltinCode(code);

        let entry = next.get(code);
        if (!entry) {
            entry = { meta: {}, messages: new Map() };
            next.set(code, entry);
            owners.set(code, new Map());
        }
        // Meta only matters for a NEW locale; the first contributor to supply it wins.
        if (!isBuiltin && contribution.meta) {
            entry.meta = { ...contribution.meta, ...entry.meta };
        }

        const keyOwners = owners.get(code)!;
        for (const [key, value] of Object.entries(contribution.messages)) {
            if (typeof value !== "string") {
                continue;
            }
            if (isBuiltin && baselineFlat(code).has(key)) {
                warn(
                    `[i18n] plugin "${contribution.pluginId}" tried to override built-in locale "${code}" key "${key}"; ignored (built-in translations cannot be overridden, only gaps filled).`,
                );
                continue;
            }
            const priorOwner = keyOwners.get(key);
            if (priorOwner && priorOwner !== contribution.pluginId) {
                warn(
                    `[i18n] plugin "${contribution.pluginId}" overrides locale "${code}" key "${key}" previously provided by "${priorOwner}" (last wins).`,
                );
            }
            entry.messages.set(key, value);
            keyOwners.set(key, contribution.pluginId);
        }
    }

    // Drop empty entries (a contributor whose every key collided).
    for (const [code, entry] of next) {
        if (entry.messages.size === 0 && Object.keys(entry.meta).length === 0) {
            next.delete(code);
        }
    }

    overlay.clear();
    for (const [code, entry] of next) {
        overlay.set(code, entry);
    }
    version += 1;
    for (const listener of listeners) {
        listener();
    }
}

/** Overlay locale codes currently registered (excludes the built-in baseline). */
export function listOverlayLocales(): string[] {
    return [...overlay.keys()];
}

/** Overlay metadata for a locale, or `undefined` if none is registered. */
export function getOverlayMeta(code: string): Partial<LocaleMeta> | undefined {
    const entry = overlay.get(code);
    if (!entry) {
        return undefined;
    }
    const meta: Partial<LocaleMeta> = {};
    if (entry.meta.nativeName) meta.nativeName = entry.meta.nativeName;
    if (entry.meta.englishName) meta.englishName = entry.meta.englishName;
    if (entry.meta.intl) meta.intl = entry.meta.intl;
    if (entry.meta.dir) meta.dir = entry.meta.dir;
    return meta;
}

/** Overlay messages for a locale, or `undefined` if none is registered. */
export function getOverlayMessages(code: string): FlatMessages | undefined {
    return overlay.get(code)?.messages;
}

/**
 * Monotonic counter bumped on every {@link setLocaleContributions}. Consumers
 * (e.g. the translator's `flatCache`) compare against it to invalidate.
 */
export function getLocaleRegistryVersion(): number {
    return version;
}

/** Subscribe to overlay changes. Returns an unsubscribe function. */
export function subscribeLocaleRegistry(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
