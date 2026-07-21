import { describe, expect, it } from "vitest";
import {
    editorDropZonePreviewRect,
    editorDropZoneToSplit,
    resolveEditorDropZone,
    resolveTabInsertIndex,
} from "./editorDropZones";

const PANE = { left: 100, top: 50, width: 400, height: 200 };

describe("resolveEditorDropZone", () => {
    it("treats the middle of the pane as a plain tab drop", () => {
        expect(resolveEditorDropZone(PANE, 300, 150)).toBe("center");
    });

    it("picks the edge band the pointer is inside", () => {
        expect(resolveEditorDropZone(PANE, 110, 150)).toBe("left");
        expect(resolveEditorDropZone(PANE, 490, 150)).toBe("right");
        expect(resolveEditorDropZone(PANE, 300, 55)).toBe("top");
        expect(resolveEditorDropZone(PANE, 300, 245)).toBe("bottom");
    });

    it("picks the nearest edge when the pointer is in a corner", () => {
        // 10px from the left, 20px from the top: 2.5% vs 10% of the pane - left is nearer.
        expect(resolveEditorDropZone(PANE, 110, 70)).toBe("left");
        // 60px from the left (15%), 10px from the top (5%) - now the top edge wins.
        expect(resolveEditorDropZone(PANE, 160, 60)).toBe("top");
    });

    it("falls back to center for a degenerate rect rather than dividing by zero", () => {
        expect(resolveEditorDropZone({ left: 0, top: 0, width: 0, height: 0 }, 0, 0)).toBe("center");
    });
});

describe("editorDropZoneToSplit", () => {
    it("maps each edge to the split that puts the new pane on that side", () => {
        expect(editorDropZoneToSplit("left")).toEqual({ direction: "horizontal", side: "before" });
        expect(editorDropZoneToSplit("right")).toEqual({ direction: "horizontal", side: "after" });
        expect(editorDropZoneToSplit("top")).toEqual({ direction: "vertical", side: "before" });
        expect(editorDropZoneToSplit("bottom")).toEqual({ direction: "vertical", side: "after" });
    });

    it("asks for no split at the center", () => {
        expect(editorDropZoneToSplit("center")).toBeNull();
    });
});

describe("editorDropZonePreviewRect", () => {
    it("previews half the pane for an edge and the whole pane for the center", () => {
        expect(editorDropZonePreviewRect("right")).toEqual({
            left: "50%",
            top: "0%",
            width: "50%",
            height: "100%",
        });
        expect(editorDropZonePreviewRect("center")).toEqual({
            left: "0%",
            top: "0%",
            width: "100%",
            height: "100%",
        });
    });
});

describe("resolveTabInsertIndex", () => {
    const rects = [
        { left: 0, top: 0, width: 100, height: 36 },
        { left: 100, top: 0, width: 100, height: 36 },
        { left: 200, top: 0, width: 100, height: 36 },
    ];

    it("inserts before a tab while the pointer is on its leading half", () => {
        expect(resolveTabInsertIndex(rects, 10)).toBe(0);
        expect(resolveTabInsertIndex(rects, 49)).toBe(0);
        expect(resolveTabInsertIndex(rects, 120)).toBe(1);
    });

    it("inserts after a tab once the pointer passes its midpoint", () => {
        expect(resolveTabInsertIndex(rects, 51)).toBe(1);
        expect(resolveTabInsertIndex(rects, 260)).toBe(3);
    });

    it("appends when the strip is empty", () => {
        expect(resolveTabInsertIndex([], 42)).toBe(0);
    });
});
