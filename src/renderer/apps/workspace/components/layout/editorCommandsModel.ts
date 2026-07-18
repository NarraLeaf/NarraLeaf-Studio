import type { EditorGroup, EditorLayout, EditorTabDefinition } from "../../registry/types";
import type { FocusContext } from "@/lib/workspace/services/ui/types";
import { FocusArea } from "@/lib/workspace/services/ui/types";

/**
 * The editor tab a global command should act on. The command palette has no click target — unlike
 * the tab context menu — so "the active tab" is the focused tab of whichever group currently holds
 * editor focus.
 */
export interface ActiveEditorTarget {
    group: EditorGroup;
    tab: EditorTabDefinition<unknown>;
    index: number;
}

/** Depth-first list of every editor group in the layout, left/first before right/second. */
export function collectEditorGroups(layout: EditorLayout): EditorGroup[] {
    if ("tabs" in layout) {
        return [layout];
    }
    return [...collectEditorGroups(layout.first), ...collectEditorGroups(layout.second)];
}

/**
 * Resolve the editor tab that a global editor command should target.
 *
 * Preference order: the tab named by editor-body focus → the focused tab of the tab-strip's group →
 * the focused tab of the first group that has one → the first tab of the first non-empty group.
 * Returns null when there are no tabs at all.
 */
export function findActiveEditorTarget(
    layout: EditorLayout,
    focus: FocusContext | null,
): ActiveEditorTarget | null {
    const groups = collectEditorGroups(layout);

    const inGroup = (group: EditorGroup | undefined, tabId: string | null | undefined): ActiveEditorTarget | null => {
        if (!group || !tabId) {
            return null;
        }
        const index = group.tabs.findIndex(tab => tab.id === tabId);
        return index >= 0 ? { group, tab: group.tabs[index], index } : null;
    };

    // 1) Editor body focus points straight at a tab.
    if (focus?.area === FocusArea.Editor && focus.targetId) {
        const owning = groups.find(group => group.tabs.some(tab => tab.id === focus.targetId));
        const target = inGroup(owning, focus.targetId);
        if (target) {
            return target;
        }
    }

    // 2) Tab-strip focus names a group; act on that group's focused tab.
    let activeGroup: EditorGroup | undefined;
    if (focus?.area === FocusArea.EditorTabs && focus.targetId) {
        activeGroup = groups.find(group => group.id === focus.targetId);
    }

    // 3) Fall back to the first group that has a focused tab, else the first non-empty group.
    activeGroup =
        activeGroup ??
        groups.find(group => group.focus && group.tabs.some(tab => tab.id === group.focus)) ??
        groups.find(group => group.tabs.length > 0);

    if (!activeGroup) {
        return null;
    }
    const focusedTarget = inGroup(activeGroup, activeGroup.focus);
    if (focusedTarget) {
        return focusedTarget;
    }
    return activeGroup.tabs.length > 0
        ? { group: activeGroup, tab: activeGroup.tabs[0], index: 0 }
        : null;
}

/** Ids of the closable tabs in `tabs` (a tab is pinned/undismissable when `closable === false`). */
export function closableTabIds(tabs: readonly EditorTabDefinition<unknown>[]): string[] {
    return tabs.filter(tab => tab.closable !== false).map(tab => tab.id);
}

/** Closable ids in the group other than the one at `index`. */
export function closableOtherTabIds(group: EditorGroup, index: number): string[] {
    return closableTabIds(group.tabs.filter((_, i) => i !== index));
}

/** Closable ids to the right of `index`. */
export function closableTabIdsToRight(group: EditorGroup, index: number): string[] {
    return closableTabIds(group.tabs.slice(index + 1));
}
