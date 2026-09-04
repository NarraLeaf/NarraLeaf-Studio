import type { StoryRichRun, StoryTextMarks } from "@shared/types/story";
import { clampFontSizeStep, isStoryTextEmphasis } from "@shared/utils/storyTextMarks";

/**
 * The marks a static label carries, named as the subset of a dialogue run's that mean something
 * without a typewriter.
 *
 * Written as a `Pick` of {@link StoryTextMarks} rather than as a type of its own, because a label
 * and a line of dialogue are the same fact set in two places: an author who has just written ruby
 * into a line has to find the same ruby on the glossary screen, spelled the same way and stored the
 * same way. A second declaration of "bold" is how the two drift.
 *
 * Two of the story's marks are deliberately not here:
 *  - `cps` is a typing speed, and nothing types a label out.
 *  - `fontSize` is the story's legacy absolute size. Nothing in the editor writes one there either,
 *    and a size pinned in pixels does not follow the box it is set in - `fontSizeStep` is the mark
 *    that survives {@link TextWidgetProps.textAutoFit} and a translated line of another length.
 */
export type UITextRunMarks = Pick<
    StoryTextMarks,
    "bold" | "italic" | "color" | "ruby" | "fontSizeStep" | "emphasis"
>;

/**
 * One stretch of a label's text, with the marks set over it.
 *
 * The text arm of {@link StoryRichRun}, narrowed. The other three arms are reveal-time or
 * story-scoped concepts a page has no answer for:
 *  - `pause` waits for the typewriter to reach it, and a label reveals nothing;
 *  - `event` fires the instant the typewriter reveals it, and targets the speaking character of the
 *    row it is written in - a page has neither;
 *  - `interpolation` shows a computed value, which a surface already answers with a value binding:
 *    a whole prop driven by a value blueprint's Return Value or by the list row's field. Two of its
 *    three targets - a scene variable, a Story Action Blueprint - only exist inside a scene.
 */
export type UITextRun = {
    text: string;
    marks?: UITextRunMarks;
};

/**
 * A label's runs are dialogue runs, and stay assignable to them.
 *
 * The assignment is the guard: widening `UITextRun` past what a `StoryRichRun` can hold - a mark
 * this file invented, an arm of its own - stops compiling here rather than in whatever reads the
 * two as one.
 */
type _UITextRunsAreStoryRuns = UITextRun extends StoryRichRun ? true : never;
const _uiTextRunsAreStoryRuns: _UITextRunsAreStoryRuns = true;
void _uiTextRunsAreStoryRuns;

/** The marks a label may carry, in the order the controls offer them. */
export const UI_TEXT_RUN_MARK_KEYS = [
    "bold",
    "italic",
    "color",
    "fontSizeStep",
    "emphasis",
    "ruby",
] as const satisfies readonly (keyof UITextRunMarks)[];

function normalizeMarks(raw: unknown): UITextRunMarks | undefined {
    if (!raw || typeof raw !== "object") {
        return undefined;
    }
    const source = raw as Record<string, unknown>;
    const marks: UITextRunMarks = {};
    if (source.bold === true) marks.bold = true;
    if (source.italic === true) marks.italic = true;
    if (typeof source.color === "string" && source.color.length > 0) marks.color = source.color;
    if (typeof source.ruby === "string" && source.ruby.length > 0) marks.ruby = source.ruby;
    if (isStoryTextEmphasis(source.emphasis)) marks.emphasis = source.emphasis;
    const step = clampFontSizeStep(source.fontSizeStep);
    if (step !== undefined) marks.fontSizeStep = step;
    return Object.keys(marks).length > 0 ? marks : undefined;
}

function sameMarks(a: UITextRunMarks | undefined, b: UITextRunMarks | undefined): boolean {
    if (!a || !b) {
        return !a && !b;
    }
    return (
        a.bold === b.bold
        && a.italic === b.italic
        && a.color === b.color
        && a.ruby === b.ruby
        && a.emphasis === b.emphasis
        && a.fontSizeStep === b.fontSizeStep
    );
}

/**
 * The runs a stored element carries, as runs.
 *
 * Anything a page cannot mean is dropped rather than refused: a document may have been written by
 * hand or by a tool, and a label that carries a pause is a label whose text is still perfectly
 * good. Two runs that agree on every mark are merged, and a run carrying an annotation - a reading
 * is set over the characters it belongs to - is never merged with its neighbour.
 *
 * Returns `undefined` when nothing is left that the plain string does not already say, which is
 * what keeps a document from growing a `rich` key that only repeats `text`.
 */
export function normalizeUITextRuns(raw: unknown): UITextRun[] | undefined {
    if (!Array.isArray(raw)) {
        return undefined;
    }
    const runs: UITextRun[] = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== "object") {
            continue;
        }
        const text = (entry as { text?: unknown }).text;
        if (typeof text !== "string" || text.length === 0) {
            continue;
        }
        const marks = normalizeMarks((entry as { marks?: unknown }).marks);
        const last = runs[runs.length - 1];
        // A reading is written over a specific stretch, so two annotated runs stay two runs even
        // when they carry the same reading - merging them would set one reading over both.
        if (last && !marks?.ruby && !last.marks?.ruby && sameMarks(last.marks, marks)) {
            runs[runs.length - 1] = { text: last.text + text, ...(marks ? { marks } : {}) };
            continue;
        }
        runs.push({ text, ...(marks ? { marks } : {}) });
    }
    if (runs.length === 0) {
        return undefined;
    }
    if (runs.length === 1 && !runs[0].marks) {
        return undefined;
    }
    return runs;
}

/** The plain string the runs spell. */
export function uiTextRunsToPlain(runs: readonly UITextRun[]): string {
    let out = "";
    for (const run of runs) {
        out += run.text;
    }
    return out;
}

/**
 * The runs to draw a label with, or `null` to draw it as the plain string.
 *
 * Runs apply only while they still spell the text being displayed. That one rule is what keeps the
 * marks from ever contradicting the string: a translated line, a `text` driven by a value
 * blueprint, a list row's own field and a line edited by something that knows nothing about marks
 * all arrive here as a string the runs do not spell, and each of them falls back to plain text
 * rather than drawing the words the label no longer holds.
 */
export function resolveUITextRuns(text: string, runs: UITextRun[] | undefined): UITextRun[] | null {
    if (!runs || runs.length === 0) {
        return null;
    }
    return uiTextRunsToPlain(runs) === text ? runs : null;
}

/** How many characters of `a` and `b` are identical, counted from the start. */
function commonPrefixLength(a: string, b: string): number {
    const limit = Math.min(a.length, b.length);
    let i = 0;
    while (i < limit && a[i] === b[i]) {
        i++;
    }
    return i;
}

/** How many characters of `a` and `b` are identical, counted from the end, without reaching `floor`. */
function commonSuffixLength(a: string, b: string, floor: number): number {
    const limit = Math.min(a.length, b.length) - floor;
    let i = 0;
    while (i < limit && a[a.length - 1 - i] === b[b.length - 1 - i]) {
        i++;
    }
    return Math.max(0, i);
}

/** The marks a run keeps once an edit has landed inside it: everything but the reading. */
function marksWithoutRuby(marks: UITextRunMarks | undefined): UITextRunMarks | undefined {
    if (!marks?.ruby) {
        return marks;
    }
    const { ruby: _ruby, ...rest } = marks;
    return Object.keys(rest).length > 0 ? (rest as UITextRunMarks) : undefined;
}

/**
 * The part of `runs` covering `[from, to)`.
 *
 * `cutRuns` names the runs the edit reached into: those lose their reading, because a reading is
 * written over the characters that were there and half of them have just been replaced.
 */
function sliceRuns(runs: readonly UITextRun[], from: number, to: number, cutRuns: ReadonlySet<number>): UITextRun[] {
    const out: UITextRun[] = [];
    let cursor = 0;
    runs.forEach((run, index) => {
        const start = cursor;
        const end = cursor + run.text.length;
        cursor = end;
        const sliceStart = Math.max(start, from);
        const sliceEnd = Math.min(end, to);
        if (sliceEnd <= sliceStart) {
            return;
        }
        const marks = cutRuns.has(index) ? marksWithoutRuby(run.marks) : run.marks;
        out.push({
            text: run.text.slice(sliceStart - start, sliceEnd - start),
            ...(marks ? { marks } : {}),
        });
    });
    return out;
}

/**
 * The runs after a plain-text edit, keeping the marks the edit did not touch.
 *
 * A plain field - the inspector's text box, the label edited in place on the canvas - can only hand
 * back a string, and rewriting the runs from it would drop every reading in the paragraph because
 * one word changed. What the string does say is where it stopped agreeing with the old one, so the
 * common head and tail keep their marks and only the stretch between them is written afresh, in the
 * marks of the character it was typed after.
 */
export function applyPlainTextToUITextRuns(
    runs: UITextRun[] | undefined,
    nextText: string,
): UITextRun[] | undefined {
    if (!runs || runs.length === 0) {
        return undefined;
    }
    const previousText = uiTextRunsToPlain(runs);
    if (previousText === nextText) {
        return normalizeUITextRuns(runs);
    }
    const prefix = commonPrefixLength(previousText, nextText);
    const suffix = commonSuffixLength(previousText, nextText, prefix);
    const inserted = nextText.slice(prefix, nextText.length - suffix);
    const removedEnd = previousText.length - suffix;

    const cutRuns = new Set<number>();
    let insertedMarks: UITextRunMarks | undefined;
    let cursor = 0;
    runs.forEach((run, index) => {
        const start = cursor;
        const end = cursor + run.text.length;
        cursor = end;
        if (start < removedEnd && end > prefix) {
            cutRuns.add(index);
        }
        // Typed text continues the run the caret was sitting in, which is what a caret inside a bold
        // word does everywhere else. Its reading is not carried over - see `marksWithoutRuby`.
        if (start < prefix && prefix <= end) {
            insertedMarks = marksWithoutRuby(run.marks);
        }
    });

    return normalizeUITextRuns([
        ...sliceRuns(runs, 0, prefix, cutRuns),
        ...(inserted.length > 0 ? [{ text: inserted, ...(insertedMarks ? { marks: insertedMarks } : {}) }] : []),
        ...sliceRuns(runs, removedEnd, previousText.length, cutRuns),
    ]);
}

/**
 * The marks shared by every character in `[start, end)`, or `undefined` where they differ.
 *
 * What a control reads to show what the selection is already set to: a value it can name is one
 * every character carries, and anything else leaves the control unset rather than claiming the
 * first character's answer for all of them.
 */
export function uiTextRunMarksInRange(
    runs: UITextRun[] | undefined,
    text: string,
    start: number,
    end: number,
): UITextRunMarks | undefined {
    if (end <= start) {
        return undefined;
    }
    const source = runs && uiTextRunsToPlain(runs) === text ? runs : [{ text }];
    let shared: UITextRunMarks | undefined;
    let first = true;
    let cursor = 0;
    for (const run of source) {
        const runStart = cursor;
        const runEnd = cursor + run.text.length;
        cursor = runEnd;
        if (runEnd <= start || runStart >= end) {
            continue;
        }
        const marks = run.marks;
        if (first) {
            shared = marks ? { ...marks } : undefined;
            first = false;
            continue;
        }
        if (!shared) {
            return undefined;
        }
        if (!marks) {
            return undefined;
        }
        const merged: UITextRunMarks = {};
        if (shared.bold && marks.bold) merged.bold = true;
        if (shared.italic && marks.italic) merged.italic = true;
        if (shared.color && shared.color === marks.color) merged.color = shared.color;
        if (shared.ruby && shared.ruby === marks.ruby) merged.ruby = shared.ruby;
        if (shared.emphasis && shared.emphasis === marks.emphasis) merged.emphasis = shared.emphasis;
        if (shared.fontSizeStep !== undefined && shared.fontSizeStep === marks.fontSizeStep) {
            merged.fontSizeStep = shared.fontSizeStep;
        }
        shared = Object.keys(merged).length > 0 ? merged : undefined;
    }
    return shared;
}

/**
 * The runs after one mark is set over `[start, end)`, or cleared from it when `value` is undefined.
 *
 * The range is split off from whatever runs it crosses and the mark written on the pieces, which is
 * how a mark set over half a bold word leaves the other half bold.
 */
export function setUITextRunMark<K extends keyof UITextRunMarks>(
    runs: UITextRun[] | undefined,
    text: string,
    start: number,
    end: number,
    key: K,
    value: UITextRunMarks[K] | undefined,
): UITextRun[] | undefined {
    if (end <= start) {
        return normalizeUITextRuns(runs);
    }
    const source: UITextRun[] = runs && uiTextRunsToPlain(runs) === text ? runs : [{ text }];
    const out: UITextRun[] = [];
    let cursor = 0;
    for (const run of source) {
        const runStart = cursor;
        const runEnd = cursor + run.text.length;
        cursor = runEnd;
        if (runEnd <= start || runStart >= end) {
            out.push(run);
            continue;
        }
        const head = run.text.slice(0, Math.max(0, start - runStart));
        const middle = run.text.slice(Math.max(0, start - runStart), Math.min(run.text.length, end - runStart));
        const tail = run.text.slice(Math.min(run.text.length, end - runStart));
        if (head) {
            out.push({ text: head, ...(run.marks ? { marks: run.marks } : {}) });
        }
        if (middle) {
            const marks: UITextRunMarks = { ...(run.marks ?? {}) };
            if (value === undefined || value === false || value === "") {
                delete marks[key];
            } else {
                marks[key] = value;
            }
            const cleaned = normalizeMarks(marks);
            out.push({ text: middle, ...(cleaned ? { marks: cleaned } : {}) });
        }
        if (tail) {
            out.push({ text: tail, ...(run.marks ? { marks: run.marks } : {}) });
        }
    }
    return normalizeUITextRuns(out);
}
