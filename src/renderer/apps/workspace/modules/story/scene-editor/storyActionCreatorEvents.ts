export const STORY_ACTION_CREATOR_PANEL_ID = "narraleaf-studio:story-action-creator";
export const STORY_ACTION_CREATE_REQUEST_EVENT = "narraleaf-studio:story-action-create-request";

export type StoryActionCreatorPanelPayload = {
    /** The story scene tab an insert from the manual lands in: the one the author was in last. */
    tabId: string;
};

export type StoryActionCreateRequestDetail = {
    tabId: string;
    /** Built-in ActionCommandId, or a namespaced plugin story action id. */
    commandId: string;
};

/**
 * Requests no tab took when they were sent, by tab id. The latest one per tab wins.
 *
 * The manual stays on the rail while its scene tab is behind another editor, so the tab an insert is
 * for may be hidden with its scene still loading, or not mounted at all once the keep-alive limit
 * has let it go. The sender brings the tab forward; whatever the tab could not act on at once waits
 * here until it can, rather than being dropped on an event nobody was listening for.
 */
const pendingRequests = new Map<string, string>();

/**
 * Ask a scene tab to insert a command. A tab that acts on it calls `preventDefault()` on the event;
 * one that does not is left to pick it up with {@link takePendingStoryActionCreateRequest}.
 */
export function dispatchStoryActionCreateRequest(detail: StoryActionCreateRequestDetail): void {
    const event = new CustomEvent<StoryActionCreateRequestDetail>(STORY_ACTION_CREATE_REQUEST_EVENT, {
        detail,
        cancelable: true,
    });
    window.dispatchEvent(event);
    if (event.defaultPrevented) {
        pendingRequests.delete(detail.tabId);
    } else {
        pendingRequests.set(detail.tabId, detail.commandId);
    }
}

/** The command a tab was asked to insert before it could, once; null when there is none. */
export function takePendingStoryActionCreateRequest(tabId: string): string | null {
    const commandId = pendingRequests.get(tabId);
    if (commandId === undefined) {
        return null;
    }
    pendingRequests.delete(tabId);
    return commandId;
}

/**
 * Forget the requests of tabs that have closed. A request outlives nothing it was made for: the same
 * scene opened again later is a new tab, and must not open with a line nobody asked it for.
 */
export function discardPendingStoryActionCreateRequests(isOpen: (tabId: string) => boolean): void {
    for (const tabId of [...pendingRequests.keys()]) {
        if (!isOpen(tabId)) {
            pendingRequests.delete(tabId);
        }
    }
}
