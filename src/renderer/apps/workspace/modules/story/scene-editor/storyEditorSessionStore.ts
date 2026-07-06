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

// Per-tab scroll position (keyed by scene-editor tab id) so switching tabs / remounting keeps the
// author's place. Session-scoped, not persisted.
const scrollPositions = new Map<string, number>();

export function getStoryEditorScroll(key: string): number | undefined {
    return scrollPositions.get(key);
}

export function setStoryEditorScroll(key: string, top: number): void {
    scrollPositions.set(key, top);
}
