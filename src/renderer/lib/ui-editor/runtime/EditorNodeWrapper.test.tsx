// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UIElement } from "@shared/types/ui-editor/document";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import {
    WidgetRuntimeScopeProvider,
    WidgetRuntimeStateProvider,
} from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { EditorNodeWrapper, isElementHoveredByPointer } from "./EditorNodeWrapper";

afterEach(() => {
    cleanup();
});

const element: UIElement = {
    id: "image",
    type: "nl.image",
    parentId: null,
    childrenIds: [],
    layout: {
        x: 10,
        y: 20,
        width: 100,
        height: 50,
        opacity: 0.35,
    },
};

const KEY = "scope\0image";

function tree(store: WidgetRuntimeStateStore, layout = element.layout) {
    return (
        <WidgetRuntimeStateProvider externalStore={store}>
            <WidgetRuntimeScopeProvider runtimeScopeId="scope">
                <EditorNodeWrapper
                    element={element}
                    layout={layout}
                    interactive={false}
                />
            </WidgetRuntimeScopeProvider>
        </WidgetRuntimeStateProvider>
    );
}

function renderWrapper(store: WidgetRuntimeStateStore, layout = element.layout): string {
    return renderToStaticMarkup(tree(store, layout));
}

function mountWrapper(store: WidgetRuntimeStateStore, layout = element.layout) {
    const view = render(tree(store, layout));
    const node = view.container.querySelector<HTMLElement>(".ui-editor-node-preview");
    if (!node) {
        throw new Error("the wrapper drew no node");
    }
    return { view, node };
}

describe("EditorNodeWrapper", () => {
    it("detects the browser hover state from the mounted wrapper", () => {
        const element = {
            matches: vi.fn((selector: string) => selector === ":hover"),
        } as unknown as Element;

        expect(isElementHoveredByPointer(element)).toBe(true);
        expect(element.matches).toHaveBeenCalledWith(":hover");
    });

    it("treats unsupported hover selector checks as not hovered", () => {
        const element = {
            matches: () => {
                throw new Error("selector unsupported");
            },
        } as unknown as Element;

        expect(isElementHoveredByPointer(element)).toBe(false);
        expect(isElementHoveredByPointer(null)).toBe(false);
    });

    it("keeps authored opacity in static style when opacity is not motion-controlled", () => {
        expect(renderWrapper(new WidgetRuntimeStateStore())).toContain("opacity:0.35");
    });

    it("lets displayable opacity motion own opacity style", () => {
        const store = new WidgetRuntimeStateStore();
        store.setDisplayableMotion(KEY, {
            target: { opacity: [0, 1] },
            transition: { type: "tween", durationMs: 200 },
        });

        expect(renderWrapper(store)).not.toContain("opacity:0.35");
    });

    it("draws the persistent base offset through the pose's own transform", () => {
        const store = new WidgetRuntimeStateStore();
        store.setDisplayableBaseTransform(KEY, { offsetX: 24, offsetY: -12 });

        expect(renderWrapper(store)).toContain("transform:translateX(24px) translateY(-12px)");
    });

    it("draws static rotation in the pose's transform", () => {
        expect(renderWrapper(new WidgetRuntimeStateStore(), { ...element.layout, rotation: 15 })).toContain(
            "transform:rotate(15deg)",
        );
    });

    it("keeps plain widgets free of a transform until they carry a pose", () => {
        const markup = renderWrapper(new WidgetRuntimeStateStore());

        expect(markup).not.toContain("transform:");
        expect(markup).toContain("left:10px");
        expect(markup).toContain("top:20px");
    });
});

/**
 * The node is a plain `div` that React writes until something moves it; from then on a driver writes
 * the channels that move, and React must never write them again - one writer per channel, or the last
 * React render wins over a motion mid-flight. These hold that handover.
 */
describe("EditorNodeWrapper pointer state", () => {
    it("does not come back hovered or pressed after it stopped being drawn", () => {
        const store = new WidgetRuntimeStateStore();
        const interactiveTree = (drawn: boolean) => (
            <WidgetRuntimeStateProvider externalStore={store}>
                <WidgetRuntimeScopeProvider runtimeScopeId="scope">
                    {drawn ? <EditorNodeWrapper element={element} layout={element.layout} interactive /> : null}
                </WidgetRuntimeScopeProvider>
            </WidgetRuntimeStateProvider>
        );
        const view = render(interactiveTree(true));
        act(() => {
            store.setHoverTarget(KEY);
            store.setActivePointerTarget(KEY);
        });

        view.rerender(interactiveTree(false));
        view.rerender(interactiveTree(true));

        expect(store.getSignalsForElement(KEY, false)).toMatchObject({ hovered: false, active: false });
    });
});

describe("EditorNodeWrapper motion handover", () => {
    it("draws a motion's first frame in the commit that starts it", () => {
        const store = new WidgetRuntimeStateStore();
        const { node } = mountWrapper(store);
        expect(node.style.transform).toBe("");

        act(() => {
            store.setDisplayableMotion(KEY, {
                target: { x: [40, 80] },
                transition: { type: "tween", durationMs: 5000 },
            });
        });

        expect(node.style.transform).toBe("translateX(40px)");
    });

    it("never lets a later render write a channel the motion has taken", () => {
        const store = new WidgetRuntimeStateStore();
        const { view, node } = mountWrapper(store);
        act(() => {
            store.setDisplayableMotion(KEY, {
                target: { x: [40, 80], opacity: [0.2, 1] },
                transition: { type: "tween", durationMs: 5000 },
            });
        });
        expect(node.style.opacity).toBe("0.2");

        // A render for an unrelated reason, with a new authored opacity and a moved element.
        act(() => {
            view.rerender(tree(store, { ...element.layout, x: 30, opacity: 0.6 }));
        });

        expect(node.style.transform).toBe("translateX(40px)");
        expect(node.style.opacity).toBe("0.2");
        // Placement is not part of the motion, so the move lands.
        expect(node.style.left).toBe("30px");
    });

    it("keeps opacity with the motions once one has taken it, until the running one clears", () => {
        const store = new WidgetRuntimeStateStore();
        const { view, node } = mountWrapper(store);
        act(() => {
            store.setDisplayableMotion(KEY, {
                target: { opacity: [0.2, 1] },
                transition: { type: "tween", durationMs: 5000 },
            });
        });
        act(() => {
            store.clearDisplayableMotion(KEY);
        });
        expect(node.style.opacity).toBe("0.35");
        act(() => {
            store.setDisplayableMotion(KEY, {
                target: { x: [40, 80] },
                transition: { type: "tween", durationMs: 5000 },
            });
        });

        // The authored opacity changes mid-motion: React would write it, and the channel is not React's.
        act(() => {
            view.rerender(tree(store, { ...element.layout, opacity: 0.6 }));
        });
        expect(node.style.opacity).toBe("0.35");

        act(() => {
            store.clearDisplayableMotion(KEY);
        });
        expect(node.style.opacity).toBe("0.6");
    });

    it("snaps back to the resting pose in the commit that clears the motion", () => {
        const store = new WidgetRuntimeStateStore();
        store.setDisplayableBaseTransform(KEY, { offsetX: 12 });
        const { node } = mountWrapper(store);
        expect(node.style.transform).toBe("translateX(12px)");

        act(() => {
            store.setDisplayableMotion(KEY, {
                target: { x: [40, 80], scale: [1, 2] },
                transition: { type: "tween", durationMs: 5000 },
            });
        });
        expect(node.style.transform).toBe("translateX(40px)");

        act(() => {
            store.clearDisplayableMotion(KEY);
        });
        expect(node.style.transform).toBe("translateX(12px)");
        expect(node.style.opacity).toBe("0.35");
    });

    it("puts the pose back on the next render after something else wrote the transform", () => {
        const store = new WidgetRuntimeStateStore();
        const rotated = { ...element.layout, rotation: 15 };
        const { view, node } = mountWrapper(store, rotated);
        expect(node.style.transform).toBe("rotate(15deg)");

        // What the editor's drag leaves behind when a gesture ends.
        node.style.transform = "";
        act(() => {
            view.rerender(tree(store, { ...rotated, opacity: 0.5 }));
        });
        expect(node.style.transform).toBe("rotate(15deg)");

        // The same once a motion has taken the channel.
        act(() => {
            store.setDisplayableMotion(KEY, { target: { x: [40, 80] }, transition: { type: "tween", durationMs: 5000 } });
        });
        node.style.transform = "";
        act(() => {
            view.rerender(tree(store, { ...rotated, opacity: 0.6 }));
        });
        expect(node.style.transform).toBe("translateX(40px) rotate(15deg)");
    });

    it("starts a state's trip from where the element was, not from where React just put it", () => {
        const store = new WidgetRuntimeStateStore();
        const offset = (x: number) => ({ x, y: 0, durationMs: 400, easing: "easeOut" as const });
        const placed = (x: number): UIElement => ({ ...element, parentId: "parent", extra: { stateMotionOffset: offset(x) } });
        const placedTree = (x: number) => (
            <WidgetRuntimeStateProvider externalStore={store}>
                <WidgetRuntimeScopeProvider runtimeScopeId="scope">
                    <EditorNodeWrapper element={placed(x)} layout={element.layout} interactive={false} />
                </WidgetRuntimeScopeProvider>
            </WidgetRuntimeStateProvider>
        );
        const view = render(placedTree(0));
        const node = view.container.querySelector<HTMLElement>(".ui-editor-node-preview")!;
        expect(node.style.left).toBe("10px");

        act(() => {
            view.rerender(placedTree(60));
        });

        // React has written 70px by now; the trip puts the node back at 10px to travel from there.
        expect(node.style.left).toBe("10px");
    });

    it("reports nothing for a motion still running when the element leaves", async () => {
        const store = new WidgetRuntimeStateStore();
        const complete = vi.spyOn(store, "completeDisplayableMotion");
        const { view } = mountWrapper(store);
        act(() => {
            store.setDisplayableMotion(KEY, {
                target: { x: [0, 80] },
                transition: { type: "tween", durationMs: 5000 },
                resetOnComplete: true,
            });
        });

        view.unmount();
        await Promise.resolve();
        await Promise.resolve();

        expect(complete).not.toHaveBeenCalled();
    });
});
