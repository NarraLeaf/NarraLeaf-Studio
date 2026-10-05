import { describe, expect, it } from "vitest";
import type { ReactFlowState } from "@xyflow/react";
import { frameBlueprintNode } from "./blueprintFraming";

type Card = { x: number; y: number; width?: number; height?: number };

/** The parts of React Flow's state framing reads, for a 1000x600 pane holding `cards`. */
function canvas(cards: Record<string, Card>, pane = { width: 1000, height: 600 }) {
    const nodeLookup = new Map(
        Object.entries(cards).map(([id, card]) => [
            id,
            {
                id,
                measured: { width: card.width, height: card.height },
                internals: { positionAbsolute: { x: card.x, y: card.y } },
            },
        ]),
    );
    return {
        nodeLookup,
        width: pane.width,
        height: pane.height,
        minZoom: 0.1,
        maxZoom: 2,
        domNode: null,
    } as unknown as Pick<ReactFlowState, "nodeLookup" | "width" | "height" | "minZoom" | "maxZoom" | "domNode">;
}

/** Where a card lands on screen under `viewport`. */
function onScreen(card: Required<Card>, viewport: { x: number; y: number; zoom: number }) {
    const left = card.x * viewport.zoom + viewport.x;
    const top = card.y * viewport.zoom + viewport.y;
    return { left, top, right: left + card.width * viewport.zoom, bottom: top + card.height * viewport.zoom };
}

describe("frameBlueprintNode", () => {
    // A card far to the right of a wide graph: where the writer list's Set Text sat when the
    // graph was fitted whole instead.
    const target = { x: 4200, y: 900, width: 200, height: 120 };
    const state = canvas({ start: { x: 0, y: 0, width: 200, height: 120 }, target });

    it("puts the node in the middle of the pane at the zoom the canvas already uses", () => {
        const viewport = frameBlueprintNode(state, "target", { x: -3000, y: 40, zoom: 0.8 });
        expect(viewport).not.toBeNull();
        expect(viewport!.zoom).toBe(0.8);
        const box = onScreen(target, viewport!);
        expect((box.left + box.right) / 2).toBeCloseTo(500);
        expect((box.top + box.bottom) / 2).toBeCloseTo(300);
    });

    it("keeps the whole card inside the pane", () => {
        for (const zoom of [0.3, 1, 2]) {
            const box = onScreen(target, frameBlueprintNode(state, "target", { x: 0, y: 0, zoom })!);
            expect(box.left).toBeGreaterThanOrEqual(0);
            expect(box.top).toBeGreaterThanOrEqual(0);
            expect(box.right).toBeLessThanOrEqual(1000);
            expect(box.bottom).toBeLessThanOrEqual(600);
        }
    });

    it("zooms out only when the card would not fit at the current zoom", () => {
        const huge = { x: 0, y: 0, width: 1600, height: 300 };
        const viewport = frameBlueprintNode(canvas({ huge }), "huge", { x: 0, y: 0, zoom: 1 });
        expect(viewport!.zoom).toBeLessThan(1);
        const box = onScreen(huge, viewport!);
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(1000);
    });

    it("waits for a card that has not been measured, one that is not on the canvas, and a pane not laid out", () => {
        const current = { x: 0, y: 0, zoom: 1 };
        expect(frameBlueprintNode(canvas({ fresh: { x: 10, y: 10 } }), "fresh", current)).toBeNull();
        expect(frameBlueprintNode(state, "gone", current)).toBeNull();
        expect(frameBlueprintNode(canvas({ target }, { width: 0, height: 0 }), "target", current)).toBeNull();
    });
});
