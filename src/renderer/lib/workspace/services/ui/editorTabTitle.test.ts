import { describe, expect, it } from "vitest";
import type { EditorGroup, EditorTabDefinition } from "@/apps/workspace/registry/types";
import type { UIService } from "../core/UIService";
import { UIStore } from "./UIStore";
import { syncEditorTabTitle } from "./editorTabTitle";

const DummyTab = () => null;

function tab(id: string, title = id): EditorTabDefinition {
    return { id, title, component: DummyTab };
}

/** Just enough of the service for the helper: it only ever asks for the store. */
function serviceFor(store: UIStore): UIService {
    return { getStore: () => store } as unknown as UIService;
}

function groups(store: UIStore): EditorGroup[] {
    const found: EditorGroup[] = [];
    const visit = (layout: ReturnType<UIStore["getEditorLayout"]>): void => {
        if ("tabs" in layout) {
            found.push(layout);
            return;
        }
        visit(layout.first);
        visit(layout.second);
    };
    visit(store.getEditorLayout());
    return found;
}

function titleOf(store: UIStore, tabId: string): string | undefined {
    for (const group of groups(store)) {
        const found = group.tabs.find(candidate => candidate.id === tabId);
        if (found) {
            return found.title;
        }
    }
    return undefined;
}

describe("syncEditorTabTitle", () => {
    it("re-titles a tab in the main group", () => {
        const store = new UIStore();
        store.openEditorTabInGroup(tab("asset:1", "old.png"));

        syncEditorTabTitle(serviceFor(store), "asset:1", "new.png");

        expect(titleOf(store, "asset:1")).toBe("new.png");
    });

    /**
     * The reason this helper exists at all: `EditorService.update` writes the flat legacy
     * `editorTabs` list, which nothing has populated since tabs moved into layout groups - so a tab
     * dragged into a second pane has to be found by walking the layout, not by assuming the active
     * group.
     */
    it("re-titles a tab that lives in a split group", () => {
        const store = new UIStore();
        store.openEditorTabInGroup(tab("asset:1", "old.png"));
        const secondId = store.splitEditorGroupForDrop("main", "horizontal", "after");
        expect(secondId).toBeTruthy();
        store.openEditorTabInGroup(tab("asset:2", "other.png"), secondId!);

        syncEditorTabTitle(serviceFor(store), "asset:2", "renamed.png");

        expect(titleOf(store, "asset:2")).toBe("renamed.png");
        expect(titleOf(store, "asset:1")).toBe("old.png");
    });

    it("does not move focus to the tab it re-titles", () => {
        const store = new UIStore();
        store.openEditorTabInGroup(tab("asset:1", "old.png"));
        store.openEditorTabInGroup(tab("asset:2", "other.png"));
        const focused = groups(store)[0].focus;
        expect(focused).toBe("asset:2");

        syncEditorTabTitle(serviceFor(store), "asset:1", "new.png");

        expect(groups(store)[0].focus).toBe("asset:2");
    });

    it("ignores an unknown tab and an empty title", () => {
        const store = new UIStore();
        store.openEditorTabInGroup(tab("asset:1", "old.png"));

        syncEditorTabTitle(serviceFor(store), "asset:missing", "new.png");
        syncEditorTabTitle(serviceFor(store), "asset:1", "");

        expect(titleOf(store, "asset:1")).toBe("old.png");
        expect(groups(store)[0].tabs).toHaveLength(1);
    });
});
