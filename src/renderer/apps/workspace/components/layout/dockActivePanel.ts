/**
 * Which panel a dock area actually draws, given the selection the author left behind.
 *
 * The selection is persisted (`ui.leftSidebar.activePanel` and its siblings); the panel set is not.
 * Panels are registered imperatively while the window starts, and a plugin's panel exists only for
 * as long as that plugin is installed, enabled, and loaded here. So a stored id can perfectly well
 * name a panel this window has nothing to draw for: a plugin that was uninstalled, one whose
 * dependency this project does not meet - which is the ordinary state of a project that arrived
 * from somewhere else - or one that simply has not registered yet because its plugin is still
 * loading.
 *
 * Rendered straight, such an id produced a dock cell wrapped around nothing: a one-pixel column
 * with a resize cursor beside the left rail, or a blank band at the bottom panel's last dragged
 * height, with no rail icon lit to say what was open. The dock's own state was intact the whole
 * time - the id was simply about a panel that was not there.
 *
 * # Derived, and never written back
 *
 * The answer is computed at render, and nothing here touches the stored selection. The store behind
 * it (`GlobalSettingsService`) is app-wide rather than per-project, so repairing it because a plugin
 * is missing from THIS window would also discard the author's choice in every window where that
 * plugin loads perfectly well. Leaving it alone has a second payoff: a panel that registers late -
 * a plugin's, which arrives after the layout has finished reading its settings - takes its dock back
 * the moment it does, with no bookkeeping to unwind.
 *
 * Deliberate choices still write, and should: clicking a rail icon, or opening a dock that is
 * currently drawing nothing, records what the author picked. What never writes is the repair.
 */

/** What this decision reads off a registered panel. `PanelDefinition` satisfies it. */
export type DockPanelEntry = {
    id: string;
    /**
     * Set on a rail entry that runs something instead of opening a body - it holds a slot on the
     * rail but has nothing to draw in the dock, so it can never be what a dock shows.
     */
    railAction?: unknown;
};

/** The rail state that decides which panels a dock would offer, as `UIStore` keeps it. */
export type DockPanelAvailability = {
    /** `false` for a panel switched off from the rail's menu; a missing entry means shown. */
    visibility?: Readonly<Record<string, boolean>>;
    /** Panel ids folded into the rail's collapse group, where they are reached one click deeper. */
    collapsed?: readonly string[];
};

/**
 * The first panel a dock would offer of its own accord: one with a body, not switched off, and not
 * folded into the collapse group.
 *
 * This is where "open the sidebar" lands when the author has never chosen a panel, and where a dock
 * falls back when the panel they chose is not in this window. Hidden and folded panels are passed
 * over because opening onto one would contradict the rail - there would be no icon in it pointing
 * at what the dock is showing.
 *
 * `panels` is the dock's own panels in rail order, which is the order `UIStore` keeps them in.
 */
export function firstDrawablePanelId(
    panels: readonly DockPanelEntry[],
    availability: DockPanelAvailability = {},
): string | null {
    const { visibility = {}, collapsed = [] } = availability;
    const first = panels.find(panel =>
        !panel.railAction && visibility[panel.id] !== false && !collapsed.includes(panel.id));
    return first?.id ?? null;
}

/**
 * The panel id a dock should render, or `null` for a dock that draws nothing at all.
 *
 * A stored id is kept whenever it names a registered panel with a body, **including one that is
 * hidden or folded into the collapse group**. Those are states of the rail rather than statements
 * about the panel: an author who switched an icon off keeps looking at the panel they had open
 * until they pick another, and `panelVisibilityChanged` is what moves them off it. Only an id that
 * names nothing in this window falls back.
 *
 * `null` covers two cases the caller must treat the same way - **do not draw the dock cell** - and
 * neither is a fault: a dock with nothing to offer (a recovery window before its probes have
 * unlocked any panels, or any window in the moment before registration), and a dock the author has
 * never opened. A cell drawn around no panel is the empty strip this module exists to prevent.
 */
export function resolveActivePanelId(
    storedId: string | null | undefined,
    panels: readonly DockPanelEntry[],
    availability: DockPanelAvailability = {},
): string | null {
    if (!storedId) {
        // No stored choice is not something to repair. A dock the author has never opened stays
        // shut, and whatever opens it picks the panel then - and records that pick.
        return null;
    }
    const stored = panels.find(panel => panel.id === storedId);
    if (stored && !stored.railAction) {
        return stored.id;
    }
    return firstDrawablePanelId(panels, availability);
}
