import { describe, expect, it } from "vitest";
import type { UISurface, UISurfaceKind } from "@shared/types/ui-editor/document";
import {
    moveSurfaceIdToGap,
    reorderSurfacesForDrop,
    surfaceGapAnchor,
    surfaceGapForCard,
    surfaceHalfFromPointer,
} from "./surfaceReorder";

function surface(id: string, kind: UISurfaceKind): UISurface {
    return { id, kind, name: id } as unknown as UISurface;
}

/** Pages and Game UIs interleaved, so a reorder that ignored the seam would be visible. */
const SURFACES: UISurface[] = [
    surface("p1", "appSurface"),
    surface("g1", "stageSurface"),
    surface("p2", "appSurface"),
    surface("p3", "appSurface"),
    surface("g2", "stageSurface"),
];

describe("surfaceGapForCard / surfaceHalfFromPointer", () => {
    it("makes the bottom of one card and the top of the next the same gap", () => {
        const rect = { top: 100, height: 96 };
        expect(surfaceHalfFromPointer(140, rect)).toBe("top");
        expect(surfaceHalfFromPointer(180, rect)).toBe("bottom");
        expect(surfaceGapForCard(0, "bottom")).toBe(1);
        expect(surfaceGapForCard(1, "top")).toBe(1);
    });
});

describe("surfaceGapAnchor", () => {
    it("draws every gap in exactly one place", () => {
        expect(surfaceGapAnchor(3, 0)).toEqual({ cardIndex: 0, edge: "before" });
        expect(surfaceGapAnchor(3, 2)).toEqual({ cardIndex: 2, edge: "before" });
        expect(surfaceGapAnchor(3, 3)).toEqual({ cardIndex: 2, edge: "after" });
        expect(surfaceGapAnchor(3, 4)).toBeNull();
        expect(surfaceGapAnchor(0, 0)).toBeNull();
    });
});

describe("moveSurfaceIdToGap", () => {
    it("moves a card to the gap it was dropped in", () => {
        expect(moveSurfaceIdToGap(["p1", "p2", "p3"], "p3", 0)).toEqual(["p3", "p1", "p2"]);
        expect(moveSurfaceIdToGap(["p1", "p2", "p3"], "p1", 3)).toEqual(["p2", "p3", "p1"]);
    });

    it("reads the anchor off the list with the dragged card taken out", () => {
        // Gap 2 is above p3. Moving p1 there lands it between p2 and p3, not after p3.
        expect(moveSurfaceIdToGap(["p1", "p2", "p3"], "p1", 2)).toEqual(["p2", "p1", "p3"]);
    });

    it("refuses the two gaps the card already sits between", () => {
        expect(moveSurfaceIdToGap(["p1", "p2", "p3"], "p2", 1)).toBeNull();
        expect(moveSurfaceIdToGap(["p1", "p2", "p3"], "p2", 2)).toBeNull();
    });

    it("refuses a card the list does not show and a gap off the end", () => {
        expect(moveSurfaceIdToGap(["p1", "p2"], "g1", 0)).toBeNull();
        expect(moveSurfaceIdToGap(["p1", "p2"], "p1", 3)).toBeNull();
    });
});

describe("reorderSurfacesForDrop", () => {
    it("moves a page and leaves the Game UIs where they were", () => {
        // Pages are p1, p2, p3; gap 0 is above p1.
        expect(reorderSurfacesForDrop(SURFACES, "appSurface", "p3", 0))
            .toEqual(["p3", "g1", "p1", "p2", "g2"]);
    });

    it("appends past the last card of its own kind", () => {
        expect(reorderSurfacesForDrop(SURFACES, "appSurface", "p1", 3))
            .toEqual(["p2", "g1", "p3", "p1", "g2"]);
    });

    it("reorders game UIs the same way, without touching the pages", () => {
        expect(reorderSurfacesForDrop(SURFACES, "stageSurface", "g2", 0))
            .toEqual(["p1", "g2", "p2", "p3", "g1"]);
    });

    it("refuses a drop that changes nothing", () => {
        expect(reorderSurfacesForDrop(SURFACES, "appSurface", "p2", 1)).toBeNull();
        expect(reorderSurfacesForDrop(SURFACES, "appSurface", "p2", 2)).toBeNull();
    });
});
