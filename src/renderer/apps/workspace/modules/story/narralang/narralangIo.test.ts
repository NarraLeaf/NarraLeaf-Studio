import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryScene } from "@shared/types/story";
import { en } from "@shared/i18n/catalog/en";
import type { NarralangIssue, NarralangIssueReason, NarralangLookups } from "@/lib/story/narralang/narralangPrinter";
import { narralangFileName, narralangIssueRows } from "./narralangIo";

/**
 * The two things the export flow decides after the printer has run: what the file is called, and how
 * a list of block ids becomes a list an author can find in their story.
 */

function block(id: string, value: string): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        payload: { action: "narration", text: { textId: `t-${id}`, value, role: "narration" } },
        parentId: null,
        childrenIds: [],
    } as StoryBlock;
}

function scene(id: string, name: string, blocks: StoryBlock[]): StoryScene {
    return {
        id,
        name,
        runtimeName: id,
        rootBlockIds: blocks.map(entry => entry.id),
        blocks: Object.fromEntries(blocks.map(entry => [entry.id, entry])),
    };
}

const LOOKUPS: NarralangLookups = { character: () => null };

const FIRST = scene("s1", "Corridor", [block("b1", "The corridor is orange."), block("b2", "She is late.")]);
const SECOND = scene("s2", "Rooftop", [block("b3", "The wind picks up.")]);

/**
 * Every reason the printer can raise, as a type the compiler has to see completed.
 *
 * The report builds its key by template (`story.narralang.reason.${reason}`), which is exactly the
 * shape a missing translation hides in: the key falls back to itself and the author reads
 * `story.narralang.reason.somethingNew`. A reason added to the printer breaks this record at compile
 * time, and the assertion below then makes sure the catalog gained the sentence too.
 */
const EVERY_REASON: Record<NarralangIssueReason, true> = {
    blueprintAction: true,
    blueprintCondition: true,
    blueprintInterpolation: true,
    inlineEvent: true,
    invalidRow: true,
    customTransform: true,
    customTransition: true,
    effectProps: true,
    unresolvedRef: true,
    unknownPayload: true,
};

describe("narralang issue reasons", () => {
    it("has a sentence for every reason the printer can raise", () => {
        const sentences = en.story.narralang.reason as Record<string, string>;
        for (const reason of Object.keys(EVERY_REASON)) {
            expect(sentences[reason], `story.narralang.reason.${reason} is missing from en`).toBeTruthy();
        }
        // The other direction: a sentence for a reason that no longer exists is dead copy the parity
        // test would happily keep translating.
        expect(Object.keys(sentences).sort()).toEqual(Object.keys(EVERY_REASON).sort());
    });
});

describe("narralang export file name", () => {
    it("writes .nl, and strips what a native save dialog would refuse", () => {
        expect(narralangFileName("Chapter 1")).toBe("Chapter 1.nl");
        expect(narralangFileName("第一章 / 序")).toBe("第一章 序.nl");
        // A scene named only out of forbidden characters still has to produce a file name.
        expect(narralangFileName("///")).toBe("script.nl");
    });
});

describe("narralang issue rows", () => {
    it("groups every issue of one row into one row, keeping each reason once", () => {
        const issues: NarralangIssue[] = [
            { blockId: "b1", reason: "unresolvedRef", detail: "asset" },
            { blockId: "b2", reason: "inlineEvent" },
            { blockId: "b1", reason: "unresolvedRef", detail: "character" },
            { blockId: "b1", reason: "inlineEvent" },
        ];

        const rows = narralangIssueRows(issues, [FIRST], LOOKUPS);

        // Two rows, not four issues: the heading counts rows the author has to go and find.
        expect(rows.map(row => row.blockId)).toEqual(["b1", "b2"]);
        expect(rows[0].reasons).toEqual(["unresolvedRef", "inlineEvent"]);
        expect(rows[0].description).toBe("The corridor is orange.");
    });

    it("names the scene only when the export covered more than one", () => {
        const issues: NarralangIssue[] = [{ blockId: "b3", reason: "invalidRow" }];

        expect(narralangIssueRows(issues, [SECOND], LOOKUPS)[0].sceneName).toBe("");
        expect(narralangIssueRows(issues, [FIRST, SECOND], LOOKUPS)[0].sceneName).toBe("Rooftop");
    });

    it("drops an issue whose row is in none of the scenes rather than naming it by its id", () => {
        const issues: NarralangIssue[] = [{ blockId: "gone", reason: "unknownPayload" }];

        expect(narralangIssueRows(issues, [FIRST, SECOND], LOOKUPS)).toEqual([]);
    });
});
