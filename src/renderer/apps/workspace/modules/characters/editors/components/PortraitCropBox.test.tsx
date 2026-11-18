// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PortraitCropBox } from "./PortraitCropBox";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("portrait framing", () => {
    it("commits one crop when a drag ends in StrictMode", () => {
        vi.stubGlobal("PointerEvent", MouseEvent);
        vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
        vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(200);
        vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(200);
        const onCommit = vi.fn();
        const { container } = render(
            <React.StrictMode>
                <PortraitCropBox natural={{ width: 200, height: 200 }} value={{ x: 0.2, y: 0.2, w: 0.4, h: 0.4 }} title="crop" onCommit={onCommit} />
            </React.StrictMode>,
        );
        const box = container.querySelector('[data-tip="crop"]')!;
        fireEvent.pointerDown(box, { clientX: 50, clientY: 50 });
        fireEvent.pointerMove(window, { clientX: 70, clientY: 60 });
        fireEvent.pointerUp(window);
        expect(onCommit).toHaveBeenCalledTimes(1);
        expect(onCommit).toHaveBeenCalledWith({ x: 0.3, y: 0.25, w: 0.4, h: 0.4 });
    });

    it("keeps the crop inside an image narrower than the minimum handle size", () => {
        vi.stubGlobal("PointerEvent", MouseEvent);
        vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
        vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(20);
        vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(40);
        const onCommit = vi.fn();
        const { container } = render(
            <PortraitCropBox natural={{ width: 100, height: 200 }} value={{ x: 0.2, y: 0.2, w: 0.4, h: 0.2 }} title="crop" onCommit={onCommit} />,
        );
        const box = container.querySelector('[data-tip="crop"]')!;
        fireEvent.pointerDown(box, { clientX: 5, clientY: 10 });
        fireEvent.pointerMove(window, { clientX: 10, clientY: 15 });
        fireEvent.pointerUp(window);
        expect(onCommit).toHaveBeenCalledWith({ x: 0, y: 0.325, w: 1, h: 0.5 });
    });
});
