/**
 * Game voice-over (player-facing spoken dialogue) shared types.
 *
 * Studio does not record audio — voice work is done externally and *imported*.
 * A voice unit therefore links a story line to an audio asset that already
 * lives in the project's asset library; a director then approves takes.
 *
 * The identity that ties everything together is the story segment's `textId`:
 * it is simultaneously the translation unit id (see `@shared/types/localization`)
 * and the engine's `voiceId` (the id a `Scene.voices` map/generator resolves).
 * One key space spans text, translation, and voice.
 *
 * Voice languages are intentionally INDEPENDENT of localization locales: a
 * project may ship Japanese voice over English text, or voice a game that was
 * never localized at all. Both use the same conservative locale alphabet.
 * Comments in English per project convention.
 */

import { isValidLocaleCode, type LocaleCode } from "./localization";

export { isValidLocaleCode };
export type { LocaleCode };

export const VOICE_DOCUMENT_SCHEMA_VERSION = 1 as const;
export type VoiceDocumentVersion = typeof VOICE_DOCUMENT_SCHEMA_VERSION;

/**
 * Persistent-storage key holding the player's current voice language. Read
 * synchronously through the shared host persistence snapshot (same channel as
 * `nls.locale`), so the scene's voice resolver can pick the right take per line
 * without recompiling. Distinct from `nls.locale` on purpose — dub language and
 * subtitle language are separate player choices.
 */
export const VOICE_LOCALE_STORAGE_KEY = "nls.voiceLocale";

/**
 * Project-level voice configuration, persisted in `.nlproj` under `app.voice`
 * (same pattern as `app.localization`). `voicedLocales` lists every language a
 * voice pack exists for; the first entry is the default the runtime falls back
 * to before a player has chosen one. An empty list means voice has not been set
 * up for the project.
 */
export type VoiceConfiguration = {
    voicedLocales: VoiceLocaleEntry[];
    /**
     * Filename convention for the recording-script export and audio batch
     * import (see shared/utils/voiceNaming). The recording script also carries
     * each line's authoritative unit id, so a drifted filename never loses the
     * link — the pattern is for humans in the booth.
     */
    namingPattern: string;
    /**
     * Casting: the voice actor for a character, per voice language
     * (`cast[characterId][localeCode]`). Pure metadata shown alongside a
     * character's lines in the voice table; never affects playback.
     */
    cast: Record<string, Record<string, string>>;
};

export type VoiceLocaleEntry = {
    code: LocaleCode;
    /** Author-facing autonym shown for this voice language (e.g. "日本語"). */
    displayName: string;
};

/**
 * Default recording-script filename convention: scene, zero-padded index, and
 * speaker in one basename. Kept flat (no folder) so a batch of imported audio
 * files matches by basename regardless of how the booth organised folders.
 */
export const DEFAULT_VOICE_NAMING_PATTERN = "{scene}_{index}_{character}";

export const DEFAULT_VOICE_CONFIGURATION: VoiceConfiguration = {
    voicedLocales: [],
    namingPattern: DEFAULT_VOICE_NAMING_PATTERN,
    cast: {},
};

/** Coerce an unknown value into the cast map, dropping malformed entries. */
function normalizeVoiceCast(value: unknown): Record<string, Record<string, string>> {
    const cast: Record<string, Record<string, string>> = {};
    if (!value || typeof value !== "object") {
        return cast;
    }
    for (const [characterId, perLocale] of Object.entries(value as Record<string, unknown>)) {
        if (!characterId || !perLocale || typeof perLocale !== "object") {
            continue;
        }
        const entries: Record<string, string> = {};
        for (const [code, name] of Object.entries(perLocale as Record<string, unknown>)) {
            if (isValidLocaleCode(code) && typeof name === "string" && name.trim()) {
                entries[code] = name.trim();
            }
        }
        if (Object.keys(entries).length > 0) {
            cast[characterId] = entries;
        }
    }
    return cast;
}

/**
 * Coerce an unknown (persisted / partially-migrated) value into a complete
 * VoiceConfiguration. Malformed entries are dropped, never thrown — a corrupt
 * config must not block project load (mirrors localization / network config).
 */
export function normalizeVoiceConfiguration(value: unknown): VoiceConfiguration {
    if (!value || typeof value !== "object") {
        return { voicedLocales: [], namingPattern: DEFAULT_VOICE_NAMING_PATTERN, cast: {} };
    }
    const record = value as Record<string, unknown>;
    const voicedLocales: VoiceLocaleEntry[] = [];
    const seen = new Set<string>();
    if (Array.isArray(record.voicedLocales)) {
        for (const raw of record.voicedLocales) {
            if (!raw || typeof raw !== "object") {
                continue;
            }
            const entry = raw as Record<string, unknown>;
            if (!isValidLocaleCode(entry.code) || seen.has(entry.code)) {
                continue;
            }
            seen.add(entry.code);
            voicedLocales.push({
                code: entry.code,
                displayName: typeof entry.displayName === "string" && entry.displayName.trim()
                    ? entry.displayName.trim()
                    : entry.code,
            });
        }
    }
    const namingPattern = typeof record.namingPattern === "string" && record.namingPattern.trim()
        ? record.namingPattern.trim()
        : DEFAULT_VOICE_NAMING_PATTERN;
    return { voicedLocales, namingPattern, cast: normalizeVoiceCast(record.cast) };
}

/** True when the project has at least one voice language configured. */
export function isVoiceEnabled(config: VoiceConfiguration): boolean {
    return config.voicedLocales.length > 0;
}

/**
 * Stored status of a voice unit.
 *  - "linked": an audio asset has been imported and assigned to the line.
 *  - "approved": a director has signed the take off.
 * A unit only exists once a clip is linked, so "missing" is never stored — it is
 * derived from the absence of a unit. "stale" is likewise NOT stored: it is
 * derived by comparing `sourceHash` against the current line text, so editing a
 * line never has to touch voice files (mirrors localization's stale handling).
 */
export type VoiceUnitStatus = "linked" | "approved";

/** One voice unit inside a per-locale document. Keyed externally by unit id (the story `textId`). */
export type VoiceUnit = {
    /** Asset-library id of the imported audio clip. */
    assetId: string;
    /** Hash of the line text at import time (see shared/utils/localizationText). */
    sourceHash: string;
    status: VoiceUnitStatus;
    /** Optional clip duration in seconds, if known at import time. */
    duration?: number;
    /** Optional direction note carried alongside the take. */
    note?: string;
};

/** On-disk per-locale voice document: `editor/voice/<locale>.json`. */
export type VoiceDocument = {
    schemaVersion: VoiceDocumentVersion;
    locale: LocaleCode;
    units: Record<string, VoiceUnit>;
};

export function createEmptyVoiceDocument(locale: LocaleCode): VoiceDocument {
    return {
        schemaVersion: VOICE_DOCUMENT_SCHEMA_VERSION,
        locale,
        units: {},
    };
}

/**
 * Coerce an unknown parsed JSON value into a VoiceDocument, dropping malformed
 * units. Never throws — a broken voice file degrades to empty.
 */
export function normalizeVoiceDocument(value: unknown, locale: LocaleCode): VoiceDocument {
    const document = createEmptyVoiceDocument(locale);
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
        if (typeof unit.assetId !== "string" || !unit.assetId) {
            continue;
        }
        document.units[unitId] = {
            assetId: unit.assetId,
            sourceHash: typeof unit.sourceHash === "string" ? unit.sourceHash : "",
            status: unit.status === "approved" ? "approved" : "linked",
            ...(typeof unit.duration === "number" && Number.isFinite(unit.duration) ? { duration: unit.duration } : {}),
            ...(typeof unit.note === "string" && unit.note ? { note: unit.note } : {}),
        };
    }
    return document;
}

/**
 * Voice payload carried by the game bundle (Dev Mode and packaged runtime both
 * consume it through `DevModeBundle.voice`). Tables are lean unit-id → asset-id
 * maps per voice language; the compiler resolves asset ids to URLs at compile
 * time (like every other story asset) and feeds them to the scene voice
 * resolver. Empty units are omitted at assembly time.
 */
export type GameVoiceBundle = {
    voicedLocales: VoiceLocaleEntry[];
    /** locale → (unit id → asset id). */
    tables: Record<LocaleCode, Record<string, string>>;
};
