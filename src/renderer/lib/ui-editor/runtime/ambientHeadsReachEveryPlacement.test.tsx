// @vitest-environment jsdom
/**
 * A head a component definition is offered must hear its event in every placement of the component.
 *
 * Most events come from one drawing: a click lands in one placement and says so. The ambient ones do
 * not - a broadcast, a window event, another element's click or flush name nobody's drawing - and the
 * runtime answers "which drawings" with `everyDrawingOf` (see `widgetDrawingRegistry.ts`). That
 * enumerates the rows of a list and nothing else: an element inside a component definition gets one
 * run, as nobody. And the fan-out collectors only look at blueprints on the page's own elements, so a
 * definition's graph is not even found. Neither has mattered, because none of these heads is offered
 * inside a component definition (see `componentWidgetOwnGraph.test.ts`, which lists each with its
 * reason).
 *
 * This is the other half of that list: whoever offers one of these heads in a component must also
 * make its event reach each placement, each run with that placement's params - or the head is
 * written, the event is raised, and nothing happens, without a word.
 *
 * Every event is raised on every run of this test, with a control on the page, so the guard is known
 * to be measuring the real thing on the day somebody opens the door. The key presses already reach
 * every placement, because each drawing listens for keys itself and dispatches in its own drawing;
 * they are here so that stays true.
 *
 * Comments in English per project convention.
 */
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { BlueprintOwnerRef } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_PARAM_EVENT_HEAD_KEY_NAME,
    BLUEPRINT_NODE_TYPE_COMPONENT_GET_PARAM,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_DOWN,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_UP,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_FLUSH,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_FULLSCREEN_CHANGED,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_UP,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_ANY_BROADCAST,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_BROADCAST,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_WINDOW_FOCUS_CHANGED,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
    BLUEPRINT_NODE_TYPE_LOG,
} from "@shared/types/blueprint/graph";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import { blueprintNodeRegistry, isBlueprintNodeAllowedInGraphContext } from "@/lib/ui-editor/blueprint-nodes/BlueprintNodeRegistry";
import { buildBlueprintGraphContext } from "@/lib/ui-editor/blueprint-nodes/graphContext";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { dispatchWidgetsBlueprintEvent } from "@/lib/ui-editor/blueprint-runtime/BlueprintDispatcher";
import { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { BuiltinElementRenderers } from "@/lib/ui-editor/runtime/builtin";
import { WidgetRuntimeStateProvider } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { SurfaceElementTree } from "@/lib/ui-editor/runtime/surface/SurfaceElementTree";
import { installResizeObserverStub } from "./testing/drawingLabFixture";
import { blueprintOf, createRowRuntime, graphOf } from "./testing/rowRuntimeTestKit";

const PAGE = "ring-page";

function elementsOf(specs: Record<string, { type: string; parent: string | null; extra?: Record<string, unknown> }>) {
    const out: Record<string, UIElement> = {};
    for (const [id, spec] of Object.entries(specs)) {
        out[id] = {
            id,
            type: spec.type,
            parentId: spec.parent,
            childrenIds: Object.entries(specs).filter(([, child]) => child.parent === id).map(([childId]) => childId),
            layout: { x: 0, y: 0, width: 60, height: 24 },
            ...(spec.extra ? { extra: spec.extra } : {}),
        };
    }
    return out;
}

const placing = (label: string) => ({ componentLink: { componentId: "ringDef", linked: true, params: { label } } });

/** A page placing one component twice, beside a widget of its own and something to click. */
const document: UIDocument = {
    schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
    id: "ring-doc",
    name: "Ring",
    surfaces: [
        { id: PAGE, name: "Ring", host: "app", kind: "appSurface", designSize: { width: 640, height: 360 }, rootElementId: "root" },
    ],
    elements: elementsOf({
        root: { type: "nl.root", parent: null },
        ringA: { type: "nl.container", parent: "root", extra: placing("A") },
        ringB: { type: "nl.container", parent: "root", extra: placing("B") },
        watcher: { type: "nl.container", parent: "root" },
        target: { type: "nl.container", parent: "root" },
    }),
    components: [
        {
            id: "ringDef",
            name: "Ring",
            rootElementId: "ringRoot",
            params: [{ id: "label", name: "Label", type: "string", defaultValue: "" }],
            elements: elementsOf({
                ringRoot: { type: "nl.container", parent: null },
                bell: { type: "nl.container", parent: "ringRoot" },
            }),
        },
    ],
};

type Running = ReturnType<typeof createRowRuntime>;

function raiseWindowEvent(page: Running, eventName: string) {
    return dispatchWidgetsBlueprintEvent({
        document: page.document,
        blueprintDocument: page.blueprintDocument,
        persistentVariables: {},
        surfaceId: PAGE,
        runtimeScopeId: page.runtime.runtimeScopeId,
        eventName,
        eventPayload: {},
        hostAdapter: page.adapter,
        debug: { emit: () => undefined } as never,
        getSurfaceState: () => undefined,
        setSurfaceState: () => undefined,
    });
}

const targetRef = { surfaceId: PAGE, elementId: "target", elementType: "nl.container" };

/** Every head that reaches a widget from no drawing of it, with how to raise its event. */
const AMBIENT_HEADS: ReadonlyArray<{
    type: string;
    params?: Record<string, unknown>;
    raise: (page: Running) => Promise<unknown> | void;
}> = [
    { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_BROADCAST, params: { event: "ping" }, raise: page => page.runtime.dispatchBroadcastEvent!("ping", null) },
    { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_ANY_BROADCAST, raise: page => page.runtime.dispatchBroadcastEvent!("ping", null) },
    { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_WINDOW_FOCUS_CHANGED, raise: page => raiseWindowEvent(page, "windowFocusChanged") },
    { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_FULLSCREEN_CHANGED, raise: page => raiseWindowEvent(page, "windowFullscreenChanged") },
    { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK, params: targetRef, raise: page => page.runtime.dispatchElementBlueprintEvent("target", "mouseClick") },
    { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_FLUSH, params: targetRef, raise: page => page.runtime.dispatchElementBlueprintEvent("target", "flush") },
    {
        type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN,
        params: { [BLUEPRINT_NODE_PARAM_EVENT_HEAD_KEY_NAME]: "escape" },
        raise: () => { fireEvent.keyDown(window, { key: "Escape", code: "Escape" }); },
    },
    {
        type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_UP,
        params: { [BLUEPRINT_NODE_PARAM_EVENT_HEAD_KEY_NAME]: "escape" },
        raise: () => { fireEvent.keyUp(window, { key: "Escape", code: "Escape" }); },
    },
    { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_DOWN, raise: () => { fireEvent.keyDown(window, { key: "k", code: "KeyK" }); } },
    { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_UP, raise: () => { fireEvent.keyUp(window, { key: "k", code: "KeyK" }); } },
];

/** Whether any widget inside a component definition is offered this head. */
function offeredInComponents(headType: string): boolean {
    const def = blueprintNodeRegistry.get(headType);
    if (!def) {
        throw new Error(`${headType} is not a registered node - the list above is stale`);
    }
    return BuiltinElementRenderers.some(renderer => {
        const owner: BlueprintOwnerRef = { kind: "componentWidgetMain", componentId: "ringDef", elementId: "bell" };
        return isBlueprintNodeAllowedInGraphContext(def, buildBlueprintGraphContext({
            graphKind: "event",
            owner,
            widgetElementType: renderer.type,
            isComponentDefinitionGraph: true,
        }));
    });
}

function headThenLog(headType: string, params: Record<string, unknown> | undefined, value: { type: string; params?: Record<string, unknown> }) {
    return graphOf({
        nodes: { head: { type: headType, params }, value, log: { type: BLUEPRINT_NODE_TYPE_LOG } },
        exec: ["head", "log"],
        data: [["value", "value", "log", "value"]],
    });
}

beforeAll(() => {
    registerCoreBlueprintNodes();
    installResizeObserverStub();
});

let page: Running | null = null;
afterEach(() => {
    cleanup();
    page?.release();
    page = null;
});

/** Raise one head's event on the page, and say who heard it: "page" for the control, a label per placement. */
async function whoHears(head: (typeof AMBIENT_HEADS)[number]): Promise<{ page: string[]; placements: string[] }> {
    const running = createRowRuntime(
        [
            blueprintOf("bp-watcher", { kind: "widgetMain", surfaceId: PAGE, elementId: "watcher" }, {
                heard: { graph: headThenLog(head.type, head.params, { type: BLUEPRINT_NODE_TYPE_LITERAL_STRING, params: { value: "page" } }) },
            }),
            blueprintOf("bp-bell", { kind: "componentWidgetMain", componentId: "ringDef", elementId: "bell" }, {
                heard: { graph: headThenLog(head.type, head.params, { type: BLUEPRINT_NODE_TYPE_COMPONENT_GET_PARAM, params: { paramId: "label" } }) },
            }),
        ],
        { document },
    );
    page = running;
    render(
        <WidgetRuntimeStateProvider externalStore={running.widgetRuntimeStore}>
            <SurfaceElementTree
                document={document}
                surface={running.surface}
                rootElement={document.elements.root!}
                rendererRegistry={new ElementRendererRegistry(BuiltinElementRenderers)}
                hostAdapter={running.adapter}
                editorChrome={true}
            />
        </WidgetRuntimeStateProvider>,
    );
    // Every widget's Init has run, so a key press finds every drawing listening.
    await new Promise(resolve => setTimeout(resolve, 0));
    await head.raise(running);
    await waitFor(() => expect(running.logs).toContain("page"));
    // Anything the placements were going to log has been logged by the time the page's has: they
    // run in the same pass, the page's widget last in document order.
    await new Promise(resolve => setTimeout(resolve, 0));
    return {
        page: running.logs.filter(line => line === "page"),
        placements: running.logs.filter(line => line !== "page").sort(),
    };
}

describe("a head heard from no drawing", () => {
    for (const head of AMBIENT_HEADS) {
        it(`${head.type} reaches every placement before a component may use it`, async () => {
            const heard = await whoHears(head);

            // The control: the event was really raised, and a page widget heard it once.
            expect(heard.page).toEqual(["page"]);
            if (!offeredInComponents(head.type)) {
                return;
            }
            expect(
                heard.placements,
                `${head.type} is offered inside a component definition, but a component placed twice heard it `
                + `${JSON.stringify(heard.placements)}. Before offering it, make its event reach every placement: `
                + "`everyDrawingOf` (widgetDrawingRegistry.ts) has to enumerate placements, and the fan-out "
                + "collectors in BlueprintDispatcher.ts have to look at componentWidgetMain blueprints.",
            ).toEqual(["A", "B"]);
        });
    }
});
