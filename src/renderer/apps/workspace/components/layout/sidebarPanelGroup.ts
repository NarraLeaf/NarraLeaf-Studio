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
 * empty across restarts instead of springing back to these three.
 */
export const DEFAULT_COLLAPSED_PANEL_IDS: readonly string[] = [
  "narraleaf-studio:voice",
  "narraleaf-studio:localization",
  "narraleaf.gallery.panel"
];

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
