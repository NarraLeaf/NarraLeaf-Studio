/**
 * Find and navigate inside a windowed table.
 *
 * The translation and voice tables are one long list of entries a person scrolls, and the only way
 * to reach a known line was to scroll to it: the filters answer "which state is this in", never
 * "where is this word". This is the Mod+F both tables needed - a query, a hit count, and a step
 * through the hits that scrolls each one into view.
 *
 * It matches through the same {@link compileMatcher} the scene find bar and the project search
 * panel run on, so `Aa`, `ab` and `.*` cannot come to mean different things in the three boxes an
 * author types the same query into.
 *
 * Nothing is scanned while the overlay is closed: {@link TableFindOptions.getItemText} is only
 * called from the memo below, which stands down on a closed overlay or an empty query. That matters
 * because these tables reach tens of thousands of rows, and a fully-voiced game would otherwise pay
 * for a sweep on every keystroke typed into a translation.
 */

import { useCallback, useMemo, useState } from "react";
import { compileMatcher } from "@/lib/workspace/services/search/textMatcher";

export interface TableFindOptions {
    /** Length of the windowed list the overlay steps through. */
    itemCount: number;
    /**
     * Searchable text of one windowed item, or null for an item that holds no entry - a group
     * header, or the table's trailing add row. Memoise it: it is the sweep's only dependency that
     * changes with the rows.
     */
    getItemText: (index: number) => string | null;
    /**
     * Searchable text of every entry the table holds before its filter.
     *
     * What the hidden count is read off. A find that searched only the page would answer "no
     * results" for a line the filter is holding back - and the review and audition passes both open
     * on a filter that hides most of the table - so the count says how many hits are off the page
     * rather than leaving the author to guess that the filter is the reason.
     */
    getUnfilteredTexts: () => readonly string[];
}

export interface TableFind {
    open: boolean;
    query: string;
    caseSensitive: boolean;
    wholeWord: boolean;
    regex: boolean;
    /** The pattern would not compile. Reads as "no results", because that is what it finds. */
    invalidPattern: boolean;
    /** Hits in the list on screen. */
    matchCount: number;
    /** 1-based position of the current hit, or 0 when there are none. */
    activeMatch: number;
    /** Windowed index of the current hit - what to scroll to and what to mark. */
    activeIndex: number | null;
    /** Hits the filter is holding off the page. */
    hiddenCount: number;
    /** Bumped whenever the opener runs, to pull focus back to the field on a repeated Mod+F. */
    focusToken: number;
    openFind: () => void;
    close: () => void;
    setQuery: (value: string) => void;
    toggleCaseSensitive: () => void;
    toggleWholeWord: () => void;
    toggleRegex: () => void;
    /** Move the cursor by `delta` hits, wrapping at both ends. */
    step: (delta: number) => void;
}

export function useTableFind(options: TableFindOptions): TableFind {
    const { itemCount, getItemText, getUnfilteredTexts } = options;

    const [open, setOpen] = useState(false);
    const [query, setQueryState] = useState("");
    const [caseSensitive, setCaseSensitive] = useState(false);
    const [wholeWord, setWholeWord] = useState(false);
    const [regex, setRegex] = useState(false);
    const [cursor, setCursor] = useState(0);
    const [focusToken, setFocusToken] = useState(0);

    /**
     * One compiled matcher for the whole sweep.
     *
     * Compiling builds three `RegExp`s and the sweep runs over every item, so compiling inside the
     * loop would be three constructions per row per character typed.
     */
    const matcher = useMemo(
        () => compileMatcher(query, { caseSensitive, wholeWord, regex }),
        [query, caseSensitive, wholeWord, regex],
    );

    /** Windowed indexes that hold a hit, in list order. One per entry, however often it matches. */
    const matches = useMemo<number[]>(() => {
        if (!open || !query) {
            return [];
        }
        const found: number[] = [];
        for (let index = 0; index < itemCount; index += 1) {
            const text = getItemText(index);
            if (text !== null && matcher.test(text)) {
                found.push(index);
            }
        }
        return found;
    }, [open, query, matcher, itemCount, getItemText]);

    const hiddenCount = useMemo(() => {
        if (!open || !query) {
            return 0;
        }
        let total = 0;
        for (const text of getUnfilteredTexts()) {
            if (matcher.test(text)) {
                total += 1;
            }
        }
        // Never negative: the page is a subset of the table, but a row can leave the document
        // between the two reads, and a negative count would render as one.
        return Math.max(0, total - matches.length);
    }, [open, query, matcher, getUnfilteredTexts, matches.length]);

    // A shrinking result set must not leave the cursor pointing past the end.
    const activeMatchIndex = matches.length === 0 ? 0 : cursor % matches.length;

    const openFind = useCallback(() => {
        setOpen(true);
        setFocusToken(token => token + 1);
    }, []);

    const close = useCallback(() => {
        setOpen(false);
    }, []);

    const setQuery = useCallback((value: string) => {
        setQueryState(value);
        setCursor(0);
    }, []);

    const step = useCallback((delta: number) => {
        setCursor(current => {
            if (matches.length === 0) {
                return 0;
            }
            const from = current % matches.length;
            return (from + delta + matches.length) % matches.length;
        });
    }, [matches.length]);

    return {
        open,
        query,
        caseSensitive,
        wholeWord,
        regex,
        invalidPattern: matcher.error !== undefined,
        matchCount: matches.length,
        activeMatch: matches.length === 0 ? 0 : activeMatchIndex + 1,
        activeIndex: matches[activeMatchIndex] ?? null,
        hiddenCount,
        focusToken,
        openFind,
        close,
        setQuery,
        toggleCaseSensitive: useCallback(() => { setCaseSensitive(value => !value); setCursor(0); }, []),
        toggleWholeWord: useCallback(() => { setWholeWord(value => !value); setCursor(0); }, []),
        toggleRegex: useCallback(() => { setRegex(value => !value); setCursor(0); }, []),
        step,
    };
}
