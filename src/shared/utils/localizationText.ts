/**
 * Source-text serialization and translated-text parsing for game localization.
 *
 * A story text segment has two translator-facing serializations, and the difference between them is
 * the whole design:
 *
 *  - **{@link serializeSegmentSourceText} is what a translation is hashed against.** Inline
 *    interpolations become numbered `{n}` placeholders and everything else - styling, emphasis,
 *    pauses, reveal-time events - is invisible. That is deliberate: restyling a line must not
 *    invalidate its translations.
 *  - **{@link serializeSegmentMarkupText} is what the translator is shown and asked to reproduce.**
 *    It carries the same text with every styled span and every zero-width token wrapped in a
 *    numbered run tag, so a translation can put the emphasis, the pause and the portrait change back
 *    where the target language wants them.
 *
 * Both project the same characters, so a line with no styling serializes identically either way and
 * every translation written before run tags existed keeps working unchanged.
 *
 * Comments in English per project convention.
 */

import type { StoryRichRun, StoryTextMarks, StoryTextSegment } from "../types/story/document";
import { fnv1aHex } from "./contentHash";
import { encodeStableJson } from "./stableJson";

const SOURCE_HASH_PREFIX = "fnv1a:";

/** Serialize a segment to translator-facing text: plain runs verbatim, interpolations as `{n}`. */
export function serializeSegmentSourceText(segment: StoryTextSegment): string {
    if (!segment.rich || segment.rich.length === 0) {
        return segment.value;
    }
    let out = "";
    let interpolationIndex = 0;
    for (const run of segment.rich) {
        if ("pause" in run || "event" in run) {
            continue;
        }
        if ("interpolation" in run) {
            out += `{${interpolationIndex}}`;
            interpolationIndex += 1;
            continue;
        }
        out += run.text;
    }
    return out;
}

/**
 * Serialize a segment to the form a translator is shown and asked to reproduce: the same characters
 * {@link serializeSegmentSourceText} projects, with every styled span and every zero-width token
 * wrapped in a run tag.
 *
 * The number in a tag is the run's index in `segment.rich`, not a count of anything - so `‹4›` means
 * "run 4, whatever it is", the same bargain the `.txt` script codec strikes. A translator never has
 * to know what run 4 *is*; they move the tag to where the sentence wants it and the styling follows.
 *
 * Interpolations stay bare `{n}` even when the run carries marks of its own: an interpolation's
 * styling is compiled into the value's own Word, which a translation carries whole.
 *
 * A segment with nothing to tag returns exactly what the hashed serialization returns.
 */
export function serializeSegmentMarkupText(segment: StoryTextSegment): string {
    if (!segment.rich || segment.rich.length === 0) {
        return segment.value;
    }
    let out = "";
    let interpolationIndex = 0;
    for (let index = 0; index < segment.rich.length; index += 1) {
        const run = segment.rich[index];
        if ("pause" in run || "event" in run) {
            out += `${RUN_TAG_OPEN}${index}/${RUN_TAG_CLOSE}`;
            continue;
        }
        if ("interpolation" in run) {
            out += `{${interpolationIndex}}`;
            interpolationIndex += 1;
            continue;
        }
        if (!run.text) {
            continue;
        }
        out += run.marks
            ? `${RUN_TAG_OPEN}${index}${RUN_TAG_CLOSE}${run.text}${RUN_TAG_OPEN}/${index}${RUN_TAG_CLOSE}`
            : run.text;
    }
    return out;
}

/**
 * True for a run a tag can name: one that lends styling, or one that projects no characters at all.
 * An unstyled text run is not one - tagging it would change nothing, so a tag on it is a mistake.
 */
function isTaggableRun(run: StoryRichRun | undefined): boolean {
    if (!run) {
        return false;
    }
    return "pause" in run || "event" in run || ("text" in run && Boolean(run.marks));
}

/** True when a segment carries anything a run tag would name - styling, a pause, an inline event. */
export function segmentHasMarkup(segment: StoryTextSegment): boolean {
    return Boolean(segment.rich?.some(isTaggableRun));
}

/**
 * Split a translation into the pieces a line is rebuilt from, resolving run tags against the source
 * runs they name.
 *
 * Every way a tag can be wrong resolves to "render the characters plainly" rather than to an error:
 * a translation is written by someone who cannot run the game, and a mistyped tag must cost the
 * styling of one phrase, never the line. {@link validateMarkupParity} is what says so out loud.
 *
 *  - A tag naming a run this segment does not have is dropped, and its contents stay.
 *  - An opening tag never closed styles the rest of the line, which is what the translator was
 *    reaching for anyway.
 *  - A closing tag with nothing open is dropped.
 *  - Tags do not nest: an opening tag inside another closes the outer one first, because a run wears
 *    exactly one set of marks and a nested span would have to invent a merge rule.
 */
export function parseTranslatedRuns(target: string, sourceRuns: readonly StoryRichRun[] = []): TranslatedRunPart[] {
    const parts: TranslatedRunPart[] = [];
    let open: number | undefined;

    const pushText = (text: string): void => {
        if (!text) {
            return;
        }
        const previous = parts[parts.length - 1];
        if (previous && previous.kind === "text" && previous.runIndex === open) {
            previous.text += text;
            return;
        }
        parts.push(open === undefined ? { kind: "text", text } : { kind: "text", text, runIndex: open });
    };

    for (const token of tokenizeTranslation(target)) {
        if (token.kind === "text") {
            pushText(token.text);
            continue;
        }
        if (token.kind === "value") {
            parts.push({ kind: "placeholder", index: token.index });
            continue;
        }
        if (token.kind === "close") {
            if (open === token.index) {
                open = undefined;
            }
            continue;
        }
        const run = sourceRuns[token.index];
        if (!run) {
            continue;
        }
        const zeroWidth = "pause" in run || "event" in run;
        // The self-closing spelling says so outright; the bare one is read against the run it names,
        // which is how a translation written before the spelling existed still lands right.
        if (token.kind === "standalone" || zeroWidth) {
            if (zeroWidth) {
                parts.push({ kind: "run", runIndex: token.index });
            }
            continue;
        }
        // A run with no marks has nothing to lend, so tagging it changes nothing rather than opening
        // a span that would have to be closed.
        open = isTaggableRun(run) ? token.index : undefined;
    }
    return parts;
}

/**
 * A translation as editable runs: the same shape a story line is written in, so the translation
 * editor can render a tagged translation with the very code that renders the line.
 *
 * Each run is *the source's own run*, borrowed. A tagged span becomes text wearing that run's marks;
 * a standalone token becomes the pause or the event itself; `{n}` becomes the source's nth
 * interpolation. Nothing here can express styling the source does not have, which is the format's
 * rule restated as a data structure: a translation places the line's tags, it does not invent tags.
 */
export function translationRunsFromTarget(target: string, sourceRuns: readonly StoryRichRun[]): StoryRichRun[] {
    const interpolations = sourceRuns.filter(run => "interpolation" in run);
    const runs: StoryRichRun[] = [];
    for (const part of parseTranslatedRuns(target, sourceRuns)) {
        if (part.kind === "placeholder") {
            const run = interpolations[part.index];
            if (run) {
                runs.push(run);
            }
            continue;
        }
        if (part.kind === "run") {
            const run = sourceRuns[part.runIndex];
            if (run) {
                runs.push(run);
            }
            continue;
        }
        const marks = part.runIndex === undefined
            ? undefined
            : (sourceRuns[part.runIndex] as { marks?: StoryTextMarks } | undefined)?.marks;
        runs.push(marks ? { text: part.text, marks } : { text: part.text });
    }
    return runs;
}

/**
 * Editable runs back into a target string.
 *
 * A run is matched to the source run it came from **by value, not by identity** - the runs make a
 * round trip through the DOM of a contentEditable, which rebuilds them from data attributes and
 * loses every object reference. Two source runs that compare equal are interchangeable by
 * construction: equal marks produce the same word, equal pauses the same wait, so landing on the
 * first of them changes nothing about what the player sees.
 *
 * A run matching no source run at all loses its tag and keeps its characters. That is unreachable
 * through the editor, which only offers the line's own tags, and it is the right answer for a
 * document that arrived some other way.
 */
export function targetFromTranslationRuns(runs: readonly StoryRichRun[], sourceRuns: readonly StoryRichRun[]): string {
    const indexByRun = new Map<string, number>();
    let interpolationOrdinal = 0;
    const ordinalByInterpolation = new Map<string, number>();
    for (let index = 0; index < sourceRuns.length; index += 1) {
        const run = sourceRuns[index];
        const key = encodeStableJson(run);
        if (!indexByRun.has(key)) {
            indexByRun.set(key, index);
        }
        if ("interpolation" in run) {
            const interpolationKey = encodeStableJson(run.interpolation);
            if (!ordinalByInterpolation.has(interpolationKey)) {
                ordinalByInterpolation.set(interpolationKey, interpolationOrdinal);
            }
            interpolationOrdinal += 1;
        }
    }

    let out = "";
    for (const run of runs) {
        if ("interpolation" in run) {
            const ordinal = ordinalByInterpolation.get(encodeStableJson(run.interpolation));
            if (ordinal !== undefined) {
                out += printTranslationToken({ kind: "value", index: ordinal });
            }
            continue;
        }
        if ("pause" in run || "event" in run) {
            const index = indexByRun.get(encodeStableJson(run));
            if (index !== undefined) {
                out += printTranslationToken({ kind: "standalone", index });
            }
            continue;
        }
        if (!run.text) {
            continue;
        }
        const index = run.marks ? indexByRun.get(encodeStableJson({ text: run.text, marks: run.marks })) : undefined;
        // The text differs (it is a translation), so the run itself never matches; what has to match
        // is the marks, which is what the tag actually names.
        const byMarks = index ?? (run.marks ? marksIndex(sourceRuns, run.marks) : undefined);
        if (byMarks === undefined) {
            out += run.text;
            continue;
        }
        out += printTranslationToken({ kind: "open", index: byMarks })
            + run.text
            + printTranslationToken({ kind: "close", index: byMarks });
    }
    return out;
}

/** The first source text run whose marks equal these, or undefined. */
function marksIndex(sourceRuns: readonly StoryRichRun[], marks: StoryTextMarks): number | undefined {
    const key = encodeStableJson(marks);
    for (let index = 0; index < sourceRuns.length; index += 1) {
        const run = sourceRuns[index];
        if ("text" in run && run.marks && encodeStableJson(run.marks) === key) {
            return index;
        }
    }
    return undefined;
}

export type MarkupParityIssue =
    /** The translation tags a run this line does not have. */
    | { kind: "unknownRun"; index: number }
    /** The source run is styled, or is a pause or an event, and the translation never names it. */
    | { kind: "missingRun"; index: number };

/**
 * Compare a translation's run tags against the source segment's runs.
 *
 * Both shapes are warnings rather than defects, and for the same reason `{n}` parity is: a
 * translator may well decide a phrase needs no emphasis in their language, and a line that renders
 * plainly is a line that renders.
 */
export function validateMarkupParity(target: string, segment: StoryTextSegment): MarkupParityIssue[] {
    const runs = segment.rich ?? [];
    const referenced = new Set<number>();
    for (const token of tokenizeTranslation(target)) {
        if (token.kind !== "text" && token.kind !== "value") {
            referenced.add(token.index);
        }
    }
    const issues: MarkupParityIssue[] = [];
    for (const index of [...referenced].sort((a, b) => a - b)) {
        if (!isTaggableRun(runs[index])) {
            issues.push({ kind: "unknownRun", index });
        }
    }
    for (let index = 0; index < runs.length; index += 1) {
        if (isTaggableRun(runs[index]) && !referenced.has(index)) {
            issues.push({ kind: "missingRun", index });
        }
    }
    return issues;
}

/** Count of inline interpolation runs (the valid `{n}` placeholder range in translations). */
export function countSegmentInterpolations(segment: StoryTextSegment): number {
    if (!segment.rich) {
        return 0;
    }
    return segment.rich.reduce((count, run) => count + ("interpolation" in run ? 1 : 0), 0);
}

export function hashSourceText(sourceText: string): string {
    return `${SOURCE_HASH_PREFIX}${fnv1aHex(sourceText)}`;
}

/** True when a stored unit was translated against a different source text. */
export function isSourceHashStale(sourceHash: string, currentSourceText: string): boolean {
    return sourceHash !== hashSourceText(currentSourceText);
}

export type TranslatedTextPart =
    | { kind: "text"; text: string }
    | { kind: "placeholder"; index: number };

const PLACEHOLDER_PATTERN = /\{(\d+)\}/g;

/**
 * The fences of a run tag, and the same two characters the `.txt` script codec uses to address a run
 * by index - one problem, one answer, and an author reading both files learns one thing.
 *
 * Three shapes, spelled after XML so they read the way a translator expects:
 *
 *  - `‹1›…‹/1›` wraps characters in run 1's styling.
 *  - `‹2/›` is run 2 standing on its own - an inline pause, a reveal-time event.
 *  - `{0}` is an interpolated value, which has always been spelled this way.
 *
 * The self-closing shape carries its weight: a standalone token and a span whose closing tag the
 * translator forgot are otherwise the same characters, and telling them apart cannot depend on
 * having the source runs to hand. The XLIFF codec has only the string.
 *
 * A tag is recognised only as one of those exact shapes, never on the fence alone. That is what
 * makes the format additive: `‹` and `›` are single guillemets, which Swiss French and German set as
 * quotation marks, and prose that uses them is left alone. It is the same rule `{n}` has always
 * followed - a brace is only a placeholder when digits and a closing brace follow it.
 */
const RUN_TAG_OPEN = "‹";
const RUN_TAG_CLOSE = "›";
const RUN_TAG_PATTERN = /‹(\/?)(\d+)(\/?)›/g;

/**
 * One piece of a translation, before anything is resolved against the source.
 *
 * The tokenizer is shared rather than duplicated because two very different readers need the same
 * split: {@link parseTranslatedRuns} resolves the tokens against the runs they name, and the XLIFF
 * codec turns them into inline elements without knowing what any of them mean.
 */
export type TranslationToken =
    | { kind: "text"; text: string }
    | { kind: "open"; index: number }
    | { kind: "close"; index: number }
    | { kind: "standalone"; index: number }
    | { kind: "value"; index: number };

/** Split a translation into text, run tags and value placeholders, in order. */
export function tokenizeTranslation(target: string): TranslationToken[] {
    const tokens: TranslationToken[] = [];
    const pushText = (text: string): void => {
        if (!text) {
            return;
        }
        for (const part of parseTranslatedText(text)) {
            tokens.push(part.kind === "text" ? part : { kind: "value", index: part.index });
        }
    };
    RUN_TAG_PATTERN.lastIndex = 0;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = RUN_TAG_PATTERN.exec(target)) !== null) {
        pushText(target.slice(lastIndex, match.index));
        lastIndex = match.index + match[0].length;
        const index = Number(match[2]);
        if (match[1]) {
            // `‹/1/›` is nobody's intention; a closing tag closes.
            tokens.push({ kind: "close", index });
        } else if (match[3]) {
            tokens.push({ kind: "standalone", index });
        } else {
            tokens.push({ kind: "open", index });
        }
    }
    pushText(target.slice(lastIndex));
    return tokens;
}

/** Write one token back out. The inverse of {@link tokenizeTranslation}, token for token. */
export function printTranslationToken(token: TranslationToken): string {
    switch (token.kind) {
        case "text":
            return token.text;
        case "open":
            return `${RUN_TAG_OPEN}${token.index}${RUN_TAG_CLOSE}`;
        case "close":
            return `${RUN_TAG_OPEN}/${token.index}${RUN_TAG_CLOSE}`;
        case "standalone":
            return `${RUN_TAG_OPEN}${token.index}/${RUN_TAG_CLOSE}`;
        case "value":
            return `{${token.index}}`;
    }
}

/**
 * A translation split into the pieces the compiler rebuilds a line from.
 *
 * `runIndex` on a text part names the source run whose marks those characters wear; absent means
 * unstyled. A `run` part is a source run that projects no characters of its own - an inline pause or
 * a reveal-time event - dropped in at the point the translation puts it.
 */
export type TranslatedRunPart =
    | { kind: "text"; text: string; runIndex?: number }
    | { kind: "placeholder"; index: number }
    | { kind: "run"; runIndex: number };

export type PlaceholderParityIssue =
    /** The translation references `{index}` but the source has no such interpolation. */
    | { kind: "outOfRange"; index: number }
    /** The source interpolation `{index}` is never referenced by the translation. */
    | { kind: "missing"; index: number };

/**
 * Validate a translation's `{n}` placeholders against the source segment's
 * interpolation count. Out-of-range references are always defects (they render
 * as nothing); missing references are warnings (a translator may drop a value
 * deliberately, but it is usually an oversight).
 */
export function validatePlaceholderParity(target: string, interpolationCount: number): PlaceholderParityIssue[] {
    const referenced = new Set<number>();
    for (const part of parseTranslatedText(target)) {
        if (part.kind === "placeholder") {
            referenced.add(part.index);
        }
    }
    const issues: PlaceholderParityIssue[] = [];
    for (const index of [...referenced].sort((a, b) => a - b)) {
        if (index >= interpolationCount) {
            issues.push({ kind: "outOfRange", index });
        }
    }
    for (let index = 0; index < interpolationCount; index++) {
        if (!referenced.has(index)) {
            issues.push({ kind: "missing", index });
        }
    }
    return issues;
}

/** Split a translated string into literal chunks and `{n}` placeholder references. */
export function parseTranslatedText(target: string): TranslatedTextPart[] {
    const parts: TranslatedTextPart[] = [];
    PLACEHOLDER_PATTERN.lastIndex = 0;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = PLACEHOLDER_PATTERN.exec(target)) !== null) {
        if (match.index > lastIndex) {
            parts.push({ kind: "text", text: target.slice(lastIndex, match.index) });
        }
        parts.push({ kind: "placeholder", index: Number(match[1]) });
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < target.length) {
        parts.push({ kind: "text", text: target.slice(lastIndex) });
    }
    return parts;
}
