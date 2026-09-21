// @vitest-environment jsdom
/**
 * A prop bound to a variable shows the variable - after it is written, too, whoever writes it.
 *
 * It did not. A value binding re-ran when a widget prop it read or one of the two state stores
 * changed, and a variable is neither: `Set Var` wrote the record, the next graph to read it saw the
 * new value, and the text bound to it kept the value it had when the page was drawn. What it looked
 * like: a global counter shown on a page and on a modal overlay, raised by a global `On Action`,
 * read "Global count: 5" on the page behind the overlay while the overlay's own `Set Text` said 7.
 *
 * Pinned here for every kind of variable a binding can reach - a global blueprint's and a page's
 * through `Get Var`, an element's, a persistent one and a saved one through a Fn the binding calls -
 * on two surfaces drawn through the real tree, with each write made by a graph on a host other than
 * the one drawing the binding, as a game makes them.
 *
 * Comments in English per project convention.
 */
import { StrictMode } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { Namespace, Storable } from "narraleaf-react";
import type { Blueprint, BlueprintOwnerRef } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_PARAM_FN_NAME,
    BLUEPRINT_NODE_PARAM_FN_REF,
    BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_FULLSCREEN_CHANGED,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_GAME_READY,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_WINDOW_FOCUS_CHANGED,
    BLUEPRINT_NODE_TYPE_FN_CALL,
    BLUEPRINT_NODE_TYPE_FN_HEAD,
    BLUEPRINT_NODE_TYPE_FN_RETURN,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
    BLUEPRINT_NODE_TYPE_LOCAL_GET,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
    BLUEPRINT_NODE_TYPE_PERSISTENT_GET,
    BLUEPRINT_NODE_TYPE_PERSISTENT_SET,
    BLUEPRINT_NODE_TYPE_SAVED_GET,
    BLUEPRINT_NODE_TYPE_STRING_CONCAT,
} from "@shared/types/blueprint/graph";
import type { DevModeBundle } from "@shared/types/devMode";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement, type UISurface } from "@shared/types/ui-editor/document";
import { UI_GRAPH_DOCUMENT_SCHEMA_VERSION } from "@shared/types/ui-editor/graph";
import type { PersistentVariableRuntimeTable } from "@shared/types/variables/registry";
import { createBlueprintFnRef } from "@/lib/workspace/services/ui-editor/blueprint/fnCatalog";
import { createExplicitBlueprintVariableRef } from "@/lib/workspace/services/ui-editor/blueprint/blueprintVariableRefs";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { BindingDebugCoalescer } from "@/lib/ui-editor/blueprint-runtime/BindingDebugCoalescer";
import { createDevModeBlueprintHostApi } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import {
    dispatchGlobalBlueprintEvent,
    dispatchSurfaceBlueprintEvent,
} from "@/lib/ui-editor/blueprint-runtime/BlueprintDispatcher";
import { DebugBridge } from "@/lib/ui-editor/blueprint-runtime/DebugBridge";
import { ScopeStoreBridge } from "@/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";
import { releaseBlueprintWidgetLocals } from "@/lib/ui-editor/blueprint-runtime/blueprintWidgetLocals";
import { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import { announceSavedVariableWrites } from "@/lib/ui-editor/runtime/app/savedVariableWrites";
import { createDevModeBlueprintHostAdapter } from "@/lib/ui-editor/runtime/hostAdapters/devModeBlueprintHostAdapter";
import { blueprintDocumentOf, graphOf, type GraphNode } from "@/lib/ui-editor/runtime/testing/rowRuntimeTestKit";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { SurfaceElementTree } from "./SurfaceElementTree";

const PAGE = "page";
const OVERLAY = "overlay";
const GLOBAL_BP = "bp-global";
const PAGE_BP = "bp-page";
const BUTTON_BP = "bp-button";
const SETTING = "setting";
const SETTING_KEY = "setting-key";
const AFFECTION = "affection";
const AFFECTION_KEY = "affection-key";
const SAVED_NAMESPACE = "saved-ns";

const persistentVariables: PersistentVariableRuntimeTable = {
    [SETTING]: {
        id: SETTING,
        name: "Setting",
        scope: "persistent",
        valueType: "string",
        defaultValue: "off",
        storageKey: SETTING_KEY,
    },
};

/** Which text shows which kind of variable. */
const SHOWS = {
    global: "global-text",
    page: "page-text",
    element: "element-text",
    persistent: "persistent-text",
    saved: "saved-text",
    stamp: "stamp-text",
    overlayGlobal: "overlay-text",
} as const;

function surfaceOf(id: string): UISurface {
    return {
        id,
        name: id,
        host: "app",
        kind: "appSurface",
        designSize: { width: 640, height: 360 },
        rootElementId: `${id}-root`,
    };
}

function textOf(id: string, surfaceId: string): UIElement {
    return {
        id,
        type: "nl.text",
        parentId: `${surfaceId}-root`,
        childrenIds: [],
        layout: { x: 0, y: 0, width: 200, height: 20 },
        props: { text: "AUTHORED" },
        valueBindings: { text: { kind: "blueprintValue", blueprintId: `bp-value-${id}`, valueType: "string" } },
    };
}

function rootOf(surfaceId: string, childrenIds: string[]): UIElement {
    return {
        id: `${surfaceId}-root`,
        type: "nl.root",
        parentId: null,
        childrenIds,
        layout: { x: 0, y: 0, width: 640, height: 360 },
    };
}

const pageTexts = [SHOWS.global, SHOWS.page, SHOWS.element, SHOWS.persistent, SHOWS.saved, SHOWS.stamp];

const document: UIDocument = {
    schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
    id: "doc",
    name: "Doc",
    surfaces: [surfaceOf(PAGE), surfaceOf(OVERLAY)],
    elements: {
        [`${PAGE}-root`]: rootOf(PAGE, [...pageTexts, "button"]),
        ...Object.fromEntries(pageTexts.map(id => [id, textOf(id, PAGE)])),
        button: {
            id: "button",
            type: "nl.button",
            parentId: `${PAGE}-root`,
            childrenIds: [],
            layout: { x: 0, y: 200, width: 100, height: 40 },
        },
        [`${OVERLAY}-root`]: rootOf(OVERLAY, [SHOWS.overlayGlobal]),
        [SHOWS.overlayGlobal]: textOf(SHOWS.overlayGlobal, OVERLAY),
    },
} as unknown as UIDocument;

function blueprintOn(
    id: string,
    owner: BlueprintOwnerRef,
    layers: Record<string, ReturnType<typeof graphOf>>,
    variables: Record<string, string> = {},
): Blueprint {
    return {
        id,
        name: id,
        owner,
        members: {
            variables: Object.fromEntries(Object.entries(variables).map(([variableId, defaultValue]) => [
                variableId,
                { id: variableId, name: variableId, valueType: "string", defaultValue },
            ])),
            fields: {},
            functions: {},
        },
        bindings: {},
        graphs: {
            events: Object.fromEntries(Object.entries(layers).map(([layerId, graph]) => [layerId, { id: layerId, graph }])),
            functions: {},
        },
    } as unknown as Blueprint;
}

/** `head -> Set Var <variable> = <value>`. */
function sets(head: GraphNode, variableId: string, value: string) {
    return graphOf({
        nodes: {
            head,
            value: { type: BLUEPRINT_NODE_TYPE_LITERAL_STRING, params: { value } },
            set: { type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId } },
        },
        exec: ["head", "set"],
        data: [["value", "value", "set", "value"]],
    });
}

/** A Fn named `name` whose body runs `reader` and returns what its `value` pin gives. */
function fnReturning(headId: string, reader: GraphNode, readerIsExec: boolean) {
    return graphOf({
        nodes: {
            [headId]: { type: BLUEPRINT_NODE_TYPE_FN_HEAD, params: { [BLUEPRINT_NODE_PARAM_FN_NAME]: headId } },
            read: reader,
            ret: { type: BLUEPRINT_NODE_TYPE_FN_RETURN, params: { __fnReturnPinIds: ["ret_1_value"] } },
        },
        exec: readerIsExec ? [headId, "read", "ret"] : [headId, "ret"],
        data: [["read", "value", "ret", "ret_1_value"]],
    });
}

/** A value blueprint for one text: `Init -> Return Value` fed by `Get Var <ref>`. */
function showsVariable(textId: string, surfaceId: string, variableRef: string): Blueprint {
    return blueprintOn(`bp-value-${textId}`, { kind: "widgetValue", surfaceId, elementId: textId, propPath: "text" }, {
        init: graphOf({
            nodes: {
                head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT },
                read: { type: BLUEPRINT_NODE_TYPE_LOCAL_GET, params: { variableId: variableRef } },
                ret: { type: BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE },
            },
            exec: ["head", "ret"],
            data: [["read", "value", "ret", "value"]],
        }),
    });
}

/** A value blueprint for one text: `Init -> Call Fn -> Return Value` fed by what the Fn returns. */
function showsFnResult(textId: string, fnRef: string): Blueprint {
    return blueprintOn(`bp-value-${textId}`, { kind: "widgetValue", surfaceId: PAGE, elementId: textId, propPath: "text" }, {
        init: graphOf({
            nodes: {
                head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT },
                call: {
                    type: BLUEPRINT_NODE_TYPE_FN_CALL,
                    params: {
                        [BLUEPRINT_NODE_PARAM_FN_REF]: fnRef,
                        __fnSignatureSnapshot: {
                            name: "read",
                            params: [],
                            returns: [{ pinId: "ret_1_value", name: "value", valueType: "any" }],
                        },
                    },
                },
                ret: { type: BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE },
            },
            exec: ["head", "call", "ret"],
            data: [["call", "ret_1_value", "ret", "value"]],
        }),
    });
}

const blueprints: readonly Blueprint[] = [
    blueprintOn(GLOBAL_BP, { kind: "globalMain" }, {
        bump: sets({ type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_GAME_READY }, "count", "7"),
        persist: graphOf({
            nodes: {
                head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_FULLSCREEN_CHANGED },
                value: { type: BLUEPRINT_NODE_TYPE_LITERAL_STRING, params: { value: "on" } },
                set: { type: BLUEPRINT_NODE_TYPE_PERSISTENT_SET, params: { persistentVariableId: SETTING } },
            },
            exec: ["head", "set"],
            data: [["value", "value", "set", "value"]],
        }),
    }, { count: "5" }),
    blueprintOn(PAGE_BP, { kind: "surfaceMain", surfaceId: PAGE }, {
        tally: sets({ type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_WINDOW_FOCUS_CHANGED }, "tally", "written"),
        readSetting: fnReturning("readSetting", {
            type: BLUEPRINT_NODE_TYPE_PERSISTENT_GET,
            params: { persistentVariableId: SETTING },
        }, true),
        readAffection: fnReturning("readAffection", {
            type: BLUEPRINT_NODE_TYPE_SAVED_GET,
            params: { savedVariableId: AFFECTION },
        }, true),
        // Appends to a variable and returns it: a binding calling this writes what it reads.
        stamp: graphOf({
            nodes: {
                stampFn: { type: BLUEPRINT_NODE_TYPE_FN_HEAD, params: { [BLUEPRINT_NODE_PARAM_FN_NAME]: "stamp" } },
                before: { type: BLUEPRINT_NODE_TYPE_LOCAL_GET, params: { variableId: "stamp" } },
                append: { type: BLUEPRINT_NODE_TYPE_STRING_CONCAT, params: { b: "+" } },
                set: { type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "stamp" } },
                after: { type: BLUEPRINT_NODE_TYPE_LOCAL_GET, params: { variableId: "stamp" } },
                ret: { type: BLUEPRINT_NODE_TYPE_FN_RETURN, params: { __fnReturnPinIds: ["ret_1_value"] } },
            },
            exec: ["stampFn", "set", "ret"],
            data: [
                ["before", "value", "append", "a"],
                ["append", "result", "set", "value"],
                ["after", "value", "ret", "ret_1_value"],
            ],
        }),
    }, { tally: "fresh", stamp: "" }),
    blueprintOn(BUTTON_BP, { kind: "widgetMain", surfaceId: PAGE, elementId: "button" }, {
        click: sets({ type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK }, "mark", "marked"),
        readMark: fnReturning("readMark", { type: BLUEPRINT_NODE_TYPE_LOCAL_GET, params: { variableId: "mark" } }, false),
    }, { mark: "unmarked" }),
    showsVariable(SHOWS.global, PAGE, createExplicitBlueprintVariableRef(GLOBAL_BP, "count")),
    showsVariable(SHOWS.page, PAGE, createExplicitBlueprintVariableRef(PAGE_BP, "tally")),
    showsVariable(SHOWS.overlayGlobal, OVERLAY, createExplicitBlueprintVariableRef(GLOBAL_BP, "count")),
    showsFnResult(SHOWS.element, createBlueprintFnRef(BUTTON_BP, "readMark")),
    showsFnResult(SHOWS.persistent, createBlueprintFnRef(PAGE_BP, "readSetting")),
    showsFnResult(SHOWS.saved, createBlueprintFnRef(PAGE_BP, "readAffection")),
    showsFnResult(SHOWS.stamp, createBlueprintFnRef(PAGE_BP, "stampFn")),
];

const blueprintDocument = blueprintDocumentOf(blueprints);

const bundle = {
    bundleId: "bundle",
    revision: 1,
    timestamp: "2026-09-21T00:00:00.000Z",
    ui: {
        uidoc: document,
        uigraphs: { schemaVersion: UI_GRAPH_DOCUMENT_SCHEMA_VERSION, blueprintDocument },
        localBlueprints: blueprintDocument,
        persistentVariables,
        savedVariables: {},
        saveSchema: [],
    },
} as unknown as DevModeBundle;

let runCount = 0;

/**
 * One running game: the store every host shares, the engine's saved-variable store, and a host per
 * surface built the way a game builds each entry's.
 */
function runningGame() {
    runCount += 1;
    const scope = new ScopeStoreBridge();
    // A game seeds every declared persistent variable with its default before anything reads it.
    void scope.persistenceSet(SETTING_KEY, "off");
    const debug = new DebugBridge();
    const errors: string[] = [];
    debug.subscribeEvents(event => {
        if (event.type === "execution.error") {
            errors.push(event.message);
        }
    });
    const storable = new Storable();
    const saved = new Namespace(SAVED_NAMESPACE, { [AFFECTION_KEY]: 1 });
    storable.addNamespace(saved);
    const savedWatch = announceSavedVariableWrites(storable, {
        savedNamespaceName: SAVED_NAMESPACE,
        savedVariables: { [AFFECTION]: { id: AFFECTION, storageKey: AFFECTION_KEY } },
    });
    const widgetRuntimeStore = new WidgetRuntimeStateStore();

    function hostFor(surfaceId: string, runtimeScopeId: string): UIHostAdapter {
        const surface = document.surfaces.find(candidate => candidate.id === surfaceId)!;
        let adapter: UIHostAdapter | null = null;
        const hostApi = createDevModeBlueprintHostApi({
            document,
            scope,
            activeSurfaceId: surfaceId,
            runtimeScopeId,
            pageProps: {},
            emit: event => debug.emit(event),
            onOpenSurface: () => undefined,
            onPageBack: () => undefined,
            onWidgetPatch: () => undefined,
            widgetRuntimeStore,
            onGetSavedVariable: variableId => variableId === AFFECTION
                ? { value: storable.getNamespace(SAVED_NAMESPACE).get(AFFECTION_KEY), found: true }
                : { value: null, found: false },
            resolveHostAdapter: () => adapter,
        } as Parameters<typeof createDevModeBlueprintHostApi>[0]);
        adapter = createDevModeBlueprintHostAdapter({
            bundle,
            surface,
            runtimeScopeId,
            scopeBridge: scope,
            debug,
            hostApi,
        });
        return adapter;
    }

    const pageScope = `${PAGE}#${runCount}`;
    const overlayScope = `${OVERLAY}#${runCount}`;
    const pageHost = hostFor(PAGE, pageScope);
    const overlayHost = hostFor(OVERLAY, overlayScope);

    const registry = new ElementRendererRegistry([
        { type: "nl.root", render: props => <>{props.children}</> },
        {
            type: "nl.text",
            render: props => <span data-text={props.element.id}>{String(props.element.props?.text ?? "")}</span>,
        },
        { type: "nl.button", render: () => <span data-button="" /> },
    ]);

    function draw(surfaceId: string, runtimeScopeId: string, hostAdapter: UIHostAdapter) {
        const surface = document.surfaces.find(candidate => candidate.id === surfaceId)!;
        return (
            <SurfaceElementTree
                document={document}
                surface={surface}
                rootElement={document.elements[surface.rootElementId]!}
                rendererRegistry={registry}
                hostAdapter={hostAdapter}
                blueprintBindingContext={{
                    blueprintDocument,
                    persistentVariables,
                    surfaceState: scope.getSurfaceStore(runtimeScopeId),
                    debug,
                    coalescer: new BindingDebugCoalescer(),
                    globalState: {
                        get: key => scope.globalGet(key),
                        subscribe: listener => scope.subscribeGlobals(listener),
                    },
                }}
                editorChrome={false}
            />
        );
    }

    const view = render(
        <StrictMode>
            <div>{draw(PAGE, pageScope, pageHost)}</div>
            <div>{draw(OVERLAY, overlayScope, overlayHost)}</div>
        </StrictMode>,
    );

    const state = new Map<string, unknown>();
    const stateAccess = {
        getSurfaceState: (key: string) => state.get(key),
        setSurfaceState: (key: string, value: unknown) => {
            state.set(key, value);
        },
    };

    return {
        errors,
        shown: (textId: string) => view.container.querySelector(`[data-text="${textId}"]`)?.textContent ?? null,
        /** The global blueprint, dispatched on a host of its own. */
        global: (eventName: string, eventPayload: Record<string, unknown> = {}) =>
            dispatchGlobalBlueprintEvent({
                blueprintDocument,
                persistentVariables,
                eventName,
                eventPayload,
                hostAdapter: hostFor(PAGE, `global#${runCount}`),
                debug,
                ...stateAccess,
            }),
        /** The page's own blueprint, on a second host for the page's scope - not the one drawing it. */
        page: (eventName: string, eventPayload: Record<string, unknown> = {}) =>
            dispatchSurfaceBlueprintEvent({
                blueprintDocument,
                persistentVariables,
                surfaceId: PAGE,
                runtimeScopeId: pageScope,
                eventName,
                eventPayload,
                hostAdapter: hostFor(PAGE, pageScope),
                debug,
                ...stateAccess,
            }),
        clickButton: () =>
            pageHost.blueprintRuntime!.dispatchElementBlueprintEvent("button", "mouseClick", {
                element: { surfaceId: PAGE, elementId: "button", elementType: "nl.button" },
            }),
        storable,
        dispose: () => {
            savedWatch.cancel();
            view.unmount();
            releaseBlueprintWidgetLocals(PAGE, "button", BUTTON_BP, pageScope);
        },
    };
}

/** Value graphs are async; let every evaluation, and every re-render it asks for, finish. */
async function settle(): Promise<void> {
    for (let i = 0; i < 10; i += 1) {
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 0));
        });
    }
}

beforeAll(() => {
    registerCoreBlueprintNodes();
    if (typeof globalThis.ResizeObserver === "undefined") {
        globalThis.ResizeObserver = class {
            public observe(): void {}
            public unobserve(): void {}
            public disconnect(): void {}
        } as unknown as typeof ResizeObserver;
    }
});

let game: ReturnType<typeof runningGame> | null = null;

afterEach(() => {
    game?.dispose();
    game = null;
    cleanup();
});

describe("a prop bound to a variable", () => {
    it("starts out showing every variable's current value", async () => {
        game = runningGame();
        await settle();

        expect(game.shown(SHOWS.global)).toBe("5");
        expect(game.shown(SHOWS.overlayGlobal)).toBe("5");
        expect(game.shown(SHOWS.page)).toBe("fresh");
        expect(game.shown(SHOWS.element)).toBe("unmarked");
        expect(game.shown(SHOWS.persistent)).toBe("off");
        expect(game.shown(SHOWS.saved)).toBe("1");
        expect(game.errors).toEqual([]);
    });

    it("follows a global variable the global blueprint writes, on the page and on the overlay", async () => {
        game = runningGame();
        await settle();

        await act(async () => {
            await game!.global("gameReady");
        });
        await settle();

        expect(game.shown(SHOWS.global)).toBe("7");
        expect(game.shown(SHOWS.overlayGlobal)).toBe("7");
        expect(game.errors).toEqual([]);
    });

    it("follows a page variable the page's own graph writes from another host", async () => {
        game = runningGame();
        await settle();

        await act(async () => {
            await game!.page("windowFocusChanged", { isFocused: false });
        });
        await settle();

        expect(game.shown(SHOWS.page)).toBe("written");
        expect(game.errors).toEqual([]);
    });

    it("follows an element's variable, read through a Fn on that element", async () => {
        game = runningGame();
        await settle();

        await act(async () => {
            await game!.clickButton();
        });
        await settle();

        expect(game.shown(SHOWS.element)).toBe("marked");
        expect(game.errors).toEqual([]);
    });

    it("follows a persistent variable a graph writes, read through a Fn", async () => {
        game = runningGame();
        await settle();

        await act(async () => {
            await game!.global("windowFullscreenChanged", { isFullscreen: true });
        });
        await settle();

        expect(game.shown(SHOWS.persistent)).toBe("on");
        expect(game.errors).toEqual([]);
    });

    it("does not run a binding again for a write its own evaluation made", async () => {
        game = runningGame();
        await settle();
        const first = game.shown(SHOWS.stamp);
        await settle();

        // One run, one append. A binding that re-ran on its own write would append forever.
        expect(first).toMatch(/^\++$/);
        expect(game.shown(SHOWS.stamp)).toBe(first);
        expect(game.errors).toEqual([]);
    });

    it("follows a saved variable the playthrough writes, read through a Fn", async () => {
        game = runningGame();
        await settle();

        await act(async () => {
            game!.storable.getNamespace(SAVED_NAMESPACE).set(AFFECTION_KEY, 3);
        });
        await settle();

        expect(game.shown(SHOWS.saved)).toBe("3");
        expect(game.errors).toEqual([]);
    });
});
