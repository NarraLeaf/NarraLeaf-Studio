import { describe, expect, it } from "vitest";
import {
    closableOtherTabIds,
    closableTabIds,
    closableTabIdsToRight,
    collectEditorGroups,
    findActiveEditorTarget,
} from "./editorCommandsModel";
import type { EditorGroup, EditorLayout, EditorTabDefinition } from "../../registry/types";
import { FocusArea } from "@/lib/workspace/services/ui/types";

const Dummy = () => null;

function tab(id: string, closable = true): EditorTabDefinition {
    return { id, title: id, component: Dummy, closable };
}

function group(id: string, tabs: EditorTabDefinition[], focus: string | null): EditorGroup {
    return { id, tabs, focus };
}

describe("collectEditorGroups", () => {
    it("returns a single group unchanged", () => {
        const layout = group("main", [tab("a")], "a");
        expect(collectEditorGroups(layout).map(g => g.id)).toEqual(["main"]);
    });

    it("flattens splits first-before-second", () => {
        const layout: EditorLayout = {
            id: "split",
            direction: "horizontal",
            ratio: 0.5,
            first: group("left", [tab("a")], "a"),
            second: group("right", [tab("b")], "b"),
        };
        expect(collectEditorGroups(layout).map(g => g.id)).toEqual(["left", "right"]);
    });
});

describe("findActiveEditorTarget", () => {
    it("targets the tab named by editor-body focus", () => {
        const layout = group("main", [tab("a"), tab("b"), tab("c")], "a");
        const target = findActiveEditorTarget(layout, { area: FocusArea.Editor, targetId: "b" });
        expect(target).toMatchObject({ index: 1 });
        expect(target?.tab.id).toBe("b");
    });

    it("targets the focused tab of the group named by tab-strip focus", () => {
        const layout: EditorLayout = {
            id: "split",
            direction: "vertical",
            ratio: 0.5,
            first: group("left", [tab("a")], "a"),
            second: group("right", [tab("b"), tab("c")], "c"),
        };
        const target = findActiveEditorTarget(layout, { area: FocusArea.EditorTabs, targetId: "right" });
        expect(target?.tab.id).toBe("c");
        expect(target?.group.id).toBe("right");
    });

    it("falls back to the first group's focused tab when focus is elsewhere", () => {
        const layout = group("main", [tab("a"), tab("b")], "b");
        const target = findActiveEditorTarget(layout, { area: FocusArea.LeftPanel, targetId: "assets" });
        expect(target?.tab.id).toBe("b");
    });

    it("falls back to the first tab when no group has focus", () => {
        const layout = group("main", [tab("a"), tab("b")], null);
        const target = findActiveEditorTarget(layout, null);
        expect(target?.tab.id).toBe("a");
    });

    it("returns null when there are no tabs", () => {
        const layout = group("main", [], null);
        expect(findActiveEditorTarget(layout, null)).toBeNull();
    });
});

describe("close-set helpers", () => {
    const g = group("main", [tab("a"), tab("pinned", false), tab("c"), tab("d")], "a");

    it("closableTabIds omits pinned tabs", () => {
        expect(closableTabIds(g.tabs)).toEqual(["a", "c", "d"]);
    });

    it("closableOtherTabIds omits the target and pinned tabs", () => {
        // target index 0 ("a"); others are pinned/c/d → closable c,d
        expect(closableOtherTabIds(g, 0)).toEqual(["c", "d"]);
    });

    it("closableTabIdsToRight takes only closable tabs after the index", () => {
        expect(closableTabIdsToRight(g, 0)).toEqual(["c", "d"]);
        expect(closableTabIdsToRight(g, 2)).toEqual(["d"]);
    });
});
