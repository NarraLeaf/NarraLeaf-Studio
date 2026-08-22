import {describe, expect, it} from "vitest";
import {STORY_DOCUMENT_PATH, storyDocumentSpec} from "@shared/documents/specs";
import {encodeCanonicalJson} from "@shared/documents/canonicalJson";
import {applyMergeDecisions, mergeDecisionKey} from "@shared/documents/mergeApply";
import {DocumentCorruptError, DocumentParseContext} from "@shared/documents/types";
import type {StoryBlock, StoryChapter, StoryDocument, StoryScene} from "@shared/types/story/document";
import {STORY_DOCUMENT_SCHEMA_VERSION} from "@shared/types/story/document";

/**
 * `spec.merge3` for the story format, and the two halves of it:
 *
 *  - what merges - different scenes, different rows of one scene, different fields of one row - and
 *    what is a leaf conflict, which is exactly "the same field on both sides";
 *  - **what is refused**, which is the point of this milestone. Two rearrangements of one scene
 *    interleave into a story nobody wrote that still compiles, so the refusal is a product decision
 *    about a silent, late failure rather than an admission that the merge is hard.
 *
 * A refusal is checked for the three properties it was designed to have: it does not throw, it is
 * not an ordinary conflict row, and it is not silent - `refusal.reason` names it. And the last test
 * here pins the case that must NOT fire, because a criterion that refuses whenever two people worked
 * in one scene leaves the second tier useless for the biggest documents in a project.
 */

const STORY_PATH = "editor/story/stories/story-1/storydoc.json";

function contextFor(text: string): DocumentParseContext {
    return {
        path: STORY_PATH,
        corrupt(reason: string): never {
            throw new DocumentCorruptError({kind: "story", path: STORY_PATH, reason, text});
        },
    };
}

function block(id: string, text: string, overrides: Partial<StoryBlock> = {}): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        parentId: null,
        childrenIds: [],
        payload: {action: "narration", text: {textId: `t-${id}`, value: text}},
        ...overrides,
    } as StoryBlock;
}

function scene(id: string, name: string, blocks: StoryBlock[], overrides: Partial<StoryScene> = {}): StoryScene {
    return {
        id,
        name,
        runtimeName: name,
        rootBlockIds: blocks.map(one => one.id),
        blocks: Object.fromEntries(blocks.map(one => [one.id, one])),
        ...overrides,
    };
}

function story(scenes: StoryScene[], chapters?: StoryChapter[]): StoryDocument {
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "story-1",
        name: "A Story",
        chapters: chapters ?? [{id: "ch1", name: "Chapter One", sceneIds: scenes.map(one => one.id)}],
        scenes: Object.fromEntries(scenes.map(one => [one.id, one])),
    };
}

const merge3 = storyDocumentSpec.merge3!;

/** What a row says at a path, as a pair that reads in an assertion. */
function outcomes(decisions: ReturnType<typeof merge3>["decisions"]): [string, string][] {
    return decisions.map(one => [one.path.join("/"), one.outcome]);
}

function blockOf(document: StoryDocument, sceneId: string, blockId: string): StoryBlock {
    return document.scenes[sceneId].blocks[blockId];
}

function textOf(document: StoryDocument, sceneId: string, blockId: string): unknown {
    return (blockOf(document, sceneId, blockId).payload as {text?: {value?: unknown}}).text?.value;
}

/** Write it the way the spec writes it, and read it back the way the spec reads it. */
function reparse(document: StoryDocument): StoryDocument {
    const text = storyDocumentSpec.serialize(document);
    return storyDocumentSpec.parse(JSON.parse(text), contextFor(text));
}

/**
 * The one property a merged document must have at every moment: it can be written, and writing it
 * settles.
 *
 * **The assertion is a fixed point, not an identity**, and the difference matters. It used to read
 * `reparse(merged) === merged`, which was true only while `parse` was a near-identity that did not
 * migrate; now `parse` migrates and normalizes, so it legitimately fills a hand-built fixture in -
 * `entrySceneId`, a scene's `description` - the first time it sees one. What must be true is that
 * it does so ONCE: parse, write, read, and you have the same document, forever. That is the
 * invariant `story.ts` states, and a merge whose result kept drifting on every write would commit
 * bytes the author's decision list never described.
 *
 * It also exercises the strict half of the writer. `encodeCanonicalJson` throws on a key holding
 * `undefined`, which is the shape a half-built merge has, so a merge that produced one fails here
 * rather than on the author's disk.
 */
function expectWritable(document: StoryDocument): void {
    const once = reparse(document);
    expect(reparse(once)).toStrictEqual(once);
    // Bytes, not only structure: the same document has to encode to the same file every time, or a
    // resolve would land in history as a change to every line.
    expect(storyDocumentSpec.serialize(reparse(once))).toBe(storyDocumentSpec.serialize(once));
}

describe("story merge3 is declared where it can be reached", () => {
    it("carries onto the spec rather than being dropped by defineDocumentSpec", () => {
        expect(typeof storyDocumentSpec.merge3).toBe("function");
        expect(storyDocumentSpec.paths).toContain(STORY_DOCUMENT_PATH);
    });
});

describe("story merge3: what merges", () => {
    it("merges two people working in different scenes with nothing to decide", () => {
        const base = story([scene("s1", "Prologue", [block("b1", "hello")]), scene("s2", "Market", [block("b2", "wares")])]);
        const mine = story([scene("s1", "Prologue", [block("b1", "hello there")]), base.scenes.s2]);
        const theirs = story([base.scenes.s1, scene("s2", "Market", [block("b2", "fine wares")])]);

        const merged = merge3(base, mine, theirs);

        expect(merged.conflicts).toBe(0);
        expect(merged.refusal).toBeUndefined();
        expect(outcomes(merged.decisions)).toEqual([["scenes/s1", "auto-mine"], ["scenes/s2", "auto-theirs"]]);
        expect(textOf(merged.document, "s1", "b1")).toBe("hello there");
        expect(textOf(merged.document, "s2", "b2")).toBe("fine wares");
        expectWritable(merged.document);
    });

    it("merges two rows of one scene, one edited by each side", () => {
        const base = story([scene("s1", "Prologue", [block("b1", "hello"), block("b2", "goodbye")])]);
        const mine = story([scene("s1", "Prologue", [block("b1", "hello there"), block("b2", "goodbye")])]);
        const theirs = story([scene("s1", "Prologue", [block("b1", "hello"), block("b2", "farewell")])]);

        const merged = merge3(base, mine, theirs);

        expect(merged.conflicts).toBe(0);
        expect(outcomes(merged.decisions)).toEqual([
            ["scenes/s1/blocks/b1/payload", "auto-mine"],
            ["scenes/s1/blocks/b2/payload", "auto-theirs"],
        ]);
        expect(textOf(merged.document, "s1", "b1")).toBe("hello there");
        expect(textOf(merged.document, "s1", "b2")).toBe("farewell");
        expectWritable(merged.document);
    });

    it("merges two different fields of the SAME row", () => {
        // I disabled the row, you fixed its text. Both land, and neither is a question.
        const base = story([scene("s1", "Prologue", [block("b1", "hello")])]);
        const mine = story([scene("s1", "Prologue", [block("b1", "hello", {disabled: true})])]);
        const theirs = story([scene("s1", "Prologue", [block("b1", "hello there")])]);

        const merged = merge3(base, mine, theirs);

        expect(merged.conflicts).toBe(0);
        expect(outcomes(merged.decisions)).toEqual([
            ["scenes/s1/blocks/b1/disabled", "auto-mine"],
            ["scenes/s1/blocks/b1/payload", "auto-theirs"],
        ]);
        expect(blockOf(merged.document, "s1", "b1").disabled).toBe(true);
        expect(textOf(merged.document, "s1", "b1")).toBe("hello there");
        expectWritable(merged.document);
    });

    it("conflicts on the SAME field of the same row, and holds base until it is settled", () => {
        const base = story([scene("s1", "Prologue", [block("b1", "hello")])]);
        const mine = story([scene("s1", "Prologue", [block("b1", "hello there")])]);
        const theirs = story([scene("s1", "Prologue", [block("b1", "hi")])]);

        const merged = merge3(base, mine, theirs);

        expect(merged.conflicts).toBe(1);
        expect(merged.refusal).toBeUndefined();
        const [row] = merged.decisions;
        expect(row.path).toEqual(["scenes", "s1", "blocks", "b1", "payload"]);
        expect(row.outcome).toBe("conflict");
        expect(row.label?.key).toBe("documentDiff.story.blockChanged");
        // Both payloads verbatim: the whole question the author is being asked.
        expect((row.mine.value as {text: {value: string}}).text.value).toBe("hello there");
        expect((row.theirs.value as {text: {value: string}}).text.value).toBe("hi");
        // Base, not a side. Holding a side would be taking the decision with nothing saying so.
        expect(textOf(merged.document, "s1", "b1")).toBe("hello");
        // Half resolved and still a document - the property that lets an author stop midway.
        expectWritable(merged.document);
    });

    it("takes an ordered array the author arranged when only one side changed it", () => {
        const scenes = [scene("s1", "One", [block("b1", "a")]), scene("s2", "Two", [block("b2", "b")])];
        const chapters = (order: string[]): StoryChapter[] =>
            order.map(id => ({id, name: id, sceneIds: id === "ch1" ? ["s1"] : ["s2"]}));
        const base = story(scenes, chapters(["ch1", "ch2"]));
        const mine = story(scenes, chapters(["ch2", "ch1"]));
        const theirs = story(scenes, chapters(["ch1", "ch2"]));

        const merged = merge3(base, mine, theirs);

        expect(merged.conflicts).toBe(0);
        expect(outcomes(merged.decisions)).toEqual([["chapters", "auto-mine"]]);
        expect(merged.decisions[0].label?.key).toBe("documentDiff.story.chapterOrder");
        expect(merged.document.chapters.map(one => one.id)).toEqual(["ch2", "ch1"]);
    });

    it("answers an array BOTH sides rearranged with one decision for the whole array", () => {
        // Never interleaved and never one row per position: a third ordering is one neither author
        // wrote, and per-index rows would be an invitation to build exactly that.
        const scenes = [scene("s1", "One", [block("b1", "a")])];
        const chapters = (order: string[]): StoryChapter[] => order.map(id => ({id, name: id, sceneIds: []}));
        const base = story(scenes, chapters(["ch1", "ch2", "ch3"]));
        const mine = story(scenes, chapters(["ch3", "ch1", "ch2"]));
        const theirs = story(scenes, chapters(["ch2", "ch3", "ch1"]));

        const merged = merge3(base, mine, theirs);

        expect(merged.conflicts).toBe(1);
        expect(outcomes(merged.decisions)).toEqual([["chapters", "conflict"]]);
        expect((merged.decisions[0].mine.value as StoryChapter[]).map(one => one.id)).toEqual(["ch3", "ch1", "ch2"]);
        expect((merged.decisions[0].theirs.value as StoryChapter[]).map(one => one.id)).toEqual(["ch2", "ch3", "ch1"]);
        // Base's order until the author picks - no interleave, no third arrangement.
        expect(merged.document.chapters.map(one => one.id)).toEqual(["ch1", "ch2", "ch3"]);
        expectWritable(merged.document);
    });

    it("treats an absent base as add/add rather than as an empty story", () => {
        const mine = story([scene("s1", "Prologue", [block("b1", "hello")])]);
        const theirs = story([scene("s1", "Prologue", [block("b1", "hi")])]);

        const merged = merge3(undefined, mine, theirs);

        expect(merged.decisions.every(one => one.outcome === "conflict")).toBe(true);
        expect(merged.conflicts).toBeGreaterThan(0);
        // Whole scenes, because without a base nothing says which side moved.
        expect(outcomes(merged.decisions)).toContainEqual(["scenes/s1", "conflict"]);
        expect(textOf(merged.document, "s1", "b1")).toBe("hello");
    });

    it("does not auto-take a document field only one side holds when there is no base", () => {
        // The same add/add rule one level up from the collections it was written for, and it is a
        // real trap: handing the field merge an EMPTY base instead of no base makes "theirs never
        // had this" indistinguishable from "theirs deleted it and I did not touch it", and the
        // second reading takes mine automatically. The author would never be asked.
        const mine = {...story([scene("s1", "Prologue", [block("b1", "hello")])]), entrySceneId: "s1"};
        const theirs = story([scene("s1", "Prologue", [block("b1", "hello")])]);

        const merged = merge3(undefined, mine, theirs);

        expect(outcomes(merged.decisions)).toContainEqual(["entrySceneId", "conflict"]);
        expect(merged.decisions.find(one => one.path[0] === "entrySceneId")?.theirs.present).toBe(false);
    });

    it("is pure: neither side is mutated", () => {
        const base = story([scene("s1", "Prologue", [block("b1", "hello")])]);
        const mine = story([scene("s1", "Prologue", [block("b1", "hello there"), block("b2", "new")])]);
        const theirs = story([scene("s1", "Prologue", [block("b1", "hi")])]);
        const before = JSON.stringify([base, mine, theirs]);

        merge3(base, mine, theirs);
        merge3(undefined, mine, theirs);

        expect(JSON.stringify([base, mine, theirs])).toBe(before);
    });
});

describe("story merge3: the refusal", () => {
    const base = story([scene("s1", "Prologue", [block("b1", "a"), block("b2", "b"), block("b3", "c")])]);

    /** The same three rows, in the order this side put them. */
    function reordered(order: string[]): StoryDocument {
        const blocks = order.map(id => base.scenes.s1.blocks[id]);
        return story([scene("s1", "Prologue", blocks)]);
    }

    it("refuses when both sides rearranged the same scene, and says why", () => {
        const mine = reordered(["b2", "b1", "b3"]);
        const theirs = reordered(["b1", "b3", "b2"]);

        const merged = merge3(base, mine, theirs);

        // Named, so a surface can render a reason rather than a shrug.
        expect(merged.refusal?.reason).toBe("scene-restructured");
        expect(merged.refusal?.path).toEqual(["scenes", "s1"]);
        expect(merged.refusal?.subject).toBe("Prologue");
        // One whole-document decision, not a row that draws like the twenty beside it. A consumer
        // that never heard of `refusal` still gets exactly tier one: take one side whole.
        expect(merged.decisions).toHaveLength(1);
        expect(merged.decisions[0].path).toEqual([]);
        expect(merged.decisions[0].outcome).toBe("conflict");
        expect(merged.decisions[0].mine.value).toStrictEqual(mine);
        expect(merged.decisions[0].theirs.value).toStrictEqual(theirs);
        expect(merged.conflicts).toBe(1);
        // Base, and no third arrangement anywhere.
        expect(merged.document).toStrictEqual(base);
    });

    it("refuses rather than throwing, whatever it is handed", () => {
        // The contract that matters most: this runs in the main process, where one throw takes out
        // the whole change list for every document in the comparison.
        const empty = {} as unknown as StoryDocument;
        expect(() => merge3(empty, empty, empty)).not.toThrow();
        expect(() => merge3(undefined, empty, base)).not.toThrow();
        expect(() => merge3(base, empty, empty)).not.toThrow();
        expect(() => merge3(base, base, {...base, scenes: null} as unknown as StoryDocument)).not.toThrow();
    });

    it("refuses when one side deleted a row the other edited", () => {
        // Holding base for it - what every other conflict does - would leave a row in `blocks` that
        // no ordered array names: present in the file, invisible in the editor.
        const mine = story([scene("s1", "Prologue", [base.scenes.s1.blocks.b1, base.scenes.s1.blocks.b3])]);
        const theirs = story([scene("s1", "Prologue", [
            base.scenes.s1.blocks.b1,
            block("b2", "b, rewritten"),
            base.scenes.s1.blocks.b3,
        ])]);

        const merged = merge3(base, mine, theirs);

        expect(merged.refusal?.reason).toBe("row-deleted-and-edited");
        expect(merged.document).toStrictEqual(base);
    });

    it("refuses two sides at different schema versions", () => {
        const mine = {...base, schemaVersion: (STORY_DOCUMENT_SCHEMA_VERSION - 1)} as unknown as StoryDocument;

        const merged = merge3(base, mine, base);

        expect(merged.refusal?.reason).toBe("schema-version-split");
        expect(merged.decisions).toHaveLength(1);
        expect(merged.decisions[0].path).toEqual([]);
    });

    it("does NOT refuse an ordinary edit inside one scene", () => {
        // The case a too-eager criterion would swallow, and the reason to write one down at all.
        const mine = story([scene("s1", "Prologue", [
            block("b1", "a, rewritten"),
            base.scenes.s1.blocks.b2,
            base.scenes.s1.blocks.b3,
        ])]);
        const theirs = story([scene("s1", "Prologue", [
            base.scenes.s1.blocks.b1,
            base.scenes.s1.blocks.b2,
            block("b3", "c, rewritten"),
        ])]);

        const merged = merge3(base, mine, theirs);

        expect(merged.refusal).toBeUndefined();
        expect(merged.conflicts).toBe(0);
        expect(textOf(merged.document, "s1", "b1")).toBe("a, rewritten");
        expect(textOf(merged.document, "s1", "b3")).toBe("c, rewritten");
        expect(merged.document.scenes.s1.rootBlockIds).toEqual(["b1", "b2", "b3"]);
    });

    it("does NOT refuse when only one side rearranged the scene", () => {
        // The commonest collaboration in a story there is: one person writes rows, another fixes a
        // line. Only one side rearranged, so there was a right answer and it is taken - and the
        // other side's edit still lands on top of it.
        const mine = story([scene("s1", "Prologue", [
            base.scenes.s1.blocks.b1,
            base.scenes.s1.blocks.b2,
            base.scenes.s1.blocks.b3,
            block("b4", "d"),
        ])]);
        const theirs = story([scene("s1", "Prologue", [
            base.scenes.s1.blocks.b1,
            block("b2", "b, rewritten"),
            base.scenes.s1.blocks.b3,
        ])]);

        const merged = merge3(base, mine, theirs);

        expect(merged.refusal).toBeUndefined();
        expect(merged.conflicts).toBe(0);
        expect(merged.document.scenes.s1.rootBlockIds).toEqual(["b1", "b2", "b3", "b4"]);
        expect(textOf(merged.document, "s1", "b2")).toBe("b, rewritten");
        expect(Object.keys(merged.document.scenes.s1.blocks).sort()).toEqual(["b1", "b2", "b3", "b4"]);
        expectWritable(merged.document);
    });

    it("does NOT refuse when both sides made the SAME rearrangement", () => {
        const same = ["b3", "b1", "b2"];
        const mine = story([scene("s1", "Prologue", same.map(id => base.scenes.s1.blocks[id]))]);
        const theirs = story([scene("s1", "Prologue", same.map(id =>
            id === "b1" ? block("b1", "a, rewritten") : base.scenes.s1.blocks[id]))]);

        const merged = merge3(base, mine, theirs);

        expect(merged.refusal).toBeUndefined();
        expect(merged.document.scenes.s1.rootBlockIds).toEqual(same);
        expect(textOf(merged.document, "s1", "b1")).toBe("a, rewritten");
    });
});

describe("story merge3: writing back", () => {
    it("can be committed: the spec writes canonical bytes with a trailing newline", () => {
        // The inverse of what this case used to pin. `serialize` refused while `parse` did not run
        // the story migration, because writing back would have saved a document that was never
        // migrated. Both halves of the migration are in shared code now, so the refusal is gone -
        // and the thing that replaced it is the invariant on `story.ts`, exercised below.
        const base = story([scene("s1", "Prologue", [block("b1", "hello")])]);
        const merged = merge3(base, base, base);

        const text = storyDocumentSpec.serialize(merged.document);
        expect(text).toBe(encodeCanonicalJson(merged.document));
        expect(text.endsWith("\n")).toBe(true);
        expectWritable(merged.document);
    });

    it("settles a real conflict all the way to the bytes a resolve would commit", () => {
        // End to end, in the order `readMergeDocument` / `resolveDocumentChanges` run it: parse the
        // three sides the way the merge's own sidecar files would be parsed, merge, answer the
        // conflict, apply, serialize. This is the whole second tier for a story in one case.
        const baseText = encodeCanonicalJson(story([scene("s1", "Prologue", [block("b1", "hello")])]));
        const mineText = encodeCanonicalJson(story([scene("s1", "Prologue", [block("b1", "hello, mine")])]));
        const theirsText = encodeCanonicalJson(story([scene("s1", "Prologue", [block("b1", "hello, theirs")])]));
        const parse = (text: string) => storyDocumentSpec.parse(JSON.parse(text), contextFor(text));

        const merged = merge3(parse(baseText), parse(mineText), parse(theirsText));

        expect(merged.conflicts).toBe(1);
        const [conflict] = merged.decisions;
        expect(conflict.outcome).toBe("conflict");

        const settled = applyMergeDecisions<StoryDocument>(
            STORY_PATH,
            merged.document,
            merged.decisions,
            {[mergeDecisionKey(conflict.path)]: "theirs"},
        );
        const written = storyDocumentSpec.serialize(settled);

        // The author picked "theirs", so the committed bytes say so - and they are byte-identical to
        // simply having written their side, which is the property a resolve is judged on.
        expect(textOf(parse(written), "s1", "b1")).toBe("hello, theirs");
        expect(written).toBe(storyDocumentSpec.serialize(parse(theirsText)));
    });

    it("refuses a side written by a newer Studio instead of quietly down-levelling it", () => {
        // The exact failure the old `serialize` refusal existed to prevent, now pinned on `parse`
        // where it belongs: a merge whose sides include a document from a newer Studio must stop,
        // not migrate it DOWN to this build's schema and write that back over the newer fields.
        const newer = {
            ...story([scene("s1", "Prologue", [block("b1", "hello")])]),
            schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION + 1,
        };
        const text = encodeCanonicalJson(newer);

        expect(() => storyDocumentSpec.parse(JSON.parse(text), contextFor(text)))
            .toThrow(/newer version of Studio/);
    });
});
