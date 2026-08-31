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
 * The accent at two weights: every hit, and the one the cursor is on.
 *
 * The accent rather than a highlighter yellow: `warning` is a severity in this app, and a found
 * word is not a problem. It is the colour of the ring around the row the cursor is on, so the ring
 * and the words inside it read as one answer at two scales.
 *
 * The step between them is what says which hit is current while the rest stay visible - the quiet
 * one is "there is one here too", and it has to survive being scrolled past at a glance without
 * competing with the line it is inside. Text stays legible on both: the strong wash holds the
 * body-text ratio (7.2:1 against `fg` on the dark surface), which is why it stops where it does
 * rather than going further.
 *
 * `text-inherit` on both, always. `<mark>` carries a colour of its own from the user agent, and
 * the mirror behind a textarea paints its letters transparent - a mark that set its own colour
 * would light up a second copy of the sentence there.
 */
const MARK_CLASS = "rounded-sm bg-primary/20 text-inherit";
const ACTIVE_MARK_CLASS = "rounded-sm bg-primary/45 text-inherit";

/**
 * Split `text` at the matcher's hits. Returns the plain string when there are none.
 *
 * `active` is a property of the entry, not of the word: the find steps entry by entry, because an
 * entry is what an author acts on - a line they translate, a take they assign, a finding they jump
 * to - and there is nothing to do with the third occurrence inside one of them. So every hit in the
 * row the cursor is on wears the strong wash, and every hit everywhere else wears the quiet one.
 */
export function markedFragments(text: string, matcher: CompiledMatcher | null, active = false): ReactNode {
    if (!matcher || !text) {
        return text;
    }
    const ranges = matcher.findRanges(text);
    if (ranges.length === 0) {
        return text;
    }
    const className = active ? ACTIVE_MARK_CLASS : MARK_CLASS;
    const parts: ReactNode[] = [];
    let cursor = 0;
    ranges.forEach((range, index) => {
        if (range.start > cursor) {
            parts.push(text.slice(cursor, range.start));
        }
        parts.push(
            <mark key={index} className={className}>
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
export function MarkedText({ text, matcher, active }: {
    text: string;
    matcher: CompiledMatcher | null;
    /** This entry is the one the find's cursor is on, so its hits wear the strong wash. */
    active?: boolean;
}) {
    return <>{markedFragments(text, matcher, active)}</>;
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
export function TextareaMarkLayer({ value, matcher, active, className }: {
    value: string;
    matcher: CompiledMatcher | null;
    /** This entry is the one the find's cursor is on, so its hits wear the strong wash. */
    active?: boolean;
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
            {markedFragments(value, matcher, active)}
        </div>
    );
}
