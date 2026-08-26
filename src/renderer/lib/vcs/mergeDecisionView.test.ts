import { describe, expect, it } from "vitest";
import { NO_DOCUMENT_NAMES } from "./documentName";
import type { DocumentMergeDecision } from "@shared/documents/diff";
import { mergeDecisionKey } from "@shared/documents/mergeApply";
import type { TranslationKey } from "@shared/i18n";
import {
    buildConflictRows,
    countUndecidedChanges,
    countUndecidedFiles,
    describeMergeSides,
    MERGE_VALUE_MAX_DEPTH,
    effectiveMergeSide,
    MERGE_VALUE_FIELD_LIMIT,
    MERGE_VALUE_TEXT_LIMIT,
    mergeDocumentBlockedKey,
    mergeHeadingKey,
    resolveMergeDecisionLabel,
    type MergeChoiceState,
} from "./mergeDecisionView";
import type { LabelTranslator } from "./documentChangeView";

/**
 * What the resolve panel would draw, without drawing it.
 *
 * The rule under every case here is the same one: an `auto-*` row has an answer and a `conflict`
 * row has none, and nothing may quietly turn the second into the first. A default of "mine" would
 * be one press away from discarding a collaborator's work with nothing on screen saying so.
 */

const translator: LabelTranslator = {
    t: ((key: TranslationKey, params?: Record<string, unknown>) =>
        params && Object.keys(params).length > 0
            ? `${key}(${Object.keys(params).sort().join(",")})`
            : String(key)) as LabelTranslator["t"],
    has: () => true,
};

function decision(
    outcome: DocumentMergeDecision["outcome"],
    extra: Partial<DocumentMergeDecision> = {},
): DocumentMergeDecision {
    return {
        path: ["units", "greeting"],
        outcome,
        mine: { present: true, value: { target: "mine" } },
        theirs: { present: true, value: { target: "theirs" } },
        ...extra,
    };
}

describe("effectiveMergeSide", () => {
    it("answers with the side an automatic outcome already took", () => {
        expect(effectiveMergeSide(decision("auto-mine"), {})).toBe("mine");
        expect(effectiveMergeSide(decision("auto-theirs"), {})).toBe("theirs");
    });

    /** The one that must never acquire a default. */
    it("answers with nothing for an unanswered conflict", () => {
        expect(effectiveMergeSide(decision("conflict"), {})).toBeUndefined();
    });

    it("lets a recorded choice override an automatic outcome", () => {
        const key = mergeDecisionKey(["units", "greeting"]);
        expect(effectiveMergeSide(decision("auto-mine"), { [key]: "theirs" })).toBe("theirs");
        expect(effectiveMergeSide(decision("conflict"), { [key]: "mine" })).toBe("mine");
    });
});

describe("countUndecidedChanges", () => {
    it("counts only the conflicts nobody answered", () => {
        const other: DocumentMergeDecision = { ...decision("conflict"), path: ["units", "farewell"] };
        expect(countUndecidedChanges([decision("auto-mine"), decision("conflict"), other], {})).toBe(2);
        expect(countUndecidedChanges(
            [decision("auto-mine"), decision("conflict"), other],
            { [mergeDecisionKey(["units", "greeting"])]: "theirs" },
        )).toBe(1);
    });

    /** A file whose every change merged on its own still has to be finishable. */
    it("is zero for a document with no conflicts at all", () => {
        expect(countUndecidedChanges([decision("auto-mine"), decision("auto-theirs")], {})).toBe(0);
    });
});

describe("resolveMergeDecisionLabel", () => {
    it("translates a label and puts the author's own word first when there is one", () => {
        expect(resolveMergeDecisionLabel(decision("conflict", {
            label: { key: "documentDiff.assets.changed" },
            subject: "Sunset",
        }), translator)).toEqual({
            primary: "Sunset",
            detail: "documentDiff.assets.changed",
            untranslated: false,
        });
    });

    /**
     * A format whose merge lands before its semantic diff has no vocabulary yet, and the fallback
     * has to LOOK untranslated: inventing a sentence would put a translated-seeming label on a row
     * nobody has words for, and nothing would ever report it.
     */
    it("falls back to the path and says so when there is no label", () => {
        expect(resolveMergeDecisionLabel(decision("conflict"), translator)).toEqual({
            primary: "units / greeting",
            untranslated: true,
        });
    });
});

describe("describeMergeSides", () => {
    const held = (value: unknown) => ({ present: true as const, value });
    const missing = { present: false as const };

    /** "The other side does not have this entry" is a real answer, not an empty one. */
    it("marks a side that does not hold the entry", () => {
        const { mine, theirs } = describeMergeSides(missing, held({ target: "hi" }));

        expect(mine).toEqual({ absent: true, lines: [], hidden: 0 });
        expect(theirs.absent).toBe(false);
    });

    /**
     * Fields rather than JSON: the question a translation conflict asks is which of two sentences
     * to keep, and braces and quotes put the answer inside punctuation.
     */
    it("draws a record one field per line", () => {
        const { mine } = describeMergeSides(
            held({ target: "こんにちは", status: "translated" }),
            held({ target: "やあ", status: "translated" }),
        );

        expect(mine.lines).toEqual([
            { name: "target", text: "こんにちは" },
            { name: "status", text: "translated" },
        ]);
        expect(mine.hidden).toBe(0);
    });

    /**
     * The shape a story row has: what the author wrote is one level below the fields that say what
     * kind of row it is, and collapsing that level put the only readable thing inside the braces.
     */
    it("names a nested field rather than printing the object it sits in", () => {
        const { mine } = describeMergeSides(
            held({ action: "narration", text: { textId: "t1", role: "narration", value: "Second line." } }),
            held({ action: "narration", text: { textId: "t1", role: "narration", value: "A different line." } }),
        );

        expect(mine.lines[0]).toEqual({ name: "text.value", text: "Second line." });
        expect(mine.lines.some(line => line.text.includes("{"))).toBe(false);
    });

    /**
     * A decision exists because the sides differ. Leading with what they agree on spends the row's
     * limit on the part that is not the question - which on a story row is every field except one.
     */
    it("puts the fields the two sides disagree about first", () => {
        const { mine, theirs } = describeMergeSides(
            held({ a: "same", b: "same", c: "same", d: "mine", e: "same" }),
            held({ a: "same", b: "same", c: "same", d: "theirs", e: "same" }),
        );

        expect(mine.lines[0]).toEqual({ name: "d", text: "mine" });
        expect(theirs.lines[0]).toEqual({ name: "d", text: "theirs" });
    });

    /** Two columns are rows of each other, or the author is comparing two different things. */
    it("gives both sides the same fields in the same order", () => {
        const { mine, theirs } = describeMergeSides(
            held({ target: "hi", note: "mine only" }),
            held({ status: "translated", target: "yo" }),
        );

        expect(theirs.lines.map(line => line.name)).toEqual(mine.lines.map(line => line.name));
        // A name one side does not hold draws empty rather than vanishing: taking that side is what
        // removes it, which is the fact being chosen.
        expect(theirs.lines.find(line => line.name === "note")!.text).toBe("");
    });

    it("says how many fields it left out", () => {
        const value = Object.fromEntries(
            Array.from({ length: MERGE_VALUE_FIELD_LIMIT + 3 }, (_, index) => [`f${index}`, index]),
        );
        const { mine } = describeMergeSides(held(value), held({ ...value, f0: "differs" }));

        expect(mine.lines).toHaveLength(MERGE_VALUE_FIELD_LIMIT);
        expect(mine.hidden).toBe(3);
    });

    it("cuts a very long value rather than letting it push the other side off screen", () => {
        const { mine } = describeMergeSides(held("x".repeat(MERGE_VALUE_TEXT_LIMIT * 2)), held("y"));

        expect(mine.lines[0]!.text).toHaveLength(MERGE_VALUE_TEXT_LIMIT);
        expect(mine.lines[0]!.text.endsWith("…")).toBe(true);
    });

    it("draws a scalar as itself, with no field name to give it", () => {
        expect(describeMergeSides(held("plain"), held("other")).mine.lines).toEqual([{ text: "plain" }]);
        expect(describeMergeSides(held(7), held(8)).mine.lines).toEqual([{ text: "7" }]);
        expect(describeMergeSides(held(null), held(1)).mine.lines).toEqual([{ text: "null" }]);
    });

    it("stops naming at a depth and lets the rest be one line of JSON", () => {
        const nest = (bottom: unknown) => {
            let deep = bottom;
            for (let level = 0; level <= MERGE_VALUE_MAX_DEPTH + 1; level += 1) {
                deep = { down: deep };
            }
            return deep;
        };
        const { mine } = describeMergeSides(held(nest("mine")), held(nest("theirs")));

        expect(mine.lines[0]!.name!.split(".")).toHaveLength(MERGE_VALUE_MAX_DEPTH);
        expect(mine.lines[0]!.text).toContain("{");
    });

    /**
     * The pair stops splitting where EITHER side runs out, which is what keeps the two columns the
     * same rows: a side holding an empty object opposite one holding a filled object would
     * otherwise draw a blank where it does have a value.
     */
    it("stops splitting a name the moment one side has nothing left to split", () => {
        const { mine, theirs } = describeMergeSides(held({ tags: {} }), held({ tags: { a: 1 } }));

        expect(mine.lines).toEqual([{ name: "tags", text: "{}" }]);
        expect(theirs.lines).toEqual([{ name: "tags", text: '{"a":1}' }]);
    });

});

describe("mergeDocumentBlockedKey", () => {
    /**
     * Every blocker gets its own sentence. A shared one would tell the author "this cannot be
     * merged" without saying whether that is about the format, the file, or a migration that has
     * not landed - and the three have very different answers.
     */
    it("names a distinct key for every reason", () => {
        const keys = ([
            "no-spec", "no-merge3", "read-only", "too-large", "too-many", "unreadable",
        ] as const).map(mergeDocumentBlockedKey);
        expect(new Set(keys).size).toBe(keys.length);
        expect(keys.every(key => key.startsWith("documentDiff.resolve.change.blocked."))).toBe(true);
    });
});

/**
 * One file's state, which is the answer the finish button is built on.
 *
 * The failure these are for is a merge that can be closed while something is still unanswered: the
 * backend refuses it by name, so nothing is lost, but the author is told at the end of a two hundred
 * file merge rather than while they are making it.
 */
const EMPTY_STATE: MergeChoiceState = { decisions: {}, perChange: {}, changeChoices: {}, documents: {} };

const state = (partial: Partial<MergeChoiceState>): MergeChoiceState => ({ ...EMPTY_STATE, ...partial });

describe("buildConflictRows", () => {
    /**
     * A merge is the one surface where naming a document after its file is worst: two versions of
     * `storydoc.json` is the moment an author has to decide which of two versions of their own work
     * to keep, and the file name is the same on both.
     */
    it("names a conflicted document after what the author made", () => {
        const rows = buildConflictRows(
            ["editor/story/stories/s-1/storydoc.json"],
            EMPTY_STATE,
            { storyTitles: new Map([["s-1", "The Forest"]]) },
        );

        expect(rows[0]!.name).toEqual({ source: "authored", text: "The Forest" });
    });

    /**
     * During a merge the story index can be one of the conflicted files, so there is a real chance
     * of having no title. That answers with the kind and the id - which is an identifier and cannot
     * be mistaken for something the author typed - and never with the file name.
     */
    it("falls back to the kind and the id when the title could not be read", () => {
        const rows = buildConflictRows(
            ["editor/story/stories/s-1/storydoc.json"],
            EMPTY_STATE,
            NO_DOCUMENT_NAMES,
        );

        expect(rows[0]!.name).toEqual({
            source: "unnamed",
            key: "documentDiff.name.story",
            qualifier: "s-1",
        });
    });

    it("draws one row per conflicted file, whatever is inside it", () => {
        const many = Array.from({ length: 40 }, (_, index) => decision("conflict", { path: ["u", String(index)] }));
        const rows = buildConflictRows(["a.json", "b.json"], state({
            documents: {
                "b.json": { status: "ready", document: { path: "b.json", decisions: many, conflicts: 40 } },
            },
        }), NO_DOCUMENT_NAMES);

        expect(rows.map(row => row.path)).toEqual(["a.json", "b.json"]);
    });

    it("starts every file on neither side, which is the state that blocks the finish", () => {
        const rows = buildConflictRows(["a.json", "b.json"], EMPTY_STATE, NO_DOCUMENT_NAMES);

        expect(rows.map(row => row.decision)).toEqual(["none", "none"]);
        expect(rows.some(row => row.settled)).toBe(false);
        expect(countUndecidedFiles(rows)).toBe(2);
    });

    it("settles a file the moment a whole side is taken", () => {
        const rows = buildConflictRows(["a.json"], state({ decisions: { "a.json": "theirs" } }), NO_DOCUMENT_NAMES);

        expect(rows[0]).toMatchObject({ decision: "theirs", settled: true });
        expect(countUndecidedFiles(rows)).toBe(0);
    });

    /**
     * The per-change control is a property of the DOCUMENT, so it cannot be offered before anyone
     * has looked - a row drawn as mergeable while the read is still out would be a control that
     * disappears when the answer arrives.
     */
    it("offers the per-change choice only for a document that has answered and can be merged", () => {
        const unread = buildConflictRows(["a.json"], EMPTY_STATE, NO_DOCUMENT_NAMES);
        const loading = buildConflictRows(["a.json"], state({ documents: { "a.json": { status: "loading" } } }), NO_DOCUMENT_NAMES);
        const blocked = buildConflictRows(["a.json"], state({
            documents: {
                "a.json": { status: "ready", document: { path: "a.json", decisions: [], conflicts: 0, blocked: "no-spec" } },
            },
        }), NO_DOCUMENT_NAMES);
        const ready = buildConflictRows(["a.json"], state({
            documents: {
                "a.json": { status: "ready", document: { path: "a.json", decisions: [], conflicts: 0 } },
            },
        }), NO_DOCUMENT_NAMES);

        expect([unread[0].mergeable, loading[0].mergeable, blocked[0].mergeable]).toEqual([false, false, false]);
        expect(ready[0].mergeable).toBe(true);
    });

    it("counts a file being merged as settled only once every conflict inside it has a side", () => {
        const document = {
            path: "a.json",
            decisions: [decision("auto-mine"), decision("conflict", { path: ["units", "farewell"] })],
            conflicts: 1,
        };
        const documents = { "a.json": { status: "ready", document } } as const;

        const open = buildConflictRows(["a.json"], state({ perChange: { "a.json": true }, documents }), NO_DOCUMENT_NAMES);
        const answered = buildConflictRows(["a.json"], state({
            perChange: { "a.json": true },
            changeChoices: { "a.json": { [mergeDecisionKey(["units", "farewell"])]: "mine" } },
            documents,
        }), NO_DOCUMENT_NAMES);

        expect(open[0]).toMatchObject({ decision: "per-change", settled: false, undecidedChanges: 1 });
        expect(answered[0]).toMatchObject({ decision: "per-change", settled: true, undecidedChanges: 0 });
    });

    /**
     * Tier three is "refuse and say why", not "accept and hope". A blocked document reports its own
     * decision list as empty, and a file marked for per-change merging on the strength of that would
     * be finished with nothing chosen for it at all.
     */
    it("never settles a blocked file through the per-change route", () => {
        const rows = buildConflictRows(["a.json"], state({
            perChange: { "a.json": true },
            documents: {
                "a.json": { status: "ready", document: { path: "a.json", decisions: [], conflicts: 0, blocked: "read-only" } },
            },
        }), NO_DOCUMENT_NAMES);

        expect(rows[0]).toMatchObject({ decision: "per-change", settled: false });
        expect(countUndecidedFiles(rows)).toBe(1);
    });
});


/**
 * The strip above the resolve panel, which used to name a merge whether or not there was one.
 *
 * Finishing a merge therefore left the panel contradicting itself: the strip said the project's two
 * versions were being merged while the body two lines below said no merge was in progress.
 */
describe("mergeHeadingKey", () => {
    it("names the merge while there is one", () => {
        expect(mergeHeadingKey({ inProgress: true, conflicts: ["a.json"] })).toBe("documentDiff.resolve.merging");
    });

    it("stops naming it once the merge is over", () => {
        expect(mergeHeadingKey({ inProgress: false, conflicts: [] })).toBe("documentDiff.resolve.tab");
    });

    /**
     * Before the first read, and this is why the state is passed rather than a boolean: "nobody has
     * asked yet" is not "there is none", and the fallback has to be the answer that claims nothing
     * either way rather than the one that happens to be likely.
     */
    it("claims nothing before anything has been read", () => {
        expect(mergeHeadingKey(null)).toBe("documentDiff.resolve.tab");
    });
});
