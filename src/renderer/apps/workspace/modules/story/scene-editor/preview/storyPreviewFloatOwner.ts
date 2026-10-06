import type { EditorLayout } from "../../../../registry/types";
import { isStorySceneEditorTabId, type StorySceneEditorTabPayload } from "../storySceneEditorTabId";

/**
 * Which scene the floating live preview shows.
 *
 * There is one floating preview per workspace window, and it shows the scene of the story scene tab
 * the author focused most recently. The state is that order: the open story scene tabs, most
 * recently focused first. Focusing a tab moves it to the front; closing one drops it, which hands
 * the window to the tab focused before it; with none left there is nothing to show. Focusing any
 * other kind of tab leaves the order alone, so the window keeps the scene it was showing.
 *
 * Kept as plain functions over a list and the editor layout so the rules can be read and tested
 * without a workspace.
 */
export type StoryPreviewFloatOrder = readonly string[];

/** The tab whose scene the floating preview shows, or null when no story scene tab is open. */
export function storyPreviewFloatTarget(order: StoryPreviewFloatOrder): string | null {
    return order[0] ?? null;
}

/** A story scene tab took focus: it moves to the front. */
export function noteStoryPreviewTabFocused(order: StoryPreviewFloatOrder, tabId: string): StoryPreviewFloatOrder {
    if (order[0] === tabId) {
        return order;
    }
    return [tabId, ...order.filter(id => id !== tabId)];
}

/**
 * Bring the order in line with the story scene tabs that are open now.
 *
 * Closed tabs drop out. Tabs the order has not met yet - a restored session, a tab opened in the
 * background - join at the back, in the recency order the workspace gives them, so they never take
 * the window from a tab the author has actually focused.
 */
export function reconcileStoryPreviewTabs(
    order: StoryPreviewFloatOrder,
    openTabIdsByRecency: readonly string[],
): StoryPreviewFloatOrder {
    const open = new Set(openTabIdsByRecency);
    const next = order.filter(id => open.has(id));
    const known = new Set(next);
    for (const id of openTabIdsByRecency) {
        if (!known.has(id)) {
            known.add(id);
            next.push(id);
        }
    }
    return next.length === order.length && next.every((id, index) => id === order[index]) ? order : next;
}

/** The open story scene tab with this id, and the group holding it. */
export function findStorySceneTab(
    layout: EditorLayout,
    tabId: string | null,
): { tabId: string; groupId: string; payload: StorySceneEditorTabPayload } | null {
    if (!tabId || !isStorySceneEditorTabId(tabId)) {
        return null;
    }
    if ("tabs" in layout) {
        const tab = layout.tabs.find(candidate => candidate.id === tabId);
        const payload = tab?.payload as StorySceneEditorTabPayload | undefined;
        return tab && payload?.storyId && payload.sceneId ? { tabId, groupId: layout.id, payload } : null;
    }
    return findStorySceneTab(layout.first, tabId) ?? findStorySceneTab(layout.second, tabId);
}
