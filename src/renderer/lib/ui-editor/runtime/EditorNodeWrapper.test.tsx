import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { UIElement } from "@shared/types/ui-editor/document";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import {
    WidgetRuntimeScopeProvider,
    WidgetRuntimeStateProvider,
} from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { EditorNodeWrapper } from "./EditorNodeWrapper";

vi.mock("motion/react", async () => {
    const ReactModule = await import("react");
    return {
        motion: {
            div: ({
                animate,
                children,
                initial,
                transition,
                ...props
            }: React.HTMLAttributes<HTMLDivElement> & {
                animate?: unknown;
                initial?: unknown;
                transition?: unknown;
            }) => ReactModule.createElement("div", {
                ...props,
                "data-motion-animate": JSON.stringify(animate),
                "data-motion-initial": JSON.stringify(initial),
                "data-motion-transition": JSON.stringify(transition),
            }, children),
        },
        useAnimationControls: () => ({
            mount: () => () => undefined,
            set: () => undefined,
            start: () => Promise.resolve(),
            stop: () => undefined,
        }),
    };
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

function renderWrapper(store: WidgetRuntimeStateStore): string {
    return renderToStaticMarkup(
        <WidgetRuntimeStateProvider externalStore={store}>
            <WidgetRuntimeScopeProvider runtimeScopeId="scope">
                <EditorNodeWrapper
                    element={element}
                    layout={element.layout}
                    interactive={false}
                />
            </WidgetRuntimeScopeProvider>
        </WidgetRuntimeStateProvider>,
    );
}

describe("EditorNodeWrapper", () => {
    it("keeps authored opacity in static style when opacity is not motion-controlled", () => {
        expect(renderWrapper(new WidgetRuntimeStateStore())).toContain("opacity:0.35");
    });

    it("lets displayable opacity motion own opacity style", () => {
        const store = new WidgetRuntimeStateStore();
        store.setDisplayableMotion("scope\0image", {
            target: { opacity: [0, 1] },
            transition: { type: "tween", durationMs: 200 },
        });

        const markup = renderWrapper(store);

        expect(markup).toContain("data-motion-initial=\"false\"");
        expect(markup).not.toContain("opacity:0.35");
    });
});
