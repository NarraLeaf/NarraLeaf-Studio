import { useSyncExternalStore } from "react";
import type { StoryBlockId, StorySceneId } from "@shared/types/story";
import type { PanelStateService } from "@/lib/workspace/services/core/PanelStateService";
import {
    normalizeStoryRowFacets,
    normalizeStoryRowSpeakers,
    STORY_ROW_NARRATIVE_FACETS,
    type StoryRowFacetId,
    type StoryRowSpeakerKey,
} from "./storyRowFilter";

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
 * Focus-anchored scroll position of a scene editor. Rather than a raw pixel `scrollTop` - which
 * drifts whenever the rows re-flow (collapse state resets on remount, rich text / images change row
 * heights, the overview image loads in) and so fails to restore the author's place - we remember the
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
 * remember its selection), so the author's place survives not only a tab/page switch - the scene
 * editor fully unmounts then - but also a Studio restart: on next launch the scene reopens where it
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
    /**
     * Whether the scene-overview block (name / description / default background) is collapsed. Absent
     * until the author toggles it manually: with no stored preference the editor falls back to a
     * config-derived default (expanded while the scene is still unconfigured, collapsed once set up).
     */
    overviewCollapsed?: boolean;
};

/**
 * Reading-density of the scene editor. `compact` is the status quo; the other two open up type
 * and row boxes by the amounts in `STORY_DENSITY_METRICS` (storyEditorTextStyle.tsx), which is the one
 * place the numbers live — the row chrome reads them through a CSS variable rather than hard-coding a
 * second copy in the stylesheet.
 */
export type StoryEditorDensity = "compact" | "standard" | "comfortable";

export const STORY_EDITOR_DENSITIES: readonly StoryEditorDensity[] = ["compact", "standard", "comfortable"];

/** A stored value from an older build (or a hand-edited state file) falls back to the status quo. */
function normalizeDensity(value: unknown): StoryEditorDensity {
    return STORY_EDITOR_DENSITIES.includes(value as StoryEditorDensity) ? value as StoryEditorDensity : "compact";
}

/**
 * Editor-wide view preferences: density and the row filter. Persisted per-project via
 * {@link PanelStateService} (the same store the row view-state uses), so they survive tab switches
 * and restarts. Editor-wide, not per-scene, so they live under their own key rather than the scene map.
 */
export type StoryEditorViewPrefs = {
    density: StoryEditorDensity;
    /**
     * The row kinds the author picked out. Stored as the SELECTED set, matching the panel: `[]` is
     * the unfiltered editor, and anything else is the whole of what the page shows.
     *
     * It supersedes the `narrativeOnly` boolean this key used to hold — that flag was exactly one
     * point in this space (the four prose kinds), and is read back below so an author who left the
     * filter on finds it still on after the upgrade.
     */
    selectedRowFacets: StoryRowFacetId[];
    /** The cast the author picked out, as `storyRowFilter` keys. Same selected-set reading as above. */
    selectedRowSpeakers: StoryRowSpeakerKey[];
};

/** The pre-filter shape of the key, still on disk for anyone who set it. Read once, on the way in. */
type LegacyStoryEditorViewPrefs = { narrativeOnly?: boolean };

const STORY_EDITOR_VIEW_PREFS_KEY = "story:editor:view-prefs";
const DEFAULT_STORY_EDITOR_VIEW_PREFS: StoryEditorViewPrefs = { density: "compact", selectedRowFacets: [], selectedRowSpeakers: [] };

export function getStoryEditorViewPrefs(panelState: PanelStateService): StoryEditorViewPrefs {
    const raw = panelState.getPanelState<Partial<StoryEditorViewPrefs> & LegacyStoryEditorViewPrefs>(STORY_EDITOR_VIEW_PREFS_KEY);
    // The old boolean only speaks when the new key has never been written: once the author touches the
    // filter, `selectedRowFacets` is the whole truth — including the empty array that means "show all".
    const selectedRowFacets = raw && "selectedRowFacets" in raw
        ? normalizeStoryRowFacets(raw.selectedRowFacets)
        : raw?.narrativeOnly
            ? [...STORY_ROW_NARRATIVE_FACETS]
            : [...DEFAULT_STORY_EDITOR_VIEW_PREFS.selectedRowFacets];
    return {
        density: normalizeDensity(raw?.density),
        selectedRowFacets,
        selectedRowSpeakers: normalizeStoryRowSpeakers(raw?.selectedRowSpeakers),
    };
}

export function patchStoryEditorViewPrefs(panelState: PanelStateService, patch: Partial<StoryEditorViewPrefs>): void {
    panelState.setPanelState<StoryEditorViewPrefs>(STORY_EDITOR_VIEW_PREFS_KEY, patch);
}

/**
 * Which control containers are showing their staging lens (M7), persisted per-project via
 * {@link PanelStateService} so the choice survives tab switches and restarts — the same storage the
 * density preference uses. Keyed by the container's block id; a stale id for a since-deleted container
 * is inert (nothing matches it). Stored as an id→true map so the shallow-merge `setPanelState` can flip
 * one container without rewriting the rest (a `false`/absent entry both mean "list view").
 */
const STORY_EDITOR_LENS_STATE_KEY = "story:editor:lens-state";
type StoryEditorLensStore = Record<StoryBlockId, boolean>;

export function getStoryEditorLensContainerIds(panelState: PanelStateService): Set<StoryBlockId> {
    const store = panelState.getPanelState<StoryEditorLensStore>(STORY_EDITOR_LENS_STATE_KEY);
    const ids = new Set<StoryBlockId>();
    if (store) {
        for (const [id, on] of Object.entries(store)) {
            if (on) {
                ids.add(id);
            }
        }
    }
    return ids;
}

/** Flip one container's lens view on or off, touching only its own entry in the store. */
export function setStoryEditorLensContainer(panelState: PanelStateService, containerId: StoryBlockId, on: boolean): void {
    panelState.setPanelState<StoryEditorLensStore>(STORY_EDITOR_LENS_STATE_KEY, { [containerId]: on });
}

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
 * visible row on every scroll, so it reflects where they were looking - NOT the selected row, which
 * they may have scrolled far away from); only fall back to bringing the focused row into view when the
 * scene was never scrolled. Returns null when there is nothing to restore or the target rows aren't in
 * the DOM yet - the caller retries across frames until the value stabilizes (content reaches full
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
