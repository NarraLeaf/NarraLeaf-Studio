/**
 * The hits a find has inside one piece of text, painted where they are.
 *
 * The row-level ring says which entry matched; this says which word did. In a translation table a
 * row is two paragraphs, and "somewhere in here" is not an answer a reader can use.
 *
 * Every mark is drawn from the matcher the overlay already compiled (`FindQuery.matcher`), so a row
 * never compiles a pattern of its own and the marks cannot disagree with the count in the bar.
 * When there is no query, or this text holds no hit, the plain string is returned and no extra DOM
 * exists at all - which is what keeps the tables the same weight they were when nobody is
 * searching.
 */

import type { ReactNode } from "react";
import type { CompiledMatcher } from "@/lib/workspace/services/search/textMatcher";
import { cn } from "@/lib/utils/cn";

/**
 * The accent at the weight a background can carry text on top of.
 *
 * The accent rather than a highlighter yellow: `warning` is a severity in this app, and a found
 * word is not a problem. It is the same colour as the ring around the row the cursor is on, one
 * step lighter, so the two read as one answer at two scales.
 */
const MARK_CLASS = "rounded-sm bg-primary/30 text-inherit";

/** Split `text` at the matcher's hits. Returns the plain string when there are none. */
export function markedFragments(text: string, matcher: CompiledMatcher | null): ReactNode {
    if (!matcher || !text) {
        return text;
    }
    const ranges = matcher.findRanges(text);
    if (ranges.length === 0) {
        return text;
    }
    const parts: ReactNode[] = [];
    let cursor = 0;
    ranges.forEach((range, index) => {
        if (range.start > cursor) {
            parts.push(text.slice(cursor, range.start));
        }
        parts.push(
            <mark key={index} className={MARK_CLASS}>
                {text.slice(range.start, range.end)}
            </mark>,
        );
        cursor = range.end;
    });
    if (cursor < text.length) {
        parts.push(text.slice(cursor));
    }
    return parts;
}

/** Read-only text with the find's hits marked in it. */
export function MarkedText({ text, matcher }: { text: string; matcher: CompiledMatcher | null }) {
    return <>{markedFragments(text, matcher)}</>;
}

/**
 * The same marks behind a textarea, for the one column that is a text box rather than text.
 *
 * A textarea holds its value in a shadow tree no `<mark>` can reach, so the hits are painted by a
 * copy of the text sitting exactly behind it: same typography, same padding, same width, its own
 * letters invisible. Only the coloured rectangles show through, because the box itself is
 * `bg-transparent`.
 *
 * Two things make this honest here rather than the usual approximation. The box **autosizes and
 * never scrolls inside itself**, so there is no scroll offset to keep in step - the mirror is
 * `inset-0` and that is the whole of the geometry. And the box **paints itself opaque on focus**,
 * so the marks are gone by the time anybody is typing into it, which is when a stale mirror would
 * start to lie.
 *
 * `className` must be the typography the host gives the textarea. Passing anything else is how a
 * mirror drifts, so hosts share one constant between the two.
 */
export function TextareaMarkLayer({ value, matcher, className }: {
    value: string;
    matcher: CompiledMatcher | null;
    className?: string;
}) {
    if (!matcher || !value || matcher.findRanges(value).length === 0) {
        return null;
    }
    return (
        <div
            aria-hidden
            className={cn(
                "pointer-events-none absolute inset-0 select-none overflow-hidden whitespace-pre-wrap break-words border border-transparent text-transparent",
                className,
            )}
        >
            {markedFragments(value, matcher)}
        </div>
    );
}
