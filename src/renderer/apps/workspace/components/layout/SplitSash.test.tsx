// @vitest-environment jsdom
import React, { createRef } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SplitSash } from "./SplitSash";

afterEach(() => {
    cleanup();
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
});

function renderSash() {
    const containerRef = createRef<HTMLDivElement>();
    const onPreview = vi.fn();
    const onCommit = vi.fn();
    const view = render(
        <div ref={containerRef}>
            <SplitSash
                orientation="horizontal"
                ratio={0.5}
                containerRef={containerRef}
                onPreview={onPreview}
                onCommit={onCommit}
                dragging={false}
                label="Resize"
            />
        </div>,
    );
    const sash = view.getByRole("separator");
    sash.setPointerCapture = vi.fn();
    containerRef.current!.getBoundingClientRect = () => ({ left: 0, width: 400 } as DOMRect);
    sash.getBoundingClientRect = () => ({ left: 198, width: 4 } as DOMRect);
    return { ...view, sash, onPreview, onCommit };
}

function pointer(target: Element, type: string, clientX: number) {
    fireEvent(target, new MouseEvent(type, { bubbles: true, button: 0, clientX }));
}

describe("SplitSash drag ownership", () => {
    it("restores the document styles if the split disappears during a drag", () => {
        document.body.style.cursor = "wait";
        document.body.style.userSelect = "text";
        const { sash, unmount, onCommit } = renderSash();
        pointer(sash, "pointerdown", 200);
        expect(document.body.style.cursor).toBe("col-resize");
        expect(document.body.style.userSelect).toBe("none");

        unmount();

        expect(document.body.style.cursor).toBe("wait");
        expect(document.body.style.userSelect).toBe("text");
        expect(onCommit).not.toHaveBeenCalled();
    });

    it("commits the latest preview once if pointer capture is lost", () => {
        const { sash, onPreview, onCommit } = renderSash();
        pointer(sash, "pointerdown", 200);
        pointer(sash, "pointermove", 240);
        expect(onPreview).toHaveBeenLastCalledWith(0.6);

        fireEvent(sash, new Event("lostpointercapture", { bubbles: true }));
        expect(onCommit).toHaveBeenCalledTimes(1);
        expect(onCommit).toHaveBeenCalledWith(0.6);
        expect(document.body.style.cursor).toBe("");
        expect(document.body.style.userSelect).toBe("");

        pointer(sash, "pointerup", 240);
        expect(onCommit).toHaveBeenCalledTimes(1);
    });
});
