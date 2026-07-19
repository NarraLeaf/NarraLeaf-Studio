/**
 * Pure builders for the voice recording-script workflow: turning voiceable
 * lines into recording-script CSV rows, and building the filename → line index
 * used to reverse-match a batch of imported audio files. Side-effect free so the
 * naming/matching logic - the part most likely to silently mis-link takes - is
 * unit tested away from the asset library and the filesystem.
 * Comments in English per project convention.
 */

import type { VoiceCsvRow } from "@shared/utils/voiceCsv";
import { formatVoiceFilename, matchKeyForFilename } from "@shared/utils/voiceNaming";
import type { VoiceDocument } from "@shared/types/voice";
import { deriveVoiceUnitState } from "./voiceModel";

/** One voiceable line with everything the naming pattern and script need. */
export type VoiceScriptEntry = {
    unitId: string;
    sceneName: string;
    /** 1-based position among the voiceable lines of its scene. */
    indexInScene: number;
    /** Resolved speaker (character name or narration label). */
    speaker: string;
    sourceText: string;
};

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
        const key = matchKeyForFilename(formatVoiceFilename(pattern, {
            scene: entry.sceneName,
            index: entry.indexInScene,
            character: entry.speaker,
            locale,
            unitId: entry.unitId,
        }));
        if (!key) {
            continue;
        }
        if (map.has(key)) {
            ambiguous.add(key);
            continue;
        }
        map.set(key, { unitId: entry.unitId, sourceText: entry.sourceText });
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
