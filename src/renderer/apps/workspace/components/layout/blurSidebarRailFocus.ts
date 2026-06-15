/**
 * When the user interacts with sidebar panel content, clear DOM focus from the
 * icon rail buttons so Space/Enter do not trigger rail actions while typing elsewhere.
 */
export function blurSidebarRailFocusIfLeavingRail(eventTarget: EventTarget | null): void {
    const rails = document.querySelectorAll("[data-workspace-sidebar-rail]");
    if (rails.length === 0) {
        return;
    }
    const target = eventTarget instanceof Node ? eventTarget : null;
    for (const rail of rails) {
        if (target && rail.contains(target)) {
            return;
        }
    }
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) {
        return;
    }
    for (const rail of rails) {
        if (rail.contains(active)) {
            active.blur();
            return;
        }
    }
}
