import { useCallback, useSyncExternalStore } from "react";
import type { StoryBlockId, StoryId, StorySceneId } from "@shared/types/story";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import type { PanelStateService } from "@/lib/workspace/services/core/PanelStateService";
import {
    getStoryScenePreviewPaneState,
    patchStoryScenePreviewPaneState,
    type StoryScenePreviewPaneState,
} from "./storyScenePreviewSessionStore";
import {
    noteStoryPreviewTabFocused,
    reconcileStoryPreviewTabs,
    storyPreviewFloatTarget,
    type StoryPreviewFloatOrder,
} from "./storyPreviewFloatOwner";

/**
 * What an open story scene tab lends the floating preview while the tab is mounted.
 *
 * The window is not inside the tab, so it cannot reach the tab's editor the way the docked pane does;
 * the tab hands over the two things a press on the stage needs from it, and the box the window should
 * open over the first time it is popped out.
 */
export type StoryPreviewTabHandle = {
    tabId: string;
    storyId: StoryId;
    sceneId: StorySceneId;
    /** Move the tab's editor cursor to a row, as a step - what a press on the stage asks for. */
    stepTo: (blockId: StoryBlockId) => void;
    /** Whether the tab's editor shows a row; a stop it hides (filtered or folded) is passed over. */
    isRowShown: (blockId: StoryBlockId) => boolean;
    /** The tab's editor body, while it is mounted. */
    editorBody: () => HTMLElement | null;
};

/**
 * The live preview's shared state for one workspace window.
 *
 * Three things have to agree between every story scene tab and the one floating window, and none of
 * them belongs to any single tab:
 *
 * - the pane layout (open, docked width, mode, window placement), which used to be copied into each
 *   tab when it mounted and could then disagree with the copy next door;
 * - which tab the window follows (see `storyPreviewFloatOwner`);
 * - each scene's editor cursor, which the window follows and a press on the window moves.
 *
 * Keyed by workspace context rather than held in React context so that a tab rendered on its own - in
 * a test, say - still finds one.
 */
export class StoryPreviewHub {
    private layout: StoryScenePreviewPaneState | null = null;
    private order: StoryPreviewFloatOrder = [];
    private tabs: ReadonlyMap<string, StoryPreviewTabHandle> = new Map();
    private cursors: ReadonlyMap<StorySceneId, StoryBlockId | null> = new Map();
    private area: HTMLElement | null = null;
    private readonly listeners = new Set<() => void>();

    constructor(private readonly panelState: PanelStateService) {}

    public subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };

    /** The persisted layout. Read from the project's panel state the first time it is asked for. */
    public getLayout(): StoryScenePreviewPaneState {
        if (!this.layout) {
            this.layout = getStoryScenePreviewPaneState(this.panelState);
        }
        return this.layout;
    }

    /**
     * Change the layout and write the change through. A new window rect is always written in the
     * workspace's frame, so the frame travels with every rect that is stored.
     */
    public patchLayout(patch: Partial<StoryScenePreviewPaneState>): void {
        const resolved: Partial<StoryScenePreviewPaneState> = patch.float && !patch.floatFrame
            ? { ...patch, floatFrame: "workspace" }
            : patch;
        this.layout = { ...this.getLayout(), ...resolved };
        patchStoryScenePreviewPaneState(this.panelState, resolved);
        this.emit();
    }

    /** The tab whose scene the floating preview shows. */
    public getTarget(): string | null {
        return storyPreviewFloatTarget(this.order);
    }

    public noteFocused(tabId: string): void {
        this.setOrder(noteStoryPreviewTabFocused(this.order, tabId));
    }

    public reconcile(openTabIdsByRecency: readonly string[]): void {
        this.setOrder(reconcileStoryPreviewTabs(this.order, openTabIdsByRecency));
    }

    public registerTab(handle: StoryPreviewTabHandle): () => void {
        const next = new Map(this.tabs);
        next.set(handle.tabId, handle);
        this.tabs = next;
        this.emit();
        return () => {
            if (this.tabs.get(handle.tabId) !== handle) {
                return;
            }
            const remaining = new Map(this.tabs);
            remaining.delete(handle.tabId);
            this.tabs = remaining;
            this.emit();
        };
    }

    /** The tab's handle while it is mounted; undefined once the keep-alive limit has unmounted it. */
    public getTab(tabId: string | null): StoryPreviewTabHandle | undefined {
        return tabId ? this.tabs.get(tabId) : undefined;
    }

    /**
     * A scene's editor cursor moved. Published by the scene's tab on every move, and by the floating
     * window itself when it steps a scene whose tab is not mounted.
     */
    public publishCursor(sceneId: StorySceneId, blockId: StoryBlockId | null): void {
        if (this.cursors.has(sceneId) && this.cursors.get(sceneId) === blockId) {
            return;
        }
        const next = new Map(this.cursors);
        next.set(sceneId, blockId);
        this.cursors = next;
        this.emit();
    }

    /** The last cursor published for a scene; undefined when no tab has published one this session. */
    public getCursor(sceneId: StorySceneId | null): StoryBlockId | null | undefined {
        return sceneId ? this.cursors.get(sceneId) : undefined;
    }

    /** The workspace content area the floating window lives in. */
    public setArea(element: HTMLElement | null): void {
        this.area = element;
    }

    public getArea(): HTMLElement | null {
        return this.area;
    }

    private setOrder(next: StoryPreviewFloatOrder): void {
        if (next === this.order) {
            return;
        }
        this.order = next;
        this.emit();
    }

    private emit(): void {
        for (const listener of [...this.listeners]) {
            listener();
        }
    }
}

const hubs = new WeakMap<WorkspaceContext, StoryPreviewHub>();

export function getStoryPreviewHub(context: WorkspaceContext): StoryPreviewHub {
    let hub = hubs.get(context);
    if (!hub) {
        hub = new StoryPreviewHub(context.services.get<PanelStateService>(Services.PanelState));
        hubs.set(context, hub);
    }
    return hub;
}

const NOOP_SUBSCRIBE = () => () => undefined;

/**
 * Read one value off the hub and re-render only when that value changes. The selector must return
 * something the hub keeps (a stored object, a primitive), never a fresh object per call.
 */
export function useStoryPreviewHubValue<T>(hub: StoryPreviewHub | null, select: (hub: StoryPreviewHub) => T, fallback: T): T {
    const getSnapshot = useCallback(() => (hub ? select(hub) : fallback), [hub, select, fallback]);
    return useSyncExternalStore(hub ? hub.subscribe : NOOP_SUBSCRIBE, getSnapshot, getSnapshot);
}

const selectLayout = (hub: StoryPreviewHub) => hub.getLayout();

/** The shared pane layout, or null until the workspace has loaded it. */
export function useStoryPreviewLayout(hub: StoryPreviewHub | null): StoryScenePreviewPaneState | null {
    return useStoryPreviewHubValue<StoryScenePreviewPaneState | null>(hub, selectLayout, null);
}
