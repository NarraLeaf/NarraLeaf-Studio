/**
 * Generic fuzzy list model.
 *
 * A small, dependency-free primitive shared by the floating list overlays in the workspace shell
 * (the command palette; the editor quick switch reuses only {@link wrapIndex}). It does two things:
 *
 *  1. `fuzzyMatch` - case-insensitive *subsequence* matching with a light relevance score, so
 *     "ops" matches "Open Settings" and ranks a tight run of characters above a scattered one.
 *  2. `rankFuzzyList` - filter a list to the items that match a query and sort them best-first,
 *     preserving the original order for ties (and for an empty query, which matches everything).
 *
 * It is deliberately not a full fuzzy matcher (no transposition/typo tolerance). The lists it
 * backs are short and the queries are prefixes of known labels, so a subsequence match with a few
 * positional bonuses is both predictable and cheap.
 */

export interface FuzzyMatch {
    /** True when every query character appears in `text` in order. */
    matched: boolean;
    /** Higher is a better match. Only meaningful when {@link matched} is true. */
    score: number;
    /** Indices into `text` of the matched characters, in order (for highlighting). */
    positions: number[];
}

const NO_MATCH: FuzzyMatch = { matched: false, score: 0, positions: [] };

/** A boundary is the start of a word: index 0, or a char following a separator. */
function isWordBoundary(text: string, index: number): boolean {
    if (index === 0) {
        return true;
    }
    const prev = text[index - 1];
    return prev === " " || prev === "-" || prev === "_" || prev === "/" || prev === ":" || prev === ".";
}

/**
 * Match `query` against `text` as a case-insensitive subsequence, returning a relevance score.
 *
 * An empty query matches with score 0 (the caller decides ordering). A query with characters not
 * found in order does not match. Scoring rewards, in rough priority: consecutive runs, matches at
 * word boundaries, and matches near the start - the signals that make a hit feel "obviously right".
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch {
    if (query.length === 0) {
        return { matched: true, score: 0, positions: [] };
    }
    if (text.length === 0) {
        return NO_MATCH;
    }

    const q = query.toLowerCase();
    const t = text.toLowerCase();

    const positions: number[] = [];
    let score = 0;
    let textIndex = 0;
    let prevMatchIndex = -1;

    for (let queryIndex = 0; queryIndex < q.length; queryIndex++) {
        const target = q[queryIndex];
        let found = -1;
        for (let i = textIndex; i < t.length; i++) {
            if (t[i] === target) {
                found = i;
                break;
            }
        }
        if (found === -1) {
            return NO_MATCH;
        }

        // Base point for the match; bonuses layer on top.
        score += 1;
        if (found === prevMatchIndex + 1) {
            // Consecutive with the previous matched char - the strongest signal.
            score += 8;
        }
        if (isWordBoundary(text, found)) {
            score += 6;
        }
        if (found === 0) {
            score += 4;
        }
        // A closer match (fewer skipped characters) is marginally preferred.
        score -= Math.min(found - textIndex, 4);

        positions.push(found);
        prevMatchIndex = found;
        textIndex = found + 1;
    }

    // Note: score reflects how well the query aligns to the label, not the label's length. Two
    // labels sharing the matched prefix (e.g. "Open Settings" / "Open Project" for "open") score
    // equally, so `rankFuzzyList` can fall back to the caller's input order - a stable, meaningful
    // tiebreak instead of an arbitrary length preference.
    return { matched: true, score, positions };
}

export interface RankedFuzzyItem<T> {
    item: T;
    score: number;
    /** Positions within the *first* text field that produced the winning match (for highlighting). */
    positions: number[];
    /** Index of the text field (from `getText`) that produced the winning match. */
    fieldIndex: number;
}

/**
 * Filter `items` to those matching `query` and sort them best-first.
 *
 * `getText` returns one or more searchable strings per item (e.g. `[title, category]`); an item
 * matches if any field matches, and is scored by its best field. Later fields are down-weighted so
 * a title hit outranks a category hit. Ties - and every item when the query is empty - keep the
 * input order, which is a stable, meaningful order the caller already chose.
 */
export function rankFuzzyList<T>(
    items: readonly T[],
    query: string,
    getText: (item: T) => string | readonly string[],
): RankedFuzzyItem<T>[] {
    const trimmed = query.trim();

    if (trimmed.length === 0) {
        return items.map((item, index) => ({ item, score: -index, positions: [], fieldIndex: 0 }));
    }

    const ranked: Array<RankedFuzzyItem<T> & { order: number }> = [];

    items.forEach((item, order) => {
        const fields = getText(item);
        const texts = typeof fields === "string" ? [fields] : fields;

        let best: FuzzyMatch | null = null;
        let bestFieldIndex = 0;
        let bestFieldScore = -Infinity;

        // A plain loop (not forEach) keeps the `best` assignment in this scope, so its type is
        // narrowed correctly at the `if (best)` below.
        for (let fieldIndex = 0; fieldIndex < texts.length; fieldIndex++) {
            const match = fuzzyMatch(trimmed, texts[fieldIndex]);
            if (!match.matched) {
                continue;
            }
            // Down-weight secondary fields so a hit in the primary label wins.
            const adjusted = match.score - fieldIndex * 100;
            if (adjusted > bestFieldScore) {
                bestFieldScore = adjusted;
                best = match;
                bestFieldIndex = fieldIndex;
            }
        }

        if (best) {
            ranked.push({
                item,
                score: bestFieldScore,
                positions: bestFieldIndex === 0 ? best.positions : [],
                fieldIndex: bestFieldIndex,
                order,
            });
        }
    });

    ranked.sort((a, b) => (b.score - a.score) || (a.order - b.order));

    return ranked.map(({ order: _order, ...rest }) => rest);
}

/** Wrap `index` into `[0, length)`, so moving past either end lands on the other. */
export function wrapIndex(index: number, length: number): number {
    if (length <= 0) {
        return 0;
    }
    return ((index % length) + length) % length;
}

/** Clamp `index` into `[0, length - 1]` (or 0 when the list is empty). */
export function clampIndex(index: number, length: number): number {
    if (length <= 0) {
        return 0;
    }
    return Math.min(Math.max(index, 0), length - 1);
}
