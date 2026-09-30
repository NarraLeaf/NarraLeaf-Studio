import { describe, expect, it } from "vitest";
import type { DocumentMergeDecision } from "@shared/documents/diff";
import type { StoryBlock, StoryDocument } from "@shared/types/story";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story/document";
import type { StoryRowLookups } from "@/lib/story/storyRowProjection";
import { describeMergeSides } from "./mergeDecisionView";
import { describeStoryMergeSides } from "./storyMergeSides";

/**
 * A story merge's rows read as the story editor reads the line - speaker and words - and not as the
 * fields the row is stored in.
 *
 * The failure this replaced, measured on a sync of two people rewriting one line: the two boxes read
 * `text.value`, `action dialogue`, `characterId …`, `text.textId …` and "one more field", so the line
 * itself was one entry among five storage keys on each side of the choice.
 */

const SPOKEN = "b-spoken";
const CAST: Record<string, string> = { "c-narra": "Narra" };
const LOOKUPS: StoryRowLookups = { character: id => (CAST[id] ? { name: CAST[id] } : null) };

function spoken(text: string, characterId = "c-narra"): StoryBlock["payload"] {
    return { action: "dialogue", characterId, text: { textId: "t-spoken", value: text, role: "dialogue" } } as StoryBlock["payload"];
}

function story(): StoryDocument {
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "story-1",
        name: "The Lighthouse",
        chapters: [{ id: "ch-1", name: "Chapter 1", sceneIds: ["s-1"] }],
        scenes: {
            "s-1": {
                id: "s-1",
                name: "The corridor",
                runtimeName: "corridor",
                rootBlockIds: [SPOKEN],
                blocks: {
                    [SPOKEN]: { id: SPOKEN, kind: "nodeAction", parentId: null, childrenIds: [], payload: spoken("Is anyone there?") },
                },
            },
        },
    } as StoryDocument;
}

function payloadDecision(mine: string, theirs: string): DocumentMergeDecision {
    return {
        path: ["scenes", "s-1", "blocks", SPOKEN, "payload"],
        outcome: "conflict",
        label: { key: "documentDiff.story.blockChanged" },
        subject: mine,
        mine: { present: true, value: spoken(mine) },
        theirs: { present: true, value: spoken(theirs) },
    };
}

/** Every text a view would draw, names included, as one string to search. */
function drawn(view: ReturnType<typeof describeMergeSides>): string {
    return [view.mine, view.theirs]
        .flatMap(side => side.lines.map(line => `${line.name ?? ""} ${line.text}`))
        .join(" | ");
}

describe("a story row in a merge", () => {
    it("reads each side as speaker and line, not as the fields it is stored in", () => {
        const decision = payloadDecision("Is anyone there? Hello?", "Who's there?");

        const view = describeStoryMergeSides(decision, story(), LOOKUPS);

        expect(view?.mine).toEqual({ absent: false, lines: [{ name: "Narra", text: "Is anyone there? Hello?" }], hidden: 0 });
        expect(view?.theirs).toEqual({ absent: false, lines: [{ name: "Narra", text: "Who's there?" }], hidden: 0 });
        const text = drawn(view!);
        for (const storageKey of ["text.value", "characterId", "textId", "action", "dialogue", "c-narra", "t-spoken"]) {
            expect(text).not.toContain(storageKey);
        }
    });

    it("was drawn as storage keys by the generic reading, which is what it replaces", () => {
        const decision = payloadDecision("Is anyone there? Hello?", "Who's there?");

        const generic = describeMergeSides(decision.mine, decision.theirs);

        // The shape the author was shown: the line under `text.value`, three storage keys, one hidden.
        expect(generic.mine.lines.map(line => line.name)).toEqual(["text.value", "action", "characterId", "text.textId"]);
        expect(generic.mine.hidden).toBe(1);
    });

    it("reads a whole row one side added as the line it is, and the other side as absent", () => {
        const added: StoryBlock = {
            id: "b-new",
            kind: "nodeAction",
            parentId: null,
            childrenIds: [],
            payload: { action: "narration", text: { textId: "t-new", value: "The lamp is out.", role: "narration" } },
        } as StoryBlock;
        const decision: DocumentMergeDecision = {
            path: ["scenes", "s-1", "blocks", "b-new"],
            outcome: "auto-mine",
            mine: { present: true, value: added },
            theirs: { present: false },
        };

        const view = describeStoryMergeSides(decision, story(), LOOKUPS);

        expect(view?.mine.lines).toEqual([{ text: "The lamp is out." }]);
        expect(view?.theirs.absent).toBe(true);
    });

    it("never draws a speaker's id when the cast does not know it", () => {
        const decision = payloadDecision("Hello?", "Hi?");
        const unknown: DocumentMergeDecision = {
            ...decision,
            mine: { present: true, value: spoken("Hello?", "3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b") },
        };

        const view = describeStoryMergeSides(unknown, story(), LOOKUPS);

        expect(drawn(view!)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
    });

    it("leaves anything that is not a row to the generic reading", () => {
        const renamed: DocumentMergeDecision = {
            path: ["scenes", "s-1", "name"],
            outcome: "conflict",
            mine: { present: true, value: "The corridor" },
            theirs: { present: true, value: "The hallway" },
        };
        const disabled: DocumentMergeDecision = {
            path: ["scenes", "s-1", "blocks", SPOKEN, "disabled"],
            outcome: "auto-mine",
            mine: { present: true, value: true },
            theirs: { present: false },
        };

        expect(describeStoryMergeSides(renamed, story(), LOOKUPS)).toBeNull();
        expect(describeStoryMergeSides(disabled, story(), LOOKUPS)).toBeNull();
    });

    it("leaves a row's contents to the generic reading when the author's copy does not say what the row is", () => {
        expect(describeStoryMergeSides(payloadDecision("a", "b"), null, LOOKUPS)).toBeNull();
    });
});
