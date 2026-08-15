import type { BlueprintEntryTabPayload } from "../modules/blueprint-lite/blueprintEntryTabId";

/**
 * Editors that have left the tab strip and are living in a window of their own.
 *
 * Held in a module-level store rather than in `UIStore` alongside the tabs, because a detached
 * editor is deliberately NOT part of the editor layout: it has no group, no neighbours, no place in
 * the tab order, and the session file must not try to restore one (a restored workspace with a
 * popup it cannot re-parent is worse than a restored tab). What it does keep is its tab id, which
 * is how it goes back to being a tab and how view state that is keyed by tab id - the graph
 * viewport, the member panel - survives the round trip.
 *
 * The blueprint editor is the only detachable editor today; the entry names its kind so that
 * adding a second one is an addition rather than a rewrite.
 */
export type DetachedBlueprintEditor = {
    kind: "blueprint";
    /** The id the tab had, and gets back. Also the popup window's key. */
    tabId: string;
    /** Window title. */
    title: string;
    /** The name the tab strip gave it, restored with it. */
    tabTitle: string;
    payload: BlueprintEntryTabPayload;
};

export type DetachedEditor = DetachedBlueprintEditor;

let detached: readonly DetachedEditor[] = [];
const listeners = new Set<() => void>();

function notify(): void {
    for (const listener of [...listeners]) {
        listener();
    }
}

export function subscribeDetachedEditors(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function readDetachedEditors(): readonly DetachedEditor[] {
    return detached;
}

export function isEditorDetached(tabId: string): boolean {
    return detached.some(entry => entry.tabId === tabId);
}

/**
 * Move an editor out of the workspace.
 *
 * Idempotent on the tab id: asking twice for the same editor updates what the window shows rather
 * than opening a second window on it, which is what a navigation to an already-detached blueprint
 * (a diagnostic, a widget's Edit blueprint) has to do.
 */
export function detachEditor(entry: DetachedEditor): void {
    const existing = detached.find(item => item.tabId === entry.tabId);
    detached = existing
        ? detached.map(item => (item.tabId === entry.tabId ? entry : item))
        : [...detached, entry];
    notify();
}

/**
 * Update what a detached editor would be restored as.
 *
 * A docked editor keeps its view state (which graph is open, which node is focused) in its tab's
 * payload; detached, there is no tab to write to, so it writes here instead and the state survives
 * the trip back. No-op for an editor that is not detached.
 */
export function updateDetachedEditorPayload(tabId: string, payload: DetachedEditor["payload"]): boolean {
    const existing = detached.find(item => item.tabId === tabId);
    if (!existing) {
        return false;
    }
    detached = detached.map(item => (item.tabId === tabId ? { ...item, payload } : item));
    notify();
    return true;
}

/** Forget a detached editor. The caller decides whether it becomes a tab again. */
export function releaseDetachedEditor(tabId: string): DetachedEditor | null {
    const entry = detached.find(item => item.tabId === tabId) ?? null;
    if (!entry) {
        return null;
    }
    detached = detached.filter(item => item.tabId !== tabId);
    notify();
    return entry;
}
