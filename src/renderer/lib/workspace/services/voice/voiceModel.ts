/**
 * Pure model helpers for the game voice service: voiceable-line extraction from
 * story documents (in narrative order), derived unit state, and per-locale
 * coverage. Kept side-effect free for unit testing.
 *
 * Voiceable lines are the spoken ones — narration and dialogue. Choice text is
 * not voiced in P0. Extraction reuses the localization row extractor so text,
 * translation, and voice stay keyed by the exact same unit ids (story `textId`).
 * Comments in English per project convention.
 */

import type { StoryDocument } from "@shared/types/story";
import type { VoiceDocument, VoiceUnit } from "@shared/types/voice";
import { isSourceHashStale } from "@shared/utils/localizationText";
import {
    extractStoryTranslationRows,
    type StoryTranslationRow,
    type TranslatableUnitRef,
} from "../localization/localizationModel";

/** Derived display state of a voice unit against the current line text. */
export type VoiceUnitState = "missing" | "linked" | "approved" | "stale";

export function deriveVoiceUnitState(unit: VoiceUnit | undefined, sourceText: string): VoiceUnitState {
    if (!unit || !unit.assetId) {
        return "missing";
    }
    if (isSourceHashStale(unit.sourceHash, sourceText)) {
        return "stale";
    }
    return unit.status === "approved" ? "approved" : "linked";
}

/** Roles that carry a voiceable spoken line. */
const VOICEABLE_ROLES = new Set<StoryTranslationRow["role"]>(["narration", "dialogue"]);

/**
 * Every voiceable line of a story document in narrative order. Reuses the
 * localization extractor (same unit ids) and keeps only spoken roles.
 */
export function extractVoiceableRows(document: StoryDocument): StoryTranslationRow[] {
    return extractStoryTranslationRows(document).filter(row => VOICEABLE_ROLES.has(row.role));
}

export type VoiceProgress = {
    total: number;
    /** Units with a current (non-stale) clip, either linked or approved. */
    covered: number;
    approved: number;
    stale: number;
    missing: number;
};

export function computeVoiceProgress(
    rows: readonly TranslatableUnitRef[],
    document: VoiceDocument | undefined,
): VoiceProgress {
    const progress: VoiceProgress = { total: rows.length, covered: 0, approved: 0, stale: 0, missing: 0 };
    for (const row of rows) {
        const state = deriveVoiceUnitState(document?.units[row.unitId], row.sourceText);
        if (state === "missing") {
            progress.missing += 1;
        } else if (state === "stale") {
            progress.stale += 1;
        } else {
            progress.covered += 1;
            if (state === "approved") {
                progress.approved += 1;
            }
        }
    }
    return progress;
}
