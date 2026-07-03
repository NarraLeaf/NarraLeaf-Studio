import { describe, expect, it } from "vitest";
import type { EditorGroup, EditorTabDefinition } from "@/apps/workspace/registry/types";
import { UIStore } from "./UIStore";

const DummyTab = () => null;

function tab(id: string): EditorTabDefinition {
    return {
        id,
        title: id,
        component: DummyTab,
    };
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
