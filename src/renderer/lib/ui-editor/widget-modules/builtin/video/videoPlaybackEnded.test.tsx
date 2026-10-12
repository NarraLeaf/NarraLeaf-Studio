// @vitest-environment jsdom
/**
 * A video widget's Playback Ended.
 *
 * Driven through the real element tree, the real video renderer and the real Dev Mode runtime, and
 * asserted on what an author sees: the line the answering graph logs. The `<video>` element's own
 * `ended` is fired by hand, since jsdom plays nothing; what is under test is what the widget does
 * with it - one run per end, none for a looping clip, none once the widget is gone, none for an
 * `ended` that no longer describes the clip on screen.
 *
 * Comments in English per project convention.
 */
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_VIDEO_ENDED,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
    BLUEPRINT_NODE_TYPE_LOG,
} from "@shared/types/blueprint/graph";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { BuiltinElementRenderers } from "@/lib/ui-editor/runtime/builtin";
import { WidgetRuntimeStateProvider } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { SurfaceElementTree } from "@/lib/ui-editor/runtime/surface/SurfaceElementTree";
import { clearDevModeAssetUrls, publishDevModeAssetUrls } from "@/lib/ui-editor/runtime/devModeAssetUrls";
import { blueprintOf, createRowRuntime, graphOf } from "@/lib/ui-editor/runtime/testing/rowRuntimeTestKit";

const PAGE = "movie";
const CLIP_ASSET = "clip-asset";

function videoDocument(props: Record<string, unknown>): UIDocument {
    const element = (id: string, type: string, parentId: string | null, extra: Partial<UIElement> = {}): UIElement => ({
        id,
        type,
        parentId,
        childrenIds: [],
        layout: { x: 0, y: 0, width: 320, height: 180, visible: true },
        ...extra,
    });
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [
            {
                id: PAGE,
                name: "Movie",
                host: "app",
                kind: "appSurface",
                designSize: { width: 640, height: 360 },
                rootElementId: "root",
            },
        ],
        elements: {
            root: element("root", "nl.root", null, { childrenIds: ["opening"] }),
            opening: element("opening", "nl.video", "root", { props: { assetId: CLIP_ASSET, ...props } }),
        },
    } as UIDocument;
}

/** The video's own blueprint: on Playback Ended, log "ended". */
function endedLogger() {
    return blueprintOf("bp-opening", { kind: "widgetMain", surfaceId: PAGE, elementId: "opening" }, {
        ended: {
            graph: graphOf({
                nodes: {
                    head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_VIDEO_ENDED },
                    text: { type: BLUEPRINT_NODE_TYPE_LITERAL_STRING, params: { value: "ended" } },
                    log: { type: BLUEPRINT_NODE_TYPE_LOG },
                },
                exec: ["head", "log"],
                data: [["text", "value", "log", "value"]],
            }),
        },
    });
}

let page: ReturnType<typeof createRowRuntime> | null = null;

function mount(props: Record<string, unknown> = {}) {
    page = createRowRuntime([endedLogger()], { document: videoDocument(props) });
    const registry = new ElementRendererRegistry(BuiltinElementRenderers);
    const view = render(
        <WidgetRuntimeStateProvider externalStore={page.widgetRuntimeStore}>
            <SurfaceElementTree
                document={page.document}
                surface={page.surface}
                rootElement={page.document.elements.root!}
                rendererRegistry={registry}
                hostAdapter={page.adapter}
                editorChrome={true}
            />
        </WidgetRuntimeStateProvider>,
    );
    return { view, page };
}

async function videoOf(container: HTMLElement): Promise<HTMLVideoElement> {
    let found: HTMLVideoElement | null = null;
    await waitFor(() => {
        found = container.querySelector<HTMLVideoElement>("video[data-ui-video]");
        expect(found).not.toBeNull();
    });
    return found!;
}

/** What the element reports once the clip has played to its end, which jsdom never gets to. */
function reachEnd(node: HTMLVideoElement): void {
    Object.defineProperty(node, "ended", { configurable: true, get: () => true });
    fireEvent.ended(node);
}

/** Let any graph a dispatch started run to its end before asserting that none did. */
async function settle(): Promise<void> {
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 20));
    });
}

beforeAll(() => {
    registerCoreBlueprintNodes();
});

beforeEach(() => {
    publishDevModeAssetUrls(new Map([[CLIP_ASSET, "blob:opening-clip"]]));
    // jsdom implements no playback; the renderer pauses on mount, and these keep it quiet.
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
});

afterEach(() => {
    cleanup();
    page?.release();
    expect(page?.errors ?? []).toEqual([]);
    page = null;
    vi.restoreAllMocks();
});

afterAll(() => {
    clearDevModeAssetUrls();
});

describe("Playback Ended", () => {
    it("runs once when the clip plays to its end", async () => {
        const { view } = mount();
        const node = await videoOf(view.container);

        reachEnd(node);

        await waitFor(() => expect(page!.logs).toEqual(["ended"]));
        await settle();
        expect(page!.logs).toEqual(["ended"]);
    });

    it("runs again each time the clip reaches its end again", async () => {
        const { view } = mount();
        const node = await videoOf(view.container);

        reachEnd(node);
        await waitFor(() => expect(page!.logs).toEqual(["ended"]));
        reachEnd(node);

        await waitFor(() => expect(page!.logs).toEqual(["ended", "ended"]));
    });

    it("never runs for a looping clip", async () => {
        const { view } = mount({ loop: true });
        const node = await videoOf(view.container);
        // What keeps a looping clip from ending at all: the element itself is told to loop.
        expect(node.loop).toBe(true);

        reachEnd(node);
        await settle();

        expect(page!.logs).toEqual([]);
    });

    it("does not run once the widget is gone", async () => {
        const { view } = mount();
        const node = await videoOf(view.container);

        view.unmount();
        reachEnd(node);
        await settle();

        expect(page!.logs).toEqual([]);
    });

    it("does not run for an end that no longer describes the clip on screen", async () => {
        // An `ended` queued just before the source changed arrives at an element that is loading
        // the next clip, which reports that it has not ended.
        const { view } = mount();
        const node = await videoOf(view.container);

        fireEvent.ended(node);
        await settle();

        expect(page!.logs).toEqual([]);
    });
});
