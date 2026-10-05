import { describe, expect, it } from "vitest";
import { isPlainSelectionPress, pressLandsOnClippedSelection } from "./clippedSelectionDrag";

type Box = { left: number; top: number; width: number; height: number };

/** An element as far as the rule reads one: a box on screen, and the nodes inside it. */
function fakeElement(box: Box, children: Element[] = []): Element {
    const element = {
        getBoundingClientRect: () => ({
            ...box,
            right: box.left + box.width,
            bottom: box.top + box.height,
            x: box.left,
            y: box.top,
        }),
        contains: (other: Element) => other === element || children.includes(other),
    };
    return element as unknown as Element;
}

const viewport = fakeElement({ left: 0, top: 0, width: 2000, height: 2000 });
const clippingContainer = fakeElement({ left: 100, top: 100, width: 400, height: 300 });

describe("pressLandsOnClippedSelection", () => {
    it("takes a press inside the frame of an element that is not drawn there", () => {
        // Dragged below its clipping container: nothing at the point but the canvas behind it.
        const title = fakeElement({ left: 120, top: 600, width: 200, height: 40 });
        expect(
            pressLandsOnClippedSelection({
                point: { x: 200, y: 620 },
                targets: [title],
                insideFrame: true,
                elementsAtPoint: [viewport],
            }),
        ).toBe(true);
    });

    it("leaves a press that already reaches the element to Moveable's own drag", () => {
        const label = fakeElement({ left: 0, top: 0, width: 10, height: 10 });
        const title = fakeElement({ left: 120, top: 120, width: 200, height: 40 }, [label]);
        for (const hit of [title, label]) {
            expect(
                pressLandsOnClippedSelection({
                    point: { x: 200, y: 140 },
                    targets: [title],
                    insideFrame: true,
                    elementsAtPoint: [hit, clippingContainer, viewport],
                }),
            ).toBe(false);
        }
    });

    it("keeps a press on something drawn over the element a press on that thing", () => {
        // Covered rather than clipped: the element is still listed under the point.
        const title = fakeElement({ left: 120, top: 120, width: 200, height: 40 });
        const button = fakeElement({ left: 150, top: 110, width: 100, height: 60 });
        expect(
            pressLandsOnClippedSelection({
                point: { x: 200, y: 140 },
                targets: [title],
                insideFrame: true,
                elementsAtPoint: [button, title, clippingContainer, viewport],
            }),
        ).toBe(false);
    });

    it("takes nothing outside the selection's frame", () => {
        // A rotated element's bounding box reaches past its frame at the corners.
        const rotated = fakeElement({ left: 120, top: 600, width: 200, height: 200 });
        expect(
            pressLandsOnClippedSelection({
                point: { x: 125, y: 605 },
                targets: [rotated],
                insideFrame: false,
                elementsAtPoint: [viewport],
            }),
        ).toBe(false);
    });

    it("keeps the gap between two selected elements a press on whatever is in the gap", () => {
        const left = fakeElement({ left: 100, top: 600, width: 100, height: 40 });
        const right = fakeElement({ left: 400, top: 600, width: 100, height: 40 });
        // Inside the frame drawn around both, inside neither of them.
        expect(
            pressLandsOnClippedSelection({
                point: { x: 300, y: 620 },
                targets: [left, right],
                insideFrame: true,
                elementsAtPoint: [viewport],
            }),
        ).toBe(false);
        expect(
            pressLandsOnClippedSelection({
                point: { x: 450, y: 620 },
                targets: [left, right],
                insideFrame: true,
                elementsAtPoint: [viewport],
            }),
        ).toBe(true);
    });

    it("takes nothing when nothing is selected", () => {
        expect(
            pressLandsOnClippedSelection({
                point: { x: 1, y: 1 },
                targets: [],
                insideFrame: true,
                elementsAtPoint: [viewport],
            }),
        ).toBe(false);
    });
});

describe("isPlainSelectionPress", () => {
    const plain = { button: 0, shiftKey: false, ctrlKey: false, metaKey: false };

    it("accepts a plain primary press", () => {
        expect(isPlainSelectionPress(plain)).toBe(true);
    });

    it("leaves presses that edit the selection, and other buttons, alone", () => {
        expect(isPlainSelectionPress({ ...plain, shiftKey: true })).toBe(false);
        expect(isPlainSelectionPress({ ...plain, ctrlKey: true })).toBe(false);
        expect(isPlainSelectionPress({ ...plain, metaKey: true })).toBe(false);
        expect(isPlainSelectionPress({ ...plain, button: 1 })).toBe(false);
        expect(isPlainSelectionPress({ ...plain, button: 2 })).toBe(false);
    });
});
