// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { localPointerPoint, pointerPayloadFor, readElementPointerPositions } from "./elementPointerPosition";

/** A wrapper drawn at `box` on screen and laid out at `width` x `height` design pixels. */
function wrapper(
    elementId: string | null,
    box: { left: number; top: number; width: number; height: number },
    layout?: { width: number; height: number },
): HTMLDivElement {
    const node = document.createElement("div");
    if (elementId) {
        node.setAttribute("data-ui-element-id", elementId);
    }
    node.getBoundingClientRect = () => ({ ...box, x: box.left, y: box.top, right: box.left + box.width, bottom: box.top + box.height, toJSON: () => box }) as DOMRect;
    Object.defineProperty(node, "offsetWidth", { value: layout?.width ?? box.width });
    Object.defineProperty(node, "offsetHeight", { value: layout?.height ?? box.height });
    return node;
}

describe("readElementPointerPositions", () => {
    it("reads one press in the box of every element around the one that was hit, up to its surface", () => {
        // The page is drawn at half size, so every box on screen is half its authored size.
        const outside = wrapper("page-frame", { left: 0, top: 0, width: 1000, height: 1000 });
        const shell = wrapper(null, { left: 100, top: 100, width: 800, height: 450 });
        shell.setAttribute("data-ui-surface-id", "page");
        const panel = wrapper("panel", { left: 100, top: 100, width: 400, height: 250 }, { width: 800, height: 500 });
        const decoration = document.createElement("div");
        const button = wrapper("button", { left: 300, top: 225, width: 150, height: 100 }, { width: 300, height: 200 });
        outside.append(shell);
        shell.append(panel);
        panel.append(decoration);
        decoration.append(button);

        const positions = readElementPointerPositions(button, 375, 275);

        expect(positions("button")).toEqual({ x: 150, y: 100 });
        expect(positions("panel")).toEqual({ x: 550, y: 350 });
        // Past the surface the press is no longer this surface's elements' business.
        expect(positions("page-frame")).toBeNull();
    });

    it("takes the nearest drawing of an element, which is the one the press is in", () => {
        const shell = wrapper(null, { left: 0, top: 0, width: 500, height: 500 });
        shell.setAttribute("data-ui-surface-id", "page");
        const cardA = wrapper("card-root", { left: 0, top: 0, width: 500, height: 500 });
        const cardB = wrapper("card-root", { left: 200, top: 200, width: 100, height: 100 });
        const label = wrapper("label", { left: 210, top: 210, width: 50, height: 50 });
        shell.append(cardA);
        cardA.append(cardB);
        cardB.append(label);

        expect(readElementPointerPositions(label, 250, 250)("card-root")).toEqual({ x: 50, y: 50 });
    });
});

describe("localPointerPoint", () => {
    it("undoes the scale a box is drawn at", () => {
        expect(localPointerPoint({ left: 10, top: 10, width: 50, height: 25 }, 200, 100, 35, 20)).toEqual({ x: 100, y: 40 });
    });
});

describe("pointerPayloadFor", () => {
    const positions = (elementId: string) => (elementId === "panel" ? { x: 7, y: 8 } : null);

    it("moves x and y into the element's box and keeps the rest of the payload", () => {
        expect(pointerPayloadFor({ x: 1, y: 2, button: 0 }, "panel", positions)).toEqual({ x: 7, y: 8, button: 0 });
    });

    it("leaves a payload alone when there is no point for the element, or no point in the payload", () => {
        expect(pointerPayloadFor({ x: 1, y: 2 }, "page", positions)).toEqual({ x: 1, y: 2 });
        expect(pointerPayloadFor({ button: 0 }, "panel", positions)).toEqual({ button: 0 });
        expect(pointerPayloadFor({ x: 1, y: 2 }, "panel", undefined)).toEqual({ x: 1, y: 2 });
    });
});
