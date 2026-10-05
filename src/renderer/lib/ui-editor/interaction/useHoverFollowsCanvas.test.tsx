// @vitest-environment jsdom
import React, { useRef } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UIElement } from "@shared/types/ui-editor/document";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import {
    WidgetRuntimeScopeProvider,
    WidgetRuntimeStateProvider,
} from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { EditorNodeWrapper } from "@/lib/ui-editor/runtime/EditorNodeWrapper";
import type { ViewportTransform } from "../geometry";
import { useHoverFollowsCanvas } from "./useHoverFollowsCanvas";

const layout = { x: 0, y: 0, width: 100, height: 40 };
const panel: UIElement = { id: "panel", type: "nl.container", parentId: null, childrenIds: ["start", "art"], layout };
const start: UIElement = { id: "start", type: "nl.button", parentId: "panel", childrenIds: [], layout };
const art: UIElement = { id: "art", type: "nl.image", parentId: "panel", childrenIds: [], layout };

const key = (id: string) => `scope\0${id}`;

let frames: Array<FrameRequestCallback | null> = [];
let elementFromPoint: ReturnType<typeof vi.fn>;
const originalFrame = window.requestAnimationFrame;
const originalCancel = window.cancelAnimationFrame;

beforeEach(() => {
    frames = [];
    window.requestAnimationFrame = (callback: FrameRequestCallback) => frames.push(callback);
    window.cancelAnimationFrame = (id: number) => {
        frames[id - 1] = null;
    };
    elementFromPoint = vi.fn(() => null);
    (document as { elementFromPoint?: unknown }).elementFromPoint = elementFromPoint;
});

afterEach(() => {
    cleanup();
    window.requestAnimationFrame = originalFrame;
    window.cancelAnimationFrame = originalCancel;
    delete (document as { elementFromPoint?: unknown }).elementFromPoint;
});

function flushFrames(): void {
    act(() => {
        const pending = frames;
        frames = [];
        for (const frame of pending) {
            frame?.(0);
        }
    });
}

function Canvas(props: {
    store: WidgetRuntimeStateStore;
    viewport: ViewportTransform;
    revision: number;
    withStart?: boolean;
}) {
    const ref = useRef<HTMLDivElement | null>(null);
    useHoverFollowsCanvas(ref, props.store, props.viewport, props.revision);
    return (
        <div ref={ref} data-testid="viewport">
            <WidgetRuntimeStateProvider externalStore={props.store}>
                <WidgetRuntimeScopeProvider runtimeScopeId="scope">
                    <EditorNodeWrapper element={panel} layout={layout} interactive>
                        {props.withStart === false ? null : (
                            <EditorNodeWrapper element={start} layout={layout} interactive />
                        )}
                        <EditorNodeWrapper element={art} layout={layout} interactive />
                    </EditorNodeWrapper>
                </WidgetRuntimeScopeProvider>
            </WidgetRuntimeStateProvider>
        </div>
    );
}

function nodeOf(container: HTMLElement, id: string): HTMLElement {
    const node = container.querySelector<HTMLElement>(`[data-ui-element-id="${id}"]`);
    if (!node) {
        throw new Error(`nothing drawn for ${id}`);
    }
    return node;
}

function pointerAt(root: HTMLElement, type: string, x: number, y: number, pointerType = "mouse"): void {
    const event = new MouseEvent(type, { clientX: x, clientY: y, bubbles: type !== "pointerleave" });
    Object.defineProperty(event, "pointerType", { value: pointerType });
    root.dispatchEvent(event);
}

function hovered(store: WidgetRuntimeStateStore): string[] {
    return [...store.getSnapshot().hoverTargetIds].map(id => id.split("\0")[1]).sort();
}

const at = (offsetX: number): ViewportTransform => ({ offsetX, offsetY: 0, scale: 1 });

describe("hover on a canvas that moves under a still pointer", () => {
    it("moves the hovered look to what a pan put under the pointer", () => {
        const store = new WidgetRuntimeStateStore();
        const view = render(<Canvas store={store} viewport={at(0)} revision={1} />);
        flushFrames();
        const root = view.getByTestId("viewport");
        pointerAt(root, "pointermove", 40, 20);
        store.setHoverTarget(key("panel"));
        store.setHoverTarget(key("start"));

        elementFromPoint.mockReturnValue(nodeOf(view.container, "art"));
        view.rerender(<Canvas store={store} viewport={at(-120)} revision={1} />);
        expect(hovered(store)).toEqual(["panel", "start"]);
        flushFrames();

        expect(elementFromPoint).toHaveBeenCalledWith(40, 20);
        expect(hovered(store)).toEqual(["art", "panel"]);
    });

    it("does not bring an element back from an undo still hovered when the pointer is elsewhere", () => {
        const store = new WidgetRuntimeStateStore();
        const view = render(<Canvas store={store} viewport={at(0)} revision={1} />);
        flushFrames();
        const root = view.getByTestId("viewport");
        pointerAt(root, "pointermove", 40, 20);
        store.setHoverTarget(key("panel"));
        store.setHoverTarget(key("start"));

        // Deleted while hovered: no leave ever reaches a node that is gone.
        elementFromPoint.mockReturnValue(nodeOf(view.container, "art"));
        view.rerender(<Canvas store={store} viewport={at(0)} revision={2} withStart={false} />);
        flushFrames();
        // The pointer has gone off the page since; then the undo brings the element back.
        elementFromPoint.mockReturnValue(root);
        view.rerender(<Canvas store={store} viewport={at(0)} revision={3} />);
        flushFrames();

        expect(hovered(store)).toEqual([]);
    });

    it("leaves hover alone when the pointer is not over the canvas, or is a finger", () => {
        const store = new WidgetRuntimeStateStore();
        const view = render(<Canvas store={store} viewport={at(0)} revision={1} />);
        flushFrames();
        const root = view.getByTestId("viewport");

        pointerAt(root, "pointermove", 40, 20);
        pointerAt(root, "pointerleave", 400, 20);
        view.rerender(<Canvas store={store} viewport={at(-120)} revision={1} />);
        flushFrames();

        pointerAt(root, "pointerdown", 40, 20, "touch");
        view.rerender(<Canvas store={store} viewport={at(-240)} revision={1} />);
        flushFrames();

        expect(elementFromPoint).not.toHaveBeenCalled();
    });

    it("looks once per frame however many times the viewport moved in it", () => {
        const store = new WidgetRuntimeStateStore();
        const view = render(<Canvas store={store} viewport={at(0)} revision={1} />);
        flushFrames();
        pointerAt(view.getByTestId("viewport"), "pointermove", 40, 20);

        view.rerender(<Canvas store={store} viewport={at(-10)} revision={1} />);
        view.rerender(<Canvas store={store} viewport={at(-20)} revision={1} />);
        view.rerender(<Canvas store={store} viewport={at(-30)} revision={1} />);
        flushFrames();

        expect(elementFromPoint).toHaveBeenCalledTimes(1);
    });
});
