// @vitest-environment jsdom
/**
 * A preference change, a fullscreen or focus change and a close request reach every live surface
 * that placed a head for them - not only the page.
 *
 * They reached the global blueprint and the active page and nothing else, so a modal layer over the
 * page, a surface the story put on the stage and a page drawn in a frame could all place `On Window
 * Focus Changed`, `On Preference Changed`, `On Fullscreen Changed` or `On Window Close Requested` on
 * their own blueprint and never hear it.
 *
 * What runs here is what a game runs, short of React: the layer stack and the composite a layer's
 * readiness comes from, the per-entry host builder and cache the layers and the page share, a stage
 * surface registered as its shell registers it, the real host API and nodes, and the dispatch
 * `GameApp` hands every one of the four events to. What is asserted is which graphs answered, and in
 * what order.
 *
 * Comments in English per project convention.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { Blueprint, BlueprintOwnerRef } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_TYPE_APP_KEEP_WINDOW_OPEN,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_PREFERENCE_CHANGED,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_FULLSCREEN_CHANGED,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_WINDOW_CLOSE_REQUESTED,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_WINDOW_FOCUS_CHANGED,
    BLUEPRINT_NODE_TYPE_LOG,
} from "@shared/types/blueprint/graph";
import type { DevModeBundle } from "@shared/types/devMode";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement, type UISurface } from "@shared/types/ui-editor/document";
import { UI_GRAPH_DOCUMENT_SCHEMA_VERSION } from "@shared/types/ui-editor/graph";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import { createEventPropagationControl } from "@/lib/ui-editor/runtime/eventPropagationControl";
import { createRecordingCore } from "@/lib/ui-editor/runtime/testing/lifecycleTestKit";
import { blueprintDocumentOf, graphOf, type GraphNode } from "@/lib/ui-editor/runtime/testing/rowRuntimeTestKit";
import type { AppSurfaceLayerNavEntry } from "./AppSurfaceLayer";
import {
    AmbientSurfaceTargets,
    dispatchAmbientSurfaceEvent,
    listAmbientSurfaceTargets,
    type AmbientSurfaceDispatch,
} from "./ambientSurfaceEvents";
import type { GameHostCapabilities } from "./gameHostApiOptions";
import { buildPageHostAdapterBundle, cacheHostAdapterBundles, type PageHostInputs } from "./hostAdapterBundles";
import { LayerStackController } from "./layers/LayerStackController";
import { stageSlotRuntimeScopeId } from "./stageSlots";
import type { WidgetPatchesByScope } from "./widgetRuntimePatches";

const PAGE = "page";
const DIALOG = "dialog";
const QUICK_MENU = "quick-menu";

function rootOf(surfaceId: string, childrenIds: string[] = []): UIElement {
    return {
        id: `${surfaceId}-root`,
        type: "nl.root",
        parentId: null,
        childrenIds,
        layout: { x: 0, y: 0, width: 640, height: 360, visible: true },
    };
}

const document = {
    schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
    id: "doc",
    name: "Doc",
    surfaces: [
        { id: PAGE, name: PAGE, host: "app", kind: "appSurface", designSize: { width: 640, height: 360 }, rootElementId: `${PAGE}-root` },
        { id: DIALOG, name: DIALOG, host: "app", kind: "appSurface", designSize: { width: 640, height: 360 }, rootElementId: `${DIALOG}-root` },
        {
            id: QUICK_MENU,
            name: QUICK_MENU,
            host: "player",
            kind: "stageSurface",
            designSize: { width: 640, height: 360 },
            rootElementId: `${QUICK_MENU}-root`,
            mount: { kind: "slot", slotId: "onStage" },
        },
    ],
    elements: {
        [`${PAGE}-root`]: rootOf(PAGE),
        [`${DIALOG}-root`]: rootOf(DIALOG, ["dialog-button"]),
        "dialog-button": {
            id: "dialog-button",
            type: "nl.button",
            parentId: `${DIALOG}-root`,
            childrenIds: [],
            layout: { x: 0, y: 0, width: 100, height: 40, visible: true },
        },
        [`${QUICK_MENU}-root`]: rootOf(QUICK_MENU),
    },
} as unknown as UIDocument;

function surfaceNamed(id: string): UISurface {
    return document.surfaces.find(surface => surface.id === id)!;
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

/** A head that logs a line when it runs, and then, optionally, does something else. */
function logs(head: GraphNode, line: string, then?: GraphNode) {
    return graphOf({
        nodes: {
            head,
            say: { type: "blueprint.data.stringLiteral", params: { value: line } },
            log: { type: BLUEPRINT_NODE_TYPE_LOG },
            ...(then ? { then } : {}),
        },
        exec: then ? ["head", "log", "then"] : ["head", "log"],
        data: [["say", "value", "log", "value"]],
    });
}

const onFocus: GraphNode = { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_WINDOW_FOCUS_CHANGED };
const onFullscreen: GraphNode = { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_FULLSCREEN_CHANGED };
const onPreference: GraphNode = { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_PREFERENCE_CHANGED };
const onClose: GraphNode = { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_WINDOW_CLOSE_REQUESTED };
const keepOpen: GraphNode = { type: BLUEPRINT_NODE_TYPE_APP_KEEP_WINDOW_OPEN };

/** A surface whose blueprint places every surface-level ambient head. */
function hearsEverything(surfaceId: string, closeThen?: GraphNode): Blueprint {
    return blueprintOn(`bp-${surfaceId}`, { kind: "surfaceMain", surfaceId }, {
        focus: logs(onFocus, `${surfaceId}: focus`),
        fullscreen: logs(onFullscreen, `${surfaceId}: fullscreen`),
        preference: logs(onPreference, `${surfaceId}: preference`),
        close: logs(onClose, `${surfaceId}: close`, closeThen),
    });
}

function runningGame(options: { dialog?: { keepsWindowOpen?: boolean; live?: boolean }; quickMenu?: boolean }) {
    const blueprintDocument = blueprintDocumentOf([
        blueprintOn("bp-global", { kind: "globalMain" }, { focus: logs(onFocus, "global: focus") }),
        hearsEverything(PAGE),
        hearsEverything(DIALOG, options.dialog?.keepsWindowOpen ? keepOpen : undefined),
        blueprintOn("bp-dialog-button", { kind: "widgetMain", surfaceId: DIALOG, elementId: "dialog-button" }, {
            focus: logs(onFocus, "dialog button: focus"),
        }),
        hearsEverything(QUICK_MENU),
    ]);
    const core = createRecordingCore([]);
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
    const layerStack = new LayerStackController();
    const inputs: PageHostInputs = {
        core,
        capabilities: {
            onOpenSurface: async () => undefined,
            onPageBack: async () => undefined,
            onCloseOwnLayer: () => undefined,
            widgetRuntimeStore: new WidgetRuntimeStateStore(),
            localizationConfig: null,
            voiceConfig: null,
        } as unknown as GameHostCapabilities,
        bundle,
        startStory: async () => undefined,
        widgetPatches: { setByScope: () => undefined, byScopeRef: { current: {} as WidgetPatchesByScope } },
    };
    const hostAdapterBundleFor = cacheHostAdapterBundles((entry, surface) => buildPageHostAdapterBundle(inputs, entry, surface));

    const page: AppSurfaceLayerNavEntry = {
        key: `${PAGE}:1`,
        runtimeScopeId: `${PAGE}:1`,
        surfaceId: PAGE,
        direction: "forward",
        waitForExit: false,
        props: {},
        presentation: "appPage",
    };
    core.executionManager.openScope(page.runtimeScopeId);
    if (options.dialog) {
        const key = layerStack.show({ surfaceId: DIALOG, modal: true, ownerScopeId: page.runtimeScopeId });
        core.executionManager.openScope(key);
    }

    // The stage surface registers itself, as its shell does once its graphs run.
    const registered = new AmbientSurfaceTargets();
    if (options.quickMenu) {
        const scope = stageSlotRuntimeScopeId("session", "onStage", QUICK_MENU);
        core.executionManager.openScope(scope);
        const slotHost = buildPageHostAdapterBundle(inputs, { ...page, key: scope, runtimeScopeId: scope, surfaceId: QUICK_MENU }, surfaceNamed(QUICK_MENU));
        registered.add({ surface: surfaceNamed(QUICK_MENU), hostAdapter: slotHost.hostAdapter, runtimeScopeId: scope });
    }

    const pageHost = hostAdapterBundleFor(page, surfaceNamed(PAGE))!;
    const dispatch: AmbientSurfaceDispatch = {
        blueprintDocument,
        persistentVariables: {},
        document,
        core,
        globalHost: pageHost,
        // What `GameApp` reads as each event arrives.
        readTargets: () => listAmbientSurfaceTargets({
            layers: layerStack.getState().map(layer => ({
                entry: layer,
                surface: surfaceNamed(layer.surfaceId),
                live: options.dialog?.live ?? true,
            })),
            page: { entry: page, surface: surfaceNamed(PAGE) },
            hostAdapterBundleFor,
            registered,
        }),
    };

    return {
        errors,
        /** Raise one event and say who heard it, in the order they did. */
        raise: async (
            eventName: Parameters<typeof dispatchAmbientSurfaceEvent>[1],
            payload?: Record<string, unknown>,
        ) => {
            lines.length = 0;
            const eventControl = eventName === "windowCloseRequested" ? createEventPropagationControl() : undefined;
            await dispatchAmbientSurfaceEvent(dispatch, eventName, payload, eventControl);
            return { heard: [...lines], windowCloses: !eventControl?.isPropagationStopped() };
        },
    };
}

beforeAll(() => {
    registerCoreBlueprintNodes();
});

describe("the window and preference events reach every live surface", () => {
    it("a focus change reaches the layer, its widgets, the page and the stage surface, after the global blueprint", async () => {
        const game = runningGame({ dialog: {}, quickMenu: true });

        const { heard } = await game.raise("windowFocusChanged", { isFocused: false });

        expect(heard).toEqual([
            "global: focus",
            "dialog: focus",
            "dialog button: focus",
            "page: focus",
            "quick-menu: focus",
        ]);
        expect(game.errors).toEqual([]);
    });

    it("a preference change and a fullscreen change reach the layer and the stage surface too", async () => {
        const game = runningGame({ dialog: {}, quickMenu: true });

        expect((await game.raise("gamePreferenceChanged", { key: "bgmVolume", value: 0.5, previousValue: 1 })).heard)
            .toEqual(["dialog: preference", "page: preference", "quick-menu: preference"]);
        expect((await game.raise("windowFullscreenChanged", { isFullscreen: true })).heard)
            .toEqual(["dialog: fullscreen", "page: fullscreen", "quick-menu: fullscreen"]);
        expect(game.errors).toEqual([]);
    });

    it("a close request is answered from the top down, and a layer that keeps the window open is the last to hear it", async () => {
        const game = runningGame({ dialog: { keepsWindowOpen: true }, quickMenu: true });

        expect(await game.raise("windowCloseRequested")).toEqual({ heard: ["dialog: close"], windowCloses: false });
        expect(game.errors).toEqual([]);
    });

    it("a close request nobody keeps open reaches every surface and closes the window", async () => {
        const game = runningGame({ dialog: {}, quickMenu: true });

        expect(await game.raise("windowCloseRequested")).toEqual({
            heard: ["dialog: close", "page: close", "quick-menu: close"],
            windowCloses: true,
        });
    });

    it("a layer still arriving is not reached until its graphs run", async () => {
        const game = runningGame({ dialog: { live: false } });

        expect((await game.raise("windowFocusChanged", { isFocused: true })).heard).toEqual(["global: focus", "page: focus"]);
    });
});
