import { describe, expect, it } from "vitest";
import type { EditorSplit, EditorTabDefinition } from "@/apps/workspace/registry/types";
import type { PanelStateService } from "@/lib/workspace/services/core/PanelStateService";
import { UIStore } from "@/lib/workspace/services/ui/UIStore";
import { FocusManager } from "@/lib/workspace/services/ui/FocusManager";
import { FocusArea } from "@/lib/workspace/services/ui/types";
import { getStorySceneEditorTabId } from "../storySceneEditorTabId";
import {
    noteStoryPreviewTabFocused,
    reconcileStoryPreviewTabs,
    storyPreviewFloatTarget,
} from "./storyPreviewFloatOwner";
import { StoryPreviewHub } from "./storyPreviewHub";
import { trackStoryPreviewFloatOwner } from "./storyPreviewFloatTracking";

/**
 * Which scene the one floating preview shows, across the sequences an author actually goes through:
 * the most recently focused story scene tab, kept while other editors are in front, handed on when
 * that tab closes, and gone with the last one. Driven through a real `UIStore` and `FocusManager`,
 * because the rules only hold if every way focus reaches a tab is heard.
 */

const Dummy = () => null;
const CLUBROOM = getStorySceneEditorTabId("story", "clubroom");
const CORRIDOR = getStorySceneEditorTabId("story", "corridor");
const LAST_LIGHT = getStorySceneEditorTabId("story", "last-light");

function tab(id: string): EditorTabDefinition {
    return { id, title: id, component: Dummy };
}

function fakePanelState(): PanelStateService {
    const store: Record<string, Record<string, unknown>> = {};
    return {
        getPanelState: (panelId: string) => store[panelId],
        setPanelState: (panelId: string, partial: Record<string, unknown>) => {
            store[panelId] = { ...(store[panelId] ?? {}), ...partial };
        },
    } as unknown as PanelStateService;
}

function setup() {
    const store = new UIStore();
    const focus = new FocusManager();
    const hub = new StoryPreviewHub(fakePanelState());
    const stop = trackStoryPreviewFloatOwner({ store, focus }, hub);
    return { store, focus, hub, stop };
}

describe("story preview float ownership (pure rules)", () => {
    it("moves a focused tab to the front and leaves an unchanged order alone", () => {
        const order = noteStoryPreviewTabFocused([], "a");
        expect(order).toEqual(["a"]);
        expect(noteStoryPreviewTabFocused(order, "a")).toBe(order);
        expect(noteStoryPreviewTabFocused(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
    });

    it("drops closed tabs and lets unseen ones join at the back", () => {
        expect(reconcileStoryPreviewTabs(["a", "b"], ["b", "c", "c"])).toEqual(["b", "c"]);
        const order = ["a", "b"];
        expect(reconcileStoryPreviewTabs(order, ["b", "a"])).toBe(order);
        expect(storyPreviewFloatTarget(reconcileStoryPreviewTabs(order, []))).toBeNull();
    });
});

describe("story preview float ownership (workspace sequences)", () => {
    it("follows the story tab focused last and keeps it while another editor is in front", () => {
        const { store, hub } = setup();
        store.openEditorTabInGroup(tab(CLUBROOM));
        expect(hub.getTarget()).toBe(CLUBROOM);

        store.openEditorTabInGroup(tab("ui-editor:surface:dialogue"));
        expect(hub.getTarget()).toBe(CLUBROOM);

        store.openEditorTabInGroup(tab(CORRIDOR));
        expect(hub.getTarget()).toBe(CORRIDOR);

        store.setActiveEditorTabInGroup(CLUBROOM, "main");
        expect(hub.getTarget()).toBe(CLUBROOM);

        store.setActiveEditorTabInGroup("ui-editor:surface:dialogue", "main");
        expect(hub.getTarget()).toBe(CLUBROOM);
    });

    it("hands the window to the story tab focused before when its tab closes, and has nothing when the last one does", () => {
        const { store, hub } = setup();
        store.openEditorTabInGroup(tab(CLUBROOM));
        store.openEditorTabInGroup(tab("ui-editor:surface:dialogue"));
        store.openEditorTabInGroup(tab(CORRIDOR));
        store.setActiveEditorTabInGroup("ui-editor:surface:dialogue", "main");
        expect(hub.getTarget()).toBe(CORRIDOR);

        store.closeEditorTabInGroup(CORRIDOR, "main");
        expect(hub.getTarget()).toBe(CLUBROOM);

        store.closeEditorTabInGroup(CLUBROOM, "main");
        expect(hub.getTarget()).toBeNull();
    });

    it("does not let a tab opened in the background take the window", () => {
        const { store, hub } = setup();
        store.openEditorTabInGroup(tab(CLUBROOM));
        store.openEditorTabInGroup(tab(CORRIDOR), undefined, false);
        expect(hub.getTarget()).toBe(CLUBROOM);
        // It is still in the order, so it inherits the window if the shown one closes.
        store.closeEditorTabInGroup(CLUBROOM, "main");
        expect(hub.getTarget()).toBe(CORRIDOR);
    });

    it("follows the pane the author clicks into when two story tabs share a split", () => {
        const { store, focus, hub } = setup();
        store.openEditorTabInGroup(tab(CLUBROOM));
        store.openEditorTabInGroup(tab(CORRIDOR));
        store.splitEditorGroup("main", "horizontal", CORRIDOR);
        const split = store.getEditorLayout() as EditorSplit;
        expect("tabs" in split).toBe(false);
        expect(hub.getTarget()).toBe(CORRIDOR);

        // A click into a pane's body moves focus to its tab without touching the tab history.
        focus.setFocus(FocusArea.Editor, CLUBROOM);
        expect(hub.getTarget()).toBe(CLUBROOM);
        focus.setFocus(FocusArea.Editor, CORRIDOR);
        expect(hub.getTarget()).toBe(CORRIDOR);
        focus.setFocus(FocusArea.EditorTabs, split.first.id);
        expect(hub.getTarget()).toBe(CLUBROOM);

        // An unrelated layout write - a title, a dirty flag - leaves the window where the author put it.
        store.updateEditorTab(CORRIDOR, { title: "Corridor*" });
        expect(hub.getTarget()).toBe(CLUBROOM);
    });

    it("ignores focus on tabs that are not story scene editors", () => {
        const { store, focus, hub } = setup();
        store.openEditorTabInGroup(tab(LAST_LIGHT));
        store.openEditorTabInGroup(tab("narraleaf-studio:dashboard"));
        focus.setFocus(FocusArea.Editor, "narraleaf-studio:dashboard");
        expect(hub.getTarget()).toBe(LAST_LIGHT);
    });

    it("stops listening once stopped", () => {
        const { store, hub, stop } = setup();
        store.openEditorTabInGroup(tab(CLUBROOM));
        stop();
        store.openEditorTabInGroup(tab(CORRIDOR));
        expect(hub.getTarget()).toBe(CLUBROOM);
    });
});
