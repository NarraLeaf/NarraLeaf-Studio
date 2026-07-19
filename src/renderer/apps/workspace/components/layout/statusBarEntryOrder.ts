import { StatusBarAlignment } from "@/lib/workspace/services/ui/types";

/** The minimum an entry needs for placement; both built-in modules and service items satisfy it. */
export interface OrderableStatusBarEntry {
    id: string;
    alignment: StatusBarAlignment;
}

/**
 * Lay out one side of the status bar from the registry's registration order.
 *
 * The rule is "later registrations pack toward the middle". A left group grows rightward from the
 * left edge, so registration order *is* DOM order. A right group grows leftward from the right
 * edge, so the first registration ends up furthest right - DOM order is the reverse.
 *
 * Hidden ids drop out entirely rather than leaving a gap; the remaining entries close up against
 * their edge, which is why hiding one never shifts the others away from the side they belong to.
 */
export function orderStatusBarEntries<T extends OrderableStatusBarEntry>(
    entries: T[],
    alignment: StatusBarAlignment,
    hiddenIds: ReadonlySet<string>,
): T[] {
    const side = entries.filter(entry => entry.alignment === alignment && !hiddenIds.has(entry.id));
    return alignment === StatusBarAlignment.Right ? side.reverse() : side;
}
