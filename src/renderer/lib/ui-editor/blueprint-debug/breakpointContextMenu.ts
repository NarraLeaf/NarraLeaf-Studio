/**
 * The breakpoint entries of a node's right-click menu.
 *
 * Shared by the Workspace blueprint editor and the Dev Mode read-only graph so that the same
 * gesture offers the same choices in both windows - an author who learns the menu in one has
 * learned it in the other.
 */

import type { ContextMenuItemDef } from "@/lib/components/elements/ContextMenu";

const ROW_ID_ADD = "breakpoint.add";
const ROW_ID_REMOVE = "breakpoint.remove";
const ROW_ID_ENABLED = "breakpoint.enabled";
const ROW_ID_EDIT = "breakpoint.edit";

/**
 * Every row id this builder can emit.
 *
 * A breakpoint is debugger state, not document state, so a frozen project keeps these rows live.
 * Menus that fold them in beside rows which do write the document hand this set to
 * `freezeContextMenuRows` as the exemption list.
 */
export const BREAKPOINT_MENU_ROW_IDS: ReadonlySet<string> = new Set([
    ROW_ID_ADD,
    ROW_ID_REMOVE,
    ROW_ID_ENABLED,
    ROW_ID_EDIT,
]);

/**
 * Whether these rows may be offered on a node at all.
 *
 * A breakpoint stops the graph on its way through a node, so it can only be set on a node the
 * graph goes through. A comment - an author's note, or the frame drawn around a group - is painted
 * on the canvas and never runs: offered the rows, it would take a stop that can never happen and
 * carry a marker nothing would ever reach.
 */
export function canBlueprintNodeCarryBreakpoint(role: string | undefined): boolean {
    return role !== "comment";
}

export type BreakpointContextMenuLabels = {
    add: string;
    remove: string;
    enable: string;
    disable: string;
    edit: string;
};

export function buildBreakpointContextMenu(input: {
    /** The breakpoint already on this node, if any. */
    existing: { enabled: boolean } | undefined;
    /** Add when absent, remove when present. */
    onToggle: () => void;
    onSetEnabled: (enabled: boolean) => void;
    onEdit: () => void;
    labels: BreakpointContextMenuLabels;
}): ContextMenuItemDef[] {
    const { existing, onToggle, onSetEnabled, onEdit, labels } = input;
    if (!existing) {
        return [{ id: ROW_ID_ADD, label: labels.add, onClick: onToggle }];
    }
    return [
        { id: ROW_ID_REMOVE, label: labels.remove, onClick: onToggle },
        {
            id: ROW_ID_ENABLED,
            label: existing.enabled ? labels.disable : labels.enable,
            onClick: () => onSetEnabled(!existing.enabled),
        },
        { id: ROW_ID_EDIT, label: labels.edit, onClick: onEdit },
    ];
}
