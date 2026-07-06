import { useSyncExternalStore } from "react";

/**
 * Ephemeral, session-scoped UI state for the Story scene editor. Shared across every row and every
 * open scene-editor tab in the current Studio session, but never persisted to disk (contrast with
 * the `story.actionCreator.starredActionIds` global setting).
 */

let richToolbarExpanded = false;
const listeners = new Set<() => void>();

function emit(): void {
    for (const listener of listeners) {
        listener();
    }
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function getRichToolbarExpanded(): boolean {
    return richToolbarExpanded;
}

export function setRichToolbarExpanded(next: boolean): void {
    if (richToolbarExpanded === next) {
        return;
    }
    richToolbarExpanded = next;
    emit();
}

/** Reactive accessor for the session-shared "rich text toolbar expanded" flag. */
export function useRichToolbarExpanded(): [boolean, (next: boolean) => void] {
    const value = useSyncExternalStore(subscribe, getRichToolbarExpanded, getRichToolbarExpanded);
    return [value, setRichToolbarExpanded];
}
