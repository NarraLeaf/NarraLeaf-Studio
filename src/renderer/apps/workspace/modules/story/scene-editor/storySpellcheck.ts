import type { StoryRichRun } from "@shared/types/story";
import type { SpellcheckRange } from "@shared/types/spellcheck";
import { isTextRun } from "./richText";

/**
 * Turning a row of rich runs into something the checker can read, and turning its answer back into
 * positions the editor can draw on.
 *
 * Nothing here touches layout or the network. It is separated from the field for the ordinary
 * reason - the mapping is where this feature gets things wrong, and a mapping that needs a laid-out
 * browser to exercise is a mapping nobody tests.
 *
 * Comments in English per project convention.
 */

/**
 * What one non-text unit contributes to the checked string.
 *
 * A single space, and both halves of that matter. A space, because a chip *separates* words the way
 * a space does - `Hello{name}` is not one word and asking the checker about `Helloname` would invent
 * a misspelling that is not in the script. Exactly one character, because the offsets that come back
 * have to survive the trip: a chip is one unit in the editor's model, so making it one character
 * here keeps the two counts walking in step and leaves the map below a straight line rather than a
 * table of exceptions.
 */
const CHIP_PLACEHOLDER = " ";

/**
 * The plain text handed to the checker, with the unit offset of every character in it.
 *
 * `unitAt` is one entry longer than `text`: the last is the total unit count, so an exclusive end
 * offset maps without a special case.
 *
 * The two coordinate systems are genuinely different, and conflating them is the bug this exists to
 * prevent. The checker counts characters; the editor counts *units*, where an inline chip is one
 * unit and no characters at all. `richRunsToPlain` drops chips entirely, so an offset taken from
 * that string and spent in the unit model lands further and further left the more chips a line
 * holds - and the string built here is deliberately not that one.
 *
 * Because {@link CHIP_PLACEHOLDER} is exactly one character, `unitAt` currently comes out as the
 * identity. That is the property the placeholder was chosen for, not an accident to lean on: the map
 * is built and used anyway, so nothing above has to know it holds, and a later decision to spend
 * something other than one character on a chip stays a one-line change here rather than a silent
 * mis-mapping everywhere else.
 */
export function buildSpellcheckText(runs: readonly StoryRichRun[]): { text: string; unitAt: number[] } {
    let text = "";
    const unitAt: number[] = [];
    let unit = 0;
    for (const run of runs) {
        if (isTextRun(run)) {
            for (const character of run.text) {
                text += character;
                unitAt.push(unit);
                unit += 1;
            }
            continue;
        }
        text += CHIP_PLACEHOLDER;
        unitAt.push(unit);
        unit += 1;
    }
    unitAt.push(unit);
    return { text, unitAt };
}

/**
 * One misspelling as the editor holds it: where it is in the checked string, where it is in the unit
 * model, and the word itself.
 *
 * Both coordinate systems are kept because both are needed and neither can be derived from the
 * other later: the plain pair is what revalidates the mark against text that has since been typed,
 * the unit pair is what builds the DOM range and what an accepted suggestion is spliced over.
 */
export type SpellMark = {
    /** Offset of the first character in the checked string. */
    start: number;
    /** Offset one past the last character in the checked string. */
    end: number;
    /** Unit offset of the first character, for `createUnitRange` and for splicing. */
    unitStart: number;
    /** Unit offset one past the last character. */
    unitEnd: number;
    word: string;
};

/**
 * Place one returned range in the unit model, or `null` when it does not describe a word in the text
 * that was sent.
 *
 * Refusing rather than clamping. A range outside the string is not a near miss to be rescued - it
 * means the answer was computed for text this row no longer holds, and a clamped version of it would
 * underline a word chosen at random.
 */
export function markFromRange(unitAt: readonly number[], text: string, range: SpellcheckRange): SpellMark | null {
    const { start, end, word } = range;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end >= unitAt.length) {
        return null;
    }
    if (text.slice(start, end) !== word) {
        return null;
    }
    return { start, end, unitStart: unitAt[start], unitEnd: unitAt[end], word };
}

/** Every range that describes a word in `text`, in the unit model. Ranges that do not are dropped. */
export function marksFromRanges(
    unitAt: readonly number[],
    text: string,
    ranges: readonly SpellcheckRange[],
): SpellMark[] {
    const marks: SpellMark[] = [];
    for (const range of ranges) {
        const mark = markFromRange(unitAt, text, range);
        if (mark) {
            marks.push(mark);
        }
    }
    return marks;
}

/**
 * The marks that still name the word they were made for, re-anchored to the current unit offsets.
 *
 * Run on every edit, and it is the reason a squiggle can never end up under a word that was never
 * checked. A check is debounced and its answer arrives late by design; between asking and answering
 * the author may have typed anything at all. Rather than trusting the answer's age, each mark is
 * asked the only question that settles it: is the text at these offsets still this word? Everything
 * that says no goes, immediately, and comes back only if the next check says so.
 *
 * Note what it does NOT do: it never shifts a mark to follow its word. A word that has moved is a
 * word this answer no longer describes, and guessing where it went is how an underline ends up
 * under the word beside the one that was checked.
 *
 * The unit pair is re-read from the fresh map for the same reason the map exists at all - see
 * {@link buildSpellcheckText}. It costs nothing and it is what keeps this correct if a chip ever
 * stops costing exactly one character.
 */
export function pruneStaleMarks(
    marks: readonly SpellMark[],
    text: string,
    unitAt: readonly number[],
): SpellMark[] {
    const kept: SpellMark[] = [];
    for (const mark of marks) {
        if (mark.end >= unitAt.length || text.slice(mark.start, mark.end) !== mark.word) {
            continue;
        }
        kept.push({ ...mark, unitStart: unitAt[mark.start], unitEnd: unitAt[mark.end] });
    }
    return kept;
}

/** The mark the pointer is standing in, or `null`. Both edges count, so the ends of a word are hit. */
export function markAtUnit(marks: readonly SpellMark[], unit: number): SpellMark | null {
    return marks.find(mark => unit >= mark.unitStart && unit <= mark.unitEnd) ?? null;
}

/** Just enough of a `DOMRect` to place a box by. Written out so the geometry is testable without layout. */
export type RectLike = { left: number; top: number; right: number; bottom: number; width: number; height: number };

/** One drawn underline: where it sits in the overlay's coordinate space, and how wide. */
export type UnderlineBox = { left: number; top: number; width: number };

/**
 * How tall the drawn squiggle is, and how far of it sits below the glyphs.
 *
 * The line is drawn just under the text rather than through the space below it: a wave in the middle
 * of the leading reads as belonging to the next line as much as to this one.
 */
export const UNDERLINE_HEIGHT_PX = 3;
const UNDERLINE_OVERLAP_PX = 1;

/**
 * Client rects of a range, moved into the overlay's coordinate space.
 *
 * The overlay is an absolutely positioned sibling of the field, so its coordinates are relative to
 * whatever `offsetParent` the field resolves against, plus that element's scroll. Expressing it that
 * way rather than in viewport coordinates is what makes the layer follow scrolling for free: the
 * boxes are laid out inside the same scrolled content as the words they mark, so the two move
 * together with no listener, no re-measure and no frame where the squiggle lags the sentence.
 *
 * A range spanning a line break returns one rect per visual line, which is why this is a list: a
 * wrapped word gets a piece of underline on each line, exactly under its own part of the word.
 * Empty rects are dropped - Chromium emits a zero-width one at a run boundary, and drawing it would
 * put a one-pixel wave in the middle of a word.
 */
export function underlineBoxes(
    rects: readonly RectLike[],
    origin: { left: number; top: number },
    scroll: { left: number; top: number },
): UnderlineBox[] {
    const boxes: UnderlineBox[] = [];
    for (const rect of rects) {
        if (rect.width <= 0) {
            continue;
        }
        boxes.push({
            left: rect.left - origin.left + scroll.left,
            top: rect.bottom - origin.top + scroll.top - UNDERLINE_OVERLAP_PX,
            width: rect.width,
        });
    }
    return boxes;
}

/**
 * How long a field stays still before it is checked.
 *
 * Long enough that a sentence typed straight through is checked once rather than once per word, and
 * short enough that stopping to think produces the marks before the author starts reading back what
 * they wrote.
 */
export const SPELLCHECK_DEBOUNCE_MS = 400;

export type SpellcheckRunnerOptions = {
    /** Ask the checker. Resolves `null` when the call could not be made or failed. */
    check: (text: string, language: string) => Promise<readonly SpellcheckRange[] | null>;
    /**
     * The row's runs as they stand at the moment of asking. Read again when an answer arrives, which
     * is what lets the answer be judged against the text rather than against its own age.
     */
    readRuns: () => StoryRichRun[] | null;
    /** Words the project spells this way are never marked, however the checker feels about them. */
    isKnownWord: (word: string) => boolean;
    /** Called whenever the marks change - including to nothing. */
    onMarks: (marks: SpellMark[]) => void;
    debounceMs?: number;
};

/**
 * The checking loop for one field: when to ask, and which answers are allowed to be drawn.
 *
 * A class rather than a hook because the interesting part has nothing to do with React and
 * everything to do with time. A check is debounced and answered over IPC, so between the question
 * and the answer the author may have typed a word, deleted the sentence, or closed the row. Every
 * way of getting that wrong looks the same on screen - a squiggle under a word that was never
 * checked - and none of it is reachable from a rendered component test.
 *
 * Two independent guards, because they fail differently:
 *
 *  1. **A generation counter**, bumped by every edit and captured by every request. An answer from
 *     an older generation is discarded whole. Never shifted to fit, never partly kept.
 *  2. **Re-verification against the live text.** Each returned range is placed by
 *     {@link markFromRange}, which refuses any whose word is not at those offsets *now*. This
 *     catches an answer that arrived on time for a row something else rewrote underneath it - a
 *     programmatic re-render, an undo - and it holds even if the counter is ever got wrong.
 *
 * A third thing keeps the two honest: {@link edited} re-asks the marks already drawn whether their
 * word is still theirs, on the keystroke rather than at the end of the debounce. So nothing stale is
 * ever on screen, not even for the length of the pause.
 */
export class SpellcheckRunner {
    private readonly options: SpellcheckRunnerOptions;
    private readonly debounceMs: number;
    private marks: SpellMark[] = [];
    private generation = 0;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private language: string | null = null;
    private disposed = false;

    constructor(options: SpellcheckRunnerOptions) {
        this.options = options;
        this.debounceMs = options.debounceMs ?? SPELLCHECK_DEBOUNCE_MS;
    }

    /** What is believed true right now. */
    public getMarks(): readonly SpellMark[] {
        return this.marks;
    }

    /**
     * Point the runner at a language, checking straight away when it changes.
     *
     * Not debounced: this is not the author typing, it is the answer to "what should this row be
     * checked against" changing under a row that has already been checked.
     */
    public setLanguage(language: string | null): void {
        this.language = language;
        this.generation += 1;
        if (!language) {
            this.publish([]);
            return;
        }
        this.request();
    }

    /** Check again in the current language - the project taught itself a word, or forgot one. */
    public refresh(): void {
        this.generation += 1;
        if (!this.language) {
            this.publish([]);
            return;
        }
        this.request();
    }

    /** The row changed. Prune what is drawn, then schedule a check of what it now says. */
    public edited(runs: StoryRichRun[]): void {
        this.generation += 1;
        if (this.marks.length > 0) {
            const { text, unitAt } = buildSpellcheckText(runs);
            const kept = pruneStaleMarks(this.marks, text, unitAt);
            // Published even when nothing was dropped: the words have moved on the line, so the
            // boxes under them have to be measured again.
            this.publish(kept);
        }
        if (!this.language) {
            return;
        }
        this.clearTimer();
        this.timer = setTimeout(() => {
            this.timer = null;
            this.request();
        }, this.debounceMs);
    }

    public dispose(): void {
        this.disposed = true;
        this.clearTimer();
    }

    private clearTimer(): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    private request(): void {
        const language = this.language;
        const runs = this.options.readRuns();
        if (!language || !runs) {
            return;
        }
        const { text } = buildSpellcheckText(runs);
        if (text.trim() === "") {
            this.publish([]);
            return;
        }
        const generation = this.generation;
        void (async () => {
            const ranges = await this.options.check(text, language);
            if (this.disposed || !ranges || generation !== this.generation) {
                return;
            }
            const live = this.options.readRuns();
            if (!live) {
                return;
            }
            const map = buildSpellcheckText(live);
            this.publish(
                marksFromRanges(map.unitAt, map.text, ranges).filter(mark => !this.options.isKnownWord(mark.word)),
            );
        })();
    }

    private publish(marks: SpellMark[]): void {
        this.marks = marks;
        this.options.onMarks(marks);
    }
}
