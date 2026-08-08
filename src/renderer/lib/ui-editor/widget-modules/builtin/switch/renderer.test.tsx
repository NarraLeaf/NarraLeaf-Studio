// @vitest-environment jsdom
import { cleanup, fireEvent, render, type RenderResult } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import { UI_SWITCH_ON_VARIANT_ID } from "@shared/types/ui-editor/switch";
import { WidgetRuntimeStateProvider } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { SwitchRenderer } from "./renderer";

type RenderCall = {
    childrenIds?: string[];
    elementOverrides?: Record<string, UIElement>;
};

/**
 * jsdom lays nothing out, so every rect is 0x0 and the drag maths would be meaningless. These are
 * the numbers the stub below reports for both the host and the track, so a clientX of
 * `TRACK_LEFT + n` sits at `n / TRACK_WIDTH` along the track.
 */
const TRACK_LEFT = 100;
const TRACK_TOP = 50;
const TRACK_WIDTH = 52;
const TRACK_HEIGHT = 28;

afterEach(() => {
    cleanup();
});

function stubbedRect(): DOMRect {
    return {
        x: TRACK_LEFT,
        y: TRACK_TOP,
        left: TRACK_LEFT,
        top: TRACK_TOP,
        right: TRACK_LEFT + TRACK_WIDTH,
        bottom: TRACK_TOP + TRACK_HEIGHT,
        width: TRACK_WIDTH,
        height: TRACK_HEIGHT,
        toJSON: () => ({}),
    } as DOMRect;
}

function stubLayout(view: RenderResult): void {
    const rect = stubbedRect();
    for (const node of view.container.querySelectorAll<HTMLElement>('[role="switch"], [data-ui-element-id]')) {
        node.getBoundingClientRect = () => rect;
    }
}

function createDocument(options?: { checked?: boolean; interactionDisabled?: boolean; withParts?: boolean }): UIDocument {
    const withParts = options?.withParts ?? true;
    const elements: UIDocument["elements"] = {
        root: {
            id: "root",
            type: "nl.root",
            parentId: null,
            childrenIds: ["switch"],
            layout: { x: 0, y: 0, width: 320, height: 180 },
        },
        switch: {
            id: "switch",
            type: "nl.switch",
            parentId: "root",
            childrenIds: withParts ? ["track", "thumb"] : [],
            layout: { x: 0, y: 0, width: 52, height: 28 },
            props: {
                checked: options?.checked ?? false,
                interactionDisabled: options?.interactionDisabled ?? false,
                trackElementId: withParts ? "track" : null,
                thumbElementId: withParts ? "thumb" : null,
            },
        },
    };
    if (withParts) {
        elements.track = {
            id: "track",
            type: "nl.container",
            parentId: "switch",
            childrenIds: [],
            extra: { switchSlot: "track" },
            layout: { x: 0, y: 0, width: 52, height: 28 },
        };
        elements.thumb = {
            id: "thumb",
            type: "nl.container",
            parentId: "switch",
            childrenIds: [],
            extra: { switchSlot: "thumb" },
            layout: { x: 3, y: 3, width: 22, height: 22 },
        };
    }
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [
            {
                id: "surface",
                name: "Surface",
                host: "app",
                kind: "appSurface",
                designSize: { width: 320, height: 180 },
                rootElementId: "root",
            },
        ],
        elements,
    };
}

function mountSwitch(document: UIDocument, options?: { withRuntime?: boolean }) {
    const renderCalls: RenderCall[] = [];
    const store = new WidgetRuntimeStateStore();
    const dispatchElementBlueprintEvent = vi.fn(
        async (_elementId: string, _eventName: string, _payload?: Record<string, unknown>) => {},
    );
    const hostAdapter = (options?.withRuntime ?? true
        ? { host: "app", blueprintRuntime: { surfaceId: "surface", dispatchElementBlueprintEvent } }
        : { host: "app" }) as unknown as UIHostAdapter;

    const view = render(
        <WidgetRuntimeStateProvider externalStore={store}>
            <SwitchRenderer
                element={document.elements.switch as UIElement}
                document={document}
                surface={document.surfaces[0]!}
                hostAdapter={hostAdapter}
                renderChildren={callOptions => {
                    renderCalls.push(callOptions ?? {});
                    const ids = callOptions?.childrenIds ?? [];
                    return ids.map(id => <div key={id} data-ui-element-id={id} />);
                }}
            />
        </WidgetRuntimeStateProvider>,
    );
    stubLayout(view);

    const root = view.container.querySelector<HTMLElement>('[role="switch"]')!;
    return { renderCalls, store, dispatchElementBlueprintEvent, root, view };
}

function lastCall(renderCalls: RenderCall[]): RenderCall | undefined {
    return renderCalls[renderCalls.length - 1];
}

function variantOf(call: RenderCall | undefined, id: string): string | undefined {
    const override = call?.elementOverrides?.[id];
    return (override?.extra as { runtimeVariantOverrideId?: string } | undefined)?.runtimeVariantOverrideId;
}

function interactionEvents(dispatch: ReturnType<typeof vi.fn>): unknown[] {
    return dispatch.mock.calls.map(call => call[1]).filter(name => name !== "flush");
}

async function press(root: HTMLElement, offsetX: number): Promise<void> {
    await act(async () => {
        fireEvent.pointerDown(root, {
            button: 0,
            clientX: TRACK_LEFT + offsetX,
            clientY: TRACK_TOP + TRACK_HEIGHT / 2,
        });
    });
}

async function movePointer(offsetX: number, offsetY = TRACK_HEIGHT / 2): Promise<void> {
    await act(async () => {
        fireEvent.pointerMove(window, { clientX: TRACK_LEFT + offsetX, clientY: TRACK_TOP + offsetY });
    });
}

async function release(offsetX: number): Promise<void> {
    await act(async () => {
        fireEvent.pointerUp(window, {
            clientX: TRACK_LEFT + offsetX,
            clientY: TRACK_TOP + TRACK_HEIGHT / 2,
        });
    });
}

describe("SwitchRenderer", () => {
    it("flips both parts to the on variant while checked, and leaves geometry alone", () => {
        const document = createDocument({ checked: true });
        const { renderCalls, root } = mountSwitch(document);

        expect(root.getAttribute("aria-checked")).toBe("true");
        expect(root.getAttribute("data-ui-switch-checked")).toBe("true");
        expect(lastCall(renderCalls)?.childrenIds).toEqual(["track", "thumb"]);
        expect(variantOf(lastCall(renderCalls), "track")).toBe(UI_SWITCH_ON_VARIANT_ID);
        expect(variantOf(lastCall(renderCalls), "thumb")).toBe(UI_SWITCH_ON_VARIANT_ID);
        expect(lastCall(renderCalls)?.elementOverrides?.track?.layout).toEqual(document.elements.track!.layout);
        expect(lastCall(renderCalls)?.elementOverrides?.thumb?.layout).toEqual(document.elements.thumb!.layout);
    });

    it("leaves both parts on the default variant while unchecked", () => {
        const document = createDocument({ checked: false });
        const { renderCalls, root } = mountSwitch(document);

        expect(root.getAttribute("data-ui-switch-checked")).toBe("false");
        expect(lastCall(renderCalls)?.elementOverrides).toBeUndefined();
        expect(variantOf(lastCall(renderCalls), "track")).toBeUndefined();
        expect(variantOf(lastCall(renderCalls), "thumb")).toBeUndefined();
    });

    it("toggles on release of a press that never moved, and dispatches changed then turnedOn", async () => {
        const document = createDocument({ checked: false });
        const { renderCalls, root, store, dispatchElementBlueprintEvent } = mountSwitch(document);

        await press(root, 5);
        // Pressing alone commits nothing - the release is what decides.
        expect(store.getSwitchProperties("switch")).toBeUndefined();

        await release(5);

        expect(store.getSwitchProperties("switch")).toEqual({ checked: true });
        expect(root.getAttribute("aria-checked")).toBe("true");
        expect(variantOf(lastCall(renderCalls), "thumb")).toBe(UI_SWITCH_ON_VARIANT_ID);
        // `flush` is rAF-coalesced and may or may not have landed yet; the ordered pair is the contract.
        expect(interactionEvents(dispatchElementBlueprintEvent)).toEqual(["changed", "turnedOn"]);
        expect(dispatchElementBlueprintEvent.mock.calls[0]?.[2]).toEqual({ checked: true, previousChecked: false });
    });

    it("treats a press that drifts inside the slop as a click, not as a drag", async () => {
        const document = createDocument({ checked: false });
        const { root, store, dispatchElementBlueprintEvent } = mountSwitch(document);

        await press(root, 5);
        // 2px of drift. Read as a drag this would resolve to the near (off) side and commit nothing.
        await movePointer(7);
        expect(root.getAttribute("data-ui-switch-pending")).toBeNull();

        await release(7);

        expect(store.getSwitchProperties("switch")).toEqual({ checked: true });
        expect(interactionEvents(dispatchElementBlueprintEvent)).toEqual(["changed", "turnedOn"]);
    });

    it("previews and then commits the far side when a drag crosses half the track", async () => {
        const document = createDocument({ checked: false });
        const { renderCalls, root, store, dispatchElementBlueprintEvent } = mountSwitch(document);

        await press(root, 5);
        await movePointer(45);

        // Mid-drag feedback is the same variant override the committed state uses; no runtime write yet.
        expect(root.getAttribute("data-ui-switch-pending")).toBe("true");
        expect(root.getAttribute("data-ui-switch-checked")).toBe("false");
        expect(variantOf(lastCall(renderCalls), "thumb")).toBe(UI_SWITCH_ON_VARIANT_ID);
        expect(lastCall(renderCalls)?.elementOverrides?.thumb?.layout).toEqual(document.elements.thumb!.layout);
        expect(store.getSwitchProperties("switch")).toBeUndefined();
        expect(dispatchElementBlueprintEvent).not.toHaveBeenCalled();

        await release(45);

        expect(store.getSwitchProperties("switch")).toEqual({ checked: true });
        expect(root.getAttribute("data-ui-switch-pending")).toBeNull();
        expect(interactionEvents(dispatchElementBlueprintEvent)).toEqual(["changed", "turnedOn"]);
        expect(dispatchElementBlueprintEvent.mock.calls[0]?.[2]).toEqual({ checked: true, previousChecked: false });
    });

    it("commits nothing when a drag stops short of half the track", async () => {
        const document = createDocument({ checked: false });
        const { root, store, dispatchElementBlueprintEvent } = mountSwitch(document);

        await press(root, 5);
        await movePointer(15);
        expect(root.getAttribute("data-ui-switch-pending")).toBe("false");

        await release(15);

        expect(store.getSwitchProperties("switch")).toBeUndefined();
        expect(root.getAttribute("aria-checked")).toBe("false");
        expect(dispatchElementBlueprintEvent).not.toHaveBeenCalled();
    });

    it("drags an on switch back off once the pointer crosses below half", async () => {
        const document = createDocument({ checked: true });
        const { root, store, dispatchElementBlueprintEvent } = mountSwitch(document);

        await press(root, 45);
        await movePointer(10);
        expect(root.getAttribute("data-ui-switch-pending")).toBe("false");

        await release(10);

        expect(store.getSwitchProperties("switch")).toEqual({ checked: false });
        expect(interactionEvents(dispatchElementBlueprintEvent)).toEqual(["changed", "turnedOff"]);
        expect(dispatchElementBlueprintEvent.mock.calls[0]?.[2]).toEqual({ checked: false, previousChecked: true });
    });

    it("leaves the switch untouched when the gesture is cancelled instead of released", async () => {
        const document = createDocument({ checked: false });
        const { root, store, dispatchElementBlueprintEvent } = mountSwitch(document);

        await press(root, 5);
        await movePointer(45);
        expect(root.getAttribute("data-ui-switch-pending")).toBe("true");

        await act(async () => {
            fireEvent.pointerCancel(window, { clientX: TRACK_LEFT + 45, clientY: TRACK_TOP + 14 });
        });

        expect(root.getAttribute("data-ui-switch-pending")).toBeNull();
        expect(store.getSwitchProperties("switch")).toBeUndefined();
        expect(dispatchElementBlueprintEvent).not.toHaveBeenCalled();
    });

    it("toggles on Space and on Enter", async () => {
        const document = createDocument({ checked: false });
        const { root, store } = mountSwitch(document);

        await act(async () => {
            fireEvent.keyDown(root, { key: " " });
        });
        expect(store.getSwitchProperties("switch")).toEqual({ checked: true });

        await act(async () => {
            fireEvent.keyDown(root, { key: "Enter" });
        });
        expect(store.getSwitchProperties("switch")).toEqual({ checked: false });
    });

    it("does not toggle while interaction is disabled", async () => {
        const document = createDocument({ checked: false, interactionDisabled: true });
        const { root, store, dispatchElementBlueprintEvent } = mountSwitch(document);

        expect(root.getAttribute("aria-disabled")).toBe("true");

        await press(root, 5);
        await act(async () => {
            fireEvent.keyDown(root, { key: " " });
        });

        expect(store.getSwitchProperties("switch")).toBeUndefined();
        expect(root.getAttribute("aria-checked")).toBe("false");
        expect(dispatchElementBlueprintEvent).not.toHaveBeenCalled();
    });

    it("does not drag while interaction is disabled", async () => {
        const document = createDocument({ checked: false, interactionDisabled: true });
        const { root, store, dispatchElementBlueprintEvent } = mountSwitch(document);

        await press(root, 5);
        await movePointer(45);
        expect(root.getAttribute("data-ui-switch-pending")).toBeNull();

        await release(45);

        expect(store.getSwitchProperties("switch")).toBeUndefined();
        expect(root.getAttribute("data-ui-switch-checked")).toBe("false");
        expect(dispatchElementBlueprintEvent).not.toHaveBeenCalled();
    });

    it("does not toggle without a blueprint runtime (the editor canvas is not playable)", async () => {
        const document = createDocument({ checked: false });
        const { root, store } = mountSwitch(document, { withRuntime: false });

        expect(root.getAttribute("aria-disabled")).toBe("true");
        await press(root, 5);
        await release(5);
        expect(store.getSwitchProperties("switch")).toBeUndefined();
    });

    it("renders fallback chrome instead of throwing when the parts are gone", async () => {
        const document = createDocument({ withParts: false });
        const { renderCalls, root, view } = mountSwitch(document);

        expect(view.container.querySelector('[data-ui-switch-part="track"]')).not.toBeNull();
        expect(view.container.querySelector('[data-ui-switch-part="thumb"]')).not.toBeNull();
        expect(renderCalls).toEqual([]);

        await press(root, 5);
        await release(5);
        expect(root.getAttribute("aria-checked")).toBe("true");
    });
});
