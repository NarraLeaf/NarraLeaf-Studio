/**
 * What a selection can be dragged and resized by.
 *
 * The case with a reason to guard is the element at the origin: a component's root in its own
 * editor, which the canvas is drawn at the size of. Offered every handle, a drag on its left or top
 * edge followed the pointer and then sprang back, because nothing may move that corner.
 */
import { describe, expect, it } from "vitest";
import {
    COMPACT_HANDLES_BELOW_PX,
    CORNER_RESIZE_DIRECTIONS,
    ORIGIN_RESIZE_DIRECTIONS,
    SINGLE_HANDLE_BELOW_PX,
    SINGLE_RESIZE_DIRECTIONS,
    resolveTransformGestures,
} from "./TransformController";

const plain = { inlineTextEditing: false, placedByParent: false, holdsOrigin: false };

describe("resolveTransformGestures", () => {
    it("leaves an ordinary selection draggable with Moveable's own handles", () => {
        const gestures = resolveTransformGestures(plain);

        expect(gestures.draggable).toBe(true);
        expect("renderDirections" in gestures).toBe(false);
    });

    it("keeps the origin element where it is: no drag, and only the handles that keep its corner", () => {
        const gestures = resolveTransformGestures({ ...plain, holdsOrigin: true });

        expect(gestures.draggable).toBe(false);
        expect(gestures.renderDirections).toEqual(ORIGIN_RESIZE_DIRECTIONS);
        for (const direction of gestures.renderDirections ?? []) {
            expect(direction).not.toMatch(/[nw]/);
        }
    });

    it("does not drag what a parent places or text being typed into", () => {
        expect(resolveTransformGestures({ ...plain, placedByParent: true }).draggable).toBe(false);
        expect(resolveTransformGestures({ ...plain, inlineTextEditing: true }).draggable).toBe(false);
    });

    it("gives what a stack places only the handles that keep its corner", () => {
        expect(resolveTransformGestures({ ...plain, placedByParent: true }).renderDirections).toEqual(ORIGIN_RESIZE_DIRECTIONS);
    });

    it("leaves a small element room to be dragged: corners only, then a single corner", () => {
        const roomy = resolveTransformGestures({ ...plain, screenSize: { width: 200, height: COMPACT_HANDLES_BELOW_PX } });
        expect("renderDirections" in roomy).toBe(false);

        const small = resolveTransformGestures({ ...plain, screenSize: { width: 200, height: COMPACT_HANDLES_BELOW_PX - 1 } });
        expect(small.renderDirections).toEqual(CORNER_RESIZE_DIRECTIONS);
        expect(small.draggable).toBe(true);

        const tiny = resolveTransformGestures({ ...plain, screenSize: { width: SINGLE_HANDLE_BELOW_PX - 1, height: 200 } });
        expect(tiny.renderDirections).toEqual(SINGLE_RESIZE_DIRECTIONS);
    });

    it("measures a flipped box by its size, not its sign", () => {
        const flipped = resolveTransformGestures({ ...plain, screenSize: { width: -10, height: -10 } });
        expect(flipped.renderDirections).toEqual(SINGLE_RESIZE_DIRECTIONS);
    });

    it("keeps the origin element's corner when it is also small", () => {
        const small = resolveTransformGestures({ ...plain, holdsOrigin: true, screenSize: { width: 20, height: 20 } });
        expect(small.renderDirections).toEqual(["se"]);
    });
});
