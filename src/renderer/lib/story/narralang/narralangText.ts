/**
 * Rich text as tags.
 *
 * The default dialect's `{i}…{/i}` is the vocabulary NarraLeaf's own `Sentence` markup uses, so an
 * author who has written a dialogue line in the engine reads this without a second table to learn.
 * The alternative - the `.txt` codec's `‹…›` run delimiters - was picked there precisely because
 * nobody types those characters, which is the wrong property for a surface people are meant to edit.
 *
 * Every word and fence here comes off {@link NarralangDialect.text}; this file only knows that marks
 * nest, that the nesting order has to be fixed so two exports of one segment are byte-identical, and
 * that the whole line's edges need protecting once the runs are joined.
 */

import type { StoryTextMarks } from "@shared/types/story";

import type { NarralangDialect } from "./narralangDialect";
import type { NarralangText, NarralangTextRun } from "./narralangShape";
import {
    escapeNarralangProse,
    narralangNumber,
    narralangSeconds,
    narralangTagArgument,
    protectNarralangLineEdges,
} from "./narralangSyntax";

function tag(dialect: NarralangDialect, body: string): string {
    return `${dialect.text.open}${body}${dialect.text.close}`;
}

function wrapMarks(inner: string, marks: StoryTextMarks | undefined, dialect: NarralangDialect): string {
    if (!marks) {
        return inner;
    }
    const specs = dialect.text.marks;
    let out = inner;
    // Applied innermost-first so the emitted order matches the dialect's outer-to-inner list.
    for (let i = specs.length - 1; i >= 0; i -= 1) {
        const spec = specs[i];
        const value = marks[spec.mark];
        if (value === undefined || value === false || value === "") {
            continue;
        }
        // A raw argument is author data - a colour function, a ruby reading - and can hold the space
        // that separates a tag's parts, so it goes out under the same quote-when-needed rule a name
        // does. A number never can.
        const argument = spec.arg === "number"
            ? narralangNumber(Number(value))
            : spec.arg === "raw" ? narralangTagArgument(String(value), dialect) : null;
        const open = argument === null ? tag(dialect, spec.tag) : tag(dialect, `${spec.tag} ${argument}`);
        out = `${open}${out}${tag(dialect, `${dialect.text.closeSigil}${spec.tag}`)}`;
    }
    return out;
}

/** A resolved segment as one line of text. */
export function printNarralangText(text: NarralangText, dialect: NarralangDialect): string {
    return protectNarralangLineEdges(
        text.runs.map((run) => printRun(run, text.context, dialect)).join(""),
        dialect,
    );
}

function printRun(run: NarralangTextRun, context: NarralangText["context"], dialect: NarralangDialect): string {
    if ("text" in run) {
        return wrapMarks(escapeNarralangProse(run.text, context, dialect), run.marks, dialect);
    }
    if ("pause" in run) {
        const body = run.pause === true
            ? dialect.text.pause
            : `${dialect.text.pause} ${narralangSeconds(run.pause)}`;
        return tag(dialect, body);
    }
    // `null` is a value no script can say - a blueprint-computed one. Unreachable in a scene the gate
    // lets through, and the coverage pass has already reported the row it sits on.
    const source = run.interpolation ?? dialect.text.unknown;
    return wrapMarks(tag(dialect, `${dialect.text.interpolation} ${source}`), run.marks, dialect);
}
