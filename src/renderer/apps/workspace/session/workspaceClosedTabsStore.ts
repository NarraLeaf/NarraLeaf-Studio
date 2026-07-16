import type { EditorTabDefinition } from "@/apps/workspace/registry/types";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { WorkspaceContext } from "@/lib/workspace/services/services";
import { FocusArea } from "@/lib/workspace/services/ui/types";
import type { SerializedTab } from "./workspaceEditorSession";
import { buildTabDefinition, trySerializeTab } from "./workspaceEditorSession";

/**
 * Recently-closed editor tabs, for "Reopen closed tab" (mod+shift+t and the tab
 * context menu).
 *
 * Reuses the workspace-session serialization: a closed tab is stored as the same
 * `SerializedTab` the restart restore uses, so reopening goes through the exact
 * code path that already knows how to rebuild every tab kind — and silently
 * skips tabs whose resource has since been deleted (`buildTabDefinition`
 * returns null for those).
 *
 * In-memory by design: a window reload restores the full session anyway, so
 * persisting this stack would only add schema surface for no user-visible gain.
 */
export interface ClosedTabRecord {
    entry: SerializedTab;
    /** Group the tab lived in; reopening falls back to the default group if it is gone. */
    groupId: string;
    /** Position within the group at close time, so reopening puts the tab back where it was. */
    index: number;
}

const MAX_CLOSED_TABS = 20;

let stack: ClosedTabRecord[] = [];

/**
 * Record tabs removed by a user-initiated close. Call BEFORE the store drops
 * them (the tab definitions and their indices must still be readable).
 * Non-serializable tabs are skipped — they cannot be rebuilt, so offering to
 * "reopen" them would produce a dead entry.
 */
export function recordClosedTabs(
    tabs: readonly { tab: EditorTabDefinition; index: number }[],
    groupId: string,
): void {
    for (const { tab, index } of tabs) {
        const entry = trySerializeTab(tab);
        if (!entry) {
            continue;
        }
        stack.push({ entry, groupId, index });
    }
    if (stack.length > MAX_CLOSED_TABS) {
        stack = stack.slice(stack.length - MAX_CLOSED_TABS);
    }
}

/** Most recently closed first. Null when there is nothing to reopen. */
export function popClosedTab(): ClosedTabRecord | null {
    return stack.pop() ?? null;
}

export function hasClosedTabs(): boolean {
    return stack.length > 0;
}

/** Test seam + project-switch hygiene. */
export function clearClosedTabs(): void {
    stack = [];
}

/**
 * Reopen the most recently closed tab: rebuild it, put it back at its old
 * position (falling back to the default group if its group is gone), and focus
 * it. Entries whose resource has been deleted in the meantime rebuild to null
 * and are skipped in favor of the next one.
 *
 * Returns false when the stack is empty or nothing on it could be rebuilt.
 */
export function reopenLastClosedTab(ctx: WorkspaceContext, uiService: UIService): boolean {
    for (let record = popClosedTab(); record; record = popClosedTab()) {
        const tab = buildTabDefinition(ctx, record.entry);
        if (!tab) {
            continue;
        }
        const store = uiService.getStore();
        const layout = store.getEditorLayout();
        const groupExists = (function find(node: typeof layout): boolean {
            if ("tabs" in node) {
                return node.id === record!.groupId;
            }
            return find(node.first) || find(node.second);
        })(layout);
        store.openEditorTabInGroup(tab, groupExists ? record.groupId : undefined, true, record.index);
        uiService.focus.setFocus(FocusArea.Editor, tab.id);
        return true;
    }
    return false;
}
