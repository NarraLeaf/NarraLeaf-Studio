import { blueprintOwnerPathLabel, type BlueprintOwnerPath } from "@/lib/workspace/services/search/sources/blueprintSource";

/**
 * Where a Quick Open blueprint row goes, in the parts its detail line can be built from.
 *
 * `path` is the owner as the search panel names it (`Page › Control`), plus the controls above it.
 * `suffix` is the one thing a path cannot say: that the row is a control's value binding rather than
 * its logic, which hang on the same control and so share every name on the way to it.
 */
export interface QuickOpenPlace {
    path: BlueprintOwnerPath;
    suffix?: string;
}

/**
 * A row as it reads before its detail is settled: its kind, the title it shows, and every way it can
 * say where it is.
 *
 * `details` runs from the plainest to the fullest. The first is what the row reads while nothing else
 * reads the same - a scene's story, an asset's type - and each one after says a little more, such as
 * the chapter or the folder. An empty list, or `undefined` at a level, is a row with no detail there.
 */
export interface QuickOpenPlacedRow {
    /** What the row is. Every row shows its kind beside it, so rows of different kinds never read alike. */
    kind: string;
    title: string;
    details: readonly (string | undefined)[];
}

/**
 * The detail line a place reads as at one level of saying more.
 *
 * Level 0 is the plain `Page › Control`. Level 1 adds the suffix, if the row has one. Each level
 * after that names one more control on the way down, nearest first, so `Page › Track` becomes
 * `Page › Slider › Track` before it becomes `Page › Row › Slider › Track`.
 */
function detailAt(place: QuickOpenPlace, level: number): string | undefined {
    const { path, suffix } = place;
    const shown = Math.min(Math.max(level - 1, 0), path.ancestors.length);
    const label = blueprintOwnerPathLabel({
        lead: [...path.lead, ...path.ancestors.slice(0, shown).reverse()],
        leaf: path.leaf,
        ancestors: [],
    });
    return suffix && level >= 1 && label ? `${label} · ${suffix}` : label;
}

/**
 * Every detail a blueprint row can read as, plainest first: `Page › Control`, then with its suffix,
 * then with one more control above it at a time. A row with no place has none.
 */
export function blueprintPlaceDetails(place: QuickOpenPlace | undefined): (string | undefined)[] {
    if (!place) {
        return [];
    }
    const mostLevel = 1 + place.path.ancestors.length;
    return Array.from({ length: mostLevel + 1 }, (_, level) => detailAt(place, level));
}

function groupAlike(rows: readonly QuickOpenPlacedRow[], detailOf: (index: number) => string | undefined): number[][] {
    const alike = new Map<string, number[]>();
    rows.forEach((row, index) => {
        const key = `${row.kind}\u0000${row.title}\u0000${detailOf(index) ?? ""}`;
        const members = alike.get(key);
        if (members) {
            members.push(index);
        } else {
            alike.set(key, [index]);
        }
    });
    return [...alike.values()].filter(members => members.length > 1);
}

/**
 * The detail line of each row, saying only as much as it takes for no two rows to read the same.
 *
 * Rows are named after what they open, and names repeat: every slider on a settings page has a
 * "Track", two chapters can each have a scene called "Corridor", two folders can each hold an image
 * called "bg". Listed by their plainest detail those rows were identical while each opened something
 * else. So rows that read alike - same kind, same title, same detail - each say a little more, one
 * level at a time, until they differ or there is nothing left to say; a row that already reads
 * uniquely is never lengthened.
 *
 * Rows that still read alike after that are told apart by their order: each is numbered through
 * `numbered`, counting in the order the rows were given.
 *
 * Returns one detail per row, in order.
 */
export function distinguishQuickOpenDetails(
    rows: readonly QuickOpenPlacedRow[],
    numbered: (detail: string | undefined, ordinal: number) => string,
): (string | undefined)[] {
    const levels = rows.map(() => 0);
    const read = (index: number): string | undefined => rows[index].details[levels[index]];
    for (;;) {
        let raised = false;
        for (const members of groupAlike(rows, read)) {
            for (const index of members) {
                if (levels[index] < rows[index].details.length - 1) {
                    levels[index] += 1;
                    raised = true;
                }
            }
        }
        if (!raised) {
            break;
        }
    }
    const details = rows.map((_, index) => read(index));
    for (const members of groupAlike(rows, index => details[index])) {
        members.forEach((index, position) => {
            details[index] = numbered(details[index], position + 1);
        });
    }
    return details;
}
