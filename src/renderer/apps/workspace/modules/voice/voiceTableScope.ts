/**
 * Which lines the voice table is working on: whose they are, and whether they hold the words being
 * searched for.
 *
 * Pulled out of the table because one answer serves three places that must not drift apart - the
 * character axis's buckets, the speaker filter's list, and the rows the state counts are counted
 * over. A line filed under one speaker and counted under another is the kind of disagreement nobody
 * reports as a bug; they just stop trusting the numbers.
 *
 * Comments in English per project convention.
 */

import type { CompiledMatcher } from "@/lib/workspace/services/search/textMatcher";
import type { VoiceTableRow } from "./VoiceRows";

/** The speaker filter standing down. Cannot collide: a character's key is a UUID. */
export const ALL_SPEAKERS_VALUE = "__all__";
/** Narration is one bucket: it is read by whoever the project casts as its voice, not by a character. */
export const NARRATION_GROUP_KEY = "__narration__";
/** Every choice option shares one bucket on the character axis: an option has no speaker. */
export const CHOICE_GROUP_KEY = "__choice__";

/**
 * What a row has to say about itself for its voice to be known.
 *
 * `role` is the table row's own, every kind of it: a choice's prompt and an author's note are read by
 * whoever says the line they sit on, so they are filed by speaker like any other line.
 */
export interface VoiceSpeakerRow {
    role: VoiceTableRow["role"];
    characterId?: string;
    /** The speaker's name in the interface language, which is all a bare speaker has. */
    speaker: string;
}

/**
 * Which bucket a row's voice belongs to: a cast member, a bare speaker name, or one of the two that
 * are nobody's voice.
 *
 * A character is keyed by id rather than by name, so a renamed character keeps the lines already
 * filed under them; a speaker who is only a name has nothing but the name to be keyed by.
 */
export function voiceSpeakerKey(row: VoiceSpeakerRow): string {
    if (row.role === "narration") {
        return NARRATION_GROUP_KEY;
    }
    if (row.role === "choiceText") {
        return CHOICE_GROUP_KEY;
    }
    return row.characterId ?? `name:${row.speaker}`;
}

/** True for the name-only keys {@link voiceSpeakerKey} mints, which no character id can look like. */
export function isBareSpeakerKey(key: string): boolean {
    return key.startsWith("name:");
}

/**
 * The rows left after the speaker filter and the search, in the order they came in.
 *
 * `haystack` is the row's searchable text, which is the table's business: a director looks for a take
 * by its line, by its clip's name or by the direction written on it, and all three are on the row.
 */
export function scopeVoiceRows<T extends VoiceSpeakerRow>(
    rows: readonly T[],
    speakerFilter: string,
    matcher: CompiledMatcher | null,
    haystack: (row: T) => string,
): readonly T[] {
    let out = rows;
    if (speakerFilter !== ALL_SPEAKERS_VALUE) {
        out = out.filter(row => voiceSpeakerKey(row) === speakerFilter);
    }
    if (matcher) {
        out = out.filter(row => matcher.test(haystack(row)));
    }
    // The same array when nothing is narrowing it: the table's own memos lean on that identity.
    return out;
}
