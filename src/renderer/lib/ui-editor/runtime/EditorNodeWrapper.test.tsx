import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { UIElement } from "@shared/types/ui-editor/document";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import {
    WidgetRuntimeScopeProvider,
    WidgetRuntimeStateProvider,
} from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { EditorNodeWrapper, isElementHoveredByPointer } from "./EditorNodeWrapper";

vi.mock("motion/react", async () => {
    const ReactModule = await import("react");
    return {
        motion: {
            div: ({
                animate,
                children,
                initial,
                transition,
                style,
                ...props
            }: React.HTMLAttributes<HTMLDivElement> & {
                animate?: unknown;
                initial?: unknown;
                transition?: unknown;
            }) => ReactModule.createElement("div", {
                ...props,
                // Motion writes a motion value into the channel it names; the mock reads it back so
                // the pose still shows up in the markup these tests assert on.
                style: style
                    ? Object.fromEntries(
                          Object.entries(style).map(([key, value]) => [
                              key,
                              value && typeof value === "object" && typeof (value as { get?: unknown }).get === "function"
                                  ? (value as { get: () => unknown }).get()
                                  : value,
                          ]),
                      )
                    : style,
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
        useMotionValue: (initial: number) => {
            const ref = ReactModule.useRef<{ current: number; get(): number; set(next: number): void } | null>(null);
            if (!ref.current) {
                ref.current = {
                    current: initial,
                    get() {
                        return this.current;
                    },
                    set(next: number) {
                        this.current = next;
                    },
                };
            }
            return ref.current;
        },
        animate: (value: { set(next: number): void }, target: number) => {
            value.set(target);
            return { stop: () => undefined };
        },
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

function renderWrapper(store: WidgetRuntimeStateStore, layout = element.layout): string {
    return renderToStaticMarkup(
        <WidgetRuntimeStateProvider externalStore={store}>
            <WidgetRuntimeScopeProvider runtimeScopeId="scope">
                <EditorNodeWrapper
                    element={element}
                    layout={layout}
                    interactive={false}
                />
            </WidgetRuntimeScopeProvider>
        </WidgetRuntimeStateProvider>,
    );
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
        store.setDisplayableMotion("scope\0image", {
            target: { opacity: [0, 1] },
            transition: { type: "tween", durationMs: 200 },
        });

        const markup = renderWrapper(store);

        expect(markup).toContain("data-motion-initial=\"false\"");
        expect(markup).not.toContain("opacity:0.35");
    });

    it("routes the persistent base offset through motion-managed style values", () => {
        const store = new WidgetRuntimeStateStore();
        store.setDisplayableBaseTransform("scope\0image", { offsetX: 24, offsetY: -12 });

        const markup = renderWrapper(store);

        // The offset is a motion style value (x/y), not a raw transform string, so a motion
        // rendering its own transform composes with it instead of discarding it.
        expect(markup).toContain("x:24px");
        expect(markup).toContain("y:-12px");
        expect(markup).not.toContain("transform:");
    });

    it("keeps static rotation in the motion-managed transform channel", () => {
        const markup = renderWrapper(new WidgetRuntimeStateStore(), { ...element.layout, rotation: 15 });

        // Static rotation must survive motions: a raw style.transform string is dropped as soon
        // as motion renders transforms, so it always flows through the motion `rotate` value.
        expect(markup).toContain("rotate:15");
        expect(markup).not.toContain("transform:rotate(15deg)");
    });

    it("keeps plain widgets free of motion transform values until they carry a pose", () => {
        const markup = renderWrapper(new WidgetRuntimeStateStore());

        expect(markup).not.toContain("x:");
        expect(markup).not.toContain("rotate:");
    });
});
