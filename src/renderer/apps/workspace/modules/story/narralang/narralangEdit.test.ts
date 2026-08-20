import { describe, expect, it } from "vitest";
import { en } from "@shared/i18n/catalog/en";
import type { StoryBlock, StoryScene } from "@shared/types/story";
import type { TranslationKey } from "@shared/i18n";
import type { NarralangParseReason } from "@/lib/story/narralang/narralangParse";
import type { NarralangParseDiagnostic } from "@/lib/story/narralang/narralangReconcile";
import {
    NARRALANG_COMMIT_DEBOUNCE_MS,
    NARRALANG_DIAGNOSTIC_NOUNS,
    NARRALANG_HISTORY_MERGE_WINDOW_MS,
    narralangDiagnosticMarks,
    narralangHistoryMergeKey,
    narralangSceneMoved,
    shouldAdoptNarralangPrint,
} from "./narralangEdit";

/**
 * The three decisions the editable script view makes that are not about Monaco. Each of them is a way
 * of losing an author's typing if it is got wrong, which is why they are here rather than inside a
 * component that needs a DOM to be reasoned about.
 */

/** Keys in, keys out, so a test can see which sentence was chosen without matching prose. */
const echo = (key: TranslationKey, params?: Record<string, string | number>): string =>
    params === undefined ? key : `${key}(${Object.entries(params).map(([name, value]) => `${name}=${value}`).join(",")})`;

function diagnostic(
    line: number,
    column: number,
    reason: NarralangParseReason,
    detail?: string,
): NarralangParseDiagnostic {
    return detail === undefined ? { line, column, reason } : { line, column, reason, detail };
}

describe("narralang diagnostic marks", () => {
    it("underlines from where the reading broke down to the end of the statement", () => {
        // Not one character: the parser's claim is that the LINE does not read as anything, and a
        // squiggle under a single column would be a claim about a word that it never made.
        const marks = narralangDiagnosticMarks([diagnostic(2, 3, "unknownStatement")], () => 20, echo);

        expect(marks).toEqual([{
            line: 2,
            startColumn: 3,
            endColumn: 21,
            message: "story.narralang.parse.unknownStatement",
        }]);
    });

    it("names the thing at fault when the detail is a noun a reader knows", () => {
        const marks = narralangDiagnosticMarks([diagnostic(1, 1, "unknownName", "character")], () => 10, echo);

        expect(marks[0].message).toBe(
            "story.narralang.parse.unknownNameNamed(what=story.narralang.detail.character)",
        );
    });

    it("drops a detail that is an internal name rather than a noun", () => {
        // `ambiguousStatement` carries the verb it ranked first, which is an identifier out of the
        // dialect table. Showing it would put `displayableShow` in front of an author.
        const marks = narralangDiagnosticMarks([diagnostic(1, 1, "ambiguousStatement", "displayableShow")], () => 10, echo);

        expect(marks[0].message).toBe("story.narralang.parse.ambiguousStatement");
        expect(marks[0].message).not.toContain("displayableShow");
    });

    it("keeps a span of at least one column on an empty line", () => {
        const marks = narralangDiagnosticMarks([diagnostic(4, 1, "badIndent")], () => 0, echo);

        expect(marks[0].endColumn).toBeGreaterThan(marks[0].startColumn);
    });
});

describe("whether a reconciled tree is worth committing", () => {
    /**
     * Three rows, the last two loose at the top level - the shape a script has before the author
     * indents anything.
     */
    function flatScene(): Pick<StoryScene, "rootBlockIds" | "blocks"> {
        return {
            rootBlockIds: ["a", "b", "c"],
            blocks: {
                a: row("a", []),
                b: row("b", []),
                c: row("c", []),
            },
        };
    }

    function row(id: string, childrenIds: string[]): StoryBlock {
        return {
            id,
            kind: "nodeAction",
            payload: { action: "narration", text: { textId: `t-${id}`, value: id, role: "narration" } },
            parentId: null,
            childrenIds,
        } as StoryBlock;
    }

    it("sees an indent, which changes no payload at all", () => {
        // THE case this function exists for. Dragging two lines into a container re-parents them and
        // rewrites nothing, so the reconciler reports an empty `touchedBlockIds` - and a commit that
        // tested only that array would refuse the edit for ever, which reads as a broken editor.
        const moved = narralangSceneMoved(flatScene(), {
            rootBlockIds: ["a"],
            blocks: { a: row("a", ["b", "c"]), b: row("b", []), c: row("c", []) },
            touchedBlockIds: [],
        });

        expect(moved).toBe(true);
    });

    it("sees a passage moved without being re-indented", () => {
        const moved = narralangSceneMoved(flatScene(), {
            rootBlockIds: ["c", "a", "b"],
            blocks: flatScene().blocks,
            touchedBlockIds: [],
        });

        expect(moved).toBe(true);
    });

    it("sees a row added or deleted even when nothing else is touched", () => {
        const scene = flatScene();

        expect(narralangSceneMoved(scene, {
            rootBlockIds: ["a", "b"],
            blocks: { a: row("a", []), b: row("b", []) },
            touchedBlockIds: [],
        })).toBe(true);
    });

    it("sees a rewritten line through `touchedBlockIds` alone", () => {
        const scene = flatScene();

        expect(narralangSceneMoved(scene, { ...scene, touchedBlockIds: ["b"] })).toBe(true);
    });

    it("says nothing happened when the tree and the payloads both stand", () => {
        // A caret move, a trailing space, a re-print of the same scene. Committing this would push an
        // undo step for nothing and republish the document to every panel that listens.
        const scene = flatScene();

        expect(narralangSceneMoved(scene, { ...flatScene(), touchedBlockIds: [] })).toBe(false);
    });
});

describe("narralang commit timing", () => {
    it("keeps a run of commits inside one undo step", () => {
        // The merge window is measured between commits, and typing continuously produces one commit
        // per debounce. A window narrower than the debounce would break the group mid-sentence and
        // undoing a paragraph would take a press per typing pause.
        expect(NARRALANG_HISTORY_MERGE_WINDOW_MS).toBeGreaterThan(NARRALANG_COMMIT_DEBOUNCE_MS);
    });

    it("groups per scene, and never with an edit made in the row list", () => {
        expect(narralangHistoryMergeKey("scene-1")).not.toBe(narralangHistoryMergeKey("scene-2"));
        // The row editor passes no merge key at all, so a row edit can never fold into a script one.
        expect(narralangHistoryMergeKey("scene-1")).toBeTruthy();
    });
});

describe("adopting a change that arrived from elsewhere", () => {
    const settled = "bg corridor\n爱丽丝: 你也留到这么晚啊。";
    const moved = "bg rooftop\n爱丽丝: 你也留到这么晚啊。";

    it("takes a change while the author is reading", () => {
        expect(shouldAdoptNarralangPrint({ settled, buffer: settled, focused: false }, moved)).toBe(true);
    });

    it("never replaces text the author has typed and not yet committed", () => {
        // The buffer is the only copy of it. This is the case the whole predicate exists for.
        expect(shouldAdoptNarralangPrint({ settled, buffer: `${settled}\nwait 1`, focused: true }, moved)).toBe(false);
        expect(shouldAdoptNarralangPrint({ settled, buffer: `${settled}\nwait 1`, focused: false }, moved)).toBe(false);
    });

    it("waits for the author to leave the editor even when nothing is at stake", () => {
        // Replacing equal-looking text still moves the caret, and a caret that jumps mid-sentence is
        // indistinguishable from a bug. The caller holds the print and asks again on blur.
        expect(shouldAdoptNarralangPrint({ settled, buffer: settled, focused: true }, moved)).toBe(false);
    });

    it("does nothing when the print says what the buffer already says", () => {
        expect(shouldAdoptNarralangPrint({ settled, buffer: settled, focused: false }, settled)).toBe(false);
    });
});

/**
 * Every reason the parser can raise, as a type the compiler has to see completed.
 *
 * The marks build their key by template, which is exactly the shape a missing translation hides in:
 * the key falls back to itself and the author reads `story.narralang.parse.somethingNew`. A reason
 * added to the parser breaks this record at compile time, and the assertions below then make sure the
 * catalog gained the sentence too.
 */
const EVERY_PARSE_REASON: Record<NarralangParseReason, true> = {
    unknownStatement: true,
    unknownName: true,
    ambiguousName: true,
    ambiguousStatement: true,
    badWord: true,
    missingValue: true,
    conflictingValues: true,
    badIndent: true,
    danglingBranch: true,
    badTag: true,
    badExpression: true,
};

/** The two reasons that also have a form with the noun filled in. */
const NAMED_VARIANTS = ["unknownNameNamed", "ambiguousNameNamed"];

describe("narralang parse reasons", () => {
    it("has a sentence for every reason the parser can raise, and no others", () => {
        const sentences = en.story.narralang.parse as Record<string, string>;

        expect(Object.keys(sentences).sort()).toEqual(
            [...Object.keys(EVERY_PARSE_REASON), ...NAMED_VARIANTS].sort(),
        );
    });

    it("has a noun for every detail the marks are willing to show", () => {
        const nouns = en.story.narralang.detail as Record<string, string>;

        for (const noun of NARRALANG_DIAGNOSTIC_NOUNS) {
            expect(nouns[noun], `story.narralang.detail.${noun} is missing from en`).toBeTruthy();
        }
    });
});
