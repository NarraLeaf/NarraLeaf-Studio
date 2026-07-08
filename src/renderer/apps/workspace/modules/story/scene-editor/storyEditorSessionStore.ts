import { useSyncExternalStore } from "react";
import type { StoryBlockId, StorySceneId } from "@shared/types/story";
import type { PanelStateService } from "@/lib/workspace/services/core/PanelStateService";

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

/**
 * Focus-anchored scroll position of a scene editor. Rather than a raw pixel `scrollTop` — which
 * drifts whenever the rows re-flow (collapse state resets on remount, rich text / images change row
 * heights, the overview image loads in) and so fails to restore the author's place — we remember the
 * top-most visible story row ("focus row") and its offset from the viewport top. Restore then puts
 * that same row back at the same spot regardless of how the content above it re-laid out.
 */
export type StoryEditorScrollAnchor = {
    /** Block id of the top-most visible story row when captured; null when the scene had no rows. */
    blockId: StoryBlockId | null;
    /** The anchor row's top edge relative to the scroll viewport top, in px (may be negative). */
    offset: number;
    /** Raw scrollTop, used as a fallback when the anchor row can't be resolved on restore. */
    scrollTop: number;
};

/**
 * Everything needed to put an author back where they left a scene: the focused row (聚焦项目) and its
 * selection, plus the focus-anchored scroll position. Keyed by scene id (each scene has its own id,
 * so no further nesting is needed).
 *
 * Persisted per-project on disk via {@link PanelStateService} (the same store the Story panel uses to
 * remember its selection), so the author's place survives not only a tab/page switch — the scene
 * editor fully unmounts then — but also a Studio restart: on next launch the scene reopens where it
 * was left. `PanelStateService` loads its store from disk during workspace init, before the editor can
 * render, so the synchronous restore below always sees the persisted value.
 */
export type StoryEditorViewState = {
    /** The focused/active row, restored as both active and selected on reopen. */
    activeBlockId: StoryBlockId | null;
    /** Full row selection to restore alongside the active row. */
    selectedBlockIds: StoryBlockId[];
    /** Focus-anchored scroll position; absent until the author scrolls. */
    scroll?: StoryEditorScrollAnchor;
};

const ROW_SELECTOR = "[data-story-row-block-id]";

// One PanelStateService entry holds every scene's view state as a `sceneId -> state` map.
const STORY_EDITOR_VIEW_STATE_KEY = "story:editor:view-state";
type StoryEditorViewStateStore = Record<StorySceneId, StoryEditorViewState>;

export function getStoryEditorViewState(panelState: PanelStateService, sceneId: StorySceneId): StoryEditorViewState | undefined {
    return panelState.getPanelState<StoryEditorViewStateStore>(STORY_EDITOR_VIEW_STATE_KEY)?.[sceneId];
}

/** Merge a partial update into a scene's persisted view state (focus, selection, and/or scroll). */
export function patchStoryEditorViewState(panelState: PanelStateService, sceneId: StorySceneId, patch: Partial<StoryEditorViewState>): void {
    const prev = getStoryEditorViewState(panelState, sceneId) ?? { activeBlockId: null, selectedBlockIds: [] };
    // setPanelState shallow-merges this partial into the store, so only the touched scene's entry changes.
    panelState.setPanelState<StoryEditorViewStateStore>(STORY_EDITOR_VIEW_STATE_KEY, { [sceneId]: { ...prev, ...patch } });
}

/** Capture the current focus-anchored scroll position from a scene editor scroll container. */
export function captureStoryEditorScrollAnchor(container: HTMLElement): StoryEditorScrollAnchor {
    const containerTop = container.getBoundingClientRect().top;
    const rows = container.querySelectorAll<HTMLElement>(ROW_SELECTOR);
    for (const row of rows) {
        const rect = row.getBoundingClientRect();
        // First row whose bottom is still below the viewport top is the top-most (partially) visible row.
        if (rect.bottom > containerTop + 1) {
            return {
                blockId: row.dataset.storyRowBlockId ?? null,
                offset: rect.top - containerTop,
                scrollTop: container.scrollTop,
            };
        }
    }
    return { blockId: null, offset: 0, scrollTop: container.scrollTop };
}

/** Content-coordinate top of a story row within its scroll container (invariant to scrollTop). */
function rowContentTop(container: HTMLElement, row: HTMLElement): number {
    return container.scrollTop + (row.getBoundingClientRect().top - container.getBoundingClientRect().top);
}

function findRow(container: HTMLElement, blockId: StoryBlockId): HTMLElement | null {
    const rows = container.querySelectorAll<HTMLElement>(ROW_SELECTOR);
    for (const row of rows) {
        if (row.dataset.storyRowBlockId === blockId) {
            return row;
        }
    }
    return null;
}

/**
 * Compute the scrollTop that restores a scene's saved place, for the container's CURRENT layout.
 * Priority: reproduce the actual scroll viewport the author left (the anchor captures the top-most
 * visible row on every scroll, so it reflects where they were looking — NOT the selected row, which
 * they may have scrolled far away from); only fall back to bringing the focused row into view when the
 * scene was never scrolled. Returns null when there is nothing to restore or the target rows aren't in
 * the DOM yet — the caller retries across frames until the value stabilizes (content reaches full
 * height post-mount).
 */
export function resolveStoryEditorRestoreScrollTop(container: HTMLElement, view: StoryEditorViewState): number | null {
    const anchor = view.scroll;
    if (anchor) {
        if (anchor.blockId) {
            const row = findRow(container, anchor.blockId);
            if (row) {
                return Math.max(0, rowContentTop(container, row) - anchor.offset);
            }
        }
        return Math.max(0, anchor.scrollTop);
    }
    if (view.activeBlockId) {
        const row = findRow(container, view.activeBlockId);
        if (row) {
            return Math.max(0, rowContentTop(container, row) - container.clientHeight * 0.25);
        }
    }
    return null;
}
