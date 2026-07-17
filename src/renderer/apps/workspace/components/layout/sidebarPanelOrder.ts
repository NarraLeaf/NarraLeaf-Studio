/**
 * Splice a reordered subset of *visible* rail ids back over the full ordered id list, so hidden
 * panels keep their absolute position instead of being shuffled to the end.
 *
 * `fullIds` is the current full order for a dock area; `orderedVisibleIds` is a permutation of the
 * ids currently shown in the rail (a drag only ever reorders the visible icons). Every full-order
 * slot whose id is in the visible set is filled, in sequence, from `orderedVisibleIds`; hidden
 * slots are left exactly where they were.
 */
export function mergeVisibleRailOrder(fullIds: string[], orderedVisibleIds: string[]): string[] {
    const visibleSet = new Set(orderedVisibleIds);
    let cursor = 0;
    return fullIds.map(id => (visibleSet.has(id) ? orderedVisibleIds[cursor++] : id));
}
