import { describe, expect, it } from "vitest";
import type { EditorLayout, EditorTabDefinition } from "../../registry/types";
import {
    buildEditorQuickSwitchOrder,
    collectEditorQuickSwitchCandidates,
    collectFocusedEditorQuickSwitchKeys,
    getEditorQuickSwitchKey,
    pruneEditorQuickSwitchMru,
    recordEditorQuickSwitchMru,
} from "./editorQuickSwitchModel";

const DummyTab = () => null;

function tab(id: string, title: string = id): EditorTabDefinition {
    return {
        id,
        title,
        component: DummyTab,
    };
}

describe("editorQuickSwitchModel", () => {
    it("collects tabs from a single editor group", () => {
        const layout: EditorLayout = {
            id: "main",
            tabs: [tab("a"), tab("b")],
            focus: "b",
        };

        const result = collectEditorQuickSwitchCandidates(layout);

        expect(result.groupCount).toBe(1);
        expect(result.candidates.map(candidate => ({
            key: candidate.key,
            tabId: candidate.tabId,
            groupId: candidate.groupId,
            layoutIndex: candidate.layoutIndex,
        }))).toEqual([
            { key: "main:a", tabId: "a", groupId: "main", layoutIndex: 0 },
            { key: "main:b", tabId: "b", groupId: "main", layoutIndex: 1 },
        ]);
    });

    it("collects tabs and group ids from split layouts", () => {
        const layout: EditorLayout = {
            id: "split",
            direction: "horizontal",
            ratio: 0.5,
            first: {
                id: "left",
                tabs: [tab("a")],
                focus: "a",
            },
            second: {
                id: "right",
                tabs: [tab("b"), tab("c")],
                focus: "c",
            },
        };

        const result = collectEditorQuickSwitchCandidates(layout);

        expect(result.groupCount).toBe(2);
        expect(result.candidates.map(candidate => candidate.key)).toEqual([
            "left:a",
            "right:b",
            "right:c",
        ]);
        expect(collectFocusedEditorQuickSwitchKeys(layout)).toEqual(["left:a", "right:c"]);
    });

    it("orders candidates by active tab then MRU then visible layout order", () => {
        const layout: EditorLayout = {
            id: "main",
            tabs: [tab("a"), tab("b"), tab("c"), tab("d")],
            focus: "c",
        };

        const result = buildEditorQuickSwitchOrder(
            layout,
            ["main:b", "main:a"],
            getEditorQuickSwitchKey("main", "c")
        );

        expect(result.candidates.map(candidate => candidate.key)).toEqual([
            "main:c",
            "main:b",
            "main:a",
            "main:d",
        ]);
    });

    it("prunes closed and duplicate MRU entries", () => {
        const layout: EditorLayout = {
            id: "main",
            tabs: [tab("a"), tab("b")],
            focus: "a",
        };
        const { candidates } = collectEditorQuickSwitchCandidates(layout);

        expect(pruneEditorQuickSwitchMru(
            ["main:b", "main:missing", "main:a", "main:b"],
            candidates
        )).toEqual(["main:b", "main:a"]);
    });

    it("records a tab at the front of the MRU list", () => {
        const layout: EditorLayout = {
            id: "main",
            tabs: [tab("a"), tab("b"), tab("c")],
            focus: "a",
        };
        const { candidates } = collectEditorQuickSwitchCandidates(layout);

        expect(recordEditorQuickSwitchMru(
            ["main:b", "main:a"],
            "main:c",
            candidates
        )).toEqual(["main:c", "main:b", "main:a"]);
    });

    it("falls back to visible layout order when MRU is empty", () => {
        const layout: EditorLayout = {
            id: "main",
            tabs: [tab("a"), tab("b"), tab("c")],
            focus: "a",
        };

        const result = buildEditorQuickSwitchOrder(layout, [], null);

        expect(result.candidates.map(candidate => candidate.key)).toEqual([
            "main:a",
            "main:b",
            "main:c",
        ]);
    });
});
