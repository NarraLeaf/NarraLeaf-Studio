/**
 * Rich text as brace tags.
 *
 * `{i}…{/i}` is the vocabulary NarraLeaf's own `Sentence` markup uses, so an author who has written a
 * dialogue line in the engine reads this without a second table to learn. The alternative - the
 * `.txt` codec's `‹…›` run delimiters - was picked there precisely because nobody types those
 * characters, which is the wrong property for a surface people are meant to edit.
 *
 * Marks nest in a fixed order so two exports of the same segment are byte-identical. The order is
 * outer-to-inner: `b`, `i`, `color`, `size`, `cps`, `ruby`. Ruby is innermost because it annotates
 * the base text itself rather than styling it.
 */

import type {
    StoryInterpolationRef,
    StoryRichRun,
    StoryTextMarks,
    StoryTextSegment,
} from "@shared/types/story";
import type { StoryVariableNameLookups } from "@/lib/story/storyRowProjection";
import { variableRefShortLabel } from "@/lib/story/storyRowProjection";

import {
    escapeNarralangProse,
    narralangNumber,
    narralangSeconds,
    protectNarralangLineEdges,
    type NarralangProseContext,
} from "./narralangSyntax";

/** A mark, its tag name, and how its argument prints. Order in this array IS the nesting order. */
const MARK_TAGS: readonly {
    key: keyof StoryTextMarks;
    tag: string;
    arg?: (value: NonNullable<StoryTextMarks[keyof StoryTextMarks]>) => string;
}[] = [
    { key: "bold", tag: "b" },
    { key: "italic", tag: "i" },
    { key: "color", tag: "color", arg: (value) => String(value) },
    { key: "fontSize", tag: "size", arg: (value) => narralangNumber(Number(value)) },
    { key: "cps", tag: "cps", arg: (value) => narralangNumber(Number(value)) },
    { key: "ruby", tag: "ruby", arg: (value) => String(value) },
];

function wrapMarks(inner: string, marks: StoryTextMarks | undefined): string {
    if (!marks) {
        return inner;
    }
    let out = inner;
    // Applied innermost-first so the emitted order matches MARK_TAGS outer-to-inner.
    for (let i = MARK_TAGS.length - 1; i >= 0; i -= 1) {
        const spec = MARK_TAGS[i];
        const value = marks[spec.key];
        if (value === undefined || value === false || value === "") {
            continue;
        }
        const open = spec.arg ? `{${spec.tag} ${spec.arg(value)}}` : `{${spec.tag}}`;
        out = `${open}${out}{/${spec.tag}}`;
    }
    return out;
}

/**
 * The `{= … }` form.
 *
 * A `variable` interpolation prints the variable's author-facing name and a bare name re-reads as
 * that same variable, so the two representations the document allows (`kind: "variable"` and an
 * expression whose tree is a lone identifier) print identically - which is correct, because they mean
 * the same thing and `storyExpressionParser` normalises a bare identifier back to the variable arm.
 *
 * A `blueprint` interpolation has no spelling. It is reported by the coverage analyser rather than
 * printed as a guess; see `narralangCoverage.ts`.
 */
function printInterpolation(ref: StoryInterpolationRef, lookups: StoryVariableNameLookups): string {
    if (ref.kind === "variable") {
        return `{= ${variableRefShortLabel(ref.target, lookups)}}`;
    }
    if (ref.kind === "expression") {
        return `{= ${ref.expression.source}}`;
    }
    // Unreachable for an expressible scene - the analyser refuses the scene before we get here.
    return "{= ?}";
}

/**
 * A segment's runs as one line of text.
 *
 * Falls back to `segment.value` when there are no runs, which is the plain case and the overwhelming
 * majority of rows. `value` is documented as the plain-text projection of `rich`, but it is NOT used
 * when runs exist: it would drop every mark.
 */
export function printNarralangText(
    segment: StoryTextSegment,
    lookups: StoryVariableNameLookups,
    context: NarralangProseContext,
): string {
    const runs = segment.rich;
    if (!runs || runs.length === 0) {
        return protectNarralangLineEdges(escapeNarralangProse(segment.value ?? "", context));
    }
    return protectNarralangLineEdges(runs.map((run) => printRun(run, lookups, context)).join(""));
}

function printRun(run: StoryRichRun, lookups: StoryVariableNameLookups, context: NarralangProseContext): string {
    if ("text" in run) {
        return wrapMarks(escapeNarralangProse(run.text, context), run.marks);
    }
    if ("pause" in run) {
        return run.pause === true ? "{p}" : `{p ${narralangSeconds(run.pause)}}`;
    }
    if ("interpolation" in run) {
        return wrapMarks(printInterpolation(run.interpolation, lookups), run.marks);
    }
    // An inline reveal event. No spelling; the analyser refuses the scene.
    return "";
}
