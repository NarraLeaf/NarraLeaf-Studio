/**
 * Pure model helpers for the game voice service: voiceable-line extraction from
 * story documents (in narrative order), derived unit state, and per-locale
 * coverage. Kept side-effect free for unit testing.
 *
 * Voiceable lines are the spoken ones - narration and dialogue - plus choice
 * options in a project that has switched choice voicing on (`app.voice`).
 * Extraction reuses the localization row extractor so text,
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
 * Roles that carry a voiceable line once the project voices its choices.
 *
 * `choiceText` only: an option is a thing the menu can speak, and the choice *prompt* is not - the
 * menu surface renders the options and nothing else, so a take recorded against a prompt would have
 * nowhere to play. Listing it would be coverage a game can never satisfy.
 */
const VOICEABLE_CHOICE_ROLES = new Set<StoryTranslationRow["role"]>(["narration", "dialogue", "choiceText"]);

export type VoiceableRowOptions = {
    /** Project setting: whether choice options are lines an actor records. Off by default. */
    includeChoices?: boolean;
};

/**
 * Every voiceable line of a story document in narrative order. Reuses the
 * localization extractor (same unit ids) and keeps only spoken roles.
 */
export function extractVoiceableRows(
    document: StoryDocument,
    options: VoiceableRowOptions = {},
): StoryTranslationRow[] {
    const roles = options.includeChoices ? VOICEABLE_CHOICE_ROLES : VOICEABLE_ROLES;
    return extractStoryTranslationRows(document).filter(row => roles.has(row.role));
}

export type VoiceProgress = {
    total: number;
    /** Units with a current (non-stale) clip, either linked or approved. */
    covered: number;
    approved: number;
    stale: number;
    missing: number;
};

/**
 * The text a take is a recording of, per line. Supplied by the caller because only the service knows
 * which language is being dubbed; defaults to the source text so a project with no translation for
 * that language behaves exactly as it always did.
 */
export type VoiceLineTextFor = (unitId: string, sourceText: string) => string;

export const SOURCE_LINE_TEXT: VoiceLineTextFor = (_unitId, sourceText) => sourceText;

export function computeVoiceProgress(
    rows: readonly TranslatableUnitRef[],
    document: VoiceDocument | undefined,
    lineTextFor: VoiceLineTextFor = SOURCE_LINE_TEXT,
): VoiceProgress {
    const progress: VoiceProgress = { total: rows.length, covered: 0, approved: 0, stale: 0, missing: 0 };
    for (const row of rows) {
        const state = deriveVoiceUnitState(document?.units[row.unitId], lineTextFor(row.unitId, row.sourceText));
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
