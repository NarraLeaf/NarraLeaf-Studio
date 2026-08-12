/**
 * The layer nodes, driven end to end: a real {@link LayerStackController} behind a real host API
 * bridge, wired exactly the way GameApp wires it.
 *
 * Every assertion about a data output reads it from a DOWNSTREAM node rather than from the value
 * `execute()` returned, because that is the read path that silently yields `undefined` when a node
 * type is missing from the whitelist in `graphParamResolvers.ts` - the executor stores the value
 * either way, and nothing reports the gap.
 *
 * Comments in English per project convention.
 */

import { describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_LAYER_CLOSE_SELF,
    BLUEPRINT_NODE_TYPE_LAYER_HIDE,
    BLUEPRINT_NODE_TYPE_LAYER_IS_MOUNTED,
    BLUEPRINT_NODE_TYPE_LAYER_SHOW,
    BLUEPRINT_NODE_TYPE_LAYER_WAIT,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
    BLUEPRINT_NODE_TYPE_PAGE_GET_PROPS,
} from "@shared/types/blueprint/graph";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument } from "@shared/types/ui-editor/document";
import type { UIGraph } from "@shared/types/ui-editor/graph";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import type { BlueprintDebugEvent } from "@shared/types/blueprint/debug";
import { ScopeStoreBridge } from "@/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import {
    createDevModeBlueprintHostApi,
    type BlueprintHostApiRuntime,
} from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import {
    LayerStackController,
    mountSurfaceLayer,
} from "@/lib/ui-editor/runtime/app/layers/LayerStackController";
import { BlueprintGraphExecutionError } from "../../behavior-graph/GraphExecutionError";
import { executeGraph } from "../../behavior-graph/GraphExecutor";

function createDocument(): UIDocument {
    const surface = (id: string, name: string) => ({
        id,
        name,
        host: "app" as const,
        kind: "appSurface" as const,
        designSize: { width: 320, height: 180 },
        rootElementId: `root-${id}`,
    });
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [surface("page", "Page"), surface("confirm", "Confirm")],
        elements: {},
    } as unknown as UIDocument;
}

type LayerTestHost = {
    stack: LayerStackController;
    api: BlueprintHostApiRuntime;
    adapter: UIHostAdapter;
    logs: { level: string; message: string }[];
};

/**
 * The six callbacks GameApp injects, against a live stack.
 *
 * Assembled here rather than stubbed so the timing rules under test - a close settling its waiter
 * at once, a group releasing only on the exit - are the real ones and not a second implementation
 * that could drift from the one that ships.
 */
function createLayerHost(options?: { runtimeScopeId?: string; pageProps?: Record<string, unknown> }): LayerTestHost {
    const stack = new LayerStackController();
    const logs: { level: string; message: string }[] = [];
    const api = createDevModeBlueprintHostApi({
        document: createDocument(),
        scope: new ScopeStoreBridge(),
        activeSurfaceId: "page",
        runtimeScopeId: options?.runtimeScopeId ?? "page:1",
        pageProps: options?.pageProps,
        emit: (event: BlueprintDebugEvent) => {
            if (event.type === "devtools.log") {
                logs.push({ level: event.level, message: event.message });
            }
        },
        onOpenSurface: () => undefined,
        onPageBack: () => undefined,
        onWidgetPatch: () => undefined,
        widgetRuntimeStore: new WidgetRuntimeStateStore(),
        onShowLayer: request => mountSurfaceLayer(stack, request),
        onHideLayer: async handle => {
            await stack.hideAndWaitForExit(handle);
        },
        onHideLayerGroup: async group => {
            await stack.hideGroupAndWaitForExit(group);
        },
        onWaitLayer: handle => stack.waitForClose(handle),
        onCloseOwnLayer: (scopeId, result) => stack.closeWithResult(scopeId, result),
        onIsLayerMounted: handle => stack.isPresent(handle),
    });
    const adapter = {
        host: "player",
        blueprintRuntime: {
            surfaceId: "page",
            setSurfaceState: () => undefined,
            getSurfaceState: () => undefined,
            emitDebug: () => undefined,
            dispatchElementBlueprintEvent: async () => undefined,
            hostApi: api,
        },
    } as unknown as UIHostAdapter;
    return { stack, api, adapter, logs };
}

async function runGraph(graph: UIGraph, host: LayerTestHost): Promise<Record<string, unknown>> {
    const locals: Record<string, unknown> = {};
    await executeGraph({
        graph,
        entry: graph.entries.main,
        hostAdapter: host.adapter,
        blueprintLocals: locals,
    });
    return locals;
}

/** One node, its data output wired into a Set Var named `out`. */
function captureOutputGraph(
    nodeType: string,
    outputPortId: string,
    params: Record<string, unknown> = {},
): UIGraph {
    return {
        id: "capture",
        entries: { main: { start: { nodeId: "act", port: "in" } } },
        nodes: {
            act: { id: "act", type: nodeType, params },
            store: { id: "store", type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "out" } },
        },
        edges: [
            { from: { nodeId: "act", port: "next" }, to: { nodeId: "store", port: "in" } },
            { from: { nodeId: "act", port: outputPortId }, to: { nodeId: "store", port: "value" } },
        ],
    } as UIGraph;
}

/** A node reading one string literal on an input pin, optionally publishing an output into `out`. */
function stringInputGraph(
    nodeType: string,
    inputPortId: string,
    value: string,
    outputPortId?: string,
): UIGraph {
    const graph = {
        id: "input",
        entries: { main: { start: { nodeId: "act", port: "in" } } },
        nodes: {
            act: { id: "act", type: nodeType, params: {} },
            literal: { id: "literal", type: BLUEPRINT_NODE_TYPE_LITERAL_STRING, params: { value } },
            store: { id: "store", type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "out" } },
        },
        edges: [
            { from: { nodeId: "literal", port: "value" }, to: { nodeId: "act", port: inputPortId } },
            { from: { nodeId: "act", port: "next" }, to: { nodeId: "store", port: "in" } },
        ],
    } as UIGraph;
    if (outputPortId) {
        graph.edges.push({ from: { nodeId: "act", port: outputPortId }, to: { nodeId: "store", port: "value" } });
    }
    return graph;
}

describe("Layer blueprint nodes", () => {
    it("Show Layer puts the page up and publishes its handle downstream", async () => {
        const host = createLayerHost();
        const locals = await runGraph(
            captureOutputGraph(BLUEPRINT_NODE_TYPE_LAYER_SHOW, "layer", { surfaceId: "confirm" }),
            host,
        );
        const shown = host.stack.getState();
        expect(shown.map(layer => layer.surfaceId)).toEqual(["confirm"]);
        // The whole point of the whitelist entry: without it this reads `undefined`, silently, and
        // every Hide / Wait wired to this pin becomes a no-op.
        expect(locals.out).toBe(shown[0]!.key);
    });

    it("the layer belongs to the scope that showed it", async () => {
        const host = createLayerHost({ runtimeScopeId: "page:7" });
        await runGraph(
            captureOutputGraph(BLUEPRINT_NODE_TYPE_LAYER_SHOW, "layer", { surfaceId: "confirm" }),
            host,
        );
        expect(host.stack.getState()[0]!.ownerScopeId).toBe("page:7");
    });

    it("an unwired Show Layer is non-modal and dismissible", async () => {
        const host = createLayerHost();
        await runGraph(
            captureOutputGraph(BLUEPRINT_NODE_TYPE_LAYER_SHOW, "layer", { surfaceId: "confirm" }),
            host,
        );
        expect(host.stack.getState()[0]).toMatchObject({ modal: false, dismissible: true, group: null });
    });

    it("Show Layer names the page it could not find", async () => {
        const host = createLayerHost();
        const failure = runGraph(
            captureOutputGraph(BLUEPRINT_NODE_TYPE_LAYER_SHOW, "layer", { surfaceId: "gone" }),
            host,
        );
        await expect(failure).rejects.toBeInstanceOf(BlueprintGraphExecutionError);
        await expect(failure).rejects.toThrow(/gone/);
        expect(host.stack.getState()).toEqual([]);
    });

    it("Show Layer with no page picked refuses rather than showing something arbitrary", async () => {
        const host = createLayerHost();
        await expect(
            runGraph(captureOutputGraph(BLUEPRINT_NODE_TYPE_LAYER_SHOW, "layer", {}), host),
        ).rejects.toBeInstanceOf(BlueprintGraphExecutionError);
    });

    it("Hide Layer takes it down", async () => {
        const host = createLayerHost();
        const key = mountSurfaceLayer(host.stack, { surfaceId: "confirm" });
        const running = runGraph(stringInputGraph(BLUEPRINT_NODE_TYPE_LAYER_HIDE, "layer", key), host);
        host.stack.notifyExitComplete();
        await running;
        expect(host.stack.getState()).toEqual([]);
    });

    it("Hide Layer on a handle that names nothing is a no-op, not a failure", async () => {
        const host = createLayerHost();
        await expect(runGraph(stringInputGraph(BLUEPRINT_NODE_TYPE_LAYER_HIDE, "layer", "layer:gone:9"), host))
            .resolves.toBeDefined();
    });

    it("Wait For Layer publishes what the layer closed with, downstream", async () => {
        const host = createLayerHost();
        const key = mountSurfaceLayer(host.stack, { surfaceId: "confirm" });
        const waiting = runGraph(
            stringInputGraph(BLUEPRINT_NODE_TYPE_LAYER_WAIT, "layer", key, "result"),
            host,
        );
        host.stack.closeWithResult(key, { index: 1 });
        expect(await waiting).toMatchObject({ out: { index: 1 } });
    });

    it("Wait For Layer on a handle already gone returns null instead of hanging", async () => {
        const host = createLayerHost();
        const locals = await runGraph(
            stringInputGraph(BLUEPRINT_NODE_TYPE_LAYER_WAIT, "layer", "layer:gone:9", "result"),
            host,
        );
        expect(locals.out).toBeNull();
    });

    it("Close This Layer closes the layer the graph runs in, with its result", async () => {
        const stack = new LayerStackController();
        const key = mountSurfaceLayer(stack, { surfaceId: "confirm" });
        // A layer's key IS its runtime scope id, which is the whole reason the page inside never has
        // to be handed a handle of its own.
        const inside = createLayerHostOn(stack, key);
        const waiting = stack.waitForClose(key);
        await runGraph(
            stringInputGraph(BLUEPRINT_NODE_TYPE_LAYER_CLOSE_SELF, "result", "yes"),
            inside,
        );
        await expect(waiting).resolves.toBe("yes");
        expect(stack.getState()).toEqual([]);
    });

    it("Close This Layer on a page that is not a layer does nothing and says so", async () => {
        const host = createLayerHost({ runtimeScopeId: "page:1" });
        mountSurfaceLayer(host.stack, { surfaceId: "confirm" });
        await runGraph(
            {
                id: "close",
                entries: { main: { start: { nodeId: "act", port: "in" } } },
                nodes: { act: { id: "act", type: BLUEPRINT_NODE_TYPE_LAYER_CLOSE_SELF, params: {} } },
                edges: [],
            } as unknown as UIGraph,
            host,
        );
        expect(host.stack.getState()).toHaveLength(1);
        expect(host.logs).toEqual([
            { level: "warn", message: expect.stringContaining("not a layer") },
        ]);
    });

    it("Is Layer Mounted answers through the pure read path", async () => {
        const host = createLayerHost();
        const key = mountSurfaceLayer(host.stack, { surfaceId: "confirm" });
        const graph = {
            id: "mounted",
            entries: { main: { start: { nodeId: "store", port: "in" } } },
            nodes: {
                ask: { id: "ask", type: BLUEPRINT_NODE_TYPE_LAYER_IS_MOUNTED, params: {} },
                literal: { id: "literal", type: BLUEPRINT_NODE_TYPE_LITERAL_STRING, params: { value: key } },
                store: { id: "store", type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "out" } },
            },
            edges: [
                { from: { nodeId: "literal", port: "value" }, to: { nodeId: "ask", port: "layer" } },
                { from: { nodeId: "ask", port: "mounted" }, to: { nodeId: "store", port: "value" } },
            ],
        } as unknown as UIGraph;
        expect(await runGraph(graph, host)).toMatchObject({ out: true });
        host.stack.hide(key);
        expect(await runGraph(graph, host)).toMatchObject({ out: false });
    });

    /**
     * The pin an author reaches for inside a layer, and the one thing about layers that needed no
     * wiring at all: a layer IS a navigation entry, so the props it was shown with are its page
     * props. Pinned here because the Confirm sugar and every list-bound layer are built on it.
     */
    it("a layer reads what it was shown with through Get Page Props", async () => {
        const stack = new LayerStackController();
        const key = mountSurfaceLayer(stack, { surfaceId: "confirm", props: { message: "Quit?" } });
        const entry = stack.getState().find(layer => layer.key === key)!;
        const inside = createLayerHost({ runtimeScopeId: entry.runtimeScopeId, pageProps: entry.props });
        const graph = {
            id: "props",
            entries: { main: { start: { nodeId: "store", port: "in" } } },
            nodes: {
                read: { id: "read", type: BLUEPRINT_NODE_TYPE_PAGE_GET_PROPS, params: {} },
                store: { id: "store", type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "out" } },
            },
            edges: [{ from: { nodeId: "read", port: "props" }, to: { nodeId: "store", port: "value" } }],
        } as unknown as UIGraph;
        expect(await runGraph(graph, inside)).toMatchObject({ out: { message: "Quit?" } });
    });
});

/** A second host bound to an existing stack, standing in for the bundle a mounted layer gets. */
function createLayerHostOn(stack: LayerStackController, runtimeScopeId: string): LayerTestHost {
    const logs: { level: string; message: string }[] = [];
    const api = createDevModeBlueprintHostApi({
        document: createDocument(),
        scope: new ScopeStoreBridge(),
        activeSurfaceId: "confirm",
        runtimeScopeId,
        emit: (event: BlueprintDebugEvent) => {
            if (event.type === "devtools.log") {
                logs.push({ level: event.level, message: event.message });
            }
        },
        onOpenSurface: () => undefined,
        onPageBack: () => undefined,
        onWidgetPatch: () => undefined,
        widgetRuntimeStore: new WidgetRuntimeStateStore(),
        onShowLayer: request => mountSurfaceLayer(stack, request),
        onHideLayer: async handle => {
            await stack.hideAndWaitForExit(handle);
        },
        onHideLayerGroup: async group => {
            await stack.hideGroupAndWaitForExit(group);
        },
        onWaitLayer: handle => stack.waitForClose(handle),
        onCloseOwnLayer: (scopeId, result) => stack.closeWithResult(scopeId, result),
        onIsLayerMounted: handle => stack.isPresent(handle),
    });
    const adapter = {
        host: "player",
        blueprintRuntime: {
            surfaceId: "confirm",
            setSurfaceState: () => undefined,
            getSurfaceState: () => undefined,
            emitDebug: () => undefined,
            dispatchElementBlueprintEvent: async () => undefined,
            hostApi: api,
        },
    } as unknown as UIHostAdapter;
    return { stack, api, adapter, logs };
}
