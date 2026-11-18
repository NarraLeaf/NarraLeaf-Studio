// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { scriptLayerKey } from "@shared/blueprint/blueprintLayers";
import {
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_ENTER,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_UNMOUNT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_WINDOW_FOCUS_CHANGED,
    BLUEPRINT_NODE_PARAM_FN_NAME,
    BLUEPRINT_NODE_PARAM_FN_REF,
    BLUEPRINT_NODE_TYPE_FLOW_DELAY,
    BLUEPRINT_NODE_TYPE_FN_CALL,
    BLUEPRINT_NODE_TYPE_FN_HEAD,
    BLUEPRINT_NODE_TYPE_LOCAL_GET,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
    BLUEPRINT_NODE_TYPE_LOG,
} from "@shared/types/blueprint/graph";
import { UI_GRAPH_DOCUMENT_SCHEMA_VERSION } from "@shared/types/ui-editor/graph";
import { buildUIComponentInstanceKey } from "@shared/types/ui-editor/componentInstanceKey";
import { buildUIListItemInstanceKey, type UIListItemScope } from "@shared/types/ui-editor/list";
import type { DevModeBundle } from "@shared/types/devMode";
import { BlueprintExecutionManager } from "@/lib/ui-editor/blueprint-runtime/BlueprintExecutionManager";
import { evaluateBlueprintValue } from "@/lib/ui-editor/blueprint-runtime/BlueprintValueEvaluator";
import { dispatchWidgetsBlueprintEvent } from "@/lib/ui-editor/blueprint-runtime/BlueprintDispatcher";
import { acquireBlueprintExecutionLocals } from "@/lib/ui-editor/blueprint-runtime/blueprintWidgetLocals";
import { DebugBridge } from "@/lib/ui-editor/blueprint-runtime/DebugBridge";
import { ScopeStoreBridge } from "@/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";
import { mountCompiledScripts, unmountCompiledScripts } from "@/lib/ui-editor/blueprint-runtime/script/scriptRuntime";
import type { GameScriptContext, ScriptElementSelf } from "@/lib/ui-editor/blueprint-runtime/script/scriptContext";
import { createDevModeBlueprintHostAdapter } from "@/lib/ui-editor/runtime/hostAdapters/devModeBlueprintHostAdapter";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { behaviorNodeRegistry } from "@/lib/ui-editor/behavior-graph";
import { createBlueprintFnRef } from "@/lib/workspace/services/ui-editor/blueprint/fnCatalog";
import { blueprintOf, createRowRuntime, graphOf, PAGE, tileRow } from "@/lib/ui-editor/runtime/testing/rowRuntimeTestKit";
import { BlueprintWidgetInitLifecycle } from "./BlueprintWidgetInitLifecycle";

let fixtureCount = 0;
const rowInstance = (key: string) => buildUIListItemInstanceKey(undefined, "grid", key);

async function fixture(handlers: Record<string, unknown>) {
    const id = `widget-lifecycle-${++fixtureCount}`;
    const blueprint = blueprintOf(id, { kind: "widgetMain", surfaceId: PAGE, elementId: "tile" }, {
        script: { script: "scripts/lifecycle.ts" },
    }, { value: "default" });
    const lab = createRowRuntime([blueprint]);
    const scopeId = lab.runtime.runtimeScopeId!;
    const manager = new BlueprintExecutionManager();
    manager.openScope(scopeId);
    const bundle: DevModeBundle = {
        bundleId: "test", revision: 1, timestamp: "2026-01-01T00:00:00Z",
        ui: {
            uidoc: lab.document,
            uigraphs: { schemaVersion: UI_GRAPH_DOCUMENT_SCHEMA_VERSION, blueprintDocument: lab.blueprintDocument },
            localBlueprints: lab.blueprintDocument,
            persistentVariables: {}, savedVariables: {}, saveSchema: [],
        },
    };
    const host = createDevModeBlueprintHostAdapter({
        bundle, surface: lab.surface, runtimeScopeId: scopeId, scopeBridge: new ScopeStoreBridge(),
        debug: new DebugBridge(), hostApi: lab.hostApi, executionManager: manager,
    });
    await mountCompiledScripts(
        { [scriptLayerKey(id, "script")]: { scriptRef: "scripts/lifecycle.ts", url: "file:///lifecycle.mjs" } },
        () => undefined,
        async () => handlers,
    );
    const row = (scope: UIListItemScope) => (
        <BlueprintWidgetInitLifecycle
            key={scope.key} surfaceId={PAGE} elementId="tile" elementType="nl.container"
            ownedBlueprintId={id} hostAdapter={host} instanceKey={rowInstance(scope.key)} listItemScope={scope}
        />
    );
    const dispatch = (scope: UIListItemScope, eventName: string, payload?: Record<string, unknown>) =>
        host.blueprintRuntime!.dispatchElementBlueprintEvent("tile", eventName, payload, {
            instanceKey: rowInstance(scope.key), listItemScope: scope,
        });
    return { lab, manager, scopeId, host, id, row, dispatch };
}

afterEach(() => {
    cleanup();
    unmountCompiledScripts();
});

type Ctx = GameScriptContext<ScriptElementSelf>;
const rowKey = (ctx: Ctx) => ctx.self.row!.key;

describe("widget blueprint locals across drawing lifetimes", () => {
    it("keeps a value evaluation's widget generation when its Fn starts after remount", async () => {
        registerCoreBlueprintNodes();
        const id = `value-widget-${++fixtureCount}`;
        const valueId = `${id}-value`;
        let resume!: () => void;
        const wait = new Promise<void>(resolve => { resume = resolve; });
        const waitType = `${id}-wait`;
        behaviorNodeRegistry.register({ type: waitType, displayName: "Wait", execute: async () => { await wait; return { nextPort: "next" }; } });
        const set = (head: string, value: string) => ({ graph: graphOf({
            nodes: { head: { type: head }, set: { type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "value", value } } },
            exec: ["head", "set"],
        }) });
        const widget = blueprintOf(id, { kind: "widgetMain", surfaceId: PAGE, elementId: "tile" }, {
            click: set(BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK, "old"),
            enter: set(BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_ENTER, "new"),
            fn: { graph: graphOf({
                nodes: {
                    fn: { type: BLUEPRINT_NODE_TYPE_FN_HEAD, params: { [BLUEPRINT_NODE_PARAM_FN_NAME]: "Read" } },
                    get: { type: BLUEPRINT_NODE_TYPE_LOCAL_GET, params: { variableId: "value" } },
                    log: { type: BLUEPRINT_NODE_TYPE_LOG },
                },
                exec: ["fn", "log"],
                data: [["get", "value", "log", "value"]],
            }) },
        }, { value: "default" });
        const value = {
            ...blueprintOf(valueId, { kind: "widgetMain", surfaceId: PAGE, elementId: "tile" }, {
                init: { graph: graphOf({
                    nodes: {
                        head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT },
                        wait: { type: waitType },
                        call: { type: BLUEPRINT_NODE_TYPE_FN_CALL, params: { [BLUEPRINT_NODE_PARAM_FN_REF]: createBlueprintFnRef(id, "fn") } },
                    },
                    exec: ["head", "wait", "call"],
                }) },
            }),
            owner: { kind: "widgetValue" as const, surfaceId: PAGE, elementId: "tile", propPath: "text" },
        };
        const lab = createRowRuntime([widget, value]);
        const scope = tileRow("a", 0);
        const options = { instanceKey: rowInstance("a"), listItemScope: scope };
        const row = () => <BlueprintWidgetInitLifecycle
            surfaceId={PAGE} elementId="tile" elementType="nl.container" ownedBlueprintId={id}
            hostAdapter={lab.adapter} {...options}
        />;
        const view = render(row());
        await act(async () => { await lab.runtime.dispatchElementBlueprintEvent("tile", "mouseClick", undefined, options); });
        const evaluation = evaluateBlueprintValue({
            blueprintDocument: lab.blueprintDocument, persistentVariables: {}, blueprintId: valueId,
            surfaceId: PAGE, runtimeScopeId: lab.runtime.runtimeScopeId, elementId: "tile", hostAdapter: lab.adapter, ...options,
        });
        view.rerender(<></>);
        view.rerender(row());
        await act(async () => { await lab.runtime.dispatchElementBlueprintEvent("tile", "mouseEnter", undefined, options); });
        await act(async () => { resume(); await evaluation; });
        expect({ logs: lab.logs, errors: lab.errors }).toEqual({ logs: ["old"], errors: [] });
        view.unmount();
        lab.release();
    });

    it("keeps a called widget's generation through a delayed nested Fn", async () => {
        registerCoreBlueprintNodes();
        const id = `called-widget-${++fixtureCount}`;
        const callerId = `${id}-caller`;
        const outer = graphOf({
            nodes: {
                head: { type: BLUEPRINT_NODE_TYPE_FN_HEAD, params: { [BLUEPRINT_NODE_PARAM_FN_NAME]: "Outer" } },
                delay: { type: BLUEPRINT_NODE_TYPE_FLOW_DELAY, params: { duration: 0.08 } },
                call: { type: BLUEPRINT_NODE_TYPE_FN_CALL, params: { [BLUEPRINT_NODE_PARAM_FN_REF]: createBlueprintFnRef(id, "inner") } },
            },
            exec: ["head", "delay", "call"],
        });
        outer.edges[1]!.from.port = "completed";
        const widget = blueprintOf(id, { kind: "widgetMain", surfaceId: PAGE, elementId: "tile" }, {
            click: { graph: graphOf({
                nodes: {
                    head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK },
                    set: { type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "value", value: "old" } },
                },
                exec: ["head", "set"],
            }) },
            enter: { graph: graphOf({
                nodes: {
                    head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_ENTER },
                    set: { type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "value", value: "new" } },
                },
                exec: ["head", "set"],
            }) },
            outer: { graph: outer },
            inner: { graph: graphOf({
                nodes: {
                    inner: { type: BLUEPRINT_NODE_TYPE_FN_HEAD, params: { [BLUEPRINT_NODE_PARAM_FN_NAME]: "Inner" } },
                    get: { type: BLUEPRINT_NODE_TYPE_LOCAL_GET, params: { variableId: "value" } },
                    log: { type: BLUEPRINT_NODE_TYPE_LOG },
                    set: { type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "value", value: "old Fn write" } },
                },
                exec: ["inner", "log", "set"],
                data: [["get", "value", "log", "value"]],
            }) },
        }, { value: "default" });
        const caller = blueprintOf(callerId, { kind: "widgetMain", surfaceId: PAGE, elementId: "mark" }, {
            enter: { graph: graphOf({
                nodes: {
                    head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_ENTER },
                    call: { type: BLUEPRINT_NODE_TYPE_FN_CALL, params: { [BLUEPRINT_NODE_PARAM_FN_REF]: createBlueprintFnRef(id, "head") } },
                },
                exec: ["head", "call"],
            }) },
        });
        const lab = createRowRuntime([widget, caller]);
        const scope = tileRow("a", 0);
        const options = { instanceKey: rowInstance("a"), listItemScope: scope };
        const row = () => <BlueprintWidgetInitLifecycle
            surfaceId={PAGE} elementId="tile" elementType="nl.container" ownedBlueprintId={id}
            hostAdapter={lab.adapter} {...options}
        />;
        const view = render(row());
        await act(async () => { await lab.runtime.dispatchElementBlueprintEvent("tile", "mouseClick", undefined, options); });
        const pending = lab.runtime.dispatchElementBlueprintEvent("mark", "mouseEnter", undefined, options);
        view.rerender(<></>);
        view.rerender(row());
        await act(async () => { await lab.runtime.dispatchElementBlueprintEvent("tile", "mouseEnter", undefined, options); });
        await act(async () => { await pending; });
        const current = acquireBlueprintExecutionLocals({
            blueprintDocument: lab.blueprintDocument, currentBlueprintId: id,
            runtimeScopeId: lab.runtime.runtimeScopeId, elementInstanceKey: options.instanceKey,
        }).value;
        expect({ logs: lab.logs, current, errors: lab.errors }).toEqual({ logs: ["old"], current: "new", errors: [] });
        view.unmount();
        lab.release();
    });

    it("lets a graph's Unmount read what its click graph stored", async () => {
        registerCoreBlueprintNodes();
        const id = `graph-lifecycle-${++fixtureCount}`;
        const blueprint = blueprintOf(id, { kind: "widgetMain", surfaceId: PAGE, elementId: "tile" }, {
            click: { graph: graphOf({
                nodes: {
                    head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK },
                    set: { type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "value", value: "from click" } },
                },
                exec: ["head", "set"],
            }) },
            unmount: { graph: graphOf({
                nodes: {
                    head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_UNMOUNT },
                    get: { type: BLUEPRINT_NODE_TYPE_LOCAL_GET, params: { variableId: "value" } },
                    log: { type: BLUEPRINT_NODE_TYPE_LOG },
                },
                exec: ["head", "log"],
                data: [["get", "value", "log", "value"]],
            }) },
        }, { value: "default" });
        const lab = createRowRuntime([blueprint]);
        const row = tileRow("a", 0);
        const view = render(<BlueprintWidgetInitLifecycle
            surfaceId={PAGE} elementId="tile" elementType="nl.container" ownedBlueprintId={id}
            hostAdapter={lab.adapter} instanceKey={rowInstance("a")} listItemScope={row}
        />);
        await act(async () => {
            await lab.runtime.dispatchElementBlueprintEvent("tile", "mouseClick", undefined, {
                instanceKey: rowInstance("a"), listItemScope: row,
            });
        });
        view.unmount();
        await waitFor(() => expect(lab.logs).toContain("from click"));
        expect(lab.errors).toEqual([]);
        lab.release();
    });

    it("keeps nested Fns in the departing drawing while a new event uses the remounted drawing", async () => {
        registerCoreBlueprintNodes();
        const id = `graph-unmount-fn-${++fixtureCount}`;
        const outerId = `${id}-outer`;
        const setValue = (head: string, value: string) => ({ graph: graphOf({
            nodes: { head: { type: head }, set: { type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "value", value } } },
            exec: ["head", "set"],
        }) });
        const unmount = graphOf({
            nodes: {
                head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_UNMOUNT },
                delay: { type: BLUEPRINT_NODE_TYPE_FLOW_DELAY, params: { duration: 0.08 } },
                call: { type: BLUEPRINT_NODE_TYPE_FN_CALL, params: { [BLUEPRINT_NODE_PARAM_FN_REF]: createBlueprintFnRef(outerId, "outerFn") } },
            },
            exec: ["head", "delay", "call"],
        });
        unmount.edges[1]!.from.port = "completed";
        const blueprint = blueprintOf(id, { kind: "widgetMain", surfaceId: PAGE, elementId: "tile" }, {
            click: setValue(BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK, "old"),
            enter: { graph: graphOf({
                nodes: {
                    head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_ENTER },
                    set: { type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "value", value: "new" } },
                    call: { type: BLUEPRINT_NODE_TYPE_FN_CALL, params: { [BLUEPRINT_NODE_PARAM_FN_REF]: createBlueprintFnRef(id, "readFn") } },
                },
                exec: ["head", "set", "call"],
            }) },
            unmount: { graph: unmount },
            inner: { graph: graphOf({
                nodes: {
                    innerFn: { type: BLUEPRINT_NODE_TYPE_FN_HEAD, params: { [BLUEPRINT_NODE_PARAM_FN_NAME]: "Inner" } },
                    get: { type: BLUEPRINT_NODE_TYPE_LOCAL_GET, params: { variableId: "value" } },
                    log: { type: BLUEPRINT_NODE_TYPE_LOG },
                    set: { type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "value", value: "old Fn write" } },
                },
                exec: ["innerFn", "log", "set"],
                data: [["get", "value", "log", "value"]],
            }) },
            read: { graph: graphOf({
                nodes: {
                    readFn: { type: BLUEPRINT_NODE_TYPE_FN_HEAD, params: { [BLUEPRINT_NODE_PARAM_FN_NAME]: "Read" } },
                    get: { type: BLUEPRINT_NODE_TYPE_LOCAL_GET, params: { variableId: "value" } },
                    log: { type: BLUEPRINT_NODE_TYPE_LOG },
                },
                exec: ["readFn", "log"],
                data: [["get", "value", "log", "value"]],
            }) },
        }, { value: "default" });
        const outer = blueprintOf(outerId, { kind: "widgetMain", surfaceId: PAGE, elementId: "mark" }, {
            outer: { graph: graphOf({
                nodes: {
                    outerFn: { type: BLUEPRINT_NODE_TYPE_FN_HEAD, params: { [BLUEPRINT_NODE_PARAM_FN_NAME]: "Outer" } },
                    call: { type: BLUEPRINT_NODE_TYPE_FN_CALL, params: { [BLUEPRINT_NODE_PARAM_FN_REF]: createBlueprintFnRef(id, "innerFn") } },
                },
                exec: ["outerFn", "call"],
            }) },
        });
        const lab = createRowRuntime([blueprint, outer]);
        const a = tileRow("a", 0), b = tileRow("b", 1);
        const row = (scope: UIListItemScope) => <BlueprintWidgetInitLifecycle
            key={scope.key}
            surfaceId={PAGE} elementId="tile" elementType="nl.container" ownedBlueprintId={id}
            hostAdapter={lab.adapter} instanceKey={rowInstance(scope.key)} listItemScope={scope}
        />;
        const dispatch = (scope: UIListItemScope, event: string) => lab.runtime.dispatchElementBlueprintEvent("tile", event, undefined, {
            instanceKey: rowInstance(scope.key), listItemScope: scope,
        });
        const view = render(<>{row(a)}{row(b)}</>);
        await act(async () => { await dispatch(a, "mouseClick"); await dispatch(b, "mouseEnter"); });
        view.rerender(<>{row(b)}</>);
        view.rerender(<>{row(a)}{row(b)}</>);
        await act(async () => { await dispatch(a, "mouseEnter"); });
        expect(acquireBlueprintExecutionLocals({
            blueprintDocument: lab.blueprintDocument, currentBlueprintId: id,
            runtimeScopeId: lab.runtime.runtimeScopeId, elementInstanceKey: rowInstance("a"),
        }).value).toBe("new");
        await waitFor(() => expect(lab.logs).toHaveLength(3));
        const reads = [...lab.logs];
        const newDrawingValue = acquireBlueprintExecutionLocals({
            blueprintDocument: lab.blueprintDocument, currentBlueprintId: id,
            runtimeScopeId: lab.runtime.runtimeScopeId, elementInstanceKey: rowInstance("a"),
        }).value;
        const siblingValue = acquireBlueprintExecutionLocals({
            blueprintDocument: lab.blueprintDocument, currentBlueprintId: id,
            runtimeScopeId: lab.runtime.runtimeScopeId, elementInstanceKey: rowInstance("b"),
        }).value;
        view.unmount();
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 120)); });
        lab.release();
        expect({ reads, newDrawingValue, siblingValue, errors: lab.errors }).toEqual({
            reads: ["new", "new", "old"], newDrawingValue: "new", siblingValue: "new", errors: [],
        });
    });

    it("keeps a fanned-out event's drawing when its row remounts before a Fn call", async () => {
        registerCoreBlueprintNodes();
        const id = `graph-ambient-fn-${++fixtureCount}`;
        const focus = graphOf({
            nodes: {
                head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_WINDOW_FOCUS_CHANGED },
                delay: { type: BLUEPRINT_NODE_TYPE_FLOW_DELAY, params: { duration: 0.08 } },
                call: { type: BLUEPRINT_NODE_TYPE_FN_CALL, params: { [BLUEPRINT_NODE_PARAM_FN_REF]: createBlueprintFnRef(id, "readFn") } },
            },
            exec: ["head", "delay", "call"],
        });
        focus.edges[1]!.from.port = "completed";
        const set = (head: string, value: string) => ({ graph: graphOf({
            nodes: { head: { type: head }, set: { type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "value", value } } },
            exec: ["head", "set"],
        }) });
        const blueprint = blueprintOf(id, { kind: "widgetMain", surfaceId: PAGE, elementId: "tile" }, {
            click: set(BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK, "old"),
            enter: set(BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_ENTER, "new"),
            focus: { graph: focus },
            read: { graph: graphOf({
                nodes: {
                    readFn: { type: BLUEPRINT_NODE_TYPE_FN_HEAD, params: { [BLUEPRINT_NODE_PARAM_FN_NAME]: "Read" } },
                    get: { type: BLUEPRINT_NODE_TYPE_LOCAL_GET, params: { variableId: "value" } },
                    log: { type: BLUEPRINT_NODE_TYPE_LOG },
                },
                exec: ["readFn", "log"],
                data: [["get", "value", "log", "value"]],
            }) },
        }, { value: "default" });
        const lab = createRowRuntime([blueprint]);
        const scope = tileRow("a", 0);
        const instanceKey = rowInstance("a");
        const row = () => <BlueprintWidgetInitLifecycle
            surfaceId={PAGE} elementId="tile" elementType="nl.container" ownedBlueprintId={id}
            hostAdapter={lab.adapter} instanceKey={instanceKey} listItemScope={scope}
        />;
        const view = render(row());
        const unregister = lab.runtime.drawings!.registerListRow("grid", { instanceKey, listItemScope: scope });
        await act(async () => { await lab.runtime.dispatchElementBlueprintEvent("tile", "mouseClick", undefined, { instanceKey, listItemScope: scope }); });
        const focusEvent = dispatchWidgetsBlueprintEvent({
            document: lab.document, blueprintDocument: lab.blueprintDocument, persistentVariables: {},
            surfaceId: PAGE, runtimeScopeId: lab.runtime.runtimeScopeId, eventName: "windowFocusChanged",
            eventPayload: { isFocused: true }, hostAdapter: lab.adapter, debug: new DebugBridge(),
            getSurfaceState: () => undefined, setSurfaceState: () => undefined,
        });
        view.rerender(<></>);
        view.rerender(row());
        await act(async () => { await lab.runtime.dispatchElementBlueprintEvent("tile", "mouseEnter", undefined, { instanceKey, listItemScope: scope }); });
        await act(async () => { await focusEvent; });
        const current = acquireBlueprintExecutionLocals({
            blueprintDocument: lab.blueprintDocument, currentBlueprintId: id,
            runtimeScopeId: lab.runtime.runtimeScopeId, elementInstanceKey: instanceKey,
        }).value;
        expect({ logs: lab.logs, current, errors: lab.errors }).toEqual({ logs: ["old"], current: "new", errors: [] });
        unregister();
        view.unmount();
        lab.release();
    });

    it("keeps a sibling's variables and gives Unmount the removed row's current variables", async () => {
        const unmounted: Array<[string, unknown]> = [];
        const read: Array<[string, unknown]> = [];
        const lab = await fixture({
            onMouseClick: (ctx: Ctx, payload: { value: string }) => { ctx.vars.value = payload.value; },
            onUnmount: (ctx: Ctx) => { unmounted.push([rowKey(ctx), ctx.vars.value]); },
            onKeyDown: (ctx: Ctx) => { read.push([rowKey(ctx), ctx.vars.value]); },
        });
        const a = tileRow("a", 0), b = tileRow("b", 1);
        const view = render(<>{lab.row(a)}{lab.row(b)}</>);
        await act(async () => { await lab.dispatch(a, "mouseClick", { value: "A" }); await lab.dispatch(b, "mouseClick", { value: "B" }); });
        view.rerender(<>{lab.row(b)}</>);
        await act(async () => { await lab.dispatch(b, "keyDown"); });
        expect({ unmounted, read }).toEqual({ unmounted: [["a", "A"]], read: [["b", "B"]] });
        view.unmount();
        lab.lab.release();
    });

    it("keeps a same-key remount's variables while an earlier Unmount is still waiting", async () => {
        let finish!: () => void;
        const pending = new Promise<void>(resolve => { finish = resolve; });
        const events: unknown[] = [];
        const lab = await fixture({
            onMouseClick: (ctx: Ctx, payload: { value: string }) => { ctx.vars.value = payload.value; },
            onUnmount: async (ctx: Ctx) => { events.push(ctx.vars.value); await pending; events.push(ctx.vars.value); ctx.vars.value = "old-finished"; },
            onInit: (ctx: Ctx) => { events.push(`init:${ctx.vars.value}`); },
            onKeyDown: (ctx: Ctx) => { events.push(`read:${ctx.vars.value}`); },
        });
        const a = tileRow("a", 0);
        const view = render(<>{lab.row(a)}</>);
        await waitFor(() => expect(events).toContain("init:default"));
        await act(async () => { await lab.dispatch(a, "mouseClick", { value: "old" }); });
        view.rerender(<></>);
        await waitFor(() => expect(events).toContain("old"));
        view.rerender(<>{lab.row(a)}</>);
        await waitFor(() => expect(events.filter(event => event === "init:default")).toHaveLength(2));
        await act(async () => { await lab.dispatch(a, "mouseClick", { value: "new" }); });
        await act(async () => { finish(); await pending; });
        await act(async () => { await lab.dispatch(a, "keyDown"); });
        expect(events.filter(event => event === "old")).toHaveLength(2);
        expect(events.at(-1)).toBe("read:new");
        view.unmount();
        lab.lab.release();
    });

    it("hands a same-commit remount fresh locals before its old Unmount runs", async () => {
        const seen: unknown[] = [];
        const lab = await fixture({
            onInit: (ctx: Ctx) => { seen.push(`init:${ctx.vars.value}`); },
            onMouseClick: (ctx: Ctx) => { ctx.vars.value = "old"; },
            onUnmount: (ctx: Ctx) => { seen.push(`unmount:${ctx.vars.value}`); },
        });
        const a = tileRow("a", 0);
        const view = render(<section key="old">{lab.row(a)}</section>);
        await waitFor(() => expect(seen).toEqual(["init:default"]));
        await act(async () => { await lab.dispatch(a, "mouseClick"); });
        view.rerender(<section key="new">{lab.row(a)}</section>);
        await waitFor(() => expect(seen).toHaveLength(3));
        expect(seen).toEqual(["init:default", "unmount:old", "init:default"]);
        view.unmount();
        lab.lab.release();
    });

    it("keeps a shared drawing's locals until its last mounted holder leaves", async () => {
        const reads: unknown[] = [];
        const lab = await fixture({
            onMouseClick: (ctx: Ctx) => { ctx.vars.value = "shared"; },
            onKeyDown: (ctx: Ctx) => { reads.push(ctx.vars.value); },
        });
        const a = tileRow("a", 0);
        const view = render(<><section key="first">{lab.row(a)}</section><article key="second">{lab.row(a)}</article></>);
        await act(async () => { await lab.dispatch(a, "mouseClick"); });
        view.rerender(<><article key="second">{lab.row(a)}</article></>);
        await act(async () => { await lab.dispatch(a, "keyDown"); });
        expect(reads).toEqual(["shared"]);
        view.unmount();
        lab.lab.release();
    });

    it("isolates the same component drawing in two surface scopes", async () => {
        const blueprint = blueprintOf(`component-scopes-${++fixtureCount}`, {
            kind: "componentWidgetMain", componentId: "cardDef", elementId: "cardRoot",
        }, { script: { script: "scripts/component.ts" } }, { value: "default" });
        const first = createRowRuntime([blueprint]);
        const second = createRowRuntime([blueprint]);
        const reads: unknown[] = [];
        await mountCompiledScripts(
            { [scriptLayerKey(blueprint.id, "script")]: { scriptRef: "scripts/component.ts", url: "file:///component.mjs" } },
            () => undefined,
            async () => ({
                onMouseClick: (ctx: Ctx, payload: { value: string }) => { ctx.vars.value = payload.value; },
                onKeyDown: (ctx: Ctx) => { reads.push(ctx.vars.value); },
            }),
        );
        const options = { componentId: "cardDef", instanceKey: buildUIComponentInstanceKey(undefined, "card") };
        await first.runtime.dispatchElementBlueprintEvent("cardRoot", "mouseClick", { value: "first" }, options);
        await second.runtime.dispatchElementBlueprintEvent("cardRoot", "mouseClick", { value: "second" }, options);
        await first.runtime.dispatchElementBlueprintEvent("cardRoot", "keyDown", undefined, options);
        await second.runtime.dispatchElementBlueprintEvent("cardRoot", "keyDown", undefined, options);
        expect(reads).toEqual(["first", "second"]);
        first.release();
        second.release();
    });

    it("dispatches Unmount after its surface scope has closed", async () => {
        const seen: unknown[] = [];
        const lab = await fixture({
            onMouseClick: (ctx: Ctx) => { ctx.vars.value = "active"; },
            onUnmount: (ctx: Ctx) => { seen.push([ctx.vars.value, ctx.signal.aborted]); },
        });
        const a = tileRow("a", 0);
        const view = render(<>{lab.row(a)}</>);
        await act(async () => { await lab.dispatch(a, "mouseClick"); });
        lab.manager.closeScope(lab.scopeId);
        view.unmount();
        await waitFor(() => expect(seen).toEqual([["active", false]]));
        lab.lab.release();
    });

    it("retains an unmounted drawing's ordinary calls until its scope closes", async () => {
        const seen: unknown[] = [];
        const lab = await fixture({
            onMouseClick: (ctx: Ctx) => { ctx.vars.value = "called"; },
            onKeyDown: (ctx: Ctx) => { seen.push(ctx.vars.value); },
        });
        const scope = tileRow("a", 0);
        await lab.dispatch(scope, "mouseClick");
        await lab.dispatch(scope, "keyDown");
        lab.manager.closeScope(lab.scopeId);
        lab.manager.openScope(lab.scopeId);
        await lab.dispatch(scope, "keyDown");
        expect(seen).toEqual(["called", "default"]);
        lab.lab.release();
    });

    it("sends lifecycle events once through StrictMode's effect replay", async () => {
        const events: string[] = [];
        const lab = await fixture({
            onInit: () => { events.push("init"); },
            onUnmount: () => { events.push("unmount"); },
        });
        const view = render(<StrictMode>{lab.row(tileRow("a", 0))}</StrictMode>);
        await waitFor(() => expect(events).toContain("init"));
        expect(events).toEqual(["init"]);
        view.unmount();
        await waitFor(() => expect(events).toEqual(["init", "unmount"]));
        lab.lab.release();
    });

    it("sends Unmount when a real mount ends before the next microtask", async () => {
        const events: string[] = [];
        const lab = await fixture({ onUnmount: () => { events.push("unmount"); } });
        const view = render(lab.row(tileRow("a", 0)));
        view.unmount();
        await waitFor(() => expect(events).toEqual(["unmount"]), { timeout: 500 });
        lab.lab.release();
    });

    it("keeps a short-lived drawing's locals when a same-key drawing replaces it immediately", async () => {
        const events: unknown[] = [];
        const lab = await fixture({
            onMouseClick: (ctx: Ctx, payload: { value: string }) => { ctx.vars.value = payload.value; },
            onUnmount: (ctx: Ctx) => { events.push(ctx.vars.value); },
            onKeyDown: (ctx: Ctx) => { events.push(ctx.vars.value); },
        });
        const scope = tileRow("a", 0);
        const view = render(lab.row(scope));
        const oldClick = lab.dispatch(scope, "mouseClick", { value: "old" });
        view.rerender(<></>);
        view.rerender(lab.row(scope));
        const newClick = lab.dispatch(scope, "mouseClick", { value: "new" });
        await act(async () => { await oldClick; await newClick; await lab.dispatch(scope, "keyDown"); });
        expect(events).toEqual(["old", "new"]);
        view.unmount();
        lab.lab.release();
    });

    it("does not send Unmount when the mounted widget's blueprint wiring changes", async () => {
        const events: string[] = [];
        const lab = await fixture({ onUnmount: () => { events.push("unmount"); } });
        const scope = tileRow("a", 0);
        const tree = (ownedBlueprintId: string | undefined) => <BlueprintWidgetInitLifecycle
            surfaceId={PAGE} elementId="tile" elementType="nl.container" ownedBlueprintId={ownedBlueprintId}
            hostAdapter={lab.host}
            instanceKey={rowInstance("a")} listItemScope={scope}
        />;
        const view = render(tree(lab.id));
        await act(async () => { await Promise.resolve(); });
        view.rerender(tree(undefined));
        expect(events).toEqual([]);
        view.unmount();
        await waitFor(() => expect(events).toEqual(["unmount"]));
        lab.lab.release();
    });

    it("releases locals created by Unmount after blueprint wiring was removed", async () => {
        const lab = await fixture({ onUnmount: (ctx: Ctx) => { ctx.vars.value = "unmount write"; } });
        const scope = tileRow("a", 0);
        const tree = (ownedBlueprintId: string | undefined) => <BlueprintWidgetInitLifecycle
            surfaceId={PAGE} elementId="tile" elementType="nl.container" ownedBlueprintId={ownedBlueprintId}
            hostAdapter={lab.host} instanceKey={rowInstance("a")} listItemScope={scope}
        />;
        const view = render(tree(lab.id));
        await act(async () => { await Promise.resolve(); });
        view.rerender(tree(undefined));
        view.unmount();
        await waitFor(() => expect(lab.manager.listExecutionIds()).toEqual([]));
        expect(acquireBlueprintExecutionLocals({
            blueprintDocument: lab.lab.blueprintDocument, currentBlueprintId: lab.id,
            runtimeScopeId: lab.scopeId, elementInstanceKey: rowInstance("a"),
        }).value).toBe("default");
        lab.lab.release();
    });

    it("settles a cancelled asynchronous Unmount and releases its locals", async () => {
        let finish!: () => void;
        const pending = new Promise<void>(resolve => { finish = resolve; });
        const lab = await fixture({ onUnmount: async (ctx: Ctx) => {
            ctx.vars.value = "waiting";
            await pending;
            ctx.vars.value = "late";
        } });
        const view = render(lab.row(tileRow("a", 0)));
        await act(async () => { await Promise.resolve(); });
        view.unmount();
        expect(lab.manager.listExecutionIds()).toHaveLength(1);
        lab.manager.cancelScope(lab.scopeId);
        try {
            await waitFor(() => expect(lab.manager.listExecutionIds()).toEqual([]), { timeout: 500 });
            expect(acquireBlueprintExecutionLocals({
                blueprintDocument: lab.lab.blueprintDocument, currentBlueprintId: lab.id,
                runtimeScopeId: lab.scopeId, elementInstanceKey: rowInstance("a"),
            }).value).toBe("default");
            await act(async () => { finish(); await pending; });
            expect(acquireBlueprintExecutionLocals({
                blueprintDocument: lab.lab.blueprintDocument, currentBlueprintId: lab.id,
                runtimeScopeId: lab.scopeId, elementInstanceKey: rowInstance("a"),
            }).value).toBe("default");
        } finally {
            finish();
            lab.lab.release();
        }
    });
});
