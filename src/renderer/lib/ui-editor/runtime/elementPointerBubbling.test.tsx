// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UIElement } from "@shared/types/ui-editor/document";
import { WidgetRuntimeScopeProvider, WidgetRuntimeStateProvider } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import { EditorNodeWrapper } from "@/lib/ui-editor/runtime/EditorNodeWrapper";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";

afterEach(() => {
    cleanup();
});

function elementOfType(type: string): UIElement {
    return {
        id: "target",
        type,
        parentId: "parent",
        childrenIds: [],
        layout: { x: 0, y: 0, width: 100, height: 100 },
    };
}

function renderWrapper(element: UIElement) {
    const dispatchElementBlueprintEvent = vi.fn(async () => undefined);
    const hostAdapter: UIHostAdapter = {
        host: "player",
        blueprintRuntime: {
            surfaceId: "surface",
            setSurfaceState: () => undefined,
            getSurfaceState: () => undefined,
            emitDebug: () => undefined,
            dispatchElementBlueprintEvent,
        },
    };
    const view = render(
        <WidgetRuntimeStateProvider externalStore={new WidgetRuntimeStateStore()}>
            <WidgetRuntimeScopeProvider runtimeScopeId="scope">
                <EditorNodeWrapper element={element} layout={element.layout} hostAdapter={hostAdapter} interactive />
            </WidgetRuntimeScopeProvider>
        </WidgetRuntimeStateProvider>,
    );
    const node = view.container.querySelector("[data-ui-element-id=\"target\"]");
    if (!node) {
        throw new Error("the wrapper did not render an addressable element");
    }
    return { dispatchElementBlueprintEvent, node };
}

function dispatchedEvents(mock: ReturnType<typeof vi.fn>): string[] {
    return mock.mock.calls.map(call => call[1] as string);
}

/**
 * A collection, slider, text input or frame declares no mouse events of its own - the abstraction it
 * offers is "which row was clicked", not "the list was clicked". That is not the same as owning the
 * event: an element with no listener for a pointer event hands it to its parent, and the walk that
 * does so lives past the dispatch call. These lock the two halves apart, because collapsing them
 * again is silent - the wheel over a list simply stops reaching the container around it.
 */
describe("pointer events over a widget that declares none", () => {
    it("dispatches so the event can bubble to an ancestor", () => {
        for (const type of ["nl.list", "nl.choice.list", "nl.slider", "nl.textInput", "nl.frame"]) {
            const { dispatchElementBlueprintEvent, node } = renderWrapper(elementOfType(type));

            fireEvent.wheel(node, { deltaY: 120 });
            fireEvent.click(node);

            expect(dispatchedEvents(dispatchElementBlueprintEvent), type).toEqual(["mouseWheel", "mouseClick"]);
            cleanup();
        }
    });

    it("carries the wheel deltas the head reads", () => {
        const { dispatchElementBlueprintEvent, node } = renderWrapper(elementOfType("nl.list"));

        fireEvent.wheel(node, { deltaX: -8, deltaY: 120 });

        expect(dispatchElementBlueprintEvent.mock.calls[0]?.slice(0, 3)).toEqual([
            "target",
            "mouseWheel",
            expect.objectContaining({ deltaX: -8, deltaY: 120 }),
        ]);
    });

    it("still keeps events that do not bubble", () => {
        // Move and hover are deliberately outside the bubbling set: handing them up would light up
        // the whole ancestor chain as hovered at once.
        const { dispatchElementBlueprintEvent, node } = renderWrapper(elementOfType("nl.list"));

        fireEvent.pointerMove(node);

        expect(dispatchedEvents(dispatchElementBlueprintEvent)).toEqual([]);
    });
});

describe("pointer events over a widget that declares them", () => {
    it("dispatches as before", () => {
        const { dispatchElementBlueprintEvent, node } = renderWrapper(elementOfType("nl.container"));

        fireEvent.wheel(node, { deltaY: -120 });
        fireEvent.click(node);
        fireEvent.pointerMove(node);

        expect(dispatchedEvents(dispatchElementBlueprintEvent)).toEqual(["mouseWheel", "mouseClick", "mouseMove"]);
    });
});
