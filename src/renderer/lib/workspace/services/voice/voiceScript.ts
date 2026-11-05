/**
 * Pure builders for the voice recording-script workflow: turning voiceable
 * lines into recording-script CSV rows, and building the filename → line index
 * used to reverse-match a batch of imported audio files. Side-effect free so the
 * naming/matching logic - the part most likely to silently mis-link takes - is
 * unit tested away from the asset library and the filesystem.
 * Comments in English per project convention.
 */

import type { VoiceCsvRow } from "@shared/utils/voiceCsv";
import { formatVoiceFilename, matchKeyForFilename, matchKeyForVoiceName } from "@shared/utils/voiceNaming";
import { voiceSpeakerWord, voiceSpeakerWordsInEveryLanguage, type VoiceUnnamedSpeaker } from "@shared/utils/voiceSpeakerWords";
import type { VoiceDocument } from "@shared/types/voice";
import type { StoryTranslationRow } from "@/lib/workspace/services/localization/localizationModel";
import { deriveVoiceUnitState } from "./voiceModel";

/** One voiceable line with everything the naming pattern and script need. */
export type VoiceScriptEntry = {
    unitId: string;
    sceneName: string;
    /** 1-based position among the voiceable lines of its scene. */
    indexInScene: number;
    /** What `{character}` spells for this line: a character's name, or the narration / option word. */
    speaker: string;
    /**
     * Other spellings a take's name may carry for {@link speaker}: the narration or option word in
     * Studio's other languages. Matched, never written.
     */
    speakerAliases?: readonly string[];
    sourceText: string;
};

/** What a line is filed under in a recording file name, and the other spellings it is matched by. */
export type VoiceLineSpeaker = { speaker: string; speakerAliases: readonly string[] };

/**
 * The speaker a recording file name spells for a line - the one answer the recording script, the
 * batch import, the assign picker and the agent's tools all use, so a name written by one is found
 * by the others.
 *
 * A character's name is project content and is spelled as it is, and so is the bare name a temp
 * speaker (`#name`) is written under: it has no profile, but the line does say who speaks it, and
 * an actor handed a script cannot tell two of them from the narrator otherwise. Neither gets
 * aliases - the aliases exist for the narration and option words, which Studio spells differently
 * per language; a person's name has one spelling.
 *
 * Narration, a voiced option and a dialogue line left with no name at all (its character gone and
 * no bare name to fall back on) take the project's word for them, in its source language
 * (`voiceSpeakerWord`); the other languages' words are kept as aliases for matching.
 */
export function voiceLineSpeaker(
    row: Pick<StoryTranslationRow, "role" | "characterId" | "speakerName">,
    characterName: (characterId: string) => string | null | undefined,
    sourceLocale: string | null | undefined,
): VoiceLineSpeaker {
    if (row.role === "dialogue") {
        if (row.characterId) {
            const name = characterName(row.characterId);
            if (name) {
                return { speaker: name, speakerAliases: [] };
            }
        }
        const bare = row.speakerName?.trim();
        if (bare) {
            return { speaker: bare, speakerAliases: [] };
        }
    }
    // A choice option is read by whoever the game decides at that moment, so it carries no speaker
    // of its own; filed under narration it would collide with the narrator's lines in the same scene.
    const unnamed: VoiceUnnamedSpeaker = row.role === "choiceText" ? "choice" : "narration";
    const speaker = voiceSpeakerWord(unnamed, sourceLocale);
    return {
        speaker,
        speakerAliases: voiceSpeakerWordsInEveryLanguage(unnamed).filter(word => word !== speaker),
    };
}

/** Assign each row its 1-based index within its own scene (rows must be in narrative order). */
export function withSceneIndices<T extends { sceneId: string }>(rows: readonly T[]): (T & { indexInScene: number })[] {
    const counters = new Map<string, number>();
    return rows.map(row => {
        const next = (counters.get(row.sceneId) ?? 0) + 1;
        counters.set(row.sceneId, next);
        return { ...row, indexInScene: next };
    });
}

/** Build recording-script CSV rows: human filename + authoritative unit id + context + current status. */
export function buildRecordingScriptRows(
    entries: readonly VoiceScriptEntry[],
    pattern: string,
    locale: string,
    document: VoiceDocument | undefined,
): VoiceCsvRow[] {
    return entries.map(entry => {
        const state = deriveVoiceUnitState(document?.units[entry.unitId], entry.sourceText);
        const filename = formatVoiceFilename(pattern, {
            scene: entry.sceneName,
            index: entry.indexInScene,
            character: entry.speaker,
            locale,
            unitId: entry.unitId,
        });
        return {
            filename,
            unitId: entry.unitId,
            character: entry.speaker,
            scene: entry.sceneName,
            line: entry.sourceText,
            status: state,
            note: document?.units[entry.unitId]?.note ?? "",
        };
    });
}

export type VoiceNameKey = { unitId: string; sourceText: string };

/**
 * Map each line's expected filename (reduced to a match key) to its unit, for
 * reverse-matching imported audio. Keys that two lines would share are dropped -
 * a silently ambiguous match is worse than an unmatched file the user can see.
 */
export function buildVoiceNameKeyMap(
    entries: readonly VoiceScriptEntry[],
    pattern: string,
    locale: string,
): Map<string, VoiceNameKey> {
    const map = new Map<string, VoiceNameKey>();
    const ambiguous = new Set<string>();
    for (const entry of entries) {
        for (const key of voiceMatchKeysForEntry(entry, pattern, locale)) {
            if (map.has(key)) {
                ambiguous.add(key);
                continue;
            }
            map.set(key, { unitId: entry.unitId, sourceText: entry.sourceText });
        }
    }
    for (const key of ambiguous) {
        map.delete(key);
    }
    return map;
}

/**
 * The name a line's take is expected to have, reduced to a match key.
 *
 * The one place the naming pattern is turned into a key, so the batch import and the per-line
 * assign picker agree on what "this clip belongs to this line" means.
 */
export function voiceMatchKeyForEntry(entry: VoiceScriptEntry, pattern: string, locale: string): string {
    return voiceKeyFor(entry, entry.speaker, pattern, locale);
}

/**
 * Every key a line's take may be named by: {@link voiceMatchKeyForEntry} first, then the same name
 * with each of the line's speaker aliases. No key twice, and no empty one.
 */
export function voiceMatchKeysForEntry(entry: VoiceScriptEntry, pattern: string, locale: string): string[] {
    const keys = [entry.speaker, ...(entry.speakerAliases ?? [])]
        .map(speaker => voiceKeyFor(entry, speaker, pattern, locale))
        .filter(key => key.length > 0);
    return [...new Set(keys)];
}

function voiceKeyFor(entry: VoiceScriptEntry, speaker: string, pattern: string, locale: string): string {
    return matchKeyForVoiceName(formatVoiceFilename(pattern, {
        scene: entry.sceneName,
        index: entry.indexInScene,
        character: speaker,
        locale,
        unitId: entry.unitId,
    }));
}

/**
 * Match key -> asset id, over assets addressed by the name they carry **in the library**.
 *
 * The library name is the one an author sees and renames; the filename the clip arrived under is
 * gone by the time it is an asset. So a take renamed after import still matches, and a take whose
 * file was named badly matches once it is renamed - which is the only repair an author has.
 *
 * Ambiguous keys are dropped for the same reason `buildVoiceNameKeyMap` drops them: silently
 * pointing a line at the wrong one of two identically-named clips is worse than pointing at none.
 */
export function buildAssetNameKeyMap(assets: readonly { id: string; name: string }[]): Map<string, string> {
    const map = new Map<string, string>();
    const ambiguous = new Set<string>();
    for (const asset of assets) {
        const key = matchKeyForFilename(asset.name);
        if (!key) {
            continue;
        }
        if (map.has(key)) {
            ambiguous.add(key);
            continue;
        }
        map.set(key, asset.id);
    }
    for (const key of ambiguous) {
        map.delete(key);
    }
    return map;
}

export type ImportedFileMatch = { path: string; unitId: string; sourceText: string };
export type ImportedFileMatches = { matched: ImportedFileMatch[]; unmatched: string[] };

/** Split imported file paths into those that match a line and those that do not. */
export function matchImportedFiles(paths: readonly string[], keyMap: Map<string, VoiceNameKey>): ImportedFileMatches {
    const matched: ImportedFileMatch[] = [];
    const unmatched: string[] = [];
    for (const path of paths) {
        const hit = keyMap.get(matchKeyForFilename(path));
        if (hit) {
            matched.push({ path, unitId: hit.unitId, sourceText: hit.sourceText });
        } else {
            unmatched.push(path);
        }
    }
    return { matched, unmatched };
}

/** A returned file whose line already has a take: its file can replace that take's. */
export type TakeReplacement = ImportedFileMatch & { assetId: string };

/**
 * Split a batch of returned files into the ones that would re-record a line that already has a
 * take, and the rest.
 *
 * A pickup comes back under the same name as the take it replaces - the name is the line's - so
 * importing it as a new asset leaves the library holding `…-1.wav` linked to the line and the old
 * take linked to nothing. These are the files that can instead replace the linked take's file.
 * A take whose asset is gone (`hasAsset` false) has nothing to replace, and two files for one take
 * replace it once: the first one wins, the second is imported.
 */
export function planTakeReplacements(
    paths: readonly string[],
    keyMap: Map<string, VoiceNameKey>,
    takes: Readonly<Record<string, { assetId: string } | undefined>>,
    hasAsset: (assetId: string) => boolean,
): { replacements: TakeReplacement[]; imports: string[] } {
    const replacements: TakeReplacement[] = [];
    const imports: string[] = [];
    const claimed = new Set<string>();
    for (const path of paths) {
        const hit = keyMap.get(matchKeyForFilename(path));
        const assetId = hit ? takes[hit.unitId]?.assetId : undefined;
        if (hit && assetId && hasAsset(assetId) && !claimed.has(assetId)) {
            claimed.add(assetId);
            replacements.push({ path, unitId: hit.unitId, sourceText: hit.sourceText, assetId });
        } else {
            imports.push(path);
        }
    }
    return { replacements, imports };
}
