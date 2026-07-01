import type { FocusContext } from "@/lib/workspace/services/ui";
import type { ActionDefinition, ActionGroup, ActionMenuItem, ActionSeparator } from "../../registry/types";

export function isActionMenuSeparator(item: ActionMenuItem): item is ActionSeparator {
    return (item as ActionSeparator).separator === true;
}

export function isActionMenuAction(item: ActionMenuItem): item is ActionDefinition {
    return (item as ActionDefinition).onClick !== undefined;
}

export function getActionGroupItems(group: ActionGroup): ActionMenuItem[] {
    return (group.items ?? group.actions ?? []) as ActionMenuItem[];
}

export function getVisibleActionMenuItems(
    items: ActionMenuItem[],
    focusContext: FocusContext | null = null,
): ActionMenuItem[] {
    return (items || [])
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
