import {describe, expect, it} from "vitest";
import type {DocumentMerge3} from "@shared/documents/diff";
import {applyMergeDecisions, mergeDecisionKey} from "@shared/documents/mergeApply";
import {STORY_INDEX_DOCUMENT_PATH, storyIndexSpec} from "@shared/documents/specs";
import {DocumentCorruptError, type DocumentParseContext} from "@shared/documents/types";
import {
    STORY_LIBRARY_INDEX_SCHEMA_VERSION,
    type StoryLibraryEntry,
    type StoryLibraryIndex,
} from "@shared/types/story/document";

/**
 * `spec.merge3` for the story library, and above all for the case that made it necessary.
 *
 * The library is the one document in a project that every other authoring act touches: writing a
 * line stamps the story's entry, so two people working on two different stories still both write
 * this file. Before it had a spec that made every divergent edit a whole-file conflict over a
 * timestamp, and answering it either way threw away any story the other side had made.
 *
 * The decisions have to be applicable, not merely correct, so the cases that matter go through
 * `applyMergeDecisions` rather than stopping at what `merge3` handed back - the entries are a LIST
 * on disk and a keyed collection to a merge, and both halves have to hold at once.
 */

const NOW = "2026-08-28T00:00:00.000Z";
const LATER = "2026-08-28T01:00:00.000Z";
const EVEN_LATER = "2026-08-28T02:00:00.000Z";

function story(id: string, overrides: Partial<StoryLibraryEntry> = {}): StoryLibraryEntry {
    return {
        id,
        name: id,
        documentPath: `editor/story/stories/${id}/storydoc.json`,
        createdAt: NOW,
        updatedAt: NOW,
        ...overrides,
    };
}

function index(stories: StoryLibraryEntry[], overrides: Partial<StoryLibraryIndex> = {}): StoryLibraryIndex {
    return {
        schemaVersion: STORY_LIBRARY_INDEX_SCHEMA_VERSION,
        stories,
        ...overrides,
    };
}

function merge3(
    base: StoryLibraryIndex | undefined,
    mine: StoryLibraryIndex,
    theirs: StoryLibraryIndex,
): DocumentMerge3<StoryLibraryIndex> {
    const merge = storyIndexSpec.merge3;
    if (!merge) {
        throw new Error("the story index spec has no merge3");
    }
    return merge(base, mine, theirs);
}

/** Settle every decision the way the author would have to, and hand back what gets written. */
function settle(
    merged: DocumentMerge3<StoryLibraryIndex>,
    choices: Record<string, "mine" | "theirs">,
): StoryLibraryIndex {
    return applyMergeDecisions(STORY_INDEX_DOCUMENT_PATH, merged.document, merged.decisions, choices);
}

function contextFor(text: string): DocumentParseContext {
    return {
        path: STORY_INDEX_DOCUMENT_PATH,
        corrupt(reason: string): never {
            throw new DocumentCorruptError({kind: "story-index", path: STORY_INDEX_DOCUMENT_PATH, reason, text});
        },
    };
}

describe("the story library merges", () => {
    it("keeps both stories when two authors each made one", () => {
        // The acceptance case. Two people, two new stories, no overlap - and before this spec the
        // author was asked to choose one side of the file, which meant choosing one of the stories.
        const base = index([story("a")]);
        const mine = index([story("a"), story("mine", {name: "Mine"})]);
        const theirs = index([story("a"), story("theirs", {name: "Theirs"})]);

        const merged = merge3(base, mine, theirs);

        expect(merged.conflicts).toBe(0);
        expect(merged.document.stories.map(entry => entry.id)).toEqual(["a", "mine", "theirs"]);
        // And settling it changes nothing, because both additions were already automatic.
        expect(settle(merged, {}).stories.map(entry => entry.id)).toEqual(["a", "mine", "theirs"]);
    });

    it("has nothing to decide when the two sides differ only by the derived stamp", () => {
        // ⚠ The defect this spec was written for, measured on two machines: each author edited one
        // scene's description, which stamps that story's entry, and the whole file conflicted over
        // a field neither of them typed.
        const base = index([story("a", {updatedAt: NOW})]);
        const mine = index([story("a", {updatedAt: LATER})]);
        const theirs = index([story("a", {updatedAt: EVEN_LATER})]);

        const merged = merge3(base, mine, theirs);

        expect(merged.decisions).toEqual([]);
        expect(merged.conflicts).toBe(0);
        // Mine's stamp, not the later one: it is a copy of the story document's own timestamp, and
        // which side of THAT document survives is settled separately.
        expect(merged.document.stories).toEqual([story("a", {updatedAt: LATER})]);
    });

    it("merges two renames of two different stories with nothing to ask", () => {
        const base = index([story("a"), story("b")]);
        const mine = index([story("a", {name: "Harbour", updatedAt: LATER}), story("b")]);
        const theirs = index([story("a"), story("b", {name: "Lantern", updatedAt: EVEN_LATER})]);

        const merged = merge3(base, mine, theirs);

        expect(merged.conflicts).toBe(0);
        expect(settle(merged, {}).stories.map(entry => entry.name)).toEqual(["Harbour", "Lantern"]);
    });

    it("asks about one field when both sides renamed the same story, and leaves the rest merged", () => {
        const base = index([story("a", {name: "Draft"})]);
        const mine = index([story("a", {name: "Harbour", updatedAt: LATER})]);
        const theirs = index([story("a", {name: "Lantern", dlcId: "side-story", updatedAt: EVEN_LATER})]);

        const merged = merge3(base, mine, theirs);

        // One row, for the field they disagree about - not for the whole entry, and not for the
        // stamp. The DLC only theirs set merges on top of whichever name is chosen.
        expect(merged.decisions.map(entry => entry.path)).toEqual([
            ["stories", "a", "dlcId"],
            ["stories", "a", "name"],
        ]);
        expect(merged.conflicts).toBe(1);
        // The row carries the story's own title, so the author is choosing between two names for a
        // story they can recognise rather than between two rows called `stories/a`.
        expect(merged.decisions.find(entry => entry.path[2] === "name")?.subject).toBe("Harbour");

        const kept = settle(merged, {[mergeDecisionKey(["stories", "a", "name"])]: "theirs"});
        expect(kept.stories).toEqual([
            story("a", {name: "Lantern", dlcId: "side-story", updatedAt: LATER}),
        ]);
    });

    it("settles a story one side added and the other deleted, whole", () => {
        // Nothing inside to merge: one side has no entry at all, so the decision is the entry.
        const base = index([story("a"), story("gone")]);
        const mine = index([story("a"), story("gone", {name: "Kept", updatedAt: LATER})]);
        const theirs = index([story("a")]);

        const merged = merge3(base, mine, theirs);

        expect(merged.decisions.map(entry => entry.path)).toEqual([["stories", "gone"]]);
        expect(merged.conflicts).toBe(1);
        expect(merged.decisions[0].label?.key).toBe("documentDiff.storyIndex.removed");

        const removed = settle(merged, {[mergeDecisionKey(["stories", "gone"])]: "theirs"});
        expect(removed.stories.map(entry => entry.id)).toEqual(["a"]);

        const kept = settle(merged, {[mergeDecisionKey(["stories", "gone"])]: "mine"});
        expect(kept.stories.map(entry => entry.id)).toEqual(["a", "gone"]);
        // Whole, with its stamp - a decision that wrote back a stripped entry would leave the
        // library holding a story with no `updatedAt` at all.
        expect(kept.stories[1]).toEqual(story("gone", {name: "Kept", updatedAt: LATER}));
    });

    it("treats the starting story as one decision of its own", () => {
        const base = index([story("a"), story("b")], {defaultStoryId: "a"});
        const mine = index([story("a"), story("b")], {defaultStoryId: "b"});
        const theirs = index([story("a"), story("b")], {defaultStoryId: "a"});

        const merged = merge3(base, mine, theirs);

        expect(merged.decisions.map(entry => entry.path)).toEqual([["defaultStoryId"]]);
        expect(merged.decisions[0].outcome).toBe("auto-mine");
        expect(merged.decisions[0].label?.key).toBe("documentDiff.storyIndex.defaultStory");
        expect(settle(merged, {}).defaultStoryId).toBe("b");
        // And the author can still take the other side, which is what makes it a decision.
        expect(settle(merged, {[mergeDecisionKey(["defaultStoryId"])]: "theirs"}).defaultStoryId).toBe("a");
    });

    it("removes the starting story when the side that has none is chosen", () => {
        const base = index([story("a")], {defaultStoryId: "a"});
        const mine = index([story("a")], {defaultStoryId: "a"});
        const theirs = index([story("a")]);

        const merged = merge3(base, mine, theirs);

        const cleared = settle(merged, {});
        expect(Object.prototype.hasOwnProperty.call(cleared, "defaultStoryId")).toBe(false);
    });

    it("keeps the library's own timestamps out of the decisions", () => {
        const base = index([story("a")], {meta: {updatedAt: NOW}});
        const mine = index([story("a")], {meta: {updatedAt: LATER}});
        const theirs = index([story("a")], {meta: {updatedAt: EVEN_LATER}});

        const merged = merge3(base, mine, theirs);

        expect(merged.decisions).toEqual([]);
        expect(merged.document.meta).toEqual({updatedAt: LATER});
    });

    it("conflicts over every story when the two sides share no ancestor", () => {
        // `mergeKeyed`'s rule, restated here because it is the one that must not soften: with no
        // base, "theirs does not have this" and "theirs deleted this" are the same observation.
        const mine = index([story("a", {name: "Mine"})]);
        const theirs = index([story("a", {name: "Theirs"})]);

        const merged = merge3(undefined, mine, theirs);

        expect(merged.decisions.map(entry => entry.path)).toEqual([["stories", "a"]]);
        expect(merged.conflicts).toBe(1);
    });
});

describe("the story library is read defensively", () => {
    it("resolves its own path back to itself", () => {
        expect(storyIndexSpec.matches(STORY_INDEX_DOCUMENT_PATH)).toBe(true);
        expect(storyIndexSpec.pathFor()).toBe("editor/story/index.json");
    });

    it("counts the stories it holds", () => {
        expect(storyIndexSpec.summarize(index([story("a"), story("b")]))).toEqual({
            title: "",
            counts: [{key: "stories", value: 2}],
        });
    });

    it("refuses a library whose entries have no id", () => {
        // The id is the key every copy of this file is matched by. An entry without one cannot be
        // merged against its counterpart and would be dropped by the loader, so it is reported.
        const text = JSON.stringify({schemaVersion: 2, stories: [{name: "Nameless"}]});
        expect(() => storyIndexSpec.parse(JSON.parse(text), contextFor(text)))
            .toThrow(DocumentCorruptError);
    });

    it("refuses a library a newer Studio wrote", () => {
        const text = JSON.stringify({schemaVersion: STORY_LIBRARY_INDEX_SCHEMA_VERSION + 1, stories: []});
        expect(() => storyIndexSpec.parse(JSON.parse(text), contextFor(text)))
            .toThrow(DocumentCorruptError);
    });

    it("reads a library that has no stories key at all", () => {
        const text = JSON.stringify({schemaVersion: 2});
        expect(storyIndexSpec.parse(JSON.parse(text), contextFor(text))).toEqual({schemaVersion: 2});
    });
});
