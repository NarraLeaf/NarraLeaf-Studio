import { describe, expect, it } from "vitest";
import { compileMatcher } from "@/lib/workspace/services/search/textMatcher";
import {
    ALL_SPEAKERS_VALUE,
    CHOICE_GROUP_KEY,
    isBareSpeakerKey,
    NARRATION_GROUP_KEY,
    scopeVoiceRows,
    voiceSpeakerKey,
} from "./voiceTableScope";

const literal = (query: string) => compileMatcher(query, { caseSensitive: false, wholeWord: false, regex: false });

const kaede = { role: "dialogue" as const, characterId: "char-kaede", speaker: "Kaede", line: "Good morning" };
const bare = { role: "dialogue" as const, speaker: "Voice on the phone", line: "Are you there" };
const narration = { role: "narration" as const, speaker: "Narration", line: "The room was dark" };
const choice = { role: "choiceText" as const, speaker: "Choice", line: "Follow her" };
const rows = [kaede, bare, narration, choice];

const haystack = (row: (typeof rows)[number]) => `${row.speaker}\n${row.line}`;

describe("voiceSpeakerKey", () => {
    it("keys a cast member by id, so a rename keeps their lines filed where they were", () => {
        expect(voiceSpeakerKey(kaede)).toBe("char-kaede");
        expect(voiceSpeakerKey({ ...kaede, speaker: "Kaede Mori" })).toBe("char-kaede");
    });

    it("keys a speaker who is only a name by that name, and says so", () => {
        const key = voiceSpeakerKey(bare);
        expect(key).toBe("name:Voice on the phone");
        expect(isBareSpeakerKey(key)).toBe(true);
        expect(isBareSpeakerKey(voiceSpeakerKey(kaede))).toBe(false);
    });

    // Both are read by a voice the project casts rather than by a character, and the table's own
    // buckets are these two constants: a line filed anywhere else drops out of its group header.
    it("puts narration and the choice options in their own buckets", () => {
        expect(voiceSpeakerKey(narration)).toBe(NARRATION_GROUP_KEY);
        expect(voiceSpeakerKey(choice)).toBe(CHOICE_GROUP_KEY);
    });
});

describe("scopeVoiceRows", () => {
    it("hands back the same list when nothing narrows it", () => {
        expect(scopeVoiceRows(rows, ALL_SPEAKERS_VALUE, null, haystack)).toBe(rows);
    });

    it("keeps one speaker's lines, narration and choices included", () => {
        expect(scopeVoiceRows(rows, "char-kaede", null, haystack)).toEqual([kaede]);
        expect(scopeVoiceRows(rows, "name:Voice on the phone", null, haystack)).toEqual([bare]);
        expect(scopeVoiceRows(rows, NARRATION_GROUP_KEY, null, haystack)).toEqual([narration]);
        expect(scopeVoiceRows(rows, CHOICE_GROUP_KEY, null, haystack)).toEqual([choice]);
    });

    it("searches the row's own text, ignoring case", () => {
        expect(scopeVoiceRows(rows, ALL_SPEAKERS_VALUE, literal("DARK"), haystack)).toEqual([narration]);
        expect(scopeVoiceRows(rows, ALL_SPEAKERS_VALUE, literal("phone"), haystack)).toEqual([bare]);
    });

    it("applies both at once, in narrative order", () => {
        const second = { ...kaede, line: "Good night" };
        const scoped = scopeVoiceRows([narration, kaede, second], "char-kaede", literal("good"), haystack);
        expect(scoped.map(row => row.line)).toEqual(["Good morning", "Good night"]);
    });
});
