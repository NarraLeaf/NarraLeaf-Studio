/**
 * What a selection can be dragged and resized by.
 *
 * The case with a reason to guard is the element at the origin: a component's root in its own
 * editor, which the canvas is drawn at the size of. Offered every handle, a drag on its left or top
 * edge followed the pointer and then sprang back, because nothing may move that corner.
 */
import { describe, expect, it } from "vitest";
import { ORIGIN_RESIZE_DIRECTIONS, resolveTransformGestures } from "./TransformController";

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
});
