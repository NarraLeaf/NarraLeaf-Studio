// @vitest-environment jsdom
/**
 * A page drawn in a Page widget (`nl.frame`) on a Game UI slot surface is a live page, as it is on a
 * page of the app.
 *
 * The widget embeds another page the way a same-origin iframe does: the page it shows shares the host
 * environment around it, so its graphs run wherever the widget is placed. On a page and on a layer
 * that always held. On a slot surface - the dialogue box, the choice menu, notifications, NVL, the
 * on-stage layer - the embedded page was drawn and nothing of it ran: no Surface Init, no click, no
 * value binding, no Page Event back to the frame, and nothing said so. The slot never handed its
 * element tree a runtime for nested pages, so the page borrowed the slot's own adapter, which looks
 * blueprints up under the slot's surface id and never finds the page's.
 *
 * Two things here are particular to slots rather than to pages:
 *
 *  - **A slot is drawn more than once at a time.** The dialogue slot has a drawing per scene on the
 *    stage - a scene call keeps the caller's box for a short grace while the called scene's is
 *    already drawn - and those drawings share the slot's scope, which stays open until the last of
 *    them leaves. The embedded page follows the drawing it sits in: one scope under that slot scope,
 *    held by every drawing that shows it, so the drawing that leaves first cannot close it under the
 *    one that stays.
 *  - **The notification slot is passive.** It takes no press anywhere, and a page embedded in it takes
 *    none either - but its graphs are the page's, and they run.
 *
 * What runs is what a game runs: the slot shell and its lifecycle boundary, the Dev Mode adapter, the
 * real host API and nodes, the real element tree and the real frame drawing the page. What is
 * asserted is what a player would see - the text on screen - and the lines the graphs log.
 */
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Blueprint, BlueprintOwnerRef } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE,
    BLUEPRINT_NODE_TYPE_ELEMENT_REF,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_TEXT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_PREFERENCE_CHANGED,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_PAGE_EVENT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_INIT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_UNMOUNT,
    BLUEPRINT_NODE_TYPE_FRAME_EMIT,
    BLUEPRINT_NODE_TYPE_FRAME_WIDGET_SET_PAGE,
    BLUEPRINT_NODE_TYPE_GAME_IS_GAME_OVERLAY,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
    BLUEPRINT_NODE_TYPE_LOG,
    BLUEPRINT_NODE_TYPE_STRING_TO_STRING,
} from "@shared/types/blueprint/graph";
import type { DevModeBundle } from "@shared/types/devMode";
import {
    UI_DOCUMENT_SCHEMA_VERSION,
    type UIDocument,
    type UIElement,
    type UIStageSlotId,
    type UIStageSurface,
} from "@shared/types/ui-editor/document";
import { UI_GRAPH_DOCUMENT_SCHEMA_VERSION } from "@shared/types/ui-editor/graph";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { BuiltinElementRenderers } from "@/lib/ui-editor/runtime/builtin";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import { createRecordingCore, ensureAnimationFramePolyfill } from "@/lib/ui-editor/runtime/testing/lifecycleTestKit";
import { installResizeObserverStub } from "@/lib/ui-editor/runtime/testing/drawingLabFixture";
import { blueprintDocumentOf, graphOf, type GraphNode } from "@/lib/ui-editor/runtime/testing/rowRuntimeTestKit";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { AmbientSurfaceTargets, dispatchAmbientSurfaceEvent } from "./ambientSurfaceEvents";
import type { GameHostCapabilities } from "./gameHostApiOptions";
import { SurfaceLifecycleOrchestrator } from "./lifecycle/surfaceLifecycleOrchestrator";
import { createNestedSurfaceHost } from "./nestedSurfaceHost";
import { NotificationSlotSurface } from "./NotificationSlotSurface";
import {
    StageSlotSurfaceBody,
    useStageSlotSurfaceRuntime,
    type GameUiSlotHostOptions,
} from "./StageSlotSurfaceShell";
import type { WidgetPatchesByScope } from "./widgetRuntimePatches";

const DIALOG = "dialog-surface";
const NOTIFICATION = "notification-surface";
const EMBEDDED = "embedded";
const SECOND = "second";
const THIRD = "third";

function element(id: string, type: string, parentId: string | null, childrenIds: string[], more: Partial<UIElement> = {}): UIElement {
    return { id, type, parentId, childrenIds, layout: { x: 0, y: 0, width: 200, height: 40, visible: true }, ...more };
}

function slotSurface(id: string, slotId: UIStageSlotId, rootElementId: string): UIStageSurface {
    return {
        id,
        name: id,
        kind: "stageSurface",
        mount: { kind: "stageSlot", slotId },
        designSize: { width: 1280, height: 720 },
        rootElementId,
        settings: { backgroundColor: "transparent" },
    } as unknown as UIStageSurface;
}

/**
 * A dialogue slot and a notification slot, each holding a Page widget onto one small page; and the
 * page, which says it is ready when it opens, has a button that says it was pressed and tells the
 * frame so, and a text whose value is bound.
 */
const document = {
    schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
    id: "doc",
    name: "Doc",
    surfaces: [
        slotSurface(DIALOG, "dialog", "dialogRoot"),
        slotSurface(NOTIFICATION, "notification", "noteRoot"),
        {
            id: EMBEDDED,
            name: "Embedded",
            host: "app",
            kind: "appSurface",
            designSize: { width: 400, height: 200 },
            rootElementId: "embeddedRoot",
        },
        // The page the frame switches to, which holds a frame of its own.
        { id: SECOND, name: "Second", host: "app", kind: "appSurface", designSize: { width: 400, height: 200 }, rootElementId: "secondRoot" },
        { id: THIRD, name: "Third", host: "app", kind: "appSurface", designSize: { width: 400, height: 100 }, rootElementId: "thirdRoot" },
    ],
    elements: {
        dialogRoot: element("dialogRoot", "nl.root", null, ["frame", "slotStatus"], { layout: { x: 0, y: 0, width: 1280, height: 720 } }),
        frame: element("frame", "nl.frame", "dialogRoot", [], {
            layout: { x: 0, y: 0, width: 400, height: 200 },
            props: { targetSurfaceId: EMBEDDED },
        }),
        slotStatus: element("slotStatus", "nl.text", "dialogRoot", [], { props: { text: "slot-quiet" } }),
        noteRoot: element("noteRoot", "nl.root", null, ["noteFrame"], { layout: { x: 0, y: 0, width: 1280, height: 720 } }),
        noteFrame: element("noteFrame", "nl.frame", "noteRoot", [], {
            layout: { x: 0, y: 0, width: 400, height: 200 },
            props: { targetSurfaceId: EMBEDDED },
        }),
        embeddedRoot: element("embeddedRoot", "nl.root", null, ["hello", "press", "pressed", "bound", "overlay"], {
            layout: { x: 0, y: 0, width: 400, height: 200 },
        }),
        hello: element("hello", "nl.text", "embeddedRoot", [], { props: { text: "waiting" } }),
        press: element("press", "nl.button", "embeddedRoot", [], { props: { label: "Press" } }),
        pressed: element("pressed", "nl.text", "embeddedRoot", [], { props: { text: "untouched" } }),
        overlay: element("overlay", "nl.text", "embeddedRoot", [], { props: { text: "overlay-unasked" } }),
        secondRoot: element("secondRoot", "nl.root", null, ["secondHello", "innerFrame"], { layout: { x: 0, y: 0, width: 400, height: 200 } }),
        secondHello: element("secondHello", "nl.text", "secondRoot", [], { props: { text: "second-waiting" } }),
        innerFrame: element("innerFrame", "nl.frame", "secondRoot", [], {
            layout: { x: 0, y: 100, width: 400, height: 100 },
            props: { targetSurfaceId: THIRD },
        }),
        thirdRoot: element("thirdRoot", "nl.root", null, ["thirdHello"], { layout: { x: 0, y: 0, width: 400, height: 100 } }),
        thirdHello: element("thirdHello", "nl.text", "thirdRoot", [], { props: { text: "third-waiting" } }),
        bound: element("bound", "nl.text", "embeddedRoot", [], {
            props: { text: "AUTHORED" },
            valueBindings: { text: { kind: "blueprintValue", blueprintId: "bp-bound", valueType: "string" } },
        }),
    },
} as unknown as UIDocument;

const dialogSurface = document.surfaces[0] as UIStageSurface;
const notificationSurface = document.surfaces[1] as UIStageSurface;

function ref(surfaceId: string, elementId: string): GraphNode {
    return {
        type: BLUEPRINT_NODE_TYPE_ELEMENT_REF,
        params: { surfaceId, elementId, elementType: document.elements[elementId]!.type },
    };
}

function blueprintOn(id: string, owner: BlueprintOwnerRef, layers: Record<string, ReturnType<typeof graphOf>>): Blueprint {
    return {
        id,
        name: id,
        owner,
        members: { variables: {}, fields: {}, functions: {} },
        bindings: {},
        graphs: {
            events: Object.fromEntries(Object.entries(layers).map(([layerId, graph]) => [layerId, { id: layerId, graph }])),
            functions: {},
        },
    } as unknown as Blueprint;
}

/** `head -> Set Text <elementId> = <text> -> Log <line>`. */
function writesAndLogs(head: GraphNode, surfaceId: string, elementId: string, text: string, line: string) {
    return graphOf({
        nodes: {
            head,
            target: ref(surfaceId, elementId),
            write: { type: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_TEXT, params: { text } },
            log: { type: BLUEPRINT_NODE_TYPE_LOG, params: { value: line } },
        },
        exec: ["head", "write", "log"],
        data: [["target", "element", "write", "element"]],
    });
}

function logs(head: GraphNode, line: string) {
    return graphOf({
        nodes: { head, log: { type: BLUEPRINT_NODE_TYPE_LOG, params: { value: line } } },
        exec: ["head", "log"],
    });
}

const blueprints: readonly Blueprint[] = [
    // The embedded page's own graph: it says it is ready when it opens, logs when it goes, and
    // hears a preference changing like any live page.
    blueprintOn("bp-embedded", { kind: "surfaceMain", surfaceId: EMBEDDED }, {
        init: writesAndLogs({ type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_INIT }, EMBEDDED, "hello", "ready", "embedded:init"),
        // Whether it is drawn over a running game is the slot's answer, which is always yes.
        overlay: graphOf({
            nodes: {
                head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_INIT },
                ask: { type: BLUEPRINT_NODE_TYPE_GAME_IS_GAME_OVERLAY },
                asText: { type: BLUEPRINT_NODE_TYPE_STRING_TO_STRING },
                target: ref(EMBEDDED, "overlay"),
                write: { type: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_TEXT },
            },
            exec: ["head", "write"],
            data: [
                ["ask", "isGameOverlay", "asText", "value"],
                ["asText", "result", "write", "text"],
                ["target", "element", "write", "element"],
            ],
        }),
        unmount: logs({ type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_UNMOUNT }, "embedded:unmount"),
        preference: logs({ type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_PREFERENCE_CHANGED }, "embedded:preference"),
    }),
    // A widget of the page with an init of its own.
    blueprintOn("bp-hello", { kind: "widgetMain", surfaceId: EMBEDDED, elementId: "hello" }, {
        init: logs({ type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT }, "hello:init"),
    }),
    // The page's button: says it was pressed, and tells the frame.
    blueprintOn("bp-press", { kind: "widgetMain", surfaceId: EMBEDDED, elementId: "press" }, {
        click: graphOf({
            nodes: {
                head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK },
                target: ref(EMBEDDED, "pressed"),
                write: { type: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_TEXT, params: { text: "yes" } },
                log: { type: BLUEPRINT_NODE_TYPE_LOG, params: { value: "press:click" } },
                emit: { type: BLUEPRINT_NODE_TYPE_FRAME_EMIT, params: { event: "pressed" } },
            },
            exec: ["head", "write", "log", "emit"],
            data: [["target", "element", "write", "element"]],
        }),
    }),
    // A value binding on the page.
    blueprintOn("bp-bound", { kind: "widgetValue", surfaceId: EMBEDDED, elementId: "bound", propPath: "text" }, {
        init: graphOf({
            nodes: {
                head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT },
                value: { type: BLUEPRINT_NODE_TYPE_LITERAL_STRING, params: { value: "bound-value" } },
                ret: { type: BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE },
            },
            exec: ["head", "ret"],
            data: [["value", "value", "ret", "value"]],
        }),
    }),
    // The frame on the dialogue slot hears its page's event, on the slot.
    blueprintOn("bp-frame", { kind: "widgetMain", surfaceId: DIALOG, elementId: "frame" }, {
        pageEvent: writesAndLogs({ type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_PAGE_EVENT }, DIALOG, "slotStatus", "slot-heard", "frame:pageEvent"),
    }),
];

/** The same game, with a frame that goes to another page when its page says it was pressed. */
const switchingBlueprints: readonly Blueprint[] = [
    ...blueprints.filter(blueprint => blueprint.id !== "bp-frame"),
    blueprintOn("bp-frame", { kind: "widgetMain", surfaceId: DIALOG, elementId: "frame" }, {
        pageEvent: graphOf({
            nodes: {
                head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_PAGE_EVENT },
                go: { type: BLUEPRINT_NODE_TYPE_FRAME_WIDGET_SET_PAGE, params: { targetSurfaceId: SECOND } },
            },
            exec: ["head", "go"],
        }),
    }),
    blueprintOn("bp-second", { kind: "surfaceMain", surfaceId: SECOND }, {
        init: writesAndLogs({ type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_INIT }, SECOND, "secondHello", "second-ready", "second:init"),
    }),
    blueprintOn("bp-third", { kind: "surfaceMain", surfaceId: THIRD }, {
        init: writesAndLogs({ type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_INIT }, THIRD, "thirdHello", "third-ready", "third:init"),
    }),
];

let sessionCount = 0;

/** A game running the blueprints above, wired as `GameApp` hands a session to its slots. */
function runningGame(running: readonly Blueprint[] = blueprints) {
    sessionCount += 1;
    const core = createRecordingCore([]);
    const blueprintDocument = blueprintDocumentOf(running);
    const bundle: DevModeBundle = {
        bundleId: "bundle",
        revision: 1,
        timestamp: "2026-09-21T00:00:00.000Z",
        ui: {
            uidoc: document,
            uigraphs: { schemaVersion: UI_GRAPH_DOCUMENT_SCHEMA_VERSION, blueprintDocument },
            localBlueprints: blueprintDocument,
            persistentVariables: {},
            savedVariables: {},
            saveSchema: [],
        },
    };
    const lines: string[] = [];
    const errors: string[] = [];
    core.debug.subscribeEvents(event => {
        if (event.type === "devtools.log") {
            lines.push(event.message);
        }
        if (event.type === "execution.error") {
            errors.push(event.message);
        }
    });
    const widgetRuntimeStore = new WidgetRuntimeStateStore();
    const table = { current: {} as WidgetPatchesByScope };
    const ambientSurfaces = new AmbientSurfaceTargets();
    const options = {
        sessionId: `session-${sessionCount}`,
        core,
        bundle,
        rendererRegistry: new ElementRendererRegistry(BuiltinElementRenderers),
        lifecycleRef: { current: new SurfaceLifecycleOrchestrator() },
        makeStateAccessors: (runtimeScopeId: string) => {
            const store = core.scopeBridge.getSurfaceStore(runtimeScopeId);
            return { get: (key: string) => store.get(key), set: (key: string, value: unknown) => store.set(key, value) };
        },
        host: {
            onOpenSurface: async () => undefined,
            onPageBack: async () => undefined,
            onGetGamePreference: () => 1,
            onSetGamePreference: async () => undefined,
            widgetRuntimeStore,
            localizationConfig: null,
            voiceConfig: null,
        } as unknown as GameHostCapabilities,
        startStory: async () => undefined,
        setWidgetPatchesByScope: () => undefined,
        widgetPatchesByScopeRef: table,
        ambientSurfaces,
    } as unknown as GameUiSlotHostOptions;
    const count = (line: string) => lines.filter(entry => entry === line).length;
    return { core, blueprintDocument, options, lines, errors, count, ambientSurfaces };
}

/** One drawing of the dialogue slot: what `DialogSlotSurface` draws inside the engine's box. */
function DialogDrawing(props: { options: GameUiSlotHostOptions; label: string }) {
    const runtime = useStageSlotSurfaceRuntime({ options: props.options, surface: dialogSurface, slotId: "dialog" });
    return (
        <div data-testid={props.label}>
            <StageSlotSurfaceBody options={props.options} surface={dialogSurface} runtime={runtime} />
        </div>
    );
}

function textIn(container: ParentNode, elementId: string): string {
    return container.querySelector(`[data-ui-element-id='${elementId}']`)?.textContent ?? "";
}

function within(container: HTMLElement, label: string): HTMLElement {
    const drawing = container.querySelector<HTMLElement>(`[data-testid='${label}']`);
    if (!drawing) {
        throw new Error(`no drawing "${label}" on screen`);
    }
    return drawing;
}

/** Press the embedded page's button until its page takes presses - it opens to input once revealed. */
async function pressButtonIn(drawing: HTMLElement) {
    await waitFor(() => {
        const button = drawing.querySelector("[data-ui-element-id='press']");
        expect(button, "the embedded page's button is not drawn").not.toBeNull();
        fireEvent.click(button!);
        expect(textIn(drawing, "pressed")).toContain("yes");
    });
}

beforeAll(() => {
    registerCoreBlueprintNodes();
    installResizeObserverStub();
    ensureAnimationFramePolyfill();
});

afterEach(() => cleanup());

describe("a page embedded on the dialogue slot", () => {
    it("runs its Surface Init, its widgets' init and its value bindings", async () => {
        const game = runningGame();
        const view = render(<DialogDrawing options={game.options} label="box" />);
        const box = within(view.container, "box");

        await waitFor(() => expect(textIn(box, "hello")).toContain("ready"));
        await waitFor(() => expect(textIn(box, "bound")).toContain("bound-value"));
        await waitFor(() => expect(game.count("hello:init")).toBe(1));
        expect(game.count("embedded:init")).toBe(1);
        expect(game.errors).toEqual([]);
    });

    it("answers what the slot around it answers", async () => {
        const game = runningGame();
        const view = render(<DialogDrawing options={game.options} label="box" />);
        const box = within(view.container, "box");

        await waitFor(() => expect(textIn(box, "overlay")).toContain("true"));
        expect(game.errors).toEqual([]);
    });

    it("runs its button's click graph, and its Page Event reaches the frame's graph on the slot", async () => {
        const game = runningGame();
        const view = render(<DialogDrawing options={game.options} label="box" />);
        const box = within(view.container, "box");
        await waitFor(() => expect(textIn(box, "hello")).toContain("ready"));

        await pressButtonIn(box);

        await waitFor(() => expect(textIn(box, "slotStatus")).toContain("slot-heard"));
        expect(game.count("press:click")).toBeGreaterThan(0);
        expect(game.count("frame:pageEvent")).toBe(game.count("press:click"));
        expect(game.errors).toEqual([]);
    });

    it("is a live surface for the game's window and preference events", async () => {
        const game = runningGame();
        const view = render(<DialogDrawing options={game.options} label="box" />);
        await waitFor(() => expect(textIn(within(view.container, "box"), "hello")).toContain("ready"));

        const targets = game.ambientSurfaces.list();
        expect(targets.map(target => target.surface.id)).toContain(EMBEDDED);
        await dispatchAmbientSurfaceEvent({
            blueprintDocument: game.blueprintDocument,
            persistentVariables: {},
            document,
            core: game.core,
            globalHost: { hostAdapter: targets[0]!.hostAdapter, runtimeScopeId: targets[0]!.runtimeScopeId },
            readTargets: () => game.ambientSurfaces.list(),
        }, "gamePreferenceChanged", { key: "textSpeed" });

        expect(game.count("embedded:preference")).toBe(1);
        expect(game.errors).toEqual([]);
    });

    it("answers the drawing that stays when another drawing of the slot leaves first", async () => {
        // A scene call: the caller's box is kept for its replacement grace while the called scene's
        // is already drawn, then goes.
        const game = runningGame();
        const view = render(
            <>
                <DialogDrawing options={game.options} label="leaving" />
                <DialogDrawing options={game.options} label="staying" />
            </>,
        );
        await waitFor(() => expect(textIn(within(view.container, "leaving"), "hello")).toContain("ready"));
        await waitFor(() => expect(textIn(within(view.container, "staying"), "hello")).toContain("ready"));
        // One page, drawn twice: it opened once.
        expect(game.count("embedded:init")).toBe(1);

        view.rerender(<DialogDrawing options={game.options} label="staying" />);
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 20));
        });
        // The page is still on screen, so it has not unmounted.
        expect(game.count("embedded:unmount")).toBe(0);

        const staying = within(view.container, "staying");
        await pressButtonIn(staying);
        await waitFor(() => expect(textIn(staying, "slotStatus")).toContain("slot-heard"));
        expect(game.errors).toEqual([]);

        // And when the last drawing goes, the page goes with it - once.
        view.unmount();
        await waitFor(() => expect(game.count("embedded:unmount")).toBe(1));
    });

    it("opens again, widgets and all, in a box rebuilt after the last one left", async () => {
        // The engine rebuilds the dialogue box when the gap between two lines outlives its grace, so a
        // slot scope closes and reopens many times in one scene.
        const game = runningGame();
        const view = render(<DialogDrawing options={game.options} label="first" />);
        await waitFor(() => expect(game.count("hello:init")).toBe(1));
        view.unmount();
        await waitFor(() => expect(game.count("embedded:unmount")).toBe(1));

        const again = render(<DialogDrawing options={game.options} label="second" />);
        await waitFor(() => expect(game.count("embedded:init")).toBe(2));
        await waitFor(() => expect(game.count("hello:init")).toBe(2));
        await pressButtonIn(within(again.container, "second"));
        expect(game.errors).toEqual([]);
    });
    it("switches the frame to another page, which runs - and so does a frame on that page", async () => {
        const game = runningGame(switchingBlueprints);
        const view = render(<DialogDrawing options={game.options} label="box" />);
        const box = within(view.container, "box");
        await waitFor(() => expect(textIn(box, "hello")).toContain("ready"));

        // The page's button tells the frame, and the frame's graph on the slot changes its page.
        await waitFor(() => {
            const button = box.querySelector("[data-ui-element-id='press']");
            if (button) {
                fireEvent.click(button);
            }
            expect(textIn(box, "secondHello")).toContain("second-ready");
        });
        await waitFor(() => expect(textIn(box, "thirdHello")).toContain("third-ready"));
        expect(game.count("second:init")).toBe(1);
        expect(game.count("third:init")).toBe(1);
        expect(game.errors).toEqual([]);
    });
});

/** Whether the browser's hit test could stop at this element. */
function takesPointerEvents(node: Element): boolean {
    if (node.closest("[inert]")) {
        return false;
    }
    for (let current: Element | null = node; current; current = current.parentElement) {
        const value = (current as HTMLElement).style?.pointerEvents;
        if (value) {
            return value !== "none";
        }
    }
    return true;
}

describe("a page embedded on the notification slot", () => {
    it("runs its graphs, and takes no press", async () => {
        const game = runningGame();
        const stage = { advances: 0 };
        const view = render(
            <div data-testid="game">
                <div data-testid="stage" onClick={() => (stage.advances += 1)} />
                <div data-testid="slot" style={{ pointerEvents: "none" }}>
                    <NotificationSlotSurface options={game.options} surface={notificationSurface} notifications={[]} />
                </div>
            </div>,
        );

        await waitFor(() => expect(textIn(view.container, "hello")).toContain("ready"));
        await waitFor(() => expect(textIn(view.container, "bound")).toContain("bound-value"));

        // Nothing on the embedded page is somewhere a press can land, so a press over its button goes
        // to the stage beneath, once, and the button's graph never hears it.
        const button = view.container.querySelector("[data-ui-element-id='press']")!;
        const underPoint: Element[] = [];
        for (let current: Element | null = button; current && current.getAttribute("data-testid") !== "game"; current = current.parentElement) {
            underPoint.push(current);
        }
        underPoint.push(view.container.querySelector("[data-testid='stage']")!);
        const landsOn = underPoint.find(takesPointerEvents)!;
        expect(landsOn.getAttribute("data-testid")).toBe("stage");
        fireEvent.click(landsOn);

        expect(stage.advances).toBe(1);
        expect(game.count("press:click")).toBe(0);
        expect(textIn(view.container, "pressed")).toContain("untouched");
        expect(game.errors).toEqual([]);
    });
});

describe("the host a page gets inside a frame", () => {
    it("says which Game UI slot it is drawn in when the surface around it does", () => {
        // A page in the dialogue box draws the line being spoken as the box itself does, which the
        // dialogue widgets decide from the slot their host says they are in.
        const game = runningGame();
        const { options } = game;
        const runtime = createNestedSurfaceHost({
            core: game.core,
            capabilities: options.host,
            bundle: options.bundle,
            startStory: options.startStory,
            widgetPatches: { setByScope: options.setWidgetPatchesByScope, byScopeRef: options.widgetPatchesByScopeRef },
            lifecycleRef: options.lifecycleRef,
        });
        const drawnIn = (parentHostAdapter: UIHostAdapter) => runtime.createHostAdapter!({
            document,
            parentSurface: dialogSurface,
            targetSurface: document.surfaces.find(surface => surface.id === EMBEDDED)!,
            frameElement: document.elements.frame!,
            params: {},
            instanceKey: "",
            parentHostAdapter,
            runtimeScopeId: `${DIALOG}/frame:frame->${EMBEDDED}`,
            surfacePath: [DIALOG],
        });

        expect(drawnIn({ host: "player", gameUiRuntime: { slotId: "dialog" } } as unknown as UIHostAdapter).gameUiRuntime)
            .toEqual({ slotId: "dialog" });
        expect(drawnIn({ host: "player" } as unknown as UIHostAdapter).gameUiRuntime).toBeUndefined();
    });
});
