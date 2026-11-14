// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResizableHandle } from "./ResizableHandle";

afterEach(cleanup);

describe("ResizableHandle", () => {
    it("ends a detached-window drag when that window loses focus", () => {
        const frame = document.createElement("iframe");
        document.body.appendChild(frame);
        const hostDocument = frame.contentDocument!;
        const hostWindow = frame.contentWindow!;
        const onResize = vi.fn(() => 0);
        const onDragEnd = vi.fn();
        const { getByRole, unmount } = render(
            <ResizableHandle direction="horizontal" onResize={onResize} onDragEnd={onDragEnd} />,
            { container: hostDocument.body },
        );

        fireEvent.mouseDown(getByRole("separator"), { button: 0, clientX: 20 });
        fireEvent.mouseMove(hostDocument, { buttons: 1, clientX: 30 });
        expect(onResize).toHaveBeenCalledWith(10);
        fireEvent.blur(window);
        expect(onDragEnd).not.toHaveBeenCalled();

        act(() => {
            fireEvent.blur(hostWindow);
            fireEvent.mouseUp(hostDocument, { button: 0 });
        });
        expect(onDragEnd).toHaveBeenCalledTimes(1);
        fireEvent.mouseMove(hostDocument, { buttons: 1, clientX: 40 });
        expect(onResize).toHaveBeenCalledTimes(1);
        unmount();
        frame.remove();
    });
});
