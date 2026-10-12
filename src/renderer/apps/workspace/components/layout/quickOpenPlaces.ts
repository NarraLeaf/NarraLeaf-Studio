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

/** A row as it reads before its detail is settled: the title it shows, and where it goes. */
export interface QuickOpenPlacedRow {
    title: string;
    place: QuickOpenPlace | undefined;
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

function mostLevel(place: QuickOpenPlace | undefined): number {
    return place ? 1 + place.path.ancestors.length : 0;
}

/**
 * The detail line of each row, saying only as much as it takes for no two rows to read the same.
 *
 * Blueprints take their control's name, and a page commonly has several controls of one name: every
 * slider on a settings page has a "Track", the navigation rail repeats the page's own title. Listed by
 * `Page › Control` alone those rows were identical while each opened a different blueprint. So rows
 * that read alike - same title, same detail - each say a little more, one level at a time, until they
 * differ or there is nothing left to say; a row that already reads uniquely is never lengthened.
 *
 * Returns one detail per row, in order. A row with no place keeps no detail.
 */
export function distinguishQuickOpenDetails(rows: readonly QuickOpenPlacedRow[]): (string | undefined)[] {
    const levels = rows.map(() => 0);
    const read = (index: number): string | undefined => {
        const place = rows[index].place;
        return place ? detailAt(place, levels[index]) : undefined;
    };
    for (;;) {
        const alike = new Map<string, number[]>();
        rows.forEach((row, index) => {
            const key = `${row.title}\u0000${read(index) ?? ""}`;
            const members = alike.get(key);
            if (members) {
                members.push(index);
            } else {
                alike.set(key, [index]);
            }
        });
        let raised = false;
        for (const members of alike.values()) {
            if (members.length < 2) {
                continue;
            }
            for (const index of members) {
                if (levels[index] < mostLevel(rows[index].place)) {
                    levels[index] += 1;
                    raised = true;
                }
            }
        }
        if (!raised) {
            return rows.map((_, index) => read(index));
        }
    }
}
