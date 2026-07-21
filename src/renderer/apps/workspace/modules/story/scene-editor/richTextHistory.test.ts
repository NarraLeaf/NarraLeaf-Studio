import { describe, expect, it } from "vitest";
import type { StoryRichRun } from "@shared/types/story";
import { editKindForInputType, RichTextHistory, RICH_TEXT_COALESCE_IDLE_MS, type RichTextSnapshot } from "./richTextHistory";

function snap(text: string, caret = text.length): RichTextSnapshot {
    return { runs: [{ text }], range: { start: caret, end: caret } };
}

function plain(state: RichTextSnapshot | null): string | null {
    if (!state) {
        return null;
    }
    return state.runs.map(run => ("text" in run ? run.text : "•")).join("");
}

/** Type `text` one character at a time, recording each keystroke as the caller's beforeinput hook would. */
function type(history: RichTextHistory, text: string, from: string, startAt: number): string {
    let current = from;
    let now = startAt;
    for (const char of text) {
        history.record(snap(current), { kind: "typing", boundary: char === " ", now });
        current += char;
        now += 50;
    }
    return current;
}

describe("editKindForInputType", () => {
    it("groups plain typing and composition apart from structural inserts", () => {
        expect(editKindForInputType("insertText")).toBe("typing");
        expect(editKindForInputType("insertCompositionText")).toBe("typing");
        expect(editKindForInputType("insertFromPaste")).toBe("structural");
    });

    it("groups every flavour of delete together", () => {
        expect(editKindForInputType("deleteContentBackward")).toBe("deleting");
        expect(editKindForInputType("deleteWordBackward")).toBe("deleting");
    });

    it("treats formatting as structural", () => {
        expect(editKindForInputType("formatBold")).toBe("structural");
    });
});

describe("RichTextHistory - coalescing", () => {
    it("keeps a burst of typing as one entry", () => {
        const history = new RichTextHistory();
        type(history, "hello", "", 0);
        expect(history.depth).toBe(1);
        expect(plain(history.undo(snap("hello")))).toBe("");
    });

    it("breaks the burst at a word boundary, so undo steps back one word", () => {
        const history = new RichTextHistory();
        const after = type(history, "hello world", "", 0);
        expect(after).toBe("hello world");
        // The boundary entry is captured *before* the space is typed, so the space goes with the word
        // it separates rather than being stranded at the end of the previous undo step.
        expect(plain(history.undo(snap(after)))).toBe("hello");
        expect(plain(history.undo(snap("hello")))).toBe("");
    });

    it("breaks the burst after an idle pause", () => {
        const history = new RichTextHistory();
        history.record(snap(""), { kind: "typing", now: 0 });
        history.record(snap("a"), { kind: "typing", now: 50 });
        expect(history.depth).toBe(1);
        history.record(snap("ab"), { kind: "typing", now: 50 + RICH_TEXT_COALESCE_IDLE_MS });
        expect(history.depth).toBe(2);
    });

    it("does not merge typing into deleting", () => {
        const history = new RichTextHistory();
        history.record(snap("ab"), { kind: "typing", now: 0 });
        history.record(snap("abc"), { kind: "deleting", now: 10 });
        expect(history.depth).toBe(2);
    });

    it("gives every structural edit its own entry however fast they land", () => {
        const history = new RichTextHistory();
        history.record(snap("a"), { kind: "structural", now: 0 });
        history.record(snap("b"), { kind: "structural", now: 1 });
        expect(history.depth).toBe(2);
    });
});

describe("RichTextHistory - undo and redo", () => {
    it("undoes a chip before the text that preceded it, and stops at the start", () => {
        // The reported bug: type, insert a pause, Mod+Z. The pause goes first, then the text.
        const history = new RichTextHistory();
        const typed = type(history, "hi", "", 0);
        const withPause: StoryRichRun[] = [{ text: typed }, { pause: 200 }];
        history.record(snap(typed), { kind: "structural", now: 500 });

        const afterPause: RichTextSnapshot = { runs: withPause, range: { start: 3, end: 3 } };
        expect(plain(history.undo(afterPause))).toBe("hi");
        expect(plain(history.undo(snap("hi")))).toBe("");
        expect(history.undo(snap(""))).toBeNull();
    });

    it("returns null when there is nothing left, so the caller can fall through to story history", () => {
        const history = new RichTextHistory();
        expect(history.canUndo).toBe(false);
        expect(history.undo(snap("anything"))).toBeNull();
    });

    it("restores the caret along with the runs", () => {
        const history = new RichTextHistory();
        history.record(snap("hello", 2), { kind: "structural", now: 0 });
        expect(history.undo(snap("hello world"))?.range).toEqual({ start: 2, end: 2 });
    });

    it("replays an undone edit", () => {
        const history = new RichTextHistory();
        history.record(snap(""), { kind: "structural", now: 0 });
        expect(plain(history.undo(snap("hi")))).toBe("");
        expect(history.canRedo).toBe(true);
        expect(plain(history.redo(snap("")))).toBe("hi");
        expect(history.canRedo).toBe(false);
    });

    it("drops the redo stack once a new edit lands", () => {
        const history = new RichTextHistory();
        history.record(snap(""), { kind: "structural", now: 0 });
        history.undo(snap("hi"));
        expect(history.canRedo).toBe(true);
        history.record(snap(""), { kind: "typing", now: 10 });
        expect(history.canRedo).toBe(false);
    });

    it("does not merge the next keystroke into the burst it just undid", () => {
        const history = new RichTextHistory();
        type(history, "ab", "", 0);
        history.undo(snap("ab"));
        history.record(snap(""), { kind: "typing", now: 100 });
        expect(history.depth).toBe(1);
        expect(plain(history.undo(snap("x")))).toBe("");
    });
});

describe("RichTextHistory - bounds", () => {
    it("drops the oldest entries past its limit rather than growing without end", () => {
        const history = new RichTextHistory(3);
        for (let index = 0; index < 5; index += 1) {
            history.record(snap(String(index)), { kind: "structural", now: index });
        }
        expect(history.depth).toBe(3);
        expect(plain(history.undo(snap("5")))).toBe("4");
    });
});
