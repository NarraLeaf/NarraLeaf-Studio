// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { EditorTabDefinition } from "@/apps/workspace/registry/types";
import type { PanelStateService } from "@/lib/workspace/services/core/PanelStateService";
import { UIStore } from "@/lib/workspace/services/ui/UIStore";
import { FocusManager } from "@/lib/workspace/services/ui/FocusManager";
import { getStorySceneEditorTabId } from "./storySceneEditorTabId";
import { StoryPreviewHub } from "./preview/storyPreviewHub";
import { trackStoryPreviewFloatOwner } from "./preview/storyPreviewFloatTracking";
import {
    dispatchStoryActionCreateRequest,
    STORY_ACTION_CREATE_REQUEST_EVENT,
    takePendingStoryActionCreateRequest,
    type StoryActionCreatorPanelPayload,
} from "./storyActionCreatorEvents";
import { holdStoryCommandManualOnRail } from "./storyCommandManualRail";

/**
 * The command manual hangs on whether a story scene is open, not on which editor is in front.
 * Driven through a real `UIStore` and the same hub the floating preview follows, because the point is
 * that the manual survives the author looking at something else.
 */

const Dummy = () => null;
const CLUBROOM = getStorySceneEditorTabId("story", "clubroom");
const CORRIDOR = getStorySceneEditorTabId("story", "corridor");
const SURFACE = "ui-editor:surface:dialogue";

function tab(id: string): EditorTabDefinition {
    return { id, title: id, component: Dummy };
}

function fakePanelState(): PanelStateService {
    return {
        getPanelState: () => undefined,
        setPanelState: () => undefined,
    } as unknown as PanelStateService;
}

const stops: Array<() => void> = [];

afterEach(() => {
    while (stops.length > 0) {
        stops.pop()?.();
    }
});

function setup() {
    const store = new UIStore();
    const hub = new StoryPreviewHub(fakePanelState());
    stops.push(trackStoryPreviewFloatOwner({ store, focus: new FocusManager() }, hub));
    /** What the rail holds: the payload while the manual is on it, null while it is not. */
    let onRail: StoryActionCreatorPanelPayload | null = null;
    let registrations = 0;
    stops.push(holdStoryCommandManualOnRail(hub, store, {
        register: payload => {
            registrations += 1;
            onRail = payload;
            return () => {
                onRail = null;
            };
        },
        retarget: payload => {
            onRail = payload;
        },
    }));
    return {
        store,
        rail: () => onRail,
        registrations: () => registrations,
    };
}

describe("command manual on the rail", () => {
    it("is absent until a scene is open", () => {
        const { store, rail } = setup();
        expect(rail()).toBeNull();
        store.openEditorTabInGroup(tab(SURFACE));
        expect(rail()).toBeNull();
        store.openEditorTabInGroup(tab(CLUBROOM));
        expect(rail()).toEqual({ tabId: CLUBROOM });
    });

    it("stays put while another editor is in front, and is not registered again on return", () => {
        const { store, rail, registrations } = setup();
        store.openEditorTabInGroup(tab(CLUBROOM));
        store.openEditorTabInGroup(tab(SURFACE));
        expect(rail()).toEqual({ tabId: CLUBROOM });
        store.setActiveEditorTabInGroup(CLUBROOM, "main");
        expect(rail()).toEqual({ tabId: CLUBROOM });
        expect(registrations()).toBe(1);
    });

    it("points at the scene the author was in last", () => {
        const { store, rail } = setup();
        store.openEditorTabInGroup(tab(CLUBROOM));
        store.openEditorTabInGroup(tab(CORRIDOR));
        expect(rail()).toEqual({ tabId: CORRIDOR });
        store.openEditorTabInGroup(tab(SURFACE));
        expect(rail()).toEqual({ tabId: CORRIDOR });
        store.closeEditorTab(CORRIDOR);
        expect(rail()).toEqual({ tabId: CLUBROOM });
    });

    it("leaves with the last scene and comes back with the next", () => {
        const { store, rail, registrations } = setup();
        store.openEditorTabInGroup(tab(CLUBROOM));
        store.openEditorTabInGroup(tab(SURFACE));
        store.closeEditorTab(CLUBROOM);
        expect(rail()).toBeNull();
        store.openEditorTabInGroup(tab(CORRIDOR));
        expect(rail()).toEqual({ tabId: CORRIDOR });
        expect(registrations()).toBe(2);
    });
});

describe("inserting from the command manual", () => {
    it("is taken at once by a tab that is ready", () => {
        const listener = (event: Event) => event.preventDefault();
        window.addEventListener(STORY_ACTION_CREATE_REQUEST_EVENT, listener);
        try {
            dispatchStoryActionCreateRequest({ tabId: CLUBROOM, commandId: "say" });
            expect(takePendingStoryActionCreateRequest(CLUBROOM)).toBeNull();
        } finally {
            window.removeEventListener(STORY_ACTION_CREATE_REQUEST_EVENT, listener);
        }
    });

    it("waits for a tab that is not ready yet, once", () => {
        dispatchStoryActionCreateRequest({ tabId: CLUBROOM, commandId: "say" });
        dispatchStoryActionCreateRequest({ tabId: CLUBROOM, commandId: "show" });
        expect(takePendingStoryActionCreateRequest(CLUBROOM)).toBe("show");
        expect(takePendingStoryActionCreateRequest(CLUBROOM)).toBeNull();
    });

    it("is forgotten when its tab closes before taking it", () => {
        const { store } = setup();
        store.openEditorTabInGroup(tab(CLUBROOM));
        store.openEditorTabInGroup(tab(CORRIDOR));
        dispatchStoryActionCreateRequest({ tabId: CLUBROOM, commandId: "say" });
        dispatchStoryActionCreateRequest({ tabId: CORRIDOR, commandId: "show" });
        store.closeEditorTab(CLUBROOM);
        expect(takePendingStoryActionCreateRequest(CLUBROOM)).toBeNull();
        expect(takePendingStoryActionCreateRequest(CORRIDOR)).toBe("show");
    });
});
