// @vitest-environment jsdom
/**
 * A page a frame goes back to while it is still fading out reads as arriving from that moment.
 *
 * Pointing a frame back at the page it has just left, before that page has finished leaving, brings
 * the same page back rather than drawing a new one. It had already said it was exiting, and it went
 * on saying so - `Is Surface Exiting` true on a page back on screen and taking presses - until the
 * enter animation of its return had played out. A page of the app's own stack had the same hole; it
 * is pinned in `pressDuringPageExit.test.tsx`.
 *
 * The real element tree, frame, animation layer and page are rendered; the pages' runtimes are
 * recorders, and the answer is read through the reading nodes themselves.
 */
import { cleanup, render, waitFor, act } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement, type UISurface } from "@shared/types/ui-editor/document";
import { DEFAULT_UI_PAGE_ANIMATION_SETTINGS } from "@shared/types/ui-editor/pageAnimation";
import {
    BLUEPRINT_NODE_TYPE_PAGE_IS_SURFACE_ENTERING,
    BLUEPRINT_NODE_TYPE_PAGE_IS_SURFACE_EXITING,
} from "@shared/types/blueprint/graph";
import { resolveDataPinValue } from "@/lib/ui-editor/blueprint-nodes/built-in/graphParamResolvers";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { BuiltinElementRenderers } from "@/lib/ui-editor/runtime/builtin";
import { WidgetRuntimeStateProvider } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { ensureAnimationFramePolyfill } from "@/lib/ui-editor/runtime/testing/lifecycleTestKit";
import { installResizeObserverStub } from "@/lib/ui-editor/runtime/testing/drawingLabFixture";
import { SurfaceElementTree } from "./SurfaceElementTree";

/** A cross-fade slow enough that the frame can be pointed back while the page it left still fades. */
const CROSS_FADE = {
    ...DEFAULT_UI_PAGE_ANIMATION_SETTINGS,
    enter: "fade" as const,
    enterDurationSeconds: 0.6,
    exit: "fade" as const,
    exitDurationSeconds: 0.6,
    exitBlocking: false,
};

function element(id: string, type: string, parentId: string | null, childrenIds: string[], more?: Partial<UIElement>): UIElement {
    return { id, type, parentId, childrenIds, layout: { x: 0, y: 0, width: 200, height: 60 }, ...more };
}

function surfaceOf(id: string, rootElementId: string): UISurface {
    return {
        id,
        name: id,
        host: "app",
        kind: "appSurface",
        designSize: { width: 640, height: 360 },
        rootElementId,
        settings: { pageAnimation: CROSS_FADE },
    } as UISurface;
}

/** A page holding a frame, pointed at one of two pages. */
function documentShowing(targetSurfaceId: string): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [surfaceOf("host", "hostRoot"), surfaceOf("tabA", "tabARoot"), surfaceOf("tabB", "tabBRoot")],
        elements: {
            hostRoot: element("hostRoot", "nl.root", null, ["frame"]),
            frame: element("frame", "nl.frame", "hostRoot", [], {
                layout: { x: 0, y: 0, width: 640, height: 360 },
                props: { targetSurfaceId },
            }),
            tabARoot: element("tabARoot", "nl.root", null, ["a"]),
            a: element("a", "nl.button", "tabARoot", [], { props: { label: "A" } }),
            tabBRoot: element("tabBRoot", "nl.root", null, ["b"]),
            b: element("b", "nl.button", "tabBRoot", [], { props: { label: "B" } }),
        },
    } as unknown as UIDocument;
}

function recordingAdapter(surfaceId: string, runtimeScopeId: string) {
    const surfaceEvents: string[] = [];
    const adapter = {
        host: "app",
        blueprintRuntime: {
            surfaceId,
            runtimeScopeId,
            setSurfaceState: () => undefined,
            getSurfaceState: () => undefined,
            emitDebug: () => undefined,
            dispatchElementBlueprintEvent: async () => undefined,
            dispatchSurfaceBlueprintEvent: async (eventName: string) => {
                surfaceEvents.push(eventName);
            },
        },
    } as unknown as UIHostAdapter;
    return { adapter, surfaceEvents };
}

type RecordingAdapter = ReturnType<typeof recordingAdapter>;

/** What `Is Surface Exiting` and `Is Surface Entering` answer on this page right now. */
function transitionAnswers(page: RecordingAdapter): { exiting: unknown; entering: unknown } {
    const read = (type: string, port: string) =>
        resolveDataPinValue({ nodes: { node: { type, params: {} } } }, "node", port, {}, undefined, 0, {
            hostAdapter: page.adapter,
        });
    return {
        exiting: read(BLUEPRINT_NODE_TYPE_PAGE_IS_SURFACE_EXITING, "isExiting"),
        entering: read(BLUEPRINT_NODE_TYPE_PAGE_IS_SURFACE_ENTERING, "isEntering"),
    };
}

function layerOf(container: HTMLElement, surfaceId: string): HTMLElement | null {
    return container.querySelector<HTMLElement>(`[data-ui-surface-id="${surfaceId}"][data-ui-surface-prepaint]`);
}

function isLeaving(layer: HTMLElement | null): boolean {
    return Boolean(layer && Number(layer.style.zIndex) >= 30);
}

async function settle(ms = 20): Promise<void> {
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, ms));
    });
}

beforeAll(() => {
    ensureAnimationFramePolyfill();
    installResizeObserverStub();
    registerCoreBlueprintNodes();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => cleanup());

describe("a page a frame goes back to while it still fades out", () => {
    it("reads as arriving, not leaving, from the moment it is back", async () => {
        // The runtime each drawing of a page was given, latest last: the page brought back keeps its
        // runtime scope, and it is that drawing's answer that a graph on it reads.
        const pages = new Map<string, RecordingAdapter>();
        const host = recordingAdapter("host", "host-scope");
        const registry = new ElementRendererRegistry(BuiltinElementRenderers);
        const tree = (document: UIDocument) => (
            <WidgetRuntimeStateProvider>
                <SurfaceElementTree
                    document={document}
                    surface={document.surfaces[0]!}
                    rootElement={document.elements.hostRoot!}
                    rendererRegistry={registry}
                    hostAdapter={host.adapter}
                    editorChrome={true}
                    nestedSurfaceRuntime={{
                        createHostAdapter: input => {
                            const page = pages.get(input.targetSurface.id) ?? recordingAdapter(input.targetSurface.id, input.runtimeScopeId);
                            pages.set(input.targetSurface.id, page);
                            return page.adapter;
                        },
                    }}
                />
            </WidgetRuntimeStateProvider>
        );
        const view = render(tree(documentShowing("tabA")));
        await waitFor(() => expect(pages.get("tabA")?.surfaceEvents).toContain("afterSurfaceEnter"), { timeout: 3000 });
        const tabA = pages.get("tabA")!;

        view.rerender(tree(documentShowing("tabB")));
        await waitFor(() => expect(isLeaving(layerOf(view.container, "tabA"))).toBe(true), { timeout: 3000 });
        await settle();
        const whileLeaving = transitionAnswers(tabA);

        view.rerender(tree(documentShowing("tabA")));
        await waitFor(() => expect(isLeaving(layerOf(view.container, "tabA"))).toBe(false));

        expect(tabA.surfaceEvents.filter(event => event === "afterSurfaceEnter")).toHaveLength(1);
        expect(whileLeaving).toEqual({ exiting: true, entering: false });
        expect(transitionAnswers(tabA)).toEqual({ exiting: false, entering: true });

        await waitFor(() => expect(tabA.surfaceEvents.filter(event => event === "afterSurfaceEnter")).toHaveLength(2), {
            timeout: 3000,
        });
        expect(transitionAnswers(tabA)).toEqual({ exiting: false, entering: false });
    });
});
