// @vitest-environment jsdom
/**
 * A graph a key press runs on a page reads and writes the page the player is looking at.
 *
 * `GameApp` dispatches key presses - and the declared actions they raise, the menu bar, window
 * focus and fullscreen, a preference changing, a close request - to the active page itself, and
 * for that it used to build a host of its own beside the one the page's layer draws with. Same
 * inputs, same runtime scope, and a different object, and the host is not stateless:
 *
 *  - its host API kept its own copy of what it had painted, taken when it was built, so an Escape
 *    handler asking "is the viewer open?" read the page as it was when it opened - `false`, with the
 *    viewer on screen - and closed the page under the player instead of the viewer;
 *  - its adapter kept its own register of the rows the page's lists had on screen, which nothing
 *    ever filled, so a broadcast sent from that handler reached no row of any list.
 *
 * The starter project's gallery viewer worked around the first by keeping "is the viewer open" in a
 * page variable, which is the kind of rule nobody should need to be told.
 *
 * What runs here is what a game runs: the page host builder and the per-entry lookup `GameApp` and
 * its layers share, the Dev Mode adapter, the real host API and nodes, the real element tree drawing
 * the page, a real click on its button, and the key half of `GameApp`'s keyboard listener - the
 * vocabulary lookup and the surface dispatch it makes, against the bundle `GameApp` holds for the
 * active page. What is asserted is what the player would see: the text the handler writes into the
 * table the page is painted from, and the lines the rows log.
 *
 * Comments in English per project convention.
 */
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Blueprint } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_TYPE_BROADCAST_SEND,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_PROPERTY,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY,
    BLUEPRINT_NODE_TYPE_ELEMENT_REF,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_TEXT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ACTION,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_BROADCAST,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD,
    BLUEPRINT_NODE_TYPE_LOG,
    BLUEPRINT_NODE_TYPE_STRING_TO_STRING,
} from "@shared/types/blueprint/graph";
import type { DevModeBundle } from "@shared/types/devMode";
import type { UIDocument, UIElement, UISurface } from "@shared/types/ui-editor/document";
import { UI_GRAPH_DOCUMENT_SCHEMA_VERSION } from "@shared/types/ui-editor/graph";
import { UI_SURFACE_INPUT_ACTION_EVENT } from "@shared/types/ui-editor/inputActionEvent";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { dispatchSurfaceBlueprintEvent } from "@/lib/ui-editor/blueprint-runtime/BlueprintDispatcher";
import { releaseBlueprintWidgetLocals } from "@/lib/ui-editor/blueprint-runtime/blueprintWidgetLocals";
import { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { BuiltinElementRenderers } from "@/lib/ui-editor/runtime/builtin";
import { WidgetRuntimeStateProvider } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import { resolveSurfaceInputActionHits } from "@/lib/ui-editor/runtime/input/surfaceInputActions";
import { SurfaceElementTree } from "@/lib/ui-editor/runtime/surface/SurfaceElementTree";
import { createRecordingCore, ensureAnimationFramePolyfill } from "@/lib/ui-editor/runtime/testing/lifecycleTestKit";
import { blueprintDocumentOf, blueprintOf, graphOf, type GraphNode } from "@/lib/ui-editor/runtime/testing/rowRuntimeTestKit";
import {
    LAB,
    LAB_ROW_NAMES,
    installResizeObserverStub,
    labDocument,
} from "@/lib/ui-editor/runtime/testing/drawingLabFixture";
import type { AppSurfaceLayerNavEntry } from "./AppSurfaceLayer";
import type { GameHostCapabilities } from "./gameHostApiOptions";
import { buildPageHostAdapterBundle, cacheHostAdapterBundles, type PageHostInputs } from "./hostAdapterBundles";
import type { WidgetPatchesByScope } from "./widgetRuntimePatches";

/** One action, bound to Escape, which the page answers: the shape of a "close" in the starter project. */
const CLOSE = "close";

function elementOf(id: string, type: string, extra: Partial<UIElement> = {}): UIElement {
    return {
        id,
        type,
        parentId: "root",
        childrenIds: [],
        layout: { x: 0, y: 300, width: 60, height: 24, visible: true },
        ...extra,
    };
}

/**
 * The drawing lab's gallery page, with an Open button, the viewer it opens (hidden as authored) and
 * a status line, and an Escape action the page answers.
 */
const pageDocument: UIDocument = {
    ...labDocument,
    actions: { [CLOSE]: { id: CLOSE, name: "Close", bindings: [{ kind: "key", key: "Escape" }] } },
    surfaces: [{ ...labDocument.surfaces[0]!, actions: [{ actionId: CLOSE }] }],
    elements: {
        ...labDocument.elements,
        root: {
            ...labDocument.elements.root!,
            childrenIds: [...labDocument.elements.root!.childrenIds, "open", "viewer", "status"],
        },
        open: elementOf("open", "nl.button", { props: { label: "Open" } }),
        viewer: elementOf("viewer", "nl.container", { layout: { x: 100, y: 0, width: 200, height: 200, visible: false } }),
        status: elementOf("status", "nl.text", { props: { text: "-" } }),
    },
};

const surface = pageDocument.surfaces[0] as UISurface;

/** An `Element` node naming an element of the page. */
function ref(elementId: string): GraphNode {
    const element = pageDocument.elements[elementId]!;
    return { type: BLUEPRINT_NODE_TYPE_ELEMENT_REF, params: { surfaceId: LAB, elementId, elementType: element.type } };
}

/** The page's own graph, on the surface: the heads a key press reaches. */
function pageBlueprint(layers: Parameters<typeof blueprintOf>[2]): Blueprint {
    return { ...blueprintOf("bp-page", { kind: "widgetMain", surfaceId: LAB, elementId: "root" }, layers), owner: { kind: "surfaceMain", surfaceId: LAB } } as Blueprint;
}

/** Open: the pointer-driven half, a click on the button showing the viewer. */
const openShowsTheViewer = blueprintOf("bp-open", { kind: "widgetMain", surfaceId: LAB, elementId: "open" }, {
    click: {
        graph: graphOf({
            nodes: {
                head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK },
                viewer: ref("viewer"),
                show: { type: BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY, params: { property: "visible", value: true } },
            },
            exec: ["head", "show"],
            data: [["viewer", "element", "show", "element"]],
        }),
    },
});

/** Escape: read whether the viewer is showing, and write the answer on the page. */
const escapeReportsTheViewer = pageBlueprint({
    escape: {
        graph: graphOf({
            nodes: {
                head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ACTION, params: { actionId: CLOSE } },
                viewer: ref("viewer"),
                visible: { type: BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_PROPERTY, params: { property: "visible" } },
                asText: { type: BLUEPRINT_NODE_TYPE_STRING_TO_STRING },
                status: ref("status"),
                write: { type: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_TEXT },
            },
            exec: ["head", "write"],
            data: [
                ["viewer", "element", "visible", "element"],
                ["visible", "value", "asText", "value"],
                ["asText", "result", "write", "text"],
                ["status", "element", "write", "element"],
            ],
        }),
    },
});

/** Escape: tell whoever is listening. */
const escapeBroadcasts = pageBlueprint({
    escape: {
        graph: graphOf({
            nodes: {
                head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ACTION, params: { actionId: CLOSE } },
                send: { type: BLUEPRINT_NODE_TYPE_BROADCAST_SEND, params: { event: "closing" } },
            },
            exec: ["head", "send"],
        }),
    },
});

/** A gallery row: hears the broadcast, and logs which row it is. */
const rowHearsIt = blueprintOf("bp-mark", { kind: "widgetMain", surfaceId: LAB, elementId: "mark" }, {
    closing: {
        graph: graphOf({
            nodes: {
                head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_BROADCAST, params: { event: "closing" } },
                name: { type: BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD, params: { field: "f-name" } },
                log: { type: BLUEPRINT_NODE_TYPE_LOG },
            },
            exec: ["head", "log"],
            data: [["name", "value", "log", "value"]],
        }),
    },
});

let entryCount = 0;
const running: Array<() => void> = [];

/**
 * A game running `blueprints`, wired as `GameApp` wires one: the widget patch table every host of
 * the game writes, and the page host builder behind the per-entry lookup its layers and its own
 * dispatches share.
 */
function runningGame(blueprints: readonly Blueprint[]) {
    entryCount += 1;
    const core = createRecordingCore([]);
    const blueprintDocument = blueprintDocumentOf(blueprints);
    const bundle: DevModeBundle = {
        bundleId: "bundle",
        revision: 1,
        timestamp: "2026-09-21T00:00:00.000Z",
        ui: {
            uidoc: pageDocument,
            uigraphs: { schemaVersion: UI_GRAPH_DOCUMENT_SCHEMA_VERSION, blueprintDocument },
            localBlueprints: blueprintDocument,
            persistentVariables: {},
            savedVariables: {},
            saveSchema: [],
        },
    };
    const logs: string[] = [];
    const errors: string[] = [];
    core.debug.subscribeEvents(event => {
        if (event.type === "devtools.log") {
            logs.push(event.message);
        }
        if (event.type === "execution.error") {
            errors.push(event.message);
        }
    });
    const widgetRuntimeStore = new WidgetRuntimeStateStore();
    // The table itself, as `GameApp` holds it; the React state beside it only re-renders.
    const table = { current: {} as WidgetPatchesByScope };
    const inputs: PageHostInputs = {
        core,
        capabilities: {
            onOpenSurface: async () => undefined,
            onPageBack: async () => undefined,
            widgetRuntimeStore,
            localizationConfig: null,
            voiceConfig: null,
        } as unknown as GameHostCapabilities,
        bundle,
        startStory: async () => undefined,
        widgetPatches: { setByScope: () => undefined, byScopeRef: table },
    };
    const build = (entry: AppSurfaceLayerNavEntry, drawn: UISurface) => buildPageHostAdapterBundle(inputs, entry, drawn);
    const entry: AppSurfaceLayerNavEntry = {
        key: `${LAB}:${entryCount}`,
        runtimeScopeId: `${LAB}:${entryCount}`,
        surfaceId: LAB,
        direction: "forward",
        waitForExit: false,
        props: {},
        presentation: "appPage",
    };
    const runtimeScopeId = entry.runtimeScopeId;
    core.executionManager.openScope(runtimeScopeId);
    running.push(() => {
        for (const blueprint of blueprints) {
            if (blueprint.owner.kind === "widgetMain") {
                releaseBlueprintWidgetLocals(LAB, blueprint.owner.elementId, blueprint.id, runtimeScopeId);
            }
        }
    });

    /** What an Escape does in `GameApp`: the page's declared actions, against the bundle it holds for the page. */
    const pressEscape = async (hostBundle: NonNullable<ReturnType<typeof build>>) => {
        const hits = resolveSurfaceInputActionHits({
            vocabulary: pageDocument.actions,
            enablements: surface.actions,
            signal: { kind: "key", event: { key: "Escape", altKey: false, ctrlKey: false, shiftKey: false, metaKey: false } },
        });
        expect(hits.map(hit => hit.actionId)).toEqual([CLOSE]);
        const surfaceStore = core.scopeBridge.getSurfaceStore(runtimeScopeId);
        await Promise.all(hits.map(hit => dispatchSurfaceBlueprintEvent({
            blueprintDocument,
            persistentVariables: {},
            surfaceId: surface.id,
            runtimeScopeId,
            eventName: UI_SURFACE_INPUT_ACTION_EVENT,
            eventPayload: { ...hit.payload },
            hostAdapter: hostBundle.hostAdapter,
            debug: core.debug,
            getSurfaceState: key => surfaceStore.get(key),
            setSurfaceState: (key, value) => surfaceStore.set(key, value),
            executionManager: core.executionManager,
        })));
    };

    /** The page as its layer draws it: the element tree, on the host the layer looks up for the entry. */
    const drawPage = (hostBundle: NonNullable<ReturnType<typeof build>>) => render(
        <div data-ui-surface-id={LAB}>
            <WidgetRuntimeStateProvider externalStore={widgetRuntimeStore}>
                <SurfaceElementTree
                    document={pageDocument}
                    surface={surface}
                    rootElement={pageDocument.elements.root!}
                    rendererRegistry={new ElementRendererRegistry(BuiltinElementRenderers)}
                    hostAdapter={hostBundle.hostAdapter}
                    editorChrome={true}
                />
            </WidgetRuntimeStateProvider>
        </div>,
    );

    return {
        build,
        entry,
        logs,
        errors,
        pressEscape,
        drawPage,
        /** What the status line is painted with. */
        statusText: () => table.current[runtimeScopeId]?.status?.props?.text,
        viewerVisible: () => table.current[runtimeScopeId]?.viewer?.visible,
    };
}

beforeAll(() => {
    registerCoreBlueprintNodes();
    installResizeObserverStub();
    ensureAnimationFramePolyfill();
});

afterEach(() => {
    cleanup();
    for (const release of running.splice(0)) {
        release();
    }
});

describe("a key press on a page", () => {
    it("reads a visibility a click on the page wrote", async () => {
        const game = runningGame([openShowsTheViewer, escapeReportsTheViewer]);
        const hostAdapterBundleFor = cacheHostAdapterBundles(game.build);
        // Both callers, as `GameApp` has them: the layer drawing the entry, and the app's own
        // bundle for the active page - asked for in that order or the other, it is one host.
        const forKeys = hostAdapterBundleFor(game.entry, surface)!;
        const view = game.drawPage(hostAdapterBundleFor(game.entry, surface)!);

        fireEvent.click(view.container.querySelector("[data-ui-element-id='open']")!);
        await waitFor(() => expect(game.viewerVisible()).toBe(true));

        await game.pressEscape(forKeys);

        expect(game.statusText()).toBe("true");
        expect(game.errors).toEqual([]);
    });

    it("reads it on a host rebuilt after the click, and one built before it", async () => {
        // A page's host is rebuilt whenever the game's capabilities are - a story mounting is
        // enough - and a graph that was already running (a `Delay` loop, a `Wait`) carries on with
        // the one it started on. Both have to read the page the player sees, whoever wrote it.
        const game = runningGame([openShowsTheViewer, escapeReportsTheViewer]);
        const before = cacheHostAdapterBundles(game.build)(game.entry, surface)!;
        const view = game.drawPage(cacheHostAdapterBundles(game.build)(game.entry, surface)!);

        fireEvent.click(view.container.querySelector("[data-ui-element-id='open']")!);
        await waitFor(() => expect(game.viewerVisible()).toBe(true));

        await game.pressEscape(before);
        expect(game.statusText()).toBe("true");

        await game.pressEscape(cacheHostAdapterBundles(game.build)(game.entry, surface)!);
        expect(game.statusText()).toBe("true");
        expect(game.errors).toEqual([]);
    });

    it("sends a broadcast that reaches every row the page's lists are showing", async () => {
        const game = runningGame([escapeBroadcasts, rowHearsIt]);
        const hostAdapterBundleFor = cacheHostAdapterBundles(game.build);
        const forKeys = hostAdapterBundleFor(game.entry, surface)!;
        game.drawPage(hostAdapterBundleFor(game.entry, surface)!);

        await game.pressEscape(forKeys);

        expect(game.logs).toEqual([...LAB_ROW_NAMES]);
        expect(game.errors).toEqual([]);
    });
});
