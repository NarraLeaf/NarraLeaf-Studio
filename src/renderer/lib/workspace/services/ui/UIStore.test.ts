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
