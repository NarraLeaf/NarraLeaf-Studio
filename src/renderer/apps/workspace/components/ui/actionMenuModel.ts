import type { FocusContext } from "@/lib/workspace/services/ui";
import type { ActionDefinition, ActionGroup, ActionMenuItem, ActionSeparator, ActionSubmenu } from "../../registry/types";

export function isActionMenuSeparator(item: ActionMenuItem): item is ActionSeparator {
    return (item as ActionSeparator).separator === true;
}

export function isActionMenuAction(item: ActionMenuItem): item is ActionDefinition {
    return (item as ActionDefinition).onClick !== undefined;
}

/** The remaining kind: what is neither a separator nor a command is a menu of its own. */
export function isActionMenuSubmenu(item: ActionMenuItem): item is ActionSubmenu {
    return !isActionMenuSeparator(item) && !isActionMenuAction(item);
}

export function getActionGroupItems(group: ActionGroup): ActionMenuItem[] {
    return (group.items ?? group.actions ?? []) as ActionMenuItem[];
}

export function getVisibleActionMenuItems(
    items: ActionMenuItem[],
    focusContext: FocusContext | null = null,
): ActionMenuItem[] {
    const visible = (items || [])
        .filter((item) => {
            if (isActionMenuSeparator(item)) {
                return true;
            }
            if (isActionMenuAction(item)) {
                if (item.visible === false) {
                    return false;
                }
                if (item.when && focusContext && !item.when(focusContext)) {
                    return false;
                }
                return true;
            }
            return getVisibleActionMenuItems(item.items, focusContext).length > 0;
        })
        .sort(byActionMenuOrder);
    return withoutStrandedSeparators(visible);
}

/**
 * Separators only mean something between two rows.
 *
 * A separator divides what is around it, so one at either end of a menu, or one following another,
 * is a line drawn under nothing. That happens whenever the rows it was written between turn out to
 * be hidden - a `when` that does not match the focus, or a panel's editing commands folded into the
 * Edit menu while that panel is not the one in front.
 */
function withoutStrandedSeparators(items: ActionMenuItem[]): ActionMenuItem[] {
    const kept: ActionMenuItem[] = [];
    for (const item of items) {
        if (!isActionMenuSeparator(item)) {
            kept.push(item);
            continue;
        }
        if (kept.length > 0 && !isActionMenuSeparator(kept[kept.length - 1])) {
            kept.push(item);
        }
    }
    while (kept.length > 0 && isActionMenuSeparator(kept[kept.length - 1])) {
        kept.pop();
    }
    return kept;
}

export function findActionMenuItemById(
    items: ActionMenuItem[],
    actionId: string,
    focusContext: FocusContext | null = null,
): ActionDefinition | null {
    for (const item of getVisibleActionMenuItems(items, focusContext)) {
        if (isActionMenuSeparator(item)) {
            continue;
        }
        if (isActionMenuAction(item)) {
            if (item.id === actionId) {
                return item;
            }
            continue;
        }
        const found = findActionMenuItemById(item.items, actionId, focusContext);
        if (found) {
            return found;
        }
    }
    return null;
}

export function isActionVisible(action: ActionDefinition, focusContext: FocusContext | null = null): boolean {
    if (action.visible === false) {
        return false;
    }
    return !action.when || !focusContext || action.when(focusContext);
}

function byActionMenuOrder(a: ActionMenuItem, b: ActionMenuItem): number {
    if (isActionMenuSeparator(a) || isActionMenuSeparator(b)) {
        return 0;
    }
    return (a.order ?? 0) - (b.order ?? 0);
}
