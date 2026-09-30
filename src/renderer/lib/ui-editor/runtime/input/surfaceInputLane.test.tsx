// @vitest-environment jsdom
import { cleanup, createEvent, fireEvent, render } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement, type UISurface } from "@shared/types/ui-editor/document";
import type { UIInputActionDef, UISurfaceActionEnablement } from "@shared/types/ui-editor/inputAction";
import type { UIInputActionEventPayload } from "@shared/types/ui-editor/inputActionEvent";
import { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { EditorNodeWrapper } from "@/lib/ui-editor/runtime/EditorNodeWrapper";
import { GameSurfaceRenderer } from "@/lib/ui-editor/runtime/surface/GameSurfaceRenderer";
import { WidgetRuntimeScopeProvider, WidgetRuntimeStateProvider } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { WHEEL_GESTURE_SILENCE_MS, wheelGestureGate } from "@/lib/ui-editor/runtime/input/wheelGesture";
import {
    resetSharedTouchGestureTracker,
    TOUCH_GESTURE_THRESHOLD_PX,
    UI_TOUCH_GESTURE_EVENT,
    type UITouchGestureDetail,
} from "@/lib/ui-editor/runtime/input/touchGesture";
import { resetSharedInputHoldTracker } from "@/lib/ui-editor/runtime/input/inputHoldState";
import {
    GlobalInputActionContext,
    type GlobalInputActionAnswerer,
} from "@/lib/ui-editor/runtime/input/globalInputActionContext";

afterEach(() => {
    cleanup();
});

// The gate is one per renderer by design (a physical flick is one thing across every lane), so a
// test that left a claimed gesture behind would swallow the first wheel of the next one. The touch
// recogniser is one per renderer for the same reason, and a stroke left in flight would void the
// next test's.
beforeEach(() => {
    wheelGestureGate.reset();
    resetSharedTouchGestureTracker();
    resetSharedInputHoldTracker();
});

/** Far enough past the threshold that no rounding decides the answer. */
const PAST_THRESHOLD = TOUCH_GESTURE_THRESHOLD_PX + 8;

/**
 * A touch event as the recogniser reads one.
 *
 * Built by hand rather than with `TouchEvent`, whose constructor and `Touch` factory are not
 * available in every environment a test runs in.
 */
function fireTouch(
    node: Element,
    type: string,
    touches: Array<{ clientX: number; clientY: number; identifier?: number }>,
    changed = touches,
): void {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "touches", { value: touches });
    Object.defineProperty(event, "changedTouches", { value: changed });
    node.dispatchEvent(event);
}

/** A recognised gesture, as the recogniser hands it to the lane it started on. */
function fireTouchGesture(node: Element, detail: UITouchGestureDetail): void {
    node.dispatchEvent(
        new CustomEvent<UITouchGestureDetail>(UI_TOUCH_GESTURE_EVENT, {
            detail,
            bubbles: true,
            cancelable: true,
        }),
    );
}

/**
 * Dispatch a wheel event that happened at a chosen moment.
 *
 * `timeStamp` is readonly and jsdom fills it with the real clock, so two `fireEvent.wheel` calls in
 * a row are microseconds apart and could never sit on either side of the silence threshold. Shadowed
 * with an own property, which is the only way to test a boundary measured in tenths of a second
 * without spending them.
 */
function fireWheelAt(node: Element, at: number, init: { deltaX?: number; deltaY?: number }): void {
    const event = createEvent.wheel(node, init);
    Object.defineProperty(event, "timeStamp", { value: at });
    fireEvent(node, event);
}

const ADVANCE: UIInputActionDef = {
    id: "advance",
    name: "Advance",
    bindings: [
        { kind: "pointer", gesture: "click" },
        { kind: "pointer", gesture: "wheelDown" },
    ],
};

/**
 * A registry that draws every type as a plain box.
 *
 * What the widget looks like is beside the point here - routing asks the document what type sits
 * under the pointer, never the renderer - so one renderer stands in for all of them and the test
 * stays about the walk.
 */
const REGISTRY = new ElementRendererRegistry(
    ["nl.root", "nl.container", "nl.button", "nl.video", "nl.text"].map(type => ({
        type,
        render: ({ element, renderChildren }) => <>{renderChildren?.({ childrenIds: element.childrenIds })}</>,
    })),
);

function buildDocument(leaf: { type: string; props?: Record<string, unknown> }): UIDocument {
    const elements: Record<string, UIElement> = {
        root: {
            id: "root",
            type: "nl.root",
            parentId: null,
            childrenIds: ["leaf"],
            layout: { x: 0, y: 0, width: 320, height: 180 },
        },
        leaf: {
            id: "leaf",
            type: leaf.type,
            parentId: "root",
            childrenIds: [],
            layout: { x: 0, y: 0, width: 320, height: 180 },
            ...(leaf.props ? { props: leaf.props } : {}),
        },
    };
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        actions: { advance: ADVANCE },
        surfaces: [
            {
                id: "surface",
                name: "Surface",
                host: "player",
                kind: "stageSurface",
                designSize: { width: 320, height: 180 },
                rootElementId: "root",
                mount: { kind: "slot", slotId: "onStage" },
            },
        ],
        elements,
    };
}

function renderSurface(options: {
    leaf?: { type: string; props?: Record<string, unknown> };
    actions?: UISurfaceActionEnablement[];
    /** The game's global blueprint, as a running game hands it to every lane it draws. */
    answerGlobally?: GlobalInputActionAnswerer;
    /** The runtime scope the surface is drawn under, which is what tells two lanes apart. */
    runtimeScopeId?: string;
}) {
    const document = buildDocument(options.leaf ?? { type: "nl.container" });
    const surface: UISurface = {
        ...(document.surfaces[0] as UISurface),
        ...(options.actions ? { actions: options.actions } : {}),
    };
    const dispatchSurfaceInputAction = vi.fn(async (_payload: UIInputActionEventPayload) => undefined);
    const dispatchElementBlueprintEvent = vi.fn(async (_elementId: string, _eventName: string) => undefined);
    const hostAdapter: UIHostAdapter = {
        host: "player",
        blueprintRuntime: {
            surfaceId: surface.id,
            ...(options.runtimeScopeId ? { runtimeScopeId: options.runtimeScopeId } : {}),
            setSurfaceState: () => undefined,
            getSurfaceState: () => undefined,
            emitDebug: () => undefined,
            dispatchElementBlueprintEvent,
            dispatchSurfaceBlueprintEvent: async () => undefined,
            dispatchSurfaceInputAction,
        },
    };
    // Stands in for whatever the input would reach next. The two hosts really are separate DOM
    // trees, so nothing in production is literally this element - but "did the surface let the event
    // carry on past itself" is the same question either way, and it is the one the mode decides.
    const onwards = vi.fn();
    const view = render(
        <GlobalInputActionContext.Provider value={options.answerGlobally ?? null}>
            <WidgetRuntimeStateProvider externalStore={new WidgetRuntimeStateStore()}>
                <WidgetRuntimeScopeProvider runtimeScopeId="scope">
                    <div onClick={onwards} onWheel={onwards}>
                        <GameSurfaceRenderer
                            document={document}
                            surface={surface}
                            rendererRegistry={REGISTRY}
                            scale={1}
                            hostAdapter={hostAdapter}
                            staticDocument
                        />
                    </div>
                </WidgetRuntimeScopeProvider>
            </WidgetRuntimeStateProvider>
        </GlobalInputActionContext.Provider>,
    );
    const shell = view.container.querySelector("[data-ui-surface-id=\"surface\"]");
    const leafNode = view.container.querySelector("[data-ui-element-id=\"leaf\"]");
    // The touch gesture's own "onwards". React has no `on...` prop for a private event name, so the
    // stand-in for the lane behind has to be a native listener as the real one is.
    const onwardsTouch = vi.fn();
    view.container.addEventListener(UI_TOUCH_GESTURE_EVENT, onwardsTouch);
    return { dispatchElementBlueprintEvent, dispatchSurfaceInputAction, onwards, onwardsTouch, shell, leafNode };
}

/** Actions fired, by id. */
function firedActionIds(mock: { mock: { calls: [UIInputActionEventPayload][] } }): string[] {
    return mock.mock.calls.map(call => call[0].actionId);
}

describe("a surface answering a declared action", () => {
    it("fires it for a click that matches a binding", () => {
        const { dispatchSurfaceInputAction, leafNode } = renderSurface({ actions: [{ actionId: "advance" }] });

        fireEvent.click(leafNode!);

        expect(firedActionIds(dispatchSurfaceInputAction)).toEqual(["advance"]);
        expect(dispatchSurfaceInputAction.mock.calls[0]?.[0]).toMatchObject({ actionId: "advance", source: "pointer" });
    });

    it("fires it for the wheel direction it is bound to, and not the other one", () => {
        const { dispatchSurfaceInputAction, leafNode } = renderSurface({ actions: [{ actionId: "advance" }] });

        fireEvent.wheel(leafNode!, { deltaY: -120 });
        expect(firedActionIds(dispatchSurfaceInputAction)).toEqual([]);

        fireEvent.wheel(leafNode!, { deltaY: 120 });
        expect(firedActionIds(dispatchSurfaceInputAction)).toEqual(["advance"]);
    });

    it("leaves it alone when the surface enables nothing", () => {
        const { dispatchSurfaceInputAction, leafNode } = renderSurface({});

        fireEvent.click(leafNode!);

        expect(firedActionIds(dispatchSurfaceInputAction)).toEqual([]);
    });

    it("stands down over a control the player operates", () => {
        const overButton = renderSurface({ leaf: { type: "nl.button" }, actions: [{ actionId: "advance" }] });
        fireEvent.click(overButton.leafNode!);
        expect(firedActionIds(overButton.dispatchSurfaceInputAction)).toEqual([]);
        cleanup();

        const overContainer = renderSurface({ leaf: { type: "nl.container" }, actions: [{ actionId: "advance" }] });
        fireEvent.click(overContainer.leafNode!);
        expect(firedActionIds(overContainer.dispatchSurfaceInputAction)).toEqual(["advance"]);
        cleanup();

        const overVideoWithControls = renderSurface({
            leaf: { type: "nl.video", props: { controls: true } },
            actions: [{ actionId: "advance" }],
        });
        fireEvent.click(overVideoWithControls.leafNode!);
        expect(firedActionIds(overVideoWithControls.dispatchSurfaceInputAction)).toEqual([]);
    });

    it("stops the input whether or not the surface answered it", () => {
        const withAction = renderSurface({ actions: [{ actionId: "advance" }] });
        fireEvent.click(withAction.leafNode!);
        expect(withAction.onwards).not.toHaveBeenCalled();
        cleanup();

        // A surface is drawn over what is behind it, and input that lands on its content stops
        // there. Nothing on the surface has to have listened for that to be true.
        const withNothing = renderSurface({});
        fireEvent.click(withNothing.leafNode!);
        expect(withNothing.onwards).not.toHaveBeenCalled();
    });

    it("sends the input on when the action that fired said to", () => {
        const { onwards, leafNode } = renderSurface({
            actions: [{ actionId: "advance", consume: false }],
        });

        fireEvent.click(leafNode!);

        expect(onwards).toHaveBeenCalledTimes(1);
    });
});

/**
 * A finger takes the same lane walk a mouse does.
 *
 * The whole reason a recognised touch gesture travels as a private CustomEvent is that it can then
 * be routed by the code that already existed rather than by a second copy of it - so what these pin
 * is that every rule of the walk still applies when the gesture came from a finger.
 */
describe("a touch gesture on a lane", () => {
    it("fires the action the direction is bound to, and says a finger did it", () => {
        const { dispatchSurfaceInputAction, leafNode } = renderSurface({ actions: [{ actionId: "advance" }] });

        fireTouchGesture(leafNode!, { gesture: "wheelDown", clientX: 20, clientY: 40 });

        expect(dispatchSurfaceInputAction.mock.calls[0]?.[0]).toMatchObject({ actionId: "advance", source: "touch" });
    });

    it("recognises a drag on the real element and routes what it recognised", () => {
        const { dispatchSurfaceInputAction, leafNode } = renderSurface({ actions: [{ actionId: "advance" }] });

        // A finger travelling up carries the content up, which puts the viewport down: `wheelDown`,
        // the direction `advance` is bound to. Driven through the recogniser rather than around it,
        // so the direction convention is checked where an author would meet it.
        fireTouch(leafNode!, "touchstart", [{ clientX: 100, clientY: 100, identifier: 4 }]);
        fireTouch(leafNode!, "touchmove", [{ clientX: 100, clientY: 100 - PAST_THRESHOLD, identifier: 4 }]);

        expect(firedActionIds(dispatchSurfaceInputAction)).toEqual(["advance"]);
    });

    it("fires over a control that has nothing to do with a scroll", () => {
        // A button takes a click and stands between the player and a panel-wide one. It has no use
        // for a drag, so a drag that began on it is still the surface's - which is the same rule
        // that lets one more pull at the bottom of a list close the page it is in.
        const { dispatchSurfaceInputAction, leafNode } = renderSurface({
            leaf: { type: "nl.button" },
            actions: [{ actionId: "advance" }],
        });

        fireTouchGesture(leafNode!, { gesture: "wheelDown", clientX: 20, clientY: 40 });

        expect(firedActionIds(dispatchSurfaceInputAction)).toEqual(["advance"]);
    });

    it("stands down over a control for a gesture that control does take", () => {
        const { dispatchSurfaceInputAction, leafNode } = renderSurface({
            leaf: { type: "nl.button" },
            actions: [{ actionId: "advance" }],
        });

        fireTouchGesture(leafNode!, { gesture: "click", clientX: 20, clientY: 40 });

        expect(firedActionIds(dispatchSurfaceInputAction)).toEqual([]);
    });

    it("stops at a capturing surface", () => {
        const { onwardsTouch, leafNode } = renderSurface({ actions: [{ actionId: "advance" }] });

        fireTouchGesture(leafNode!, { gesture: "wheelDown", clientX: 20, clientY: 40 });

        expect(onwardsTouch).not.toHaveBeenCalled();
    });

    /**
     * The one this file exists to defend.
     *
     * A surface handing a touch gesture to the lane behind is the most easily lost link in
     * the design: it is what a CustomEvent buys over synthesising a touch or a wheel, and nothing
     * else in the walk would fail visibly if it quietly stopped working.
     */
    it("hands the gesture to the lane behind when it passes", () => {
        const { onwardsTouch, leafNode } = renderSurface({
            actions: [{ actionId: "advance", consume: false }],
        });

        fireTouchGesture(leafNode!, { gesture: "wheelDown", clientX: 20, clientY: 40 });

        expect(onwardsTouch).toHaveBeenCalledTimes(1);
    });

    it("stops once an action consumes it, whatever the mode says", () => {
        const { onwardsTouch, leafNode } = renderSurface({ actions: [{ actionId: "advance" }] });

        fireTouchGesture(leafNode!, { gesture: "wheelDown", clientX: 20, clientY: 40 });

        expect(onwardsTouch).not.toHaveBeenCalled();
    });

    /**
     * The platform's own long press is swallowed at both levels, and this is the level that is easy
     * to forget. Android turns a held finger into `contextmenu`; iOS does not. An element head left
     * answering it would make one long press mean two things on one phone and one on the other,
     * which is the difference an author must never be able to feel.
     */
    it("keeps a held finger's context menu away from the element's rightClick head", () => {
        const { dispatchElementBlueprintEvent, leafNode } = renderSurface({ actions: [{ actionId: "advance" }] });
        const rightClicks = () =>
            dispatchElementBlueprintEvent.mock.calls.filter(call => call[1] === "rightClick").length;

        fireTouch(leafNode!, "touchstart", [{ clientX: 100, clientY: 100, identifier: 1 }]);
        fireEvent.contextMenu(leafNode!);
        expect(rightClicks()).toBe(0);

        // A mouse's right button, with no finger on the glass, is what `rightClick` has always been.
        fireTouch(leafNode!, "touchend", [], [{ clientX: 100, clientY: 100, identifier: 1 }]);
        fireEvent.contextMenu(leafNode!);
        expect(rightClicks()).toBe(1);
    });

    it("reports a tap as touch and a mouse click as pointer", () => {
        const { dispatchSurfaceInputAction, leafNode } = renderSurface({ actions: [{ actionId: "advance" }] });

        // The click a tap synthesises is a PointerEvent and says so itself, so nothing has to infer
        // the device from the shape of the gesture.
        const tap = createEvent.click(leafNode!);
        Object.defineProperty(tap, "pointerType", { value: "touch" });
        fireEvent(leafNode!, tap);
        expect(dispatchSurfaceInputAction.mock.calls[0]?.[0]).toMatchObject({ source: "touch" });

        fireEvent.click(leafNode!);
        expect(dispatchSurfaceInputAction.mock.calls[1]?.[0]).toMatchObject({ source: "pointer" });
    });
});

/**
 * One physical wheel gesture counts once.
 *
 * The bug these guard: a flick that opens a page keeps producing events for the length of its
 * momentum tail, and an action bound to a wheel on the page that just opened fires from the same
 * flick that opened it. Both sides of the boundary are checked - inside the tail nothing fires,
 * after the silence a new flick works exactly as the first one did.
 */
describe("a wheel gesture something has answered", () => {
    it("fires nothing for the rest of the tail, then everything again after the silence", () => {
        const { dispatchSurfaceInputAction, leafNode } = renderSurface({ actions: [{ actionId: "advance" }] });

        fireWheelAt(leafNode!, 1_000, { deltaY: 120 });
        expect(firedActionIds(dispatchSurfaceInputAction)).toEqual(["advance"]);

        // The tail: frame-cadence events for the next second, each one inside the window the one
        // before it opened.
        for (let at = 1_016; at <= 2_000; at += 16) {
            fireWheelAt(leafNode!, at, { deltaY: 120 });
        }
        expect(firedActionIds(dispatchSurfaceInputAction)).toEqual(["advance"]);

        // The fingers came back. A new gesture, and it is answered like any other.
        fireWheelAt(leafNode!, 2_000 + WHEEL_GESTURE_SILENCE_MS + 1, { deltaY: 120 });
        expect(firedActionIds(dispatchSurfaceInputAction)).toEqual(["advance", "advance"]);
    });

    it("swallows the tail whichever direction it decays in", () => {
        const { dispatchSurfaceInputAction, leafNode } = renderSurface({ actions: [{ actionId: "advance" }] });

        fireWheelAt(leafNode!, 1_000, { deltaY: 120 });
        expect(firedActionIds(dispatchSurfaceInputAction)).toEqual(["advance"]);

        // A tail that overshoots and comes back the other way is still the same flick. The gate is
        // about the gesture, not about which of four directions an event of it happened to be.
        fireWheelAt(leafNode!, 1_016, { deltaY: -120 });
        fireWheelAt(leafNode!, 1_032, { deltaY: 120 });
        expect(firedActionIds(dispatchSurfaceInputAction)).toEqual(["advance"]);
    });

    it("leaves the gesture alone when nothing consumed it", () => {
        const { dispatchSurfaceInputAction, leafNode } = renderSurface({
            actions: [{ actionId: "advance", consume: false }],
        });

        fireWheelAt(leafNode!, 1_000, { deltaY: 120 });
        fireWheelAt(leafNode!, 1_016, { deltaY: 120 });

        // Nothing claimed the gesture, so nothing is being protected from it: an action that does
        // not end the walk does not end the flick either.
        expect(firedActionIds(dispatchSurfaceInputAction)).toEqual(["advance", "advance"]);
    });

    it("silences the element's own wheel head too, not only the surface's action", () => {
        const { dispatchElementBlueprintEvent, leafNode } = renderSurface({ actions: [{ actionId: "advance" }] });
        const wheelHeadCalls = () =>
            dispatchElementBlueprintEvent.mock.calls.filter(call => call[1] === "mouseWheel").length;

        fireWheelAt(leafNode!, 1_000, { deltaY: 120 });
        const answered = wheelHeadCalls();
        expect(answered).toBeGreaterThan(0);

        fireWheelAt(leafNode!, 1_016, { deltaY: 120 });
        fireWheelAt(leafNode!, 1_032, { deltaY: 120 });
        expect(wheelHeadCalls()).toBe(answered);

        fireWheelAt(leafNode!, 1_032 + WHEEL_GESTURE_SILENCE_MS + 1, { deltaY: 120 });
        expect(wheelHeadCalls()).toBeGreaterThan(answered);
    });
});

/**
 * The game's global blueprint takes its turn at the first lane an input lands on.
 *
 * It answers every action in the vocabulary rather than a list it switched on, before the lane's own
 * actions and under the same rule for controls. What these pin is the part of that the key half
 * cannot show: the lane's own actions wait for the global's answer, a global stop keeps the input
 * from the lane, and a gesture the global answered is spent however the lane answered it.
 */
describe("the global blueprint's turn on a lane", () => {
    /** A global blueprint whose answer the test releases, recording what it was asked. */
    function heldGlobal(options: { stops?: boolean } = {}) {
        const asked: string[][] = [];
        let release: () => void = () => undefined;
        const answered = new Promise<void>(resolve => {
            release = resolve;
        });
        const answerGlobally: GlobalInputActionAnswerer = async (payloads, eventControl) => {
            asked.push(payloads.map(payload => payload.actionId));
            await answered;
            if (options.stops) {
                eventControl.stopPropagation();
            }
        };
        return { answerGlobally, asked, release: () => release() };
    }

    /** Let the microtasks a released answer queued run out. */
    const flush = () => new Promise(resolve => setTimeout(resolve, 0));

    it("hears every action a gesture is bound to, on a surface that answers none of them", () => {
        const global = heldGlobal();
        const { leafNode } = renderSurface({ answerGlobally: global.answerGlobally });

        fireEvent.click(leafNode!);

        expect(global.asked).toEqual([["advance"]]);
    });

    it("stands down over a control, as the surface's own action does", () => {
        const global = heldGlobal();
        const { leafNode } = renderSurface({ leaf: { type: "nl.button" }, answerGlobally: global.answerGlobally });

        fireEvent.click(leafNode!);

        expect(global.asked).toEqual([]);
    });

    it("holds the surface's own action until it has answered", async () => {
        const global = heldGlobal();
        const { dispatchSurfaceInputAction, leafNode } = renderSurface({
            actions: [{ actionId: "advance" }],
            answerGlobally: global.answerGlobally,
        });

        fireEvent.click(leafNode!);
        await flush();
        expect(global.asked).toEqual([["advance"]]);
        expect(firedActionIds(dispatchSurfaceInputAction)).toEqual([]);

        global.release();
        await flush();
        expect(firedActionIds(dispatchSurfaceInputAction)).toEqual(["advance"]);
    });

    it("keeps the input from the surface when a global handler stops it", async () => {
        const global = heldGlobal({ stops: true });
        const { dispatchSurfaceInputAction, leafNode } = renderSurface({
            actions: [{ actionId: "advance" }],
            answerGlobally: global.answerGlobally,
        });

        fireEvent.click(leafNode!);
        global.release();
        await flush();

        expect(firedActionIds(dispatchSurfaceInputAction)).toEqual([]);
    });

    it("does not decide where the input goes: a surface that passes still passes it on", () => {
        const global = heldGlobal();
        const { onwards, leafNode } = renderSurface({
            actions: [{ actionId: "advance", consume: false }],
            answerGlobally: global.answerGlobally,
        });

        fireEvent.click(leafNode!);

        expect(onwards).toHaveBeenCalledTimes(1);
    });

    it("spends a scroll it answered, so the tail fires nothing - even on a surface that passes", async () => {
        const global = heldGlobal();
        const { dispatchSurfaceInputAction, leafNode } = renderSurface({
            actions: [{ actionId: "advance", consume: false }],
            answerGlobally: global.answerGlobally,
        });

        fireWheelAt(leafNode!, 1_000, { deltaY: 120 });
        fireWheelAt(leafNode!, 1_016, { deltaY: 120 });
        fireWheelAt(leafNode!, 1_032, { deltaY: 120 });
        global.release();
        await flush();

        expect(global.asked).toEqual([["advance"]]);
        // The event in hand is still the surface's; the rest of the flick is nobody's.
        expect(firedActionIds(dispatchSurfaceInputAction)).toEqual(["advance"]);
    });

    it("is offered one physical input once, however many lanes it crosses", async () => {
        const global = heldGlobal();
        const front = renderSurface({
            actions: [{ actionId: "advance", consume: false }],
            answerGlobally: global.answerGlobally,
            runtimeScopeId: "front",
        });
        const behind = renderSurface({
            actions: [{ actionId: "advance" }],
            answerGlobally: global.answerGlobally,
            runtimeScopeId: "behind",
        });
        // jsdom paints nothing, so there is no hit test to find the lane behind: stand one in, as the
        // browser's own answer for "what is under this point once the front lane is discounted".
        const ownerDocument = front.leafNode!.ownerDocument as Document & { elementsFromPoint?: unknown };
        const original = ownerDocument.elementsFromPoint;
        ownerDocument.elementsFromPoint = () => [front.leafNode!, behind.leafNode!];
        try {
            fireEvent.click(front.leafNode!, { clientX: 10, clientY: 10 });
        } finally {
            ownerDocument.elementsFromPoint = original;
        }
        expect(global.asked).toEqual([["advance"]]);
        expect(firedActionIds(front.dispatchSurfaceInputAction)).toEqual([]);
        expect(firedActionIds(behind.dispatchSurfaceInputAction)).toEqual([]);

        global.release();
        await flush();
        // Both lanes answer, and the lane behind waited for the global as the one in front did.
        expect(firedActionIds(front.dispatchSurfaceInputAction)).toEqual(["advance"]);
        expect(firedActionIds(behind.dispatchSurfaceInputAction)).toEqual(["advance"]);
    });
});
