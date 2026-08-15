// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    UI_DOCUMENT_SCHEMA_VERSION,
    type UIDocument,
    type UIElement,
    type UISurface,
} from "@shared/types/ui-editor/document";
import { DEFAULT_ELEMENT_EFFECT_VALUES } from "@shared/types/ui-editor/effects";
import type { GradientFill } from "@shared/types/ui-editor/gradientFill";
import type { RectangleLikeProps } from "@shared/types/ui-editor/rectangleLike";
import type { AppearanceFieldTransition } from "@shared/types/ui-editor/appearance";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";

vi.mock("@/lib/workspace/hooks/useAssetObjectUrl", () => ({
    useAssetObjectUrl: () => ({ url: null, metadata: null, loading: false, error: null }),
}));

vi.mock("@/lib/workspace/services/ui-editor/UIEditorStateService", () => ({
    UIEditorStateService: {
        getInstance: () => ({
            getInteractionOverride: () => null,
            on: () => () => undefined,
        }),
    },
}));

// The colour helpers are used for real: they are what resolves a stop, and half of what this file
// checks is that a stop's alpha survives that trip and reaches the crossfade decision.
import { parseColorValue } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import { RectangleChromeRenderer } from "./RectangleChromeRenderer";
import {
    FILL_LAYER_ATTRIBUTE,
    planFillCrossfade,
    resolveColorFillPaint,
    resolveGradientFillPaint,
} from "./FillLayer";

/**
 * jsdom has no Web Animations API, and without one motion writes every animated value into the
 * inline style each frame - which hides the whole class of defect this file has to be able to see.
 * Chromium takes the accelerated path instead, so the tests below run with a stub in place: enough
 * of an `Animation` for motion to drive, and a spy that records which values were handed to the
 * compositor.
 *
 * `supportsWaapi` is memoised on first use, so this has to be installed before any animation starts.
 */
const waapiCalls: { element: Element; keyframes: unknown }[] = [];

class StubAnimation {
    startTime: number | null = 0;
    currentTime: number | null = 0;
    playbackRate = 1;
    playState = "running";
    onfinish: (() => void) | null = null;
    finished = new Promise<void>(() => undefined);
    cancel() {}
    play() {}
    pause() {}
    finish() {}
    commitStyles() {}
}

Element.prototype.animate = function (this: Element, keyframes: unknown) {
    waapiCalls.push({ element: this, keyframes });
    return new StubAnimation() as unknown as Animation;
} as Element["animate"];

const SURFACE: UISurface = {
    id: "surface",
    name: "Surface",
    host: "app",
    kind: "appSurface",
    designSize: { width: 320, height: 180 },
    rootElementId: "root",
};

const ELEMENT: UIElement = {
    id: "widget",
    type: "nl.container",
    parentId: "root",
    childrenIds: [],
    layout: { x: 0, y: 0, width: 100, height: 80 },
};

const DOCUMENT: UIDocument = {
    schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
    id: "doc",
    name: "Doc",
    surfaces: [SURFACE],
    elements: {
        root: {
            id: "root",
            type: "nl.root",
            parentId: null,
            childrenIds: ["widget"],
            layout: { x: 0, y: 0, width: 320, height: 180 },
        },
        widget: ELEMENT,
    },
};

const HOST_ADAPTER: UIHostAdapter = { host: "app" };

const TWEEN: AppearanceFieldTransition = { type: "tween", durationMs: 120, delayMs: 0, easing: "linear" };

const OPAQUE_GRADIENT: GradientFill = {
    kind: "linear",
    angle: 90,
    stops: [
        { offset: 0, color: "#ff0000" },
        { offset: 1, color: "#0000ff" },
    ],
};

const TRANSLUCENT_GRADIENT: GradientFill = {
    kind: "linear",
    angle: 90,
    stops: [
        { offset: 0, color: "rgba(255, 0, 0, 0.4)" },
        { offset: 1, color: "#0000ff" },
    ],
};

function rectangleLike(overrides: Partial<RectangleLikeProps> = {}): RectangleLikeProps {
    return {
        backgroundColor: "#123456",
        borderRadius: 0,
        borderRadiusTL: 0,
        borderRadiusTR: 0,
        borderRadiusBL: 0,
        borderRadiusBR: 0,
        borderRadiusLinked: true,
        borderColor: "transparent",
        borderWidth: 0,
        borderStyle: "solid",
        backgroundImage: "",
        backgroundFit: "cover",
        fillType: "color",
        fillVisible: true,
        fillOpacity: 1,
        strokeVisible: false,
        strokeOpacity: 1,
        strokeAlign: "none",
        strokeSide: "all",
        borderJoin: "miter",
        cornerAdvanced: false,
        transformOffsetX: 0,
        transformOffsetY: 0,
        transformScale: 1,
        transformRotation: 0,
        transformOpacity: 1,
        effects: DEFAULT_ELEMENT_EFFECT_VALUES,
        ...overrides,
    };
}

function chrome(props: RectangleLikeProps, transitions?: Record<string, AppearanceFieldTransition>) {
    return (
        <RectangleChromeRenderer
            element={ELEMENT}
            surface={SURFACE}
            document={DOCUMENT}
            hostAdapter={HOST_ADAPTER}
            rectangleLike={props}
            appearanceTransitions={transitions}
        >
            <p data-child="true">Label</p>
        </RectangleChromeRenderer>
    );
}

function layers(container: HTMLElement): HTMLElement[] {
    return [...container.querySelectorAll<HTMLElement>(`[${FILL_LAYER_ATTRIBUTE}]`)];
}

function chromeRoot(container: HTMLElement): HTMLElement {
    return container.firstElementChild as HTMLElement;
}

afterEach(() => cleanup());

/** What the chrome hands the layer: the colour it has already parsed for the root. */
function parsed(stored: string) {
    return parseColorValue(stored, { hex: "#FFFFFF", alpha: 1 });
}

describe("fill paint", () => {
    it("reads a colour without folding `fillOpacity` into it", () => {
        const paint = resolveColorFillPaint(parsed("#ff0000"));
        expect(paint.color).toBe("#FF0000");
        expect(paint.image).toBeNull();
        expect(paint.opaque).toBe(true);
        // Same fill, same signature: an opacity change must not read as a change of fill.
        expect(paint.signature).toBe(resolveColorFillPaint(parsed("#FF0000")).signature);
    });

    it("reads a translucent colour as not opaque", () => {
        expect(resolveColorFillPaint(parsed("rgba(255, 0, 0, 0.5)")).opaque).toBe(false);
    });

    it("resolves every stop and keeps the geometry", () => {
        const paint = resolveGradientFillPaint(OPAQUE_GRADIENT);
        expect(paint.image).toBe("linear-gradient(90deg, #FF0000 0%, #0000FF 100%)");
        expect(paint.color).toBeNull();
        expect(paint.opaque).toBe(true);
    });

    it("is not opaque when any one stop is translucent", () => {
        const paint = resolveGradientFillPaint(TRANSLUCENT_GRADIENT);
        expect(paint.opaque).toBe(false);
        expect(paint.image).toContain("rgba(255, 0, 0, 0.4)");
    });
});

describe("planFillCrossfade", () => {
    it("holds the outgoing layer when the incoming fill is opaque", () => {
        // Fading both would put them at 0.5 and 0.5 half way through - a combined alpha of 0.75, and
        // a visible dip to whatever is behind the widget.
        expect(planFillCrossfade(true, 1)).toEqual({ outgoingTo: 1, incomingFrom: 0 });
    });

    it("holds it at the opacity it was actually painting at, not at 1", () => {
        expect(planFillCrossfade(true, 0.6)).toEqual({ outgoingTo: 0.6, incomingFrom: 0 });
    });

    it("fades the outgoing layer out when the incoming fill is translucent", () => {
        expect(planFillCrossfade(false, 1)).toEqual({ outgoingTo: 0, incomingFrom: 0 });
    });
});

describe("RectangleChromeRenderer fill layer", () => {
    it("mounts no layer for a plain colour fill, which keeps painting on the root", () => {
        const { container } = render(chrome(rectangleLike()));
        expect(layers(container)).toHaveLength(0);
        expect(chromeRoot(container).style.backgroundColor).toBe("rgb(18, 52, 86)");
        expect(chromeRoot(container).style.isolation).toBe("");
    });

    it("mounts no layer for a colour fill that has a transition configured", () => {
        // Motion interpolating one `background-color` is the good path; two layers would be a
        // permanent extra node per rectangle in the editor to do the same thing worse.
        const { container } = render(chrome(rectangleLike(), { backgroundColor: TWEEN, fillOpacity: TWEEN }));
        expect(layers(container)).toHaveLength(0);
    });

    it("mounts one layer for a gradient fill and takes the fill off the root", () => {
        const { container } = render(
            chrome(rectangleLike({ fillType: "gradient", gradientFill: OPAQUE_GRADIENT })),
        );
        const mounted = layers(container);
        expect(mounted).toHaveLength(1);
        expect(mounted[0].getAttribute(FILL_LAYER_ATTRIBUTE)).toBe("current");
        expect(mounted[0].getAttribute("data-ui-fill-layer-kind")).toBe("gradient");
        // jsdom re-serialises the colours it parses; the string handed to it is asserted verbatim in
        // the `fill paint` block above.
        expect(mounted[0].style.backgroundImage).toBe(
            "linear-gradient(90deg, rgb(255, 0, 0) 0%, rgb(0, 0, 255) 100%)",
        );
        expect(chromeRoot(container).style.backgroundColor).toBe("transparent");
    });

    it("follows fillOpacity and fillVisible", () => {
        const { container } = render(
            chrome(rectangleLike({ fillType: "gradient", gradientFill: OPAQUE_GRADIENT, fillOpacity: 0.4 })),
        );
        expect(layers(container)[0].style.opacity).toBe("0.4");

        cleanup();
        const hidden = render(
            chrome(
                rectangleLike({ fillType: "gradient", gradientFill: OPAQUE_GRADIENT, fillVisible: false }),
            ),
        );
        expect(layers(hidden.container)[0].style.opacity).toBe("0");
    });

    /**
     * The stacking rule, pinned rather than assumed.
     *
     * CSS paints positioned descendants above in-flow, non-positioned ones whatever the DOM order, so
     * an absolutely positioned layer at `z-index: auto` would cover a button's label and a text
     * widget's text - both of which arrive as ordinary in-flow content, as the child below does. Only
     * a negative z-index paints between the root's own background and its in-flow children, and only
     * inside a stacking context does it stay in this widget rather than sliding behind an ancestor.
     * Either half alone is wrong, so both are asserted.
     */
    it("paints under the children: negative z-index inside an isolated root", () => {
        const { container } = render(
            chrome(rectangleLike({ fillType: "gradient", gradientFill: OPAQUE_GRADIENT })),
        );
        const layer = layers(container)[0];
        expect(layer.style.position).toBe("absolute");
        expect(layer.style.zIndex).toBe("-1");
        expect(chromeRoot(container).style.isolation).toBe("isolate");

        const child = container.querySelector<HTMLElement>("[data-child]");
        expect(child).not.toBeNull();
        // The child is in flow and unpositioned - which is exactly why the layer cannot rely on
        // coming first in the DOM.
        expect(child!.style.position).toBe("");
    });

    it("does not eat pointer events", () => {
        const { container } = render(
            chrome(rectangleLike({ fillType: "gradient", gradientFill: OPAQUE_GRADIENT })),
        );
        expect(layers(container)[0].style.pointerEvents).toBe("none");
    });

    it("leaves an image fill alone", () => {
        const { container } = render(
            chrome(rectangleLike({ fillType: "image", backgroundImage: "https://example.test/a.png" })),
        );
        expect(layers(container)).toHaveLength(0);
        expect(container.querySelector("[data-ui-image-fill]")).not.toBeNull();
    });

    it("crossfades colour to gradient, holding the outgoing layer for an opaque incoming fill", () => {
        const { container, rerender } = render(chrome(rectangleLike(), { fillOpacity: TWEEN }));
        expect(layers(container)).toHaveLength(0);

        rerender(
            chrome(
                rectangleLike({ fillType: "gradient", gradientFill: OPAQUE_GRADIENT }),
                { fillOpacity: TWEEN },
            ),
        );

        const mounted = layers(container);
        expect(mounted.map(node => node.getAttribute(FILL_LAYER_ATTRIBUTE))).toEqual(["outgoing", "current"]);
        expect(mounted[0].getAttribute("data-ui-fill-layer-kind")).toBe("color");
        expect(mounted[0].getAttribute("data-ui-fill-layer-hold")).toBe("true");
        expect(mounted[1].getAttribute("data-ui-fill-layer-kind")).toBe("gradient");
    });

    it("fades both layers when the incoming fill is translucent", () => {
        const { container, rerender } = render(
            chrome(rectangleLike({ fillType: "gradient", gradientFill: OPAQUE_GRADIENT }), {
                fillOpacity: TWEEN,
            }),
        );
        rerender(
            chrome(rectangleLike({ fillType: "gradient", gradientFill: TRANSLUCENT_GRADIENT }), {
                fillOpacity: TWEEN,
            }),
        );

        const mounted = layers(container);
        expect(mounted).toHaveLength(2);
        expect(mounted[0].getAttribute("data-ui-fill-layer-hold")).toBe("false");
    });

    it("does not crossfade when nothing but the opacity changed", () => {
        const gradient = rectangleLike({ fillType: "gradient", gradientFill: OPAQUE_GRADIENT });
        const { container, rerender } = render(chrome(gradient, { fillOpacity: TWEEN }));
        rerender(chrome({ ...gradient, fillOpacity: 0.3 }, { fillOpacity: TWEEN }));

        // One fill, one layer: `fillOpacity` is the layer's own opacity, not a different fill.
        expect(layers(container)).toHaveLength(1);
    });

    /**
     * The end-of-crossfade flash, pinned.
     *
     * Sampling a running Studio per animation frame caught the incoming layer dropping to 0 for one
     * frame while the outgoing layer was still holding at 1 - the author saw the *old* fill, at full
     * strength, after the new one had completely arrived.
     *
     * A mounted motion element cannot go back to `initial`: that prop is read at mount and only at
     * mount. So the only way the incoming layer can paint zero again is to be rebuilt, and it can be:
     * `FillLayer` answers with a plain `div` when no transition is configured and a `motion.div` when
     * one is, so resolved transitions coming and going - which they do, per appearance variant -
     * swaps the element type under React and the DOM node is replaced. The replacement then reads
     * `initial` again.
     *
     * Reverting the fix (passing `crossfade.plan.incomingFrom` unconditionally rather than only for
     * the crossfade's first commit) fails this test with `opacity: "0"` on the incoming layer while
     * both layers are mounted, which is the flash exactly.
     */
    it("never repaints the incoming layer from zero once the crossfade is under way", () => {
        const before = rectangleLike({ fillType: "gradient", gradientFill: OPAQUE_GRADIENT });
        const after = rectangleLike({
            fillType: "gradient",
            gradientFill: { ...OPAQUE_GRADIENT, angle: 45 },
        });
        const { container, rerender } = render(chrome(before, { fillOpacity: TWEEN }));
        rerender(chrome(after, { fillOpacity: TWEEN }));
        expect(layers(container)).toHaveLength(2);

        // Rebuild both layer nodes mid-crossfade, the way a change of resolved transitions does.
        rerender(chrome(after));
        rerender(chrome(after, { fillOpacity: TWEEN }));

        const mounted = layers(container);
        expect(mounted).toHaveLength(2);
        expect(mounted[0].getAttribute(FILL_LAYER_ATTRIBUTE)).toBe("outgoing");
        expect(mounted[0].getAttribute("data-ui-fill-layer-hold")).toBe("true");
        // Anything but zero: the incoming layer may truncate its fade after a remount, but it must
        // never uncover the fill that is on its way out.
        expect(mounted[1].style.opacity).not.toBe("0");
    });

    it("drops the outgoing layer even when the incoming one has nothing left to animate", async () => {
        const before = rectangleLike({ fillType: "gradient", gradientFill: OPAQUE_GRADIENT });
        const after = rectangleLike({
            fillType: "gradient",
            gradientFill: { ...OPAQUE_GRADIENT, angle: 45 },
        });
        const brief: AppearanceFieldTransition = { type: "tween", durationMs: 30, delayMs: 0, easing: "linear" };
        const { container, rerender } = render(chrome(before, { fillOpacity: brief }));
        rerender(chrome(after, { fillOpacity: brief }));
        rerender(chrome(after));
        rerender(chrome(after, { fillOpacity: brief }));

        // A remounted incoming layer reports no completion, so the crossfade has to end on its own.
        await waitFor(() => expect(layers(container)).toHaveLength(1), { timeout: 1000 });
        expect(layers(container)[0].getAttribute(FILL_LAYER_ATTRIBUTE)).toBe("current");
    });

    /**
     * The end-of-crossfade flash, pinned at its cause.
     *
     * Sampling a running Studio per animation frame caught the incoming layer dropping to 0 for a
     * single frame while the outgoing layer was still holding at 1 - the author saw the *old* fill,
     * at full strength, after the new one had completely arrived. The node identity never changed:
     * the value was written to a live element.
     *
     * `opacity` is a value motion hands to the compositor, and a compositor animation paints above
     * the inline style rather than writing to it, so the inline style keeps the value the layer
     * mounted with - zero. `AcceleratedAnimation.onfinish` then schedules the final value for
     * motion's *next* render frame but cancels the compositor animation immediately, and in the gap
     * the element paints that stale zero.
     *
     * So the invariant is: the incoming layer's opacity must live in the inline style while it fades.
     * Reverting the fix (dropping `onUpdate` from `FillLayer`'s motion element) fails this test with
     * an inline opacity of "0" throughout, and with the layer's opacity handed to `element.animate`.
     */
    it("fades the incoming layer on the main thread, where the inline style follows it", async () => {
        const before = rectangleLike({ fillType: "gradient", gradientFill: OPAQUE_GRADIENT });
        const after = rectangleLike({
            fillType: "gradient",
            gradientFill: { ...OPAQUE_GRADIENT, angle: 45 },
        });
        const slow: AppearanceFieldTransition = { type: "tween", durationMs: 400, delayMs: 0, easing: "linear" };
        const { container, rerender } = render(chrome(before, { fillOpacity: slow }));
        waapiCalls.length = 0;
        rerender(chrome(after, { fillOpacity: slow }));

        const incoming = layers(container)[1];
        expect(incoming.getAttribute(FILL_LAYER_ATTRIBUTE)).toBe("current");

        await waitFor(
            () => {
                const painted = Number(incoming.style.opacity);
                expect(painted).toBeGreaterThan(0);
                expect(painted).toBeLessThan(1);
            },
            { timeout: 1000 },
        );

        // Nothing about either layer went to the compositor, so nothing can be cancelled back to a
        // value the layer has already left behind.
        expect(waapiCalls.filter(call => layers(container).includes(call.element as HTMLElement))).toEqual([]);
    });

    it("does not crossfade without a configured transition", () => {
        const { container, rerender } = render(
            chrome(rectangleLike({ fillType: "gradient", gradientFill: OPAQUE_GRADIENT })),
        );
        rerender(chrome(rectangleLike({ fillType: "gradient", gradientFill: TRANSLUCENT_GRADIENT })));
        expect(layers(container)).toHaveLength(1);
    });
});
