import { describe, expect, it } from "vitest";
import type { UISurface, UISurfaceKind } from "@shared/types/ui-editor/document";
import { moveSurfaceIdWithinKind, reorderSurfacesForDrop, surfaceEdgeFromPointer } from "./surfaceReorder";

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

describe("surfaceEdgeFromPointer", () => {
    it("splits a card at its midpoint", () => {
        expect(surfaceEdgeFromPointer(140, { top: 100, height: 96 })).toBe("before");
        expect(surfaceEdgeFromPointer(180, { top: 100, height: 96 })).toBe("after");
    });
});

describe("reorderSurfacesForDrop", () => {
    it("moves a page and leaves the Game UIs where they were", () => {
        expect(reorderSurfacesForDrop(SURFACES, "appSurface", "p3", "p1", "before"))
            .toEqual(["p3", "g1", "p1", "p2", "g2"]);
    });

    it("reads the anchor off the list with the dragged card taken out", () => {
        expect(reorderSurfacesForDrop(SURFACES, "appSurface", "p1", "p2", "after"))
            .toEqual(["p2", "g1", "p1", "p3", "g2"]);
    });

    it("appends past the last card of its own kind", () => {
        expect(reorderSurfacesForDrop(SURFACES, "appSurface", "p1", "p3", "after"))
            .toEqual(["p2", "g1", "p3", "p1", "g2"]);
    });

    it("reorders game UIs the same way", () => {
        expect(reorderSurfacesForDrop(SURFACES, "stageSurface", "g2", "g1", "before"))
            .toEqual(["p1", "g2", "p2", "p3", "g1"]);
    });

    it("refuses a drop on the card's own row and on the gaps either side of it", () => {
        expect(reorderSurfacesForDrop(SURFACES, "appSurface", "p2", "p2", "before")).toBeNull();
        expect(reorderSurfacesForDrop(SURFACES, "appSurface", "p2", "p1", "after")).toBeNull();
        expect(reorderSurfacesForDrop(SURFACES, "appSurface", "p2", "p3", "before")).toBeNull();
    });

    it("refuses an anchor of the other kind, which the filtered list never shows", () => {
        expect(reorderSurfacesForDrop(SURFACES, "appSurface", "p1", "g1", "after")).toBeNull();
    });
});

describe("moveSurfaceIdWithinKind", () => {
    it("is the reorder the list itself asks, over just the cards it draws", () => {
        expect(moveSurfaceIdWithinKind(["p1", "p2", "p3"], "p3", "p1", "before")).toEqual(["p3", "p1", "p2"]);
        expect(moveSurfaceIdWithinKind(["p1", "p2", "p3"], "p1", "p2", "after")).toEqual(["p2", "p1", "p3"]);
        expect(moveSurfaceIdWithinKind(["p1", "p2", "p3"], "p2", "p1", "after")).toBeNull();
        expect(moveSurfaceIdWithinKind(["p1", "p2", "p3"], "p2", "g1", "after")).toBeNull();
    });
});
