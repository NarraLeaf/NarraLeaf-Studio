import { useCallback, useRef } from "react";
import type { StoryBlockId, StoryDocument } from "@shared/types/story";
import type { VisibleStoryRow } from "./storySceneEditorTypes";

/**
 * Keeping a story row's props at the same identity when nothing they say has changed.
 *
 * The rows are memoised, and every prop they take is data — but four of those props were rebuilt from
 * scratch on every document change: the row projection, the document wrapper, the command context and
 * the temp-speaker list. So `memo` compared four fresh objects against four old ones, found them
 * different, and re-rendered the whole visible window for an edit that touched one line. Measured on a
 * scene of twenty lines, one Enter cost two full repaints of every row on screen and about 160ms of
 * blocked main thread — and because the list is windowed, a scene of four hundred lines cost the same,
 * which is why the number never looked like it scaled with anything.
 *
 * What is here is the other half of that memo: an identity that survives a change it is not about.
 * Each helper answers the same question — "is this value the one I already had?" — by comparing what
 * the value SAYS rather than which object it is, and hands back the previous object when the answer is
 * yes.
 *
 * ## Why a signature and not the object
 *
 * The story service edits blocks IN PLACE (see `updateBlockPayload`), so the row object handed out
 * last render holds the very payload the author just rewrote. Comparing this render's row against the
 * one in the cache would therefore find them equal *because both are the new text*, and the row the
 * author is typing into would be the one row that never repaints. Every cache here stores the
 * signature taken at the time it was filled, and compares against that — never against the live
 * object it is holding.
 */

/**
 * Structural equality over the plain data these projections are made of.
 *
 * Deliberately not `JSON.stringify` comparison: it allocates two strings the size of the value on
 * every call, and it answers "different" for two objects that differ only in key order. Everything it
 * is asked about here is plain — arrays, plain objects, primitives — because everything it is asked
 * about is a projection built for rendering.
 */
export function isDeepEqualProjection(a: unknown, b: unknown): boolean {
    if (Object.is(a, b)) {
        return true;
    }
    if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
        return false;
    }
    const aIsArray = Array.isArray(a);
    if (aIsArray !== Array.isArray(b)) {
        return false;
    }
    if (aIsArray) {
        const left = a as unknown[];
        const right = b as unknown[];
        if (left.length !== right.length) {
            return false;
        }
        for (let index = 0; index < left.length; index += 1) {
            if (!isDeepEqualProjection(left[index], right[index])) {
                return false;
            }
        }
        return true;
    }
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    const leftKeys = Object.keys(left);
    if (leftKeys.length !== Object.keys(right).length) {
        return false;
    }
    for (const key of leftKeys) {
        if (!Object.prototype.hasOwnProperty.call(right, key) || !isDeepEqualProjection(left[key], right[key])) {
            return false;
        }
    }
    return true;
}

/**
 * The same value, at the identity it had last time it said this.
 *
 * For the projections a row reads but rarely sees change — the command context (what a name on a line
 * may refer to) and the temp speakers. Both are rebuilt on every document change because both are
 * derived from the document; neither actually differs when the change was a line of prose.
 *
 * The cost is one structural comparison per document change, against a saving of one full render of
 * every row on screen. It is worth paying even when the comparison walks a large asset library: the
 * comparison is a walk of plain arrays, the render it replaces is React.
 */
export function useContentStable<T>(value: T): T {
    const held = useRef(value);
    if (held.current !== value && !isDeepEqualProjection(held.current, value)) {
        held.current = value;
    }
    return held.current;
}

/**
 * The document, at the identity it had while the things a row reads OUT of it still say the same.
 *
 * A row reads its own block from its `row` prop; what it reads from the document is reference data —
 * the scene names a `/jump` prints, the variables an interpolation resolves, the choice options a
 * branch names. So the wrapper only has to change identity when one of those changes, and a line of
 * prose changes none of them.
 *
 * Handing back the previous wrapper is safe precisely because the service mutates in place: the
 * wrapper is a shallow spread (`setDocument({ ...event.document })`) over the same live `scenes` map,
 * so last render's wrapper reads this render's data. The one case that is NOT a respread — a document
 * loaded afresh, which brings a new `scenes` map with it — is checked for explicitly, because there
 * the old wrapper would go on reading a map nothing writes to any more.
 *
 * @param document The document as the controller holds it, re-spread on every change.
 * @param referenceSignature Whatever the rows read out of the document besides their own block.
 */
export function useDocumentStableForRows(
    document: StoryDocument | null,
    referenceSignature: unknown,
): StoryDocument | null {
    const held = useRef<{ document: StoryDocument | null; signature: unknown }>({ document, signature: referenceSignature });
    const previous = held.current;
    const scenesReplaced = document !== null
        && previous.document !== null
        && document.scenes !== previous.document.scenes;
    if (
        previous.document !== document
        && (scenesReplaced
            || previous.document === null
            || document === null
            || !isDeepEqualProjection(previous.signature, referenceSignature))
    ) {
        held.current = { document, signature: referenceSignature };
        return document;
    }
    return previous.document;
}

/**
 * A row projection, at the identity it had while it still projects the same line.
 *
 * Applied over the rows the virtualiser is about to mount rather than over the whole list: the answer
 * is only wanted for rows that render, and taking a signature of every row in a thirty-thousand-line
 * scene to serve the twenty-five on screen would put the cost back where this is here to take it from.
 *
 * The signature is `JSON.stringify` here, not {@link isDeepEqualProjection}, because the cache holds
 * the row object it handed out — and that object's block is the live one the service mutates, so there
 * is nothing left to compare against but a string taken before the mutation. Rows are built by one
 * function in one order, so the key order a comparison would object to cannot vary.
 */
export function useStableVisibleRows(): (row: VisibleStoryRow) => VisibleStoryRow {
    const cache = useRef(new Map<StoryBlockId, { signature: string; row: VisibleStoryRow }>());
    return useCallback((row: VisibleStoryRow) => {
        const signature = JSON.stringify(row);
        const held = cache.current.get(row.block.id);
        if (held && held.signature === signature) {
            return held.row;
        }
        // Scrolling a long scene would otherwise leave a signature here for every line ever mounted -
        // a copy of the whole document, in strings, for the sake of the screenful in front of the
        // author. Dropping the lot costs one extra repaint of the window and nothing else, since a
        // miss is only ever "this row re-renders once".
        if (cache.current.size >= ROW_SIGNATURE_CACHE_LIMIT) {
            cache.current.clear();
        }
        cache.current.set(row.block.id, { signature, row });
        return row;
    }, []);
}

/** Comfortably more than any window plus its overscan, small enough that the strings stay bounded. */
const ROW_SIGNATURE_CACHE_LIMIT = 512;
