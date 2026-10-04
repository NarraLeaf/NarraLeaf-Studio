// @vitest-environment jsdom
/**
 * A page shown in a Page widget runs its own Surface `Mouse Click` and `Right Click`.
 *
 * A top-level page hears its clicks on the shell it is drawn in; a frame draws its pages without
 * one, so the page's Surface heads were never asked and the surface holding the frame answered the
 * press alone. These render the real surface renderer, the real frame and the real page inside it,
 * and assert on what each runtime receives: the page first, then the surface around it, which still
 * hears every click inside the frame.
 */
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement, type UISurface } from "@shared/types/ui-editor/document";
import { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { BuiltinElementRenderers } from "@/lib/ui-editor/runtime/builtin";
import { WidgetRuntimeStateProvider } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { GameSurfaceRenderer } from "@/lib/ui-editor/runtime/surface/GameSurfaceRenderer";
import type { NestedSurfaceRuntime } from "@/lib/ui-editor/runtime/surface/SurfaceElementTree";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { ensureAnimationFramePolyfill } from "@/lib/ui-editor/runtime/testing/lifecycleTestKit";
import { installResizeObserverStub } from "@/lib/ui-editor/runtime/testing/drawingLabFixture";

function element(id: string, type: string, parentId: string | null, childrenIds: string[], more?: Partial<UIElement>): UIElement {
    return { id, type, parentId, childrenIds, layout: { x: 0, y: 0, width: 200, height: 60 }, ...more };
}

function surfaceOf(id: string, rootElementId: string, size: { width: number; height: number }): UISurface {
    return { id, name: id, host: "app", kind: "appSurface", designSize: size, rootElementId } as UISurface;
}

/** A page with a frame onto a menu that holds one button. */
const document = {
    schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
    id: "doc",
    name: "Doc",
    surfaces: [
        surfaceOf("host", "hostRoot", { width: 640, height: 360 }),
        surfaceOf("menu", "menuRoot", { width: 320, height: 180 }),
    ],
    elements: {
        hostRoot: element("hostRoot", "nl.root", null, ["frame"]),
        frame: element("frame", "nl.frame", "hostRoot", [], {
            layout: { x: 0, y: 0, width: 320, height: 180 },
            props: { targetSurfaceId: "menu" },
        }),
        menuRoot: element("menuRoot", "nl.root", null, ["load"]),
        load: element("load", "nl.button", "menuRoot", [], { props: { label: "Load" } }),
    },
} as unknown as UIDocument;

type Heard = { surface: string; eventName: string; payload: unknown };

/** A page runtime that writes every surface event it is handed into one shared log. */
function recordingRuntime(surfaceId: string, runtimeScopeId: string, log: Heard[]): UIHostAdapter {
    return {
        host: "app",
        blueprintRuntime: {
            surfaceId,
            runtimeScopeId,
            setSurfaceState: () => undefined,
            getSurfaceState: () => undefined,
            emitDebug: () => undefined,
            dispatchElementBlueprintEvent: async () => undefined,
            dispatchSurfaceBlueprintEvent: async (eventName: string, payload?: unknown) => {
                log.push({ surface: surfaceId, eventName, payload });
            },
        },
    } as unknown as UIHostAdapter;
}

const POINTER_EVENTS = new Set(["mouseClick", "rightClick"]);

function renderHost(nested: boolean) {
    const log: Heard[] = [];
    const nestedSurfaceRuntime: NestedSurfaceRuntime | undefined = nested
        ? { createHostAdapter: input => recordingRuntime(input.targetSurface.id, input.runtimeScopeId, log) }
        : undefined;
    const view = render(
        <WidgetRuntimeStateProvider>
            <GameSurfaceRenderer
                document={document}
                surface={document.surfaces[0]!}
                rendererRegistry={new ElementRendererRegistry(BuiltinElementRenderers)}
                scale={1}
                hostAdapter={recordingRuntime("host", "host-scope", log)}
                nestedSurfaceRuntime={nestedSurfaceRuntime}
                interactive
            />
        </WidgetRuntimeStateProvider>,
    );
    return { ...view, pointerLog: () => log.filter(entry => POINTER_EVENTS.has(entry.eventName)) };
}

/** The label a button draws, which is what a player aims at. */
function labelNode(container: HTMLElement, label: string): HTMLElement {
    const node = Array.from(container.querySelectorAll<HTMLElement>("*"))
        .filter(candidate => candidate.children.length === 0)
        .find(candidate => candidate.textContent?.trim() === label);
    if (!node) {
        throw new Error(`no "${label}" on screen`);
    }
    return node;
}

async function pageReady(container: HTMLElement): Promise<void> {
    await waitFor(() =>
        expect(container.querySelector("[data-ui-surface-id='menu']")?.getAttribute("data-ui-surface-prepaint")).toBe("ready"),
    );
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 20));
    });
}

beforeAll(() => {
    ensureAnimationFramePolyfill();
    installResizeObserverStub();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => cleanup());

describe("a page shown in a frame", () => {
    it("hears a click on one of its elements with its own Mouse Click, before the surface holding the frame", async () => {
        const { container, pointerLog } = renderHost(true);
        await pageReady(container);

        fireEvent.click(labelNode(container, "Load"), { clientX: 30, clientY: 40 });

        expect(pointerLog().map(entry => `${entry.surface}:${entry.eventName}`)).toEqual(["menu:mouseClick", "host:mouseClick"]);
        expect(pointerLog()[0]!.payload).toEqual({ x: 30, y: 40 });
    });

    it("hears a right click the same way", async () => {
        const { container, pointerLog } = renderHost(true);
        await pageReady(container);

        fireEvent.contextMenu(labelNode(container, "Load"), { clientX: 12, clientY: 8 });

        expect(pointerLog().map(entry => `${entry.surface}:${entry.eventName}`)).toEqual(["menu:rightClick", "host:rightClick"]);
    });

    it("leaves a click on an empty part of it to the frame and the surface around it", async () => {
        // A page takes a press where one of its elements is drawn. In a frame, the rest of the page
        // lies over the frame, and a press there is the frame's.
        const { container, pointerLog } = renderHost(true);
        await pageReady(container);

        fireEvent.click(container.querySelector("[data-ui-surface-id='menu']")!, { clientX: 300, clientY: 170 });

        expect(pointerLog().map(entry => `${entry.surface}:${entry.eventName}`)).toEqual(["host:mouseClick"]);
    });

    it("does not answer for the surface around it when it has no runtime of its own", async () => {
        // An editor preview draws the page on the host's runtime; dispatching there would be the
        // surface holding the frame hearing the same click twice.
        const { container, pointerLog } = renderHost(false);
        await pageReady(container);

        fireEvent.click(labelNode(container, "Load"));

        expect(pointerLog().map(entry => `${entry.surface}:${entry.eventName}`)).toEqual(["host:mouseClick"]);
    });
});
