// @vitest-environment jsdom
/**
 * Play, Pause, Stop and Seek on a video widget, and the four reads of where it is.
 *
 * Driven the way a running game drives them: a graph on another element of the page (a button's
 * Mouse Click, dispatched as the page dispatches it) names the video through an Element node, and
 * the real Dev Mode host API, the real runtime store and the real video renderer carry it out on
 * the `<video>` element. jsdom plays nothing, so the element's media state is stood in for on the
 * node itself; what is asserted is what reached the element and what the graph's Log wrote.
 *
 * Comments in English per project convention.
 */
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_ELEMENT_REF,
    BLUEPRINT_NODE_TYPE_ELEMENT_VIDEO_GET_DURATION,
    BLUEPRINT_NODE_TYPE_ELEMENT_VIDEO_GET_TIME,
    BLUEPRINT_NODE_TYPE_ELEMENT_VIDEO_IS_ENDED,
    BLUEPRINT_NODE_TYPE_ELEMENT_VIDEO_IS_PLAYING,
    BLUEPRINT_NODE_TYPE_ELEMENT_VIDEO_PAUSE,
    BLUEPRINT_NODE_TYPE_ELEMENT_VIDEO_PLAY,
    BLUEPRINT_NODE_TYPE_ELEMENT_VIDEO_SEEK,
    BLUEPRINT_NODE_TYPE_ELEMENT_VIDEO_STOP,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
    BLUEPRINT_NODE_TYPE_LOG,
    BLUEPRINT_NODE_TYPE_VIDEO_GET_TIME,
} from "@shared/types/blueprint/graph";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import { clampVideoSeekSeconds } from "@shared/types/ui-editor/video";
import type { Blueprint } from "@shared/types/blueprint/document";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { BuiltinElementRenderers } from "@/lib/ui-editor/runtime/builtin";
import { WidgetRuntimeStateProvider } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { SurfaceElementTree } from "@/lib/ui-editor/runtime/surface/SurfaceElementTree";
import { clearDevModeAssetUrls, publishDevModeAssetUrls } from "@/lib/ui-editor/runtime/devModeAssetUrls";
import { blueprintOf, createRowRuntime, graphOf, type GraphNode } from "@/lib/ui-editor/runtime/testing/rowRuntimeTestKit";

const PAGE = "movie";
const CLIP_ASSET = "clip-asset";

function videoDocument(videoProps: Record<string, unknown> = {}): UIDocument {
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
            root: element("root", "nl.root", null, { childrenIds: ["opening", "remote"] }),
            opening: element("opening", "nl.video", "root", { name: "Opening", props: { assetId: CLIP_ASSET, ...videoProps } }),
            remote: element("remote", "nl.container", "root"),
        },
    } as UIDocument;
}

const videoRef: GraphNode = {
    type: BLUEPRINT_NODE_TYPE_ELEMENT_REF,
    params: { surfaceId: PAGE, elementId: "opening", elementType: "nl.video" },
};

/** The remote's Mouse Click: one command on the video, then Log "done" - the graph carried on. */
function remoteRunning(commandType: string, params?: Record<string, unknown>): Blueprint {
    return blueprintOf("bp-remote", { kind: "widgetMain", surfaceId: PAGE, elementId: "remote" }, {
        click: {
            graph: graphOf({
                nodes: {
                    head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK },
                    video: videoRef,
                    command: { type: commandType, ...(params ? { params } : {}) },
                    done: { type: BLUEPRINT_NODE_TYPE_LITERAL_STRING, params: { value: "done" } },
                    log: { type: BLUEPRINT_NODE_TYPE_LOG },
                },
                exec: ["head", "command", "log"],
                data: [
                    ["video", "element", "command", "video"],
                    ["done", "value", "log", "value"],
                ],
            }),
        },
    });
}

/** The remote's Mouse Click: Log what one video read answers. */
function remoteReading(readType: string, port: string): Blueprint {
    return blueprintOf("bp-remote", { kind: "widgetMain", surfaceId: PAGE, elementId: "remote" }, {
        click: {
            graph: graphOf({
                nodes: {
                    head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK },
                    video: videoRef,
                    read: { type: readType },
                    log: { type: BLUEPRINT_NODE_TYPE_LOG },
                },
                exec: ["head", "log"],
                data: [
                    ["video", "element", "read", "video"],
                    ["read", port, "log", "value"],
                ],
            }),
        },
    });
}

let page: ReturnType<typeof createRowRuntime> | null = null;

function mount(blueprints: Blueprint[], videoProps: Record<string, unknown> = {}) {
    page = createRowRuntime(blueprints, { document: videoDocument(videoProps), scopedHostApi: true });
    return { page, view: draw(page) };
}

function draw(running: ReturnType<typeof createRowRuntime>) {
    const registry = new ElementRendererRegistry(BuiltinElementRenderers);
    // The element tree names the runtime scope its widgets read under, from the host adapter; the
    // runtime above gives its host API the same one, as a running game's page does.
    return render(
        <WidgetRuntimeStateProvider externalStore={running.widgetRuntimeStore}>
            <SurfaceElementTree
                document={running.document}
                surface={running.surface}
                rootElement={running.document.elements.root!}
                rendererRegistry={registry}
                hostAdapter={running.adapter}
                editorChrome={true}
            />
        </WidgetRuntimeStateProvider>,
    );
}

async function videoOf(container: HTMLElement): Promise<HTMLVideoElement> {
    let found: HTMLVideoElement | null = null;
    await waitFor(() => {
        found = container.querySelector<HTMLVideoElement>("video[data-ui-video]");
        expect(found).not.toBeNull();
    });
    return found!;
}

type MediaState = { currentTime: number; duration: number; paused: boolean; ended: boolean; readyState: number };

/** Stand in for the media state jsdom does not keep, on this one element. Writes to the time are kept. */
function standInMedia(node: HTMLVideoElement, initial: Partial<MediaState> = {}): MediaState & { seeks: number[] } {
    const state = { currentTime: 0, duration: Number.NaN, paused: true, ended: false, readyState: 0, seeks: [] as number[], ...initial };
    Object.defineProperty(node, "currentTime", {
        configurable: true,
        get: () => state.currentTime,
        set: (value: number) => {
            state.seeks.push(value);
            state.currentTime = value;
        },
    });
    for (const key of ["duration", "paused", "ended", "readyState"] as const) {
        Object.defineProperty(node, key, { configurable: true, get: () => state[key] });
    }
    return state;
}

async function click(target = "remote"): Promise<void> {
    await act(async () => {
        await page!.runtime.dispatchElementBlueprintEvent(target, "mouseClick", { x: 0, y: 0 });
    });
}

let played: HTMLMediaElement[] = [];
let paused: HTMLMediaElement[] = [];

beforeAll(() => {
    registerCoreBlueprintNodes();
});

beforeEach(() => {
    publishDevModeAssetUrls(new Map([[CLIP_ASSET, "blob:opening-clip"]]));
    played = [];
    paused = [];
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
        played.push(this);
        return Promise.resolve();
    });
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) {
        paused.push(this);
    });
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

describe("Play Video", () => {
    it("plays the video it names, and the graph carries on", async () => {
        const { view } = mount([remoteRunning(BLUEPRINT_NODE_TYPE_ELEMENT_VIDEO_PLAY)]);
        const node = await videoOf(view.container);
        expect(played).toEqual([]);

        await click();

        await waitFor(() => expect(played).toEqual([node]));
        expect(page!.logs).toEqual(["done"]);
    });

    it("plays again when asked again - after the end it starts the clip over", async () => {
        const { view } = mount([remoteRunning(BLUEPRINT_NODE_TYPE_ELEMENT_VIDEO_PLAY)]);
        const node = await videoOf(view.container);

        await click();
        await waitFor(() => expect(played).toEqual([node]));
        await click();

        await waitFor(() => expect(played).toEqual([node, node]));
    });

    it("starts a clip asked to play before there was anything drawn to play", async () => {
        // A Play from the video's own Init arrives before its clip has resolved and there is no
        // element yet; the request waits for one.
        page = createRowRuntime([], { document: videoDocument(), scopedHostApi: true });
        await act(async () => {
            await page!.hostApi.widget.controlVideo("opening", { kind: "play" });
        });
        expect(played).toEqual([]);

        const node = await videoOf(draw(page).container);

        await waitFor(() => expect(played).toEqual([node]));
    });

    it("plays at the volume and mute Autoplay plays at", async () => {
        // The volume is the player's mixer applied to the authored volume, written by the same
        // effect for both; Play only changes whether it plays.
        const { view } = mount([remoteRunning(BLUEPRINT_NODE_TYPE_ELEMENT_VIDEO_PLAY)], { volume: 0.4, muted: true });
        const node = await videoOf(view.container);

        await click();
        await waitFor(() => expect(played).toEqual([node]));

        expect(node.volume).toBeCloseTo(page!.hostApi.sound.resolveElementVolume({ audioTrackId: null, volume: 0.4 }));
        expect(node.muted).toBe(true);
    });

    it("leaves a refused play in the game's log and does not stop the graph", async () => {
        vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() =>
            Promise.reject(new DOMException("play() failed because the user didn't interact with the document first.", "NotAllowedError")));
        const { view } = mount([remoteRunning(BLUEPRINT_NODE_TYPE_ELEMENT_VIDEO_PLAY)]);
        await videoOf(view.container);

        await click();

        await waitFor(() => expect(page!.logs).toHaveLength(2));
        expect(page!.logs).toContain("done");
        expect(page!.logs.find(line => line !== "done")).toContain("Opening");
    });

    it("says nothing when a play is overtaken by a pause", async () => {
        vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() =>
            Promise.reject(new DOMException("The play() request was interrupted by a call to pause().", "AbortError")));
        const { view } = mount([remoteRunning(BLUEPRINT_NODE_TYPE_ELEMENT_VIDEO_PLAY)]);
        await videoOf(view.container);

        await click();
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 20));
        });

        expect(page!.logs).toEqual(["done"]);
    });
});

describe("Pause Video and Stop Video", () => {
    it("pauses where the clip is", async () => {
        const { view } = mount([remoteRunning(BLUEPRINT_NODE_TYPE_ELEMENT_VIDEO_PAUSE)], { autoplay: true });
        const node = await videoOf(view.container);
        const media = standInMedia(node, { readyState: 1, duration: 3, currentTime: 1.2 });
        await waitFor(() => expect(played).toEqual([node]));

        await click();

        await waitFor(() => expect(paused).toContain(node));
        expect(media.seeks).toEqual([]);
    });

    it("stops: pauses and returns to the start", async () => {
        const { view } = mount([remoteRunning(BLUEPRINT_NODE_TYPE_ELEMENT_VIDEO_STOP)], { autoplay: true });
        const node = await videoOf(view.container);
        const media = standInMedia(node, { readyState: 1, duration: 3, currentTime: 2.5 });
        await waitFor(() => expect(played).toEqual([node]));

        await click();

        await waitFor(() => expect(media.seeks).toEqual([0]));
        expect(paused).toContain(node);
    });
});

describe("Seek Video", () => {
    async function seekTo(time: number, initial: Partial<MediaState> = { readyState: 1, duration: 3 }) {
        const { view } = mount([remoteRunning(BLUEPRINT_NODE_TYPE_ELEMENT_VIDEO_SEEK, { time })]);
        const node = await videoOf(view.container);
        const media = standInMedia(node, initial);
        await click();
        return { node, media };
    }

    it("moves the play head to the time asked", async () => {
        const { media } = await seekTo(1.5);

        await waitFor(() => expect(media.seeks).toEqual([1.5]));
        expect(page!.logs).toEqual(["done"]);
    });

    it("keeps a time past the end at the end", async () => {
        const { media } = await seekTo(10);

        await waitFor(() => expect(media.seeks).toEqual([3]));
    });

    it("keeps a negative time at the start", async () => {
        const { media } = await seekTo(-2);

        await waitFor(() => expect(media.seeks).toEqual([0]));
    });

    it("waits for the clip's length before moving, then keeps the time inside it", async () => {
        const { node, media } = await seekTo(10, { readyState: 0 });
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 20));
        });
        expect(media.seeks).toEqual([]);

        media.readyState = 1;
        media.duration = 2.25;
        fireEvent(node, new Event("loadedmetadata"));

        expect(media.seeks).toEqual([2.25]);
    });

    it("does not start or pause playback", async () => {
        const { node } = await seekTo(1);
        const playsBefore = played.length;
        const pausesBefore = paused.filter(item => item === node).length;
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 20));
        });

        expect(played.length).toBe(playsBefore);
        expect(paused.filter(item => item === node).length).toBe(pausesBefore);
    });
});

describe("clampVideoSeekSeconds", () => {
    it("keeps a time inside the clip", () => {
        expect(clampVideoSeekSeconds(1.5, 3)).toBe(1.5);
        expect(clampVideoSeekSeconds(3, 3)).toBe(3);
        expect(clampVideoSeekSeconds(4, 3)).toBe(3);
        expect(clampVideoSeekSeconds(-1, 3)).toBe(0);
    });

    it("bounds only the start while the length is not known", () => {
        expect(clampVideoSeekSeconds(42, Number.NaN)).toBe(42);
        expect(clampVideoSeekSeconds(42, Number.POSITIVE_INFINITY)).toBe(42);
        expect(clampVideoSeekSeconds(-3, Number.NaN)).toBe(0);
    });

    it("sends a time that is not a number to the start", () => {
        expect(clampVideoSeekSeconds(Number.NaN, 3)).toBe(0);
    });
});

describe("reading a video", () => {
    async function read(readType: string, port: string, state: Partial<MediaState>): Promise<string> {
        const { view } = mount([remoteReading(readType, port)]);
        const node = await videoOf(view.container);
        standInMedia(node, state);
        await click();
        await waitFor(() => expect(page!.logs).toHaveLength(1));
        return page!.logs[0]!;
    }

    it("reads where the clip is and how long it is", async () => {
        expect(await read(BLUEPRINT_NODE_TYPE_ELEMENT_VIDEO_GET_TIME, "time", { currentTime: 1.25, duration: 3 })).toBe("1.25");
        cleanup();
        page?.release();
        expect(await read(BLUEPRINT_NODE_TYPE_ELEMENT_VIDEO_GET_DURATION, "duration", { currentTime: 1.25, duration: 3 })).toBe("3");
    });

    it("reads a length it does not know yet as 0", async () => {
        expect(await read(BLUEPRINT_NODE_TYPE_ELEMENT_VIDEO_GET_DURATION, "duration", { duration: Number.NaN })).toBe("0");
    });

    it("reads playing while neither paused nor at the end", async () => {
        expect(await read(BLUEPRINT_NODE_TYPE_ELEMENT_VIDEO_IS_PLAYING, "isPlaying", { paused: false, ended: false })).toBe("true");
        cleanup();
        page?.release();
        expect(await read(BLUEPRINT_NODE_TYPE_ELEMENT_VIDEO_IS_PLAYING, "isPlaying", { paused: true })).toBe("false");
    });

    it("reads ended once the clip is at its end", async () => {
        expect(await read(BLUEPRINT_NODE_TYPE_ELEMENT_VIDEO_IS_ENDED, "isEnded", { paused: true, ended: true })).toBe("true");
        cleanup();
        page?.release();
        expect(await read(BLUEPRINT_NODE_TYPE_ELEMENT_VIDEO_IS_PLAYING, "isPlaying", { paused: true, ended: true })).toBe("false");
    });

    it("reads a video with nothing drawn as at rest", async () => {
        page = createRowRuntime([remoteReading(BLUEPRINT_NODE_TYPE_ELEMENT_VIDEO_GET_TIME, "time")], {
            document: videoDocument(),
            scopedHostApi: true,
        });

        await click();

        await waitFor(() => expect(page!.logs).toEqual(["0"]));
    });

    it("reads its own video from the video's blueprint", async () => {
        const { view } = mount([
            blueprintOf("bp-opening", { kind: "widgetMain", surfaceId: PAGE, elementId: "opening" }, {
                click: {
                    graph: graphOf({
                        nodes: {
                            head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK },
                            read: { type: BLUEPRINT_NODE_TYPE_VIDEO_GET_TIME },
                            log: { type: BLUEPRINT_NODE_TYPE_LOG },
                        },
                        exec: ["head", "log"],
                        data: [["read", "time", "log", "value"]],
                    }),
                },
            }),
        ]);
        const node = await videoOf(view.container);
        standInMedia(node, { currentTime: 0.5, duration: 3 });

        await click("opening");

        await waitFor(() => expect(page!.logs).toEqual(["0.5"]));
    });
});

describe("a request read back in the same graph", () => {
    /** The remote's Mouse Click: one command on the video, then Log what one read answers - one graph. */
    function remoteCommandingThenReading(commandType: string, params: Record<string, unknown>, readType: string, port: string): Blueprint {
        return blueprintOf("bp-remote", { kind: "widgetMain", surfaceId: PAGE, elementId: "remote" }, {
            click: {
                graph: graphOf({
                    nodes: {
                        head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK },
                        video: videoRef,
                        command: { type: commandType, params },
                        read: { type: readType },
                        log: { type: BLUEPRINT_NODE_TYPE_LOG },
                    },
                    exec: ["head", "command", "log"],
                    data: [
                        ["video", "element", "command", "video"],
                        ["video", "element", "read", "video"],
                        ["read", port, "log", "value"],
                    ],
                }),
            },
        });
    }

    it("reads the time a Seek just asked for", async () => {
        const { view } = mount([
            remoteCommandingThenReading(BLUEPRINT_NODE_TYPE_ELEMENT_VIDEO_SEEK, { time: 2 }, BLUEPRINT_NODE_TYPE_ELEMENT_VIDEO_GET_TIME, "time"),
        ]);
        const node = await videoOf(view.container);
        standInMedia(node, { readyState: 1, duration: 3, currentTime: 0.5 });

        await click();

        await waitFor(() => expect(page!.logs).toEqual(["2"]));
    });

    it("reads playing right after Play", async () => {
        const { view } = mount([
            remoteCommandingThenReading(BLUEPRINT_NODE_TYPE_ELEMENT_VIDEO_PLAY, {}, BLUEPRINT_NODE_TYPE_ELEMENT_VIDEO_IS_PLAYING, "isPlaying"),
        ]);
        const node = await videoOf(view.container);
        const media = standInMedia(node, { readyState: 1, duration: 3, paused: true });
        // As the element does: play() leaves `paused` false at once, before playback has started.
        vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
            played.push(this);
            media.paused = false;
            return Promise.resolve();
        });

        await click();

        await waitFor(() => expect(page!.logs).toEqual(["true"]));
    });
});
