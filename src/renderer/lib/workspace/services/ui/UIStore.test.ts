import { describe, expect, it } from "vitest";
import type { EditorGroup, EditorTabDefinition } from "@/apps/workspace/registry/types";
import { EDITOR_SPLIT_RATIO_EPSILON, UIStore } from "./UIStore";
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

    it("leaves a defaultVisible:false panel unseeded - the trap behind the 'first click focuses' bug", () => {
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

    it("returns the source pane to its most-recently-shown tab when the active tab is split off", () => {
        const store = new UIStore();
        store.openEditorTabInGroup(tab("a"));
        store.openEditorTabInGroup(tab("b"));
        store.openEditorTabInGroup(tab("c"));
        // Recent order in main becomes c (active) -> a -> b; `a` is the most recent tab besides `c`.
        store.setActiveEditorTabInGroup("b", "main");
        store.setActiveEditorTabInGroup("a", "main");
        store.setActiveEditorTabInGroup("c", "main");

        expect(store.splitEditorGroup("main", "horizontal")).toBe(true);

        const layout = store.getEditorLayout();
        if ("tabs" in layout) {
            throw new Error("Expected a split layout");
        }
        const source = layout.first;
        if (!("tabs" in source)) {
            throw new Error("Expected the source pane to be a group");
        }
        expect(source.tabs.map(t => t.id)).toEqual(["a", "b"]);
        // Not "b", the last tab in the strip - the pane returns to the tab it last showed.
        expect(source.focus).toBe("a");
        expect("tabs" in layout.second && layout.second.tabs.map(t => t.id)).toEqual(["c"]);
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

    // --- drag-and-drop moves ---

    function splitLayout(store: UIStore) {
        const layout = store.getEditorLayout();
        if ("tabs" in layout) {
            throw new Error("Expected a split layout");
        }
        return layout;
    }

    function groupsOf(store: UIStore): EditorGroup[] {
        const walk = (layout: ReturnType<UIStore["getEditorLayout"]>): EditorGroup[] =>
            "tabs" in layout ? [layout] : [...walk(layout.first), ...walk(layout.second)];
        return walk(store.getEditorLayout());
    }

    function tabIds(node: ReturnType<UIStore["getEditorLayout"]>): string[] {
        if (!("tabs" in node)) {
            throw new Error("Expected a group");
        }
        return node.tabs.map(t => t.id);
    }

    it("moves a tab into another group and collapses the pane it emptied", () => {
        const store = new UIStore();
        store.openEditorTabInGroup(tab("a"));
        store.openEditorTabInGroup(tab("b"));
        store.splitEditorGroup("main", "horizontal");

        expect(store.moveEditorTabToGroup("a", "main", "group-1")).toBe(true);
        expect(groupCount(store)).toBe(1);
        expect(mainGroup(store).tabs.map(t => t.id)).toEqual(["b", "a"]);
        expect(mainGroup(store).focus).toBe("a");
    });

    it("reorders within a group, accounting for the dragged tab leaving its old slot", () => {
        const store = new UIStore();
        store.openEditorTabInGroup(tab("a"));
        store.openEditorTabInGroup(tab("b"));
        store.openEditorTabInGroup(tab("c"));

        // Index 3 is "after c" measured against [a, b, c] - with `a` removed that is index 2.
        expect(store.moveEditorTabToGroup("a", "main", "main", 3)).toBe(true);
        expect(mainGroup(store).tabs.map(t => t.id)).toEqual(["b", "c", "a"]);
    });

    it("treats a drop on either side of a tab's own slot as a no-op", () => {
        const store = new UIStore();
        store.openEditorTabInGroup(tab("a"));
        store.openEditorTabInGroup(tab("b"));
        store.openEditorTabInGroup(tab("c"));

        expect(store.moveEditorTabToGroup("b", "main", "main", 1)).toBe(false);
        expect(store.moveEditorTabToGroup("b", "main", "main", 2)).toBe(false);
        expect(mainGroup(store).tabs.map(t => t.id)).toEqual(["a", "b", "c"]);
    });

    it("splits a target group to receive a tab dragged in from elsewhere", () => {
        const store = new UIStore();
        store.openEditorTabInGroup(tab("a"));
        store.openEditorTabInGroup(tab("b"));
        store.openEditorTabInGroup(tab("c"));
        store.splitEditorGroup("main", "horizontal"); // main: [a, b] | group-1: [c]

        expect(store.moveEditorTabToNewSplit("c", "group-1", "main", "vertical", "before")).toBe(true);

        // group-1 emptied out and collapsed, leaving just the new vertical split above `main`.
        const layout = splitLayout(store);
        expect(layout.direction).toBe("vertical");
        expect(tabIds(layout.first)).toEqual(["c"]);
        expect(tabIds(layout.second)).toEqual(["a", "b"]);
    });

    it("refocuses the source pane on its most-recent tab after a tab is dragged out into a split", () => {
        const store = new UIStore();
        store.openEditorTabInGroup(tab("a"));
        store.openEditorTabInGroup(tab("b"));
        store.openEditorTabInGroup(tab("c"));
        // Recent order in main becomes c (active) -> a -> b; `a` is the most recent besides `c`.
        store.setActiveEditorTabInGroup("b", "main");
        store.setActiveEditorTabInGroup("a", "main");
        store.setActiveEditorTabInGroup("c", "main");

        // Drag the active tab out of main into a fresh pane beside it.
        expect(store.moveEditorTabToNewSplit("c", "main", "main", "horizontal", "after")).toBe(true);

        const main = groupsOf(store).find(g => g.id === "main");
        expect(main?.tabs.map(t => t.id)).toEqual(["a", "b"]);
        // The source pane returns to the last tab it showed, not the last tab in the strip ("b").
        expect(main?.focus).toBe("a");
    });

    it("refuses to split a group's only tab off itself, which would collapse straight back", () => {
        const store = new UIStore();
        store.openEditorTabInGroup(tab("a"));
        store.openEditorTabInGroup(tab("b"));
        store.splitEditorGroup("main", "horizontal"); // main: [a] | group-1: [b]

        expect(store.moveEditorTabToNewSplit("b", "group-1", "group-1", "horizontal", "after")).toBe(false);
        expect(groupCount(store)).toBe(2);
    });

    it("resizes a split and clamps a ratio that would collapse a pane", () => {
        const store = new UIStore();
        store.openEditorTabInGroup(tab("a"));
        store.openEditorTabInGroup(tab("b"));
        store.splitEditorGroup("main", "horizontal");
        const splitId = splitLayout(store).id;

        expect(store.setEditorSplitRatio(splitId, 0.75)).toBe(true);
        expect(splitLayout(store).ratio).toBe(0.75);

        // Only the degenerate-zero backstop, deliberately loose so the sash's px minimum binds
        // first at any window size.
        expect(store.setEditorSplitRatio(splitId, 0)).toBe(true);
        expect(splitLayout(store).ratio).toBe(EDITOR_SPLIT_RATIO_EPSILON);

        expect(store.setEditorSplitRatio(splitId, 5)).toBe(true);
        expect(splitLayout(store).ratio).toBe(1 - EDITOR_SPLIT_RATIO_EPSILON);
    });

    it("reports no change when a resize lands on the ratio already in effect", () => {
        const store = new UIStore();
        store.openEditorTabInGroup(tab("a"));
        store.openEditorTabInGroup(tab("b"));
        store.splitEditorGroup("main", "horizontal");
        const splitId = splitLayout(store).id;

        expect(store.setEditorSplitRatio(splitId, 0.5)).toBe(false);
        expect(store.setEditorSplitRatio("no-such-split", 0.3)).toBe(false);
        expect(store.setEditorSplitRatio(splitId, Number.NaN)).toBe(false);
    });

    it("installs a restored layout and rebuilds focus history from it", () => {
        const store = new UIStore();
        store.restoreEditorLayout({
            id: "split-1",
            direction: "vertical",
            ratio: 0.3,
            first: { id: "main", tabs: [tab("a")], focus: "a" },
            second: { id: "group-1", tabs: [tab("b"), tab("c")], focus: "c" },
        });

        expect(groupCount(store)).toBe(2);
        expect(splitLayout(store).ratio).toBe(0.3);
        expect(store.getEditorTabFocusHistoryKeys().sort()).toEqual(["group-1:c", "main:a"]);
    });

    it("drops empty panes out of a restored layout", () => {
        const store = new UIStore();
        store.restoreEditorLayout({
            id: "split-1",
            direction: "horizontal",
            ratio: 0.5,
            first: { id: "main", tabs: [], focus: null },
            second: { id: "group-1", tabs: [tab("b")], focus: "b" },
        });

        expect(groupCount(store)).toBe(1);
        expect(mainGroup(store).id).toBe("group-1");
    });

    it("routes a stale group id to a real group instead of dropping the tab", () => {
        const store = new UIStore();
        store.openEditorTabInGroup(tab("a"));
        store.openEditorTabInGroup(tab("b"));
        store.splitEditorGroup("main", "horizontal");

        // A caller holding the id of a pane that has since been closed must still land somewhere.
        store.openEditorTabInGroup(tab("c"), "group-does-not-exist");

        const allTabs = [...groupsOf(store).flatMap(g => g.tabs.map(t => t.id))];
        expect(allTabs).toContain("c");
    });

    it("opens an empty pane on the requested side for an incoming asset drop", () => {
        const store = new UIStore();
        store.openEditorTabInGroup(tab("a"));

        const newGroupId = store.splitEditorGroupForDrop("main", "vertical", "before");

        expect(newGroupId).toBe("group-1");
        const layout = splitLayout(store);
        expect(layout.direction).toBe("vertical");
        expect(tabIds(layout.first)).toEqual([]);
        expect(tabIds(layout.second)).toEqual(["a"]);
    });
});
