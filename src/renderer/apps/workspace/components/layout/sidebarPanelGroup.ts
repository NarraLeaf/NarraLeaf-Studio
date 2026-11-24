/**
 * The sidebar rail's collapse group: one rail entry standing in for a set of panels folded away
 * behind it. Clicking it opens a flyout of those panels; each of them keeps its normal rail
 * behaviour, it is just reached one click deeper.
 */

/**
 * Rail-entry id of the collapse group.
 *
 * It is deliberately NOT a registered panel — nothing in the UIStore's panel list carries it — but
 * it does take a slot in the dock's persisted order array so it can be dragged among the real
 * icons. UIStore's sort resolves order entries against the panels it knows, so an id that matches
 * no panel is inert there and only shifts the indices of the ones around it.
 */
export const SIDEBAR_GROUP_ID = "narraleaf-studio:sidebar-group";

/**
 * Panels that start out folded into the group.
 *
 * Applied only when the user has no persisted member list at all, so emptying the group stays
 * empty across restarts instead of springing back to these. The set is the panels an author
 * reaches for late in a project, if at all: voice, localization, the gallery, the menu bar and
 * the plugin list; the story, assets and characters stay out on the rail.
 */
export const DEFAULT_COLLAPSED_PANEL_IDS: readonly string[] = [
    "narraleaf-studio:voice",
    "narraleaf-studio:localization",
    "narraleaf-studio:plugins",
    "narraleaf.gallery.panel",
    "narraleaf.menu-bar.panel",
    "narraleaf-studio:story-commands",
];

/**
 * Panels added to {@link DEFAULT_COLLAPSED_PANEL_IDS} after the group first shipped.
 *
 * The defaults only reach an author with no stored member list, so a panel added later would land
 * out on everyone else's rail. Each id here is folded into a stored list once, and the ids already
 * folded are remembered, so pulling one back out keeps it out.
 */
export const LATE_COLLAPSED_PANEL_IDS: readonly string[] = [
    "narraleaf-studio:story-commands",
];

/**
 * Fold the late defaults not folded before into a stored member list. `seeded` is what earlier
 * launches already folded; the result carries the list to use and the ids to remember.
 */
export function seedLateCollapsedPanels(
    stored: readonly string[],
    seeded: readonly string[],
): { collapsed: string[]; seeded: string[] } {
    const pending = LATE_COLLAPSED_PANEL_IDS.filter(id => !seeded.includes(id));
    return {
        collapsed: [...stored, ...pending.filter(id => !stored.includes(id))],
        seeded: [...seeded, ...pending],
    };
}

/**
 * Weave the group's id into a dock's ordered panel-id list at the slot the persisted order records
 * for it.
 *
 * `panelIds` is the dock's panels in their current (already sorted) sequence; `persistedOrder` is
 * the raw stored order for that dock, which may contain ids of panels that are not registered in
 * this window — plus, once the group has been dragged at least once, {@link SIDEBAR_GROUP_ID}.
 * The group lands right after the last id that precedes it in the stored order and still exists,
 * which keeps it anchored to its neighbour rather than to an absolute index that shifts whenever a
 * plugin registers or unregisters a panel. With no recorded slot it goes last.
 */
export function weaveGroupSlot(panelIds: string[], persistedOrder: string[] | undefined): string[] {
    const recordedAt = persistedOrder ? persistedOrder.indexOf(SIDEBAR_GROUP_ID) : -1;
    if (recordedAt < 0) {
        return [...panelIds, SIDEBAR_GROUP_ID];
    }

    let insertAt = 0;
    for (let i = recordedAt - 1; i >= 0; i--) {
        const index = panelIds.indexOf(persistedOrder![i]);
        if (index >= 0) {
            insertAt = index + 1;
            break;
        }
    }
    return [...panelIds.slice(0, insertAt), SIDEBAR_GROUP_ID, ...panelIds.slice(insertAt)];
}

/** A dock's rail state, as the menu sees it, against what a reset would put back. */
export interface RailLayoutState {
    /** Rail slots in their current sequence, the collapse group's own entry included. */
    railIds: string[];
    /** The same slots as a reset would leave them. */
    defaultRailIds: string[];
    /** Ids of the dock's panels the author has hidden. */
    hiddenIds: string[];
    /** Ids currently folded into the collapse group. */
    collapsedIds: readonly string[];
    /** Ids a reset would fold into it. */
    defaultCollapsedIds: readonly string[];
}

/**
 * Whether a dock's rail is exactly what a reset would produce — order, hidden panels and collapse
 * group all three. It answers the menu's question "would resetting change anything", which is what
 * keeps the reset row from being a click with no visible effect.
 *
 * Collapse membership is compared as a set: which panels are folded away is the author's choice,
 * the sequence they are stored in is not.
 */
export function isRailLayoutDefault({
    railIds,
    defaultRailIds,
    hiddenIds,
    collapsedIds,
    defaultCollapsedIds,
}: RailLayoutState): boolean {
    if (hiddenIds.length > 0) {
        return false;
    }
    if (railIds.length !== defaultRailIds.length || railIds.some((id, index) => id !== defaultRailIds[index])) {
        return false;
    }
    if (collapsedIds.length !== defaultCollapsedIds.length) {
        return false;
    }
    const defaults = new Set(defaultCollapsedIds);
    return collapsedIds.every(id => defaults.has(id));
}
