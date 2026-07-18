import { describe, expect, it } from "vitest";
import type { EditorGroup, EditorTabDefinition } from "@/apps/workspace/registry/types";
import { UIStore } from "./UIStore";
import { PanelPosition, type PanelDefinition } from "./types";

const DummyTab = () => null;

function tab(id: string): EditorTabDefinition {
    return {
        id,
        title: id,
        component: DummyTab,
    };
}

function panel(id: string, position: PanelPosition, order: number): PanelDefinition {
    return {
        id,
        title: id,
        icon: null,
        position,
        component: DummyTab,
        order,
    };
}

function idsByPosition(store: UIStore, position: PanelPosition): string[] {
    return store.getPanels().filter(p => p.position === position).map(p => p.id);
}

function mainGroup(store: UIStore): EditorGroup {
    const layout = store.getEditorLayout();
    if (!("tabs" in layout)) {
        throw new Error("Expected a single editor group");
    }
    return layout;
}

describe("UIStore editor tab focus history", () => {
    it("focuses the previous MRU tab when closing the active tab", () => {
        const store = new UIStore();
        store.openEditorTabInGroup(tab("a"));
        store.openEditorTabInGroup(tab("b"));
        store.openEditorTabInGroup(tab("c"));
        store.setActiveEditorTabInGroup("b", "main");
        store.setActiveEditorTabInGroup("a", "main");

        const focusTarget = store.closeEditorTabInGroup("a", "main");

        expect(focusTarget).toEqual({ tabId: "b", groupId: "main" });
        expect(mainGroup(store).focus).toBe("b");
        expect(store.getEditorTabFocusHistoryKeys()).toEqual(["main:b", "main:c"]);
    });

    it("skips closed MRU tabs when closing multiple tabs", () => {
        const store = new UIStore();
        store.openEditorTabInGroup(tab("a"));
        store.openEditorTabInGroup(tab("b"));
        store.openEditorTabInGroup(tab("c"));
        store.openEditorTabInGroup(tab("d"));
        store.setActiveEditorTabInGroup("c", "main");
        store.setActiveEditorTabInGroup("b", "main");
        store.setActiveEditorTabInGroup("a", "main");

        const focusTarget = store.closeEditorTabsInGroup(["a", "b"], "main");

        expect(focusTarget).toEqual({ tabId: "c", groupId: "main" });
        expect(mainGroup(store).focus).toBe("c");
        expect(store.getEditorTabFocusHistoryKeys()).toEqual(["main:c", "main:d"]);
    });
});

describe("UIStore panel ordering", () => {
    it("sorts panels by the static order field within each position by default", () => {
        const store = new UIStore();
        store.registerPanel(panel("left-b", PanelPosition.Left, 20));
        store.registerPanel(panel("left-a", PanelPosition.Left, 10));
        store.registerPanel(panel("bottom-a", PanelPosition.Bottom, 10));

        expect(idsByPosition(store, PanelPosition.Left)).toEqual(["left-a", "left-b"]);
        expect(idsByPosition(store, PanelPosition.Bottom)).toEqual(["bottom-a"]);
    });

    it("applies a user-defined order that overrides the static order field", () => {
        const store = new UIStore();
        store.registerPanel(panel("a", PanelPosition.Left, 10));
        store.registerPanel(panel("b", PanelPosition.Left, 20));
        store.registerPanel(panel("c", PanelPosition.Left, 30));

        store.setPanelOrder(PanelPosition.Left, ["c", "a", "b"]);

        expect(idsByPosition(store, PanelPosition.Left)).toEqual(["c", "a", "b"]);
        expect(store.getPanelOrder()[PanelPosition.Left]).toEqual(["c", "a", "b"]);
    });

    it("keeps ordering scoped to a single position", () => {
        const store = new UIStore();
        store.registerPanel(panel("left-a", PanelPosition.Left, 10));
        store.registerPanel(panel("left-b", PanelPosition.Left, 20));
        store.registerPanel(panel("right-a", PanelPosition.Right, 10));
        store.registerPanel(panel("right-b", PanelPosition.Right, 20));

        store.setPanelOrder(PanelPosition.Left, ["left-b", "left-a"]);

        // Left reordered, Right untouched.
        expect(idsByPosition(store, PanelPosition.Left)).toEqual(["left-b", "left-a"]);
        expect(idsByPosition(store, PanelPosition.Right)).toEqual(["right-a", "right-b"]);
    });

    it("appends newly registered panels after the ones listed in the override", () => {
        const store = new UIStore();
        store.registerPanel(panel("a", PanelPosition.Left, 10));
        store.registerPanel(panel("b", PanelPosition.Left, 20));
        store.setPanelOrder(PanelPosition.Left, ["b", "a"]);

        // A panel registered later that is absent from the override falls back to its `order`.
        store.registerPanel(panel("c", PanelPosition.Left, 5));

        expect(idsByPosition(store, PanelPosition.Left)).toEqual(["b", "a", "c"]);
    });
});

describe("UIStore panel visibility", () => {
    function hidablePanel(id: string, defaultVisible?: boolean): PanelDefinition {
        return { id, title: id, icon: null, position: PanelPosition.Left, component: DummyTab, defaultVisible };
    }

    function recordVisibilityEvents(store: UIStore, id: string): boolean[] {
        const seen: boolean[] = [];
        store.getEvents().on("panelVisibilityChanged", ({ panelId, visible }) => {
            if (panelId === id) seen.push(visible);
        });
        return seen;
    }

    it("seeds visibility to true for a panel whose defaultVisible is not false", () => {
        const store = new UIStore();
        store.registerPanel(hidablePanel("p"));
        expect(store.getPanelVisibility().p).toBe(true);
    });

    it("leaves a defaultVisible:false panel unseeded — the trap behind the 'first click focuses' bug", () => {
        const store = new UIStore();
        store.registerPanel(hidablePanel("p", false));
        // Nothing seeds visibility, yet the rail shows such panels (undefined reads as visible).
        expect(store.getPanelVisibility().p).toBeUndefined();

        // A blind toggle flips undefined -> true, i.e. emits `visible: true`, which drove showPanel()
        // and focused the panel instead of hiding it.
        const events = recordVisibilityEvents(store, "p");
        store.togglePanelVisibility("p");
        expect(events).toEqual([true]);
        expect(store.getPanelVisibility().p).toBe(true);
    });

    it("hides an unseeded panel when the menu sets visibility from the displayed (visible) state", () => {
        const store = new UIStore();
        store.registerPanel(hidablePanel("p", false));

        // The menu reads the panel as visible (undefined !== false) and sets the opposite explicitly,
        // so the very first click emits `visible: false` -> hidePanel() removes it.
        const events = recordVisibilityEvents(store, "p");
        store.setPanelVisibility("p", false);
        expect(events).toEqual([false]);
        expect(store.getPanelVisibility().p).toBe(false);
    });
});

describe("UIStore editor group splitting", () => {
    function groupCount(store: UIStore): number {
        const walk = (layout: ReturnType<UIStore["getEditorLayout"]>): number =>
            "tabs" in layout ? 1 : walk(layout.first) + walk(layout.second);
        return walk(store.getEditorLayout());
    }

    it("refuses to split a group with a single tab, which would leave an empty pane", () => {
        const store = new UIStore();
        store.openEditorTabInGroup(tab("a"));

        expect(store.splitEditorGroup("main", "horizontal")).toBe(false);
        expect(groupCount(store)).toBe(1);
        expect(mainGroup(store).tabs.map(t => t.id)).toEqual(["a"]);
    });

    it("refuses to split an empty group", () => {
        const store = new UIStore();
        expect(store.splitEditorGroup("main", "horizontal")).toBe(false);
        expect(groupCount(store)).toBe(1);
    });

    it("moves the active tab into a new group beside it, leaving the rest behind", () => {
        const store = new UIStore();
        store.openEditorTabInGroup(tab("a"));
        store.openEditorTabInGroup(tab("b"));
        store.setActiveEditorTabInGroup("b", "main");

        expect(store.splitEditorGroup("main", "horizontal")).toBe(true);

        const layout = store.getEditorLayout();
        if ("tabs" in layout) {
            throw new Error("Expected a split layout");
        }
        expect(layout.direction).toBe("horizontal");
        expect("tabs" in layout.first && layout.first.tabs.map(t => t.id)).toEqual(["a"]);
        expect("tabs" in layout.second && layout.second.tabs.map(t => t.id)).toEqual(["b"]);
    });

    it("splits the named tab rather than the focused one when given an id", () => {
        const store = new UIStore();
        store.openEditorTabInGroup(tab("a"));
        store.openEditorTabInGroup(tab("b"));
        store.setActiveEditorTabInGroup("b", "main");

        expect(store.splitEditorGroup("main", "vertical", "a")).toBe(true);

        const layout = store.getEditorLayout();
        if ("tabs" in layout) {
            throw new Error("Expected a split layout");
        }
        expect("tabs" in layout.second && layout.second.tabs.map(t => t.id)).toEqual(["a"]);
    });

    it("merges every other group's tabs back instead of discarding them", () => {
        const store = new UIStore();
        store.openEditorTabInGroup(tab("a"));
        store.openEditorTabInGroup(tab("b"));
        store.splitEditorGroup("main", "horizontal");

        expect(store.closeOtherEditorGroups("main")).toBe(true);
        expect(groupCount(store)).toBe(1);
        expect(mainGroup(store).tabs.map(t => t.id).sort()).toEqual(["a", "b"]);
    });
});
