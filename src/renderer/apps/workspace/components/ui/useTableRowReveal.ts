/**
 * A deep link into a windowed table: bring one row on screen and mark it.
 *
 * The translation and voice tables are where a missing translation is typed and a missing take is
 * linked, so a project check finding about one line has to land on that line's row - not on the
 * table's first page, which is what opening the tab alone does. The tab is handed the row through its
 * payload (`reveal`), the same bargain the scene editor's `activeBlockId` makes, and this is the half
 * that has to wait: the rows of the requested source are read asynchronously, and a filter the
 * translator left on can be hiding the very row asked for.
 *
 * So a request is held until it can be answered, and each render it is asked again:
 *
 *  - the row is in the windowed list: scroll it to the centre and mark it - done;
 *  - the row is in the table but a filter hides it: show every row, once, and ask again;
 *  - the row is not there yet: wait - for at most {@link REVEAL_PATIENCE_MS}, after which a row that
 *    never arrived (a unit whose line was deleted since the link was made) stops being looked for,
 *    rather than scrolling the table under the translator whenever such a row appears later.
 *
 * The mark expires on its own, for the reason the assets panel's does: it says "here", and a ring
 * that stays says "wrong".
 */

import { useEffect, useRef, useState } from "react";

/** How long a reveal waits for its row before it gives up. */
export const REVEAL_PATIENCE_MS = 5000;
/** How long the revealed row stays marked. */
export const REVEAL_MARK_MS = 2200;

/** A request: the row's key and the token that tells this request from the last one. */
export type TableRowRevealRequest = { unitId: string; token: number };

/** What to do about a pending request, given what the table holds right now. */
export type TableRowRevealStep =
    | { kind: "scroll"; index: number }
    | { kind: "showAll" }
    | { kind: "wait" };

/**
 * The decision, apart from React so it can be tested on its own.
 *
 * `index` is the row's position in the windowed list or -1, `inTable` whether the table holds the row
 * at all, filters aside, and `filtersCleared` whether this request already asked for every row to be
 * shown - it asks once, and a row a cleared filter still does not show is waited for, not looped on.
 */
export function planTableRowReveal(input: { index: number; inTable: boolean; filtersCleared: boolean }): TableRowRevealStep {
    if (input.index >= 0) {
        return { kind: "scroll", index: input.index };
    }
    if (input.inTable && !input.filtersCleared) {
        return { kind: "showAll" };
    }
    return { kind: "wait" };
}

export function useTableRowReveal(input: {
    request: TableRowRevealRequest | undefined;
    /** The row's index in the windowed list, or -1 when it is not there (not loaded, or filtered out). */
    indexOf: (unitId: string) => number;
    /** Whether the table holds the row, whatever its filters say. */
    inTable: (unitId: string) => boolean;
    /** Clear every filter that can hide a row. */
    showAll: () => void;
    scrollToIndex: (index: number) => void;
}): { markedUnitId: string | null } {
    const { request, indexOf, inTable, showAll, scrollToIndex } = input;
    const [pending, setPending] = useState<(TableRowRevealRequest & { filtersCleared: boolean }) | null>(null);
    const [marked, setMarked] = useState<{ unitId: string; token: number } | null>(null);
    const handledToken = useRef<number | null>(null);

    // A new request replaces whatever was still waiting.
    const requestToken = request?.token ?? null;
    const requestUnitId = request?.unitId ?? null;
    useEffect(() => {
        if (requestToken === null || requestUnitId === null || handledToken.current === requestToken) {
            return;
        }
        handledToken.current = requestToken;
        setPending({ unitId: requestUnitId, token: requestToken, filtersCleared: false });
    }, [requestToken, requestUnitId]);

    useEffect(() => {
        if (!pending) {
            return;
        }
        const step = planTableRowReveal({
            index: indexOf(pending.unitId),
            inTable: inTable(pending.unitId),
            filtersCleared: pending.filtersCleared,
        });
        if (step.kind === "scroll") {
            scrollToIndex(step.index);
            setMarked({ unitId: pending.unitId, token: pending.token });
            setPending(null);
        } else if (step.kind === "showAll") {
            showAll();
            setPending({ ...pending, filtersCleared: true });
        }
    }, [pending, indexOf, inTable, showAll, scrollToIndex]);

    const pendingToken = pending?.token ?? null;
    useEffect(() => {
        if (pendingToken === null) {
            return;
        }
        const timer = window.setTimeout(() => {
            setPending(current => (current?.token === pendingToken ? null : current));
        }, REVEAL_PATIENCE_MS);
        return () => window.clearTimeout(timer);
    }, [pendingToken]);

    const markedToken = marked?.token ?? null;
    useEffect(() => {
        if (markedToken === null) {
            return;
        }
        const timer = window.setTimeout(() => {
            setMarked(current => (current?.token === markedToken ? null : current));
        }, REVEAL_MARK_MS);
        return () => window.clearTimeout(timer);
    }, [markedToken]);

    return { markedUnitId: marked?.unitId ?? null };
}
