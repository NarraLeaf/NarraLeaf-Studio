/**
 * The breakpoint entries of a node's right-click menu.
 *
 * Shared by the Workspace blueprint editor and the Dev Mode read-only graph so that the same
 * gesture offers the same choices in both windows - an author who learns the menu in one has
 * learned it in the other.
 */

import type { ContextMenuDef } from "@/lib/components/elements/ContextMenu";

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
}): ContextMenuDef {
  const { existing, onToggle, onSetEnabled, onEdit, labels } = input;
  if (!existing) {
    return [{ id: "breakpoint.add", label: labels.add, onClick: onToggle }];
  }
  return [
    { id: "breakpoint.remove", label: labels.remove, onClick: onToggle },
    {
      id: "breakpoint.enabled",
      label: existing.enabled ? labels.disable : labels.enable,
      onClick: () => onSetEnabled(!existing.enabled)
    },
    { id: "breakpoint.edit", label: labels.edit, onClick: onEdit }
  ];
}
