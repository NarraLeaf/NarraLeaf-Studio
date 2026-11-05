import { useEffect, useRef } from "react";

/**
 * Run `apply` when the row filter changes, and only then.
 *
 * The scene editor re-places its page on a filter change (see the tab), and the effect that did it was
 * keyed on the tab being shown as well as on the filter - so every return to a tab, and every mount,
 * re-placed the page too: on the active row, wherever the author had scrolled to. Coming back to a tab
 * left at the top of the scene showed it scrolled down to a row selected an episode ago, and a tab
 * reopened by the keep-alive limit landed there instead of on its saved place.
 *
 * A filter changed while the tab was hidden (the filter is shared by every story tab) is still applied,
 * on the first render the tab is shown in: that is the one return that does show a different page.
 *
 * `apply` is read from the render the effect runs after, so it sees the rows that filter produced.
 */
export function useRowFilterChange<T>(active: boolean, filter: T, apply: () => void): void {
    const appliedRef = useRef(filter);
    const applyRef = useRef(apply);
    applyRef.current = apply;

    useEffect(() => {
        if (!active || appliedRef.current === filter) {
            return;
        }
        appliedRef.current = filter;
        applyRef.current();
    }, [active, filter]);
}
