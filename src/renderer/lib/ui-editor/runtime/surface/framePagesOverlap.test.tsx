// @vitest-environment jsdom
/**
 * While a frame changes page, the page leaving and the page arriving are both drawn in the frame's
 * own area, over each other - so the animations they are given actually play.
 *
 * They were drawn one after the other in flow. The second of them sat just below the frame's box,
 * where the frame clips it away: in a cross-fade the leaving page vanished the moment the change
 * began, and when the page being left is held until its replacement has arrived, that arrival played
 * out of sight and the new page jumped in at the end.
 *
 * jsdom lays nothing out, so each page's box is worked out from the styles that place it
 * (`boxLayoutModel`); the frame, its widget, the animation layers and the element tree are the real
 * ones. What a page looks like in a frame at rest - where it sits, its size, how a page of other
 * proportions is fitted, its background - is pinned beside the change, so that it can be seen not to
 * have moved.
 */
import { cleanup, render, waitFor, act } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
    UI_DOCUMENT_SCHEMA_VERSION,
    type UIDocument,
    type UIElement,
    type UISurface,
} from "@shared/types/ui-editor/document";
import { DEFAULT_UI_PAGE_ANIMATION_SETTINGS, type UIPageAnimationSettings } from "@shared/types/ui-editor/pageAnimation";
import { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { BuiltinElementRenderers } from "@/lib/ui-editor/runtime/builtin";
import { WidgetRuntimeStateProvider } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { ensureAnimationFramePolyfill } from "@/lib/ui-editor/runtime/testing/lifecycleTestKit";
import { installResizeObserverStub } from "@/lib/ui-editor/runtime/testing/drawingLabFixture";
import { laidOutBoxIn, type LaidOutBox } from "@/lib/ui-editor/runtime/testing/boxLayoutModel";
import { SurfaceElementTree } from "./SurfaceElementTree";

// The background picture is resolved from the asset library, which a test has none of; any id
// answers with a picture here, so the layer that paints it is drawn.
vi.mock("@/lib/workspace/hooks/useAssetObjectUrl", () => ({
    useAssetObjectUrl: (assetId?: string | null) => ({
        url: assetId ? `blob:${assetId}` : null,
        metadata: null,
        loading: false,
        error: null,
    }),
}));

/** Slow enough that a change is still under way when the test looks at it. */
const FADE: UIPageAnimationSettings = {
    ...DEFAULT_UI_PAGE_ANIMATION_SETTINGS,
    enter: "fade",
    enterDurationSeconds: 0.6,
    exit: "fade",
    exitDurationSeconds: 0.6,
    exitBlocking: false,
};
/** The page being left stays drawn, unanimated, until the page replacing it has finished arriving. */
const HOLD: UIPageAnimationSettings = { ...FADE, exit: "none", exitDurationSeconds: 0 };
/** The page being left plays its exit before the next one is drawn at all. */
const EXIT_FIRST: UIPageAnimationSettings = { ...FADE, exitBlocking: true };

/** The frame's own box, in its own coordinates: every page it shows must fill exactly this. */
const FRAME_BOX: LaidOutBox = { x: 0, y: 0, width: 640, height: 360 };

function element(id: string, type: string, parentId: string | null, childrenIds: string[], more?: Partial<UIElement>): UIElement {
    return { id, type, parentId, childrenIds, layout: { x: 0, y: 0, width: 200, height: 60 }, ...more };
}

function pageOf(id: string, size: { width: number; height: number }, settings: UISurface["settings"]): UISurface {
    return {
        id,
        name: id,
        host: "app",
        kind: "appSurface",
        designSize: size,
        rootElementId: `${id}Root`,
        settings,
    } as UISurface;
}

/**
 * A 640x360 page holding a 640x360 frame, and the pages it can show: three the frame's size, one
 * twice it, and one of other proportions.
 */
function documentShowing(targetSurfaceId: string, frameAnimation?: UIPageAnimationSettings): UIDocument {
    const pageRoot = (id: string, size: { width: number; height: number }) =>
        element(`${id}Root`, "nl.root", null, [`${id}Label`], { layout: { x: 0, y: 0, ...size } });
    const label = (id: string) => element(`${id}Label`, "nl.text", `${id}Root`, [], { props: { text: id } });
    const same = { width: 640, height: 360 };
    const double = { width: 1280, height: 720 };
    const other = { width: 1000, height: 600 };
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [
            pageOf("host", same, { backgroundColor: "#202020" }),
            pageOf("tabA", same, { backgroundColor: "#aa0000", pageAnimation: FADE, backgroundImage: { assetId: "art", fillMode: "cover" } }),
            pageOf("tabB", same, { backgroundColor: "#0000aa", pageAnimation: FADE }),
            pageOf("tabC", same, { backgroundColor: "#00aa00", pageAnimation: FADE }),
            pageOf("large", double, { backgroundColor: "#aaaa00", pageAnimation: FADE }),
            pageOf("other", other, { backgroundColor: "#00aaaa", pageAnimation: FADE }),
        ],
        elements: {
            hostRoot: element("hostRoot", "nl.root", null, ["frame"], { layout: { x: 0, y: 0, ...same } }),
            frame: element("frame", "nl.frame", "hostRoot", [], {
                layout: { x: 0, y: 0, ...same },
                props: { targetSurfaceId, ...(frameAnimation ? { animation: frameAnimation } : {}) },
            }),
            tabARoot: pageRoot("tabA", same),
            tabALabel: label("tabA"),
            tabBRoot: pageRoot("tabB", same),
            tabBLabel: label("tabB"),
            tabCRoot: pageRoot("tabC", same),
            tabCLabel: label("tabC"),
            largeRoot: pageRoot("large", double),
            largeLabel: label("large"),
            otherRoot: pageRoot("other", other),
            otherLabel: label("other"),
        },
    } as unknown as UIDocument;
}

function renderFrame(targetSurfaceId: string, frameAnimation?: UIPageAnimationSettings) {
    const adapter = {
        host: "app",
        blueprintRuntime: {
            surfaceId: "host",
            runtimeScopeId: "host-scope",
            setSurfaceState: () => undefined,
            getSurfaceState: () => undefined,
            emitDebug: () => undefined,
            dispatchElementBlueprintEvent: async () => undefined,
            dispatchSurfaceBlueprintEvent: async () => undefined,
        },
    } as unknown as UIHostAdapter;
    const registry = new ElementRendererRegistry(BuiltinElementRenderers);
    const tree = (document: UIDocument) => (
        <WidgetRuntimeStateProvider>
            <SurfaceElementTree
                document={document}
                surface={document.surfaces[0]!}
                rootElement={document.elements.hostRoot!}
                rendererRegistry={registry}
                hostAdapter={adapter}
                editorChrome={true}
            />
        </WidgetRuntimeStateProvider>
    );
    const view = render(tree(documentShowing(targetSurfaceId, frameAnimation)));
    return {
        container: view.container,
        showPage: (target: string) => view.rerender(tree(documentShowing(target, frameAnimation))),
    };
}

function frameOf(container: HTMLElement): HTMLElement {
    const frame = container.querySelector<HTMLElement>("[data-ui-element-id='frame']");
    if (!frame) {
        throw new Error("no frame drawn");
    }
    return frame;
}

function layerOf(container: HTMLElement, surfaceId: string): HTMLElement | null {
    return container.querySelector<HTMLElement>(`[data-ui-surface-id="${surfaceId}"][data-ui-surface-prepaint]`);
}

/** The pages the frame is drawing, in the order they are drawn. */
function drawnPages(container: HTMLElement): string[] {
    return Array.from(frameOf(container).querySelectorAll<HTMLElement>("[data-ui-surface-prepaint]"))
        .map(layer => layer.dataset.uiSurfaceId ?? "");
}

/** Where each page the frame is drawing sits, in the frame's own coordinates. */
function pageBoxes(container: HTMLElement): Record<string, LaidOutBox> {
    const frame = frameOf(container);
    const boxes: Record<string, LaidOutBox> = {};
    for (const layer of frame.querySelectorAll<HTMLElement>("[data-ui-surface-prepaint]")) {
        boxes[layer.dataset.uiSurfaceId ?? ""] = laidOutBoxIn(frame, layer);
    }
    return boxes;
}

/**
 * A frame draws the pages it keeps at z-index 10 and up, a page leaving over them at 30 and up, and
 * a page leaving under the one that replaced it at 0.
 */
function zIndexOf(layer: HTMLElement | null): number | null {
    return layer && layer.style.zIndex !== "" ? Number(layer.style.zIndex) : null;
}
const isPresent = (layer: HTMLElement | null) => {
    const z = zIndexOf(layer);
    return z !== null && z >= 10 && z < 30;
};
const isLeaving = (layer: HTMLElement | null) => {
    const z = zIndexOf(layer);
    return z !== null && (z >= 30 || z === 0);
};
const isReady = (layer: HTMLElement | null) => layer?.dataset.uiSurfacePrepaint === "ready";

async function settle(ms = 20): Promise<void> {
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, ms));
    });
}

async function pageShown(container: HTMLElement, surfaceId: string): Promise<void> {
    await waitFor(() => expect(drawnPages(container)).toEqual([surfaceId]), { timeout: 3000 });
    await waitFor(() => expect(isReady(layerOf(container, surfaceId))).toBe(true), { timeout: 3000 });
    await settle();
}

beforeAll(() => {
    ensureAnimationFramePolyfill();
    installResizeObserverStub();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => cleanup());

describe("a frame at rest", () => {
    it("draws its page over the frame's whole area, at the page's design size, with its background", async () => {
        const frame = renderFrame("tabA");
        await pageShown(frame.container, "tabA");

        expect(pageBoxes(frame.container)).toEqual({ tabA: FRAME_BOX });
        const layer = layerOf(frame.container, "tabA")!;
        expect(layer.style.width).toBe("640px");
        expect(layer.style.height).toBe("360px");
        expect(layer.style.overflow).toBe("hidden");
        expect(layer.style.backgroundColor).toBe("rgb(170, 0, 0)");
        // The picture fills the page's design box, which at rest is the page's own layer.
        const picture = layer.querySelector<HTMLElement>("[data-ui-surface-background-image]");
        expect(picture).not.toBeNull();
        expect(laidOutBoxIn(frameOf(frame.container), picture!)).toEqual(FRAME_BOX);
    });

    it("fits a page of other proportions by covering the frame, centred, as it always has", async () => {
        const frame = renderFrame("other");
        await pageShown(frame.container, "other");

        // 1000x600 into 640x360: scaled by 0.64 so it covers, 384 tall, 12 off the top and bottom.
        expect(pageBoxes(frame.container)).toEqual({ other: { x: 0, y: -12, width: 640, height: 384 } });
        const layer = layerOf(frame.container, "other")!;
        expect(layer.style.width).toBe("1000px");
        expect(layer.style.height).toBe("600px");
    });
});

describe("a frame changing page draws both pages in its own area", () => {
    it("cross-fading: the page leaving plays out over the page arriving, both filling the frame", async () => {
        const frame = renderFrame("tabA");
        await pageShown(frame.container, "tabA");

        frame.showPage("tabB");
        // Straight away the arriving page is being prepared under the page it replaces, which is
        // still the one on screen - and must still be in the frame to be seen.
        expect(drawnPages(frame.container).sort()).toEqual(["tabA", "tabB"]);
        expect(isReady(layerOf(frame.container, "tabB"))).toBe(false);
        expect(pageBoxes(frame.container)).toEqual({ tabA: FRAME_BOX, tabB: FRAME_BOX });

        // Then the page leaving fades out over the one fading in.
        await waitFor(() => {
            expect(isLeaving(layerOf(frame.container, "tabA"))).toBe(true);
            expect(isReady(layerOf(frame.container, "tabB"))).toBe(true);
        }, { timeout: 3000 });
        expect(Number(layerOf(frame.container, "tabA")!.style.zIndex))
            .toBeGreaterThan(Number(layerOf(frame.container, "tabB")!.style.zIndex));
        expect(pageBoxes(frame.container)).toEqual({ tabA: FRAME_BOX, tabB: FRAME_BOX });

        await pageShown(frame.container, "tabB");
        expect(pageBoxes(frame.container)).toEqual({ tabB: FRAME_BOX });
    });

    it("holding the page being left: the page arriving plays its enter in place, over it", async () => {
        const frame = renderFrame("tabA", HOLD);
        await pageShown(frame.container, "tabA");

        frame.showPage("tabB");
        await waitFor(() => expect(isReady(layerOf(frame.container, "tabB"))).toBe(true), { timeout: 3000 });
        // The enter lasts 600ms, and the page being left is drawn for all of it.
        expect(drawnPages(frame.container)).toEqual(["tabA", "tabB"]);
        expect(isPresent(layerOf(frame.container, "tabB"))).toBe(true);
        expect(Number(layerOf(frame.container, "tabB")!.style.zIndex))
            .toBeGreaterThan(Number(layerOf(frame.container, "tabA")!.style.zIndex));
        expect(pageBoxes(frame.container)).toEqual({ tabA: FRAME_BOX, tabB: FRAME_BOX });

        await pageShown(frame.container, "tabB");
        expect(pageBoxes(frame.container)).toEqual({ tabB: FRAME_BOX });
    });

    it("exit first: each page plays in the frame's area, one after the other", async () => {
        const frame = renderFrame("tabA", EXIT_FIRST);
        await pageShown(frame.container, "tabA");

        frame.showPage("tabB");
        await waitFor(() => expect(isLeaving(layerOf(frame.container, "tabA"))).toBe(true), { timeout: 3000 });
        expect(drawnPages(frame.container)).toEqual(["tabA"]);
        expect(pageBoxes(frame.container)).toEqual({ tabA: FRAME_BOX });

        await waitFor(() => expect(drawnPages(frame.container)).toEqual(["tabB"]), { timeout: 3000 });
        expect(pageBoxes(frame.container)).toEqual({ tabB: FRAME_BOX });
        await pageShown(frame.container, "tabB");
        expect(pageBoxes(frame.container)).toEqual({ tabB: FRAME_BOX });
    });

    it("exit first, pointed at a third page while the first still plays out: the two overlap", async () => {
        const frame = renderFrame("tabA", EXIT_FIRST);
        await pageShown(frame.container, "tabA");

        frame.showPage("tabB");
        await waitFor(() => expect(isLeaving(layerOf(frame.container, "tabA"))).toBe(true), { timeout: 3000 });
        frame.showPage("tabC");
        await waitFor(() => expect(isReady(layerOf(frame.container, "tabC"))).toBe(true), { timeout: 3000 });
        expect(isLeaving(layerOf(frame.container, "tabA"))).toBe(true);
        expect(pageBoxes(frame.container)).toEqual({ tabA: FRAME_BOX, tabC: FRAME_BOX });

        await pageShown(frame.container, "tabC");
        expect(pageBoxes(frame.container)).toEqual({ tabC: FRAME_BOX });
    });

    it("between pages of two design sizes: each keeps the place it has in the frame when it is the frame's page", async () => {
        const frame = renderFrame("tabA");
        await pageShown(frame.container, "tabA");

        // The frame's box is now drawn for a page twice the size; the page leaving is fitted into it.
        frame.showPage("large");
        await waitFor(() => {
            expect(isLeaving(layerOf(frame.container, "tabA"))).toBe(true);
            expect(isReady(layerOf(frame.container, "large"))).toBe(true);
        }, { timeout: 3000 });
        expect(pageBoxes(frame.container)).toEqual({ tabA: FRAME_BOX, large: FRAME_BOX });
        // Its background picture goes with it.
        const picture = layerOf(frame.container, "tabA")!.querySelector<HTMLElement>("[data-ui-surface-background-image]");
        expect(laidOutBoxIn(frameOf(frame.container), picture!)).toEqual(FRAME_BOX);

        await pageShown(frame.container, "large");
        expect(pageBoxes(frame.container)).toEqual({ large: FRAME_BOX });

        frame.showPage("tabA");
        await waitFor(() => {
            expect(isLeaving(layerOf(frame.container, "large"))).toBe(true);
            expect(isReady(layerOf(frame.container, "tabA"))).toBe(true);
        }, { timeout: 3000 });
        expect(pageBoxes(frame.container)).toEqual({ large: FRAME_BOX, tabA: FRAME_BOX });
    });
});
