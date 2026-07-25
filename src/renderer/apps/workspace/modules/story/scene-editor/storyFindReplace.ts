import type { StoryBlock, StoryBlockId, StoryRichRun, StoryTextSegment } from "@shared/types/story";
import { isTextRun, plainToRichRuns, richIfMeaningful, richRunsToPlain, segmentToRuns, spliceRuns } from "./richText";

/**
 * Find and replace across a scene's prose.
 *
 * Kept pure and separate from the bar that drives it, because the one thing this must never do is
 * corrupt a line while rewriting it. A styled line is a list of runs, not a string: bold in the middle
 * of a sentence is two text runs with something between them, and a pause token is a run that occupies
 * a position while contributing no characters at all. Matching happens on the plain projection (so a
 * search finds what the author sees, including across a style boundary) and replacing happens in unit
 * space (so the surrounding marks, pauses and inline values survive).
 */

export type StoryFindOptions = {
    caseSensitive: boolean;
};

/** One hit, as offsets into a segment's plain-text projection. */
export type StoryTextRange = {
    start: number;
    end: number;
};

export type StoryFindMatch = StoryTextRange & {
    blockId: StoryBlockId;
    /** Index of the row in the list that was searched, for navigation without a second lookup. */
    rowIndex: number;
};

/** Every non-overlapping hit for `query` in `value`. An empty query matches nothing. */
export function findRangesInText(value: string, query: string, options: StoryFindOptions): StoryTextRange[] {
    if (!query) {
        return [];
    }
    const haystack = options.caseSensitive ? value : value.toLowerCase();
    const needle = options.caseSensitive ? query : query.toLowerCase();
    const ranges: StoryTextRange[] = [];
    let from = 0;
    for (;;) {
        const index = haystack.indexOf(needle, from);
        if (index < 0) {
            return ranges;
        }
        ranges.push({ start: index, end: index + needle.length });
        // Non-overlapping: a search for "aa" in "aaaa" is two hits, not three.
        from = index + needle.length;
    }
}

/**
 * The plain-text projection a search runs against. Rich runs win when present — `value` is only their
 * derived projection, and a segment mid-edit can have the two disagree for a frame.
 */
export function segmentPlainText(segment: StoryTextSegment): string {
    return segment.rich && segment.rich.length > 0 ? richRunsToPlain(segment.rich) : segment.value;
}

/**
 * Plain-text offset → unit offset.
 *
 * `spliceRuns` counts in units, where every non-text run (a pause, an inline value, a reveal event)
 * is one unit and no characters. Replacing at a plain offset without this conversion would cut a
 * styled line at the wrong place — silently, and only on lines that carry a token.
 */
export function plainOffsetToUnit(runs: readonly StoryRichRun[], plainOffset: number): number {
    let plain = 0;
    let unit = 0;
    for (const run of runs) {
        if (!isTextRun(run)) {
            unit += 1;
            continue;
        }
        if (plain + run.text.length >= plainOffset) {
            return unit + (plainOffset - plain);
        }
        plain += run.text.length;
        unit += run.text.length;
    }
    return unit;
}

/**
 * Replace one hit in a segment, keeping everything the hit did not cover.
 *
 * The replacement inherits the marks of the run the match starts in, which is the reading a human
 * would expect: correcting a name inside a bold clause leaves it bold.
 */
export function replaceInSegment(segment: StoryTextSegment, range: StoryTextRange, replacement: string): StoryTextSegment {
    const runs = segmentToRuns(segment);
    const startUnit = plainOffsetToUnit(runs, range.start);
    const endUnit = plainOffsetToUnit(runs, range.end);
    const marks = markAtUnit(runs, startUnit);
    const insert: StoryRichRun[] = replacement
        ? [marks ? { text: replacement, marks } : { text: replacement }]
        : [];
    const next = spliceRuns([...runs], startUnit, endUnit, insert);
    const value = richRunsToPlain(next);
    const rich = richIfMeaningful(next);
    return rich ? { ...segment, value, rich } : { ...segment, value, rich: undefined };
}

/** Replace every hit in a segment, back to front so earlier offsets stay valid. */
export function replaceAllInSegment(
    segment: StoryTextSegment,
    ranges: readonly StoryTextRange[],
    replacement: string,
): StoryTextSegment {
    let next = segment;
    for (let index = ranges.length - 1; index >= 0; index -= 1) {
        next = replaceInSegment(next, ranges[index], replacement);
    }
    return next;
}

/** The marks carried at a unit position, so a replacement does not lose the styling around it. */
function markAtUnit(runs: readonly StoryRichRun[], unit: number) {
    let position = 0;
    for (const run of runs) {
        const length = isTextRun(run) ? run.text.length : 1;
        if (unit < position + length && isTextRun(run)) {
            return run.marks;
        }
        position += length;
    }
    // Past the end: inherit the last text run's marks, which is what typing at the end does.
    for (let index = runs.length - 1; index >= 0; index -= 1) {
        const run = runs[index];
        if (isTextRun(run)) {
            return run.marks;
        }
    }
    return undefined;
}

/** Put a plain string into a segment, used when a replacement empties one. */
export function plainSegment(segment: StoryTextSegment, value: string): StoryTextSegment {
    const rich = richIfMeaningful(plainToRichRuns(value));
    return rich ? { ...segment, value, rich } : { ...segment, value, rich: undefined };
}

/**
 * The block's text segment, whichever payload field holds it. Mirrors `getTextSegment` but returns the
 * setter too, so a caller can write one back without re-deriving which field it came from.
 */
export type StorySegmentSlot = {
    segment: StoryTextSegment;
    /** A copy of the block with the segment replaced. */
    withSegment: (next: StoryTextSegment) => StoryBlock;
};

export function getSegmentSlot(block: StoryBlock): StorySegmentSlot | null {
    if (block.kind === "nodeAction") {
        const payload = block.payload;
        if (payload.action === "narration" || payload.action === "dialogue" || payload.action === "choiceOption") {
            return {
                segment: payload.text,
                withSegment: next => ({ ...block, payload: { ...payload, text: next } }),
            };
        }
        if (payload.action === "choice" && payload.prompt) {
            const prompt = payload.prompt;
            return {
                segment: prompt,
                withSegment: next => ({ ...block, payload: { ...payload, prompt: next } }),
            };
        }
        return null;
    }
    if (block.kind === "note") {
        const payload = block.payload;
        return {
            segment: payload.text,
            withSegment: next => ({ ...block, payload: { ...payload, text: next } }),
        };
    }
    return null;
}
