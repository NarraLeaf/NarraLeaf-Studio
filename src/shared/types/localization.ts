/**
 * Game localization (player-facing multi-language) shared types.
 * Distinct from the Studio UI i18n framework in `src/shared/i18n`.
 * Comments in English per project convention.
 */

export const LOCALIZATION_DOCUMENT_SCHEMA_VERSION = 1 as const;
export type LocalizationDocumentVersion = typeof LOCALIZATION_DOCUMENT_SCHEMA_VERSION;

/** BCP-47-ish language tag, e.g. "en", "ja", "zh-CN". */
export type LocaleCode = string;

/**
 * Persistent-storage key holding the player's current locale. Read synchronously
 * through the shared host persistence snapshot (same channel as persistent variables),
 * so story text can resolve per-render without recompiling.
 * Must satisfy the host persistence key charset (letters/digits with `.`/`_`/`-`
 * separators — see ensureValidKey in shared/utils/persistentState); colons are rejected.
 */
export const LOCALE_STORAGE_KEY = "nls.locale";

/** Locale codes double as translation-file names; keep them to a conservative alphabet. */
const LOCALE_CODE_PATTERN = /^[A-Za-z0-9-]{1,35}$/;

export function isValidLocaleCode(code: unknown): code is LocaleCode {
    return typeof code === "string" && LOCALE_CODE_PATTERN.test(code);
}

export type LocalizationLocaleEntry = {
    code: LocaleCode;
    /** Author-facing autonym shown to players (e.g. "日本語", never "Japanese"). */
    displayName: string;
    /** Optional intermediate fallback locale tried before the source locale. */
    fallback?: LocaleCode;
};

/**
 * Project-level localization configuration, persisted in `.nlproj` under
 * `app.localization` (same pattern as `app.network`).
 * `locales` lists every language of the project INCLUDING the source language;
 * `sourceLocale` points at one of them. An empty `sourceLocale` means the
 * feature has not been set up for the project.
 */
export type LocalizationConfiguration = {
    sourceLocale: LocaleCode;
    locales: LocalizationLocaleEntry[];
};

export const DEFAULT_LOCALIZATION_CONFIGURATION: LocalizationConfiguration = {
    sourceLocale: "",
    locales: [],
};

/**
 * Coerce an unknown (persisted / partially-migrated) value into a complete
 * LocalizationConfiguration. Malformed entries are dropped, never thrown —
 * a corrupt config must not block project load (mirrors network config).
 */
export function normalizeLocalizationConfiguration(value: unknown): LocalizationConfiguration {
    if (!value || typeof value !== "object") {
        return { sourceLocale: "", locales: [] };
    }
    const record = value as Record<string, unknown>;
    const locales: LocalizationLocaleEntry[] = [];
    const seen = new Set<string>();
    if (Array.isArray(record.locales)) {
        for (const raw of record.locales) {
            if (!raw || typeof raw !== "object") {
                continue;
            }
            const entry = raw as Record<string, unknown>;
            if (!isValidLocaleCode(entry.code) || seen.has(entry.code)) {
                continue;
            }
            seen.add(entry.code);
            locales.push({
                code: entry.code,
                displayName: typeof entry.displayName === "string" && entry.displayName.trim()
                    ? entry.displayName.trim()
                    : entry.code,
                ...(isValidLocaleCode(entry.fallback) && entry.fallback !== entry.code
                    ? { fallback: entry.fallback }
                    : {}),
            });
        }
    }
    const sourceLocale = isValidLocaleCode(record.sourceLocale) && seen.has(record.sourceLocale)
        ? record.sourceLocale
        : "";
    return { sourceLocale, locales };
}

/** True when the project has a usable localization setup (source + at least one target). */
export function isLocalizationEnabled(config: LocalizationConfiguration): boolean {
    return Boolean(config.sourceLocale) && config.locales.some(locale => locale.code !== config.sourceLocale);
}

export type LocalizationUnitStatus = "untranslated" | "machine" | "translated" | "reviewed";

/**
 * One translation unit inside a per-locale document. Keyed externally by unit id
 * (Phase 1: the story `textId`; later phases add `ui:` and named keys).
 * "stale" is intentionally NOT a stored status — it is derived at read time by
 * comparing `sourceHash` against the current source text, so editing the source
 * never has to touch translation files.
 */
export type LocalizationUnit = {
    /** Translated text; `{n}` placeholders map to the source segment's inline interpolations. */
    target: string;
    /** Hash of the source text at translation time (see shared/utils/localizationText). */
    sourceHash: string;
    status: LocalizationUnitStatus;
    /** Optional translator note. */
    note?: string;
};

/** On-disk per-locale translation document: `editor/localization/<locale>.json`. */
export type LocalizationDocument = {
    schemaVersion: LocalizationDocumentVersion;
    locale: LocaleCode;
    units: Record<string, LocalizationUnit>;
};

export function createEmptyLocalizationDocument(locale: LocaleCode): LocalizationDocument {
    return {
        schemaVersion: LOCALIZATION_DOCUMENT_SCHEMA_VERSION,
        locale,
        units: {},
    };
}

/**
 * Coerce an unknown parsed JSON value into a LocalizationDocument, dropping
 * malformed units. Never throws — a broken translation file degrades to empty.
 */
export function normalizeLocalizationDocument(value: unknown, locale: LocaleCode): LocalizationDocument {
    const document = createEmptyLocalizationDocument(locale);
    if (!value || typeof value !== "object") {
        return document;
    }
    const record = value as Record<string, unknown>;
    if (!record.units || typeof record.units !== "object") {
        return document;
    }
    for (const [unitId, raw] of Object.entries(record.units as Record<string, unknown>)) {
        if (!unitId || !raw || typeof raw !== "object") {
            continue;
        }
        const unit = raw as Record<string, unknown>;
        if (typeof unit.target !== "string") {
            continue;
        }
        document.units[unitId] = {
            target: unit.target,
            sourceHash: typeof unit.sourceHash === "string" ? unit.sourceHash : "",
            status: unit.status === "machine" || unit.status === "translated" || unit.status === "reviewed"
                ? unit.status
                : "untranslated",
            ...(typeof unit.note === "string" && unit.note ? { note: unit.note } : {}),
        };
    }
    return document;
}

// --- Named keys (developer-authored strings for blueprints and reusable UI text) ---

export const LOCALIZATION_KEYS_SCHEMA_VERSION = 1 as const;

/** Named keys use the same charset as persistence keys, minus leading separators. */
const LOCALIZATION_KEY_NAME_PATTERN = /^[A-Za-z0-9]+([._-][A-Za-z0-9]+)*$/;

export function isValidLocalizationKeyName(name: unknown): name is string {
    return typeof name === "string" && name.length <= 120 && LOCALIZATION_KEY_NAME_PATTERN.test(name);
}

/** Translation-unit id of a named key inside per-locale documents. */
export function localizationKeyUnitId(name: string): string {
    return `key:${name}`;
}

/** Translation-unit id of a character's display name (used by the in-game nametag). */
export function characterTranslationUnitId(characterId: string): string {
    return `char:${characterId}`;
}

export type LocalizationKeyDefinition = {
    /** Source-language text (what renders when no translation applies). */
    sourceText: string;
    /** Optional developer note shown to translators. */
    note?: string;
};

/** On-disk named-key registry: `editor/localization/keys.json`. */
export type LocalizationKeysDocument = {
    schemaVersion: typeof LOCALIZATION_KEYS_SCHEMA_VERSION;
    keys: Record<string, LocalizationKeyDefinition>;
};

export function createEmptyLocalizationKeysDocument(): LocalizationKeysDocument {
    return { schemaVersion: LOCALIZATION_KEYS_SCHEMA_VERSION, keys: {} };
}

/** Coerce unknown JSON into a keys document, dropping malformed entries (never throws). */
export function normalizeLocalizationKeysDocument(value: unknown): LocalizationKeysDocument {
    const document = createEmptyLocalizationKeysDocument();
    if (!value || typeof value !== "object") {
        return document;
    }
    const record = value as Record<string, unknown>;
    if (!record.keys || typeof record.keys !== "object") {
        return document;
    }
    for (const [name, raw] of Object.entries(record.keys as Record<string, unknown>)) {
        if (!isValidLocalizationKeyName(name) || !raw || typeof raw !== "object") {
            continue;
        }
        const entry = raw as Record<string, unknown>;
        if (typeof entry.sourceText !== "string") {
            continue;
        }
        document.keys[name] = {
            sourceText: entry.sourceText,
            ...(typeof entry.note === "string" && entry.note ? { note: entry.note } : {}),
        };
    }
    return document;
}

/**
 * Localization payload carried by the game bundle (Dev Mode and packaged runtime
 * both consume it through `DevModeBundle.localization`). Tables are lean
 * unit-id → target-text maps; empty targets are omitted at assembly time.
 */
export type GameLocalizationBundle = {
    sourceLocale: LocaleCode;
    locales: LocalizationLocaleEntry[];
    tables: Record<LocaleCode, Record<string, string>>;
    /** Named-key source texts (key name → source-language text). */
    keys?: Record<string, string>;
};

/**
 * Resolve a translation-unit id (story textId, `ui:` anchor, or `key:` unit)
 * against the bundle for the given locale, walking the fallback chain. Returns
 * null when the source-language text should render instead.
 */
export function resolveLocalizedUnitText(
    bundle: GameLocalizationBundle,
    locale: LocaleCode,
    unitId: string,
): string | null {
    for (const code of resolveLocaleChain(bundle, locale)) {
        const target = bundle.tables[code]?.[unitId];
        if (target) {
            return target;
        }
    }
    return null;
}

/**
 * Match the player's system language against the configured locales.
 * Tries exact (case-insensitive) matches first across all candidates, then
 * prefix matches in both directions ("zh-CN" system ↔ "zh" config and vice
 * versa). Returns null when nothing matches.
 */
export function matchSystemLocale(
    locales: readonly LocalizationLocaleEntry[],
    candidates: readonly string[],
): LocaleCode | null {
    const normalized = candidates
        .filter((candidate): candidate is string => typeof candidate === "string" && candidate.length > 0)
        .map(candidate => candidate.toLowerCase());
    for (const candidate of normalized) {
        const exact = locales.find(locale => locale.code.toLowerCase() === candidate);
        if (exact) {
            return exact.code;
        }
    }
    for (const candidate of normalized) {
        const prefixed = locales.find(locale => {
            const code = locale.code.toLowerCase();
            return candidate.startsWith(`${code}-`) || code.startsWith(`${candidate}-`);
        });
        if (prefixed) {
            return prefixed.code;
        }
    }
    return null;
}

/**
 * Resolve the locale chain to try for `locale`: itself, its configured fallback
 * (cycle-safe), ending before the source locale (source text is the compiled
 * default, not a table lookup).
 */
export function resolveLocaleChain(config: Pick<GameLocalizationBundle, "sourceLocale" | "locales">, locale: LocaleCode): LocaleCode[] {
    const chain: LocaleCode[] = [];
    const seen = new Set<LocaleCode>();
    let current: LocaleCode | undefined = locale;
    while (current && !seen.has(current) && current !== config.sourceLocale) {
        seen.add(current);
        chain.push(current);
        current = config.locales.find(entry => entry.code === current)?.fallback;
    }
    return chain;
}
