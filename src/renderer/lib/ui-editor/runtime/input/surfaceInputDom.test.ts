// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readPointerInputGesture } from "./pointerInputGesture";
import { handOffInputToLaneBehind } from "./surfaceInputDom";

afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
});

describe("handOffInputToLaneBehind", () => {
    it("preserves the device of a tap handed to another surface", () => {
        class TestPointerEvent extends MouseEvent {
            readonly pointerType: string;

            constructor(type: string, init: MouseEventInit & { pointerType?: string } = {}) {
                super(type, init);
                this.pointerType = init.pointerType ?? "";
            }
        }
        vi.stubGlobal("PointerEvent", TestPointerEvent);
        const front = document.createElement("div");
        const behind = document.createElement("div");
        document.body.append(front, behind);
        const received: ReturnType<typeof readPointerInputGesture>[] = [];
        behind.addEventListener("click", event => received.push(readPointerInputGesture(event)));
        const original = Object.getOwnPropertyDescriptor(document, "elementsFromPoint");
        Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: () => [front, behind] });
        try {
            const tap = new TestPointerEvent("click", { bubbles: true, clientX: 10, clientY: 20, pointerType: "touch" });
            expect(handOffInputToLaneBehind({ event: tap, surfaceRoot: front })).toBe(true);
            expect(received).toEqual([{ gesture: "click", device: "touch" }]);
        } finally {
            if (original) {
                Object.defineProperty(document, "elementsFromPoint", original);
            } else {
                delete (document as { elementsFromPoint?: unknown }).elementsFromPoint;
            }
        }
    });
});
