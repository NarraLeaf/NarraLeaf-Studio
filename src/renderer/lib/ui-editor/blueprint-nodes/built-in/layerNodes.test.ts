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
  BLUEPRINT_NODE_TYPE_LAYER_CONFIRM,
  BLUEPRINT_NODE_TYPE_LAYER_HIDE,
  BLUEPRINT_NODE_TYPE_LAYER_IS_MOUNTED,
  BLUEPRINT_NODE_TYPE_LAYER_SHOW,
  BLUEPRINT_NODE_TYPE_LAYER_WAIT,
  BLUEPRINT_NODE_TYPE_LITERAL_STRING,
  BLUEPRINT_NODE_TYPE_LOCAL_SET,
  BLUEPRINT_NODE_TYPE_PAGE_GET_PROPS
} from "@shared/types/blueprint/graph";
import { resolveBlueprintLabel } from "@/apps/workspace/modules/blueprint-lite/blueprintNodeI18n";
import { allBuiltinBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/built-in";
import {
  generateNextDynamicInputPinIds,
  getDynamicInputPinRemovalIds,
  resolveEffectiveBlueprintCatalogEntry
} from "@/lib/ui-editor/blueprint-nodes/effectivePins";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument } from "@shared/types/ui-editor/document";
import type { UIGraph } from "@shared/types/ui-editor/graph";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import type { BlueprintDebugEvent } from "@shared/types/blueprint/debug";
import { ScopeStoreBridge } from "@/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import {
  createDevModeBlueprintHostApi,
  type BlueprintHostApiRuntime
} from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import {
  LayerStackController,
  mountSurfaceLayer
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
    rootElementId: `root-${id}`
  });
  return {
    schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
    id: "doc",
    name: "Doc",
    surfaces: [surface("page", "Page"), surface("confirm", "Confirm")],
    elements: {}
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
function createLayerHost(options?: {
  runtimeScopeId?: string;
  pageProps?: Record<string, unknown>;
}): LayerTestHost {
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
    onShowLayer: (request) => mountSurfaceLayer(stack, request),
    onHideLayer: async (handle) => {
      await stack.hideAndWaitForExit(handle);
    },
    onHideLayerGroup: async (group) => {
      await stack.hideGroupAndWaitForExit(group);
    },
    onWaitLayer: (handle) => stack.waitForClose(handle),
    onCloseOwnLayer: (scopeId, result) => stack.closeWithResult(scopeId, result),
    onIsLayerMounted: (handle) => stack.isPresent(handle)
  });
  const adapter = {
    host: "player",
    blueprintRuntime: {
      surfaceId: "page",
      setSurfaceState: () => undefined,
      getSurfaceState: () => undefined,
      emitDebug: () => undefined,
      dispatchElementBlueprintEvent: async () => undefined,
      hostApi: api
    }
  } as unknown as UIHostAdapter;
  return { stack, api, adapter, logs };
}

async function runGraph(graph: UIGraph, host: LayerTestHost): Promise<Record<string, unknown>> {
  const locals: Record<string, unknown> = {};
  await executeGraph({
    graph,
    entry: graph.entries.main,
    hostAdapter: host.adapter,
    blueprintLocals: locals
  });
  return locals;
}

/** One node, its data output wired into a Set Var named `out`. */
function captureOutputGraph(
  nodeType: string,
  outputPortId: string,
  params: Record<string, unknown> = {}
): UIGraph {
  return {
    id: "capture",
    entries: { main: { start: { nodeId: "act", port: "in" } } },
    nodes: {
      act: { id: "act", type: nodeType, params },
      store: { id: "store", type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "out" } }
    },
    edges: [
      { from: { nodeId: "act", port: "next" }, to: { nodeId: "store", port: "in" } },
      { from: { nodeId: "act", port: outputPortId }, to: { nodeId: "store", port: "value" } }
    ]
  } as UIGraph;
}

/** A node reading one string literal on an input pin, optionally publishing an output into `out`. */
function stringInputGraph(
  nodeType: string,
  inputPortId: string,
  value: string,
  outputPortId?: string
): UIGraph {
  const graph = {
    id: "input",
    entries: { main: { start: { nodeId: "act", port: "in" } } },
    nodes: {
      act: { id: "act", type: nodeType, params: {} },
      literal: { id: "literal", type: BLUEPRINT_NODE_TYPE_LITERAL_STRING, params: { value } },
      store: { id: "store", type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "out" } }
    },
    edges: [
      { from: { nodeId: "literal", port: "value" }, to: { nodeId: "act", port: inputPortId } },
      { from: { nodeId: "act", port: "next" }, to: { nodeId: "store", port: "in" } }
    ]
  } as UIGraph;
  if (outputPortId) {
    graph.edges.push({
      from: { nodeId: "act", port: outputPortId },
      to: { nodeId: "store", port: "value" }
    });
  }
  return graph;
}

describe("Layer blueprint nodes", () => {
  it("Show Layer puts the page up and publishes its handle downstream", async () => {
    const host = createLayerHost();
    const locals = await runGraph(
      captureOutputGraph(BLUEPRINT_NODE_TYPE_LAYER_SHOW, "layer", { surfaceId: "confirm" }),
      host
    );
    const shown = host.stack.getState();
    expect(shown.map((layer) => layer.surfaceId)).toEqual(["confirm"]);
    // The whole point of the whitelist entry: without it this reads `undefined`, silently, and
    // every Hide / Wait wired to this pin becomes a no-op.
    expect(locals.out).toBe(shown[0]!.key);
  });

  it("the layer belongs to the scope that showed it", async () => {
    const host = createLayerHost({ runtimeScopeId: "page:7" });
    await runGraph(
      captureOutputGraph(BLUEPRINT_NODE_TYPE_LAYER_SHOW, "layer", { surfaceId: "confirm" }),
      host
    );
    expect(host.stack.getState()[0]!.ownerScopeId).toBe("page:7");
  });

  it("an unwired Show Layer is non-modal and dismissible", async () => {
    const host = createLayerHost();
    await runGraph(
      captureOutputGraph(BLUEPRINT_NODE_TYPE_LAYER_SHOW, "layer", { surfaceId: "confirm" }),
      host
    );
    expect(host.stack.getState()[0]).toMatchObject({
      modal: false,
      dismissible: true,
      group: null
    });
  });

  it("Show Layer names the page it could not find", async () => {
    const host = createLayerHost();
    const failure = runGraph(
      captureOutputGraph(BLUEPRINT_NODE_TYPE_LAYER_SHOW, "layer", { surfaceId: "gone" }),
      host
    );
    await expect(failure).rejects.toBeInstanceOf(BlueprintGraphExecutionError);
    await expect(failure).rejects.toThrow(/gone/);
    expect(host.stack.getState()).toEqual([]);
  });

  it("Show Layer with no page picked refuses rather than showing something arbitrary", async () => {
    const host = createLayerHost();
    await expect(
      runGraph(captureOutputGraph(BLUEPRINT_NODE_TYPE_LAYER_SHOW, "layer", {}), host)
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
    await expect(
      runGraph(stringInputGraph(BLUEPRINT_NODE_TYPE_LAYER_HIDE, "layer", "layer:gone:9"), host)
    ).resolves.toBeDefined();
  });

  it("Wait For Layer publishes what the layer closed with, downstream", async () => {
    const host = createLayerHost();
    const key = mountSurfaceLayer(host.stack, { surfaceId: "confirm" });
    const waiting = runGraph(
      stringInputGraph(BLUEPRINT_NODE_TYPE_LAYER_WAIT, "layer", key, "result"),
      host
    );
    host.stack.closeWithResult(key, { index: 1 });
    expect(await waiting).toMatchObject({ out: { index: 1 } });
  });

  it("Wait For Layer on a handle already gone returns null instead of hanging", async () => {
    const host = createLayerHost();
    const locals = await runGraph(
      stringInputGraph(BLUEPRINT_NODE_TYPE_LAYER_WAIT, "layer", "layer:gone:9", "result"),
      host
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
    await runGraph(stringInputGraph(BLUEPRINT_NODE_TYPE_LAYER_CLOSE_SELF, "result", "yes"), inside);
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
        edges: []
      } as unknown as UIGraph,
      host
    );
    expect(host.stack.getState()).toHaveLength(1);
    expect(host.logs).toEqual([{ level: "warn", message: expect.stringContaining("not a layer") }]);
  });

  it("Is Layer Mounted answers through the pure read path", async () => {
    const host = createLayerHost();
    const key = mountSurfaceLayer(host.stack, { surfaceId: "confirm" });
    const graph = {
      id: "mounted",
      entries: { main: { start: { nodeId: "store", port: "in" } } },
      nodes: {
        ask: { id: "ask", type: BLUEPRINT_NODE_TYPE_LAYER_IS_MOUNTED, params: {} },
        literal: {
          id: "literal",
          type: BLUEPRINT_NODE_TYPE_LITERAL_STRING,
          params: { value: key }
        },
        store: { id: "store", type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "out" } }
      },
      edges: [
        { from: { nodeId: "literal", port: "value" }, to: { nodeId: "ask", port: "layer" } },
        { from: { nodeId: "ask", port: "mounted" }, to: { nodeId: "store", port: "value" } }
      ]
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
    const entry = stack.getState().find((layer) => layer.key === key)!;
    const inside = createLayerHost({
      runtimeScopeId: entry.runtimeScopeId,
      pageProps: entry.props
    });
    const graph = {
      id: "props",
      entries: { main: { start: { nodeId: "store", port: "in" } } },
      nodes: {
        read: { id: "read", type: BLUEPRINT_NODE_TYPE_PAGE_GET_PROPS, params: {} },
        store: { id: "store", type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "out" } }
      },
      edges: [{ from: { nodeId: "read", port: "props" }, to: { nodeId: "store", port: "value" } }]
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
    onShowLayer: (request) => mountSurfaceLayer(stack, request),
    onHideLayer: async (handle) => {
      await stack.hideAndWaitForExit(handle);
    },
    onHideLayerGroup: async (group) => {
      await stack.hideGroupAndWaitForExit(group);
    },
    onWaitLayer: (handle) => stack.waitForClose(handle),
    onCloseOwnLayer: (scopeId, result) => stack.closeWithResult(scopeId, result),
    onIsLayerMounted: (handle) => stack.isPresent(handle)
  });
  const adapter = {
    host: "player",
    blueprintRuntime: {
      surfaceId: "confirm",
      setSurfaceState: () => undefined,
      getSurfaceState: () => undefined,
      emitDebug: () => undefined,
      dispatchElementBlueprintEvent: async () => undefined,
      hostApi: api
    }
  } as unknown as UIHostAdapter;
  return { stack, api, adapter, logs };
}

/**
 * A `Show Confirm` card with its buttons already added, each answer wired to its own record.
 *
 * The pin ids are spelled the way the canvas spells them, so the params under test are the params
 * an author's node actually carries.
 */
function confirmGraph(options: {
  surfaceId?: string;
  buttons: readonly string[];
  /** Pins to drop from the stored list, standing in for a button removed from the middle. */
  dropPinIds?: readonly string[];
}): UIGraph {
  const params: Record<string, unknown> = {
    surfaceId: options.surfaceId ?? "confirm",
    message: "Delete this save?"
  };
  const pinIds: string[] = [];
  options.buttons.forEach((text, i) => {
    const base = `button_${i + 1}`;
    params[`${base}_label`] = text;
    pinIds.push(`${base}_label`, `${base}_pressed`);
  });
  const dropped = new Set(options.dropPinIds ?? []);
  const kept = pinIds.filter((id) => !dropped.has(id));
  params.__confirmButtonPins = kept;

  const nodes: Record<string, unknown> = {
    act: { id: "act", type: BLUEPRINT_NODE_TYPE_LAYER_CONFIRM, params },
    readIndex: {
      id: "readIndex",
      type: BLUEPRINT_NODE_TYPE_LOCAL_SET,
      params: { variableId: "index" }
    },
    readLabel: {
      id: "readLabel",
      type: BLUEPRINT_NODE_TYPE_LOCAL_SET,
      params: { variableId: "label" }
    }
  };
  const edges: unknown[] = [
    { from: { nodeId: "act", port: "index" }, to: { nodeId: "readIndex", port: "value" } },
    { from: { nodeId: "act", port: "label" }, to: { nodeId: "readLabel", port: "value" } },
    { from: { nodeId: "readIndex", port: "next" }, to: { nodeId: "readLabel", port: "in" } }
  ];
  // Every exec output, Dismissed included, records which way the flow left and then reads both
  // data outputs - so a route that is right and an output that is empty cannot pass for each other.
  for (const portId of [...kept.filter((id) => id.endsWith("_pressed")), "dismissed"]) {
    const storeId = `store_${portId}`;
    nodes[storeId] = {
      id: storeId,
      type: BLUEPRINT_NODE_TYPE_LOCAL_SET,
      params: { variableId: "took", value: portId }
    };
    edges.push({ from: { nodeId: "act", port: portId }, to: { nodeId: storeId, port: "in" } });
    edges.push({
      from: { nodeId: storeId, port: "next" },
      to: { nodeId: "readIndex", port: "in" }
    });
  }

  return {
    id: "confirm",
    entries: { main: { start: { nodeId: "act", port: "in" } } },
    nodes,
    edges
  } as unknown as UIGraph;
}

/** The handle of the layer a running graph has just put up. */
async function awaitMountedLayer(stack: LayerStackController): Promise<string> {
  for (let i = 0; i < 100; i += 1) {
    const key = stack.getState()[0]?.key;
    if (key) {
      return key;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("no layer was mounted");
}

describe("Show Confirm", () => {
  it("puts the question up modally, in its own group, with the buttons as page props", async () => {
    const host = createLayerHost();
    const running = runGraph(confirmGraph({ buttons: ["Delete", "Cancel"] }), host);
    const key = await awaitMountedLayer(host.stack);
    const layer = host.stack.getState()[0]!;
    expect(layer).toMatchObject({ surfaceId: "confirm", modal: true, group: "confirm" });
    expect(layer.props).toMatchObject({
      message: "Delete this save?",
      buttons: [
        { id: "button-0", text: "Delete", index: 0, disabled: false },
        { id: "button-1", text: "Cancel", index: 1, disabled: false }
      ]
    });
    host.stack.closeWithResult(key, 0);
    await running;
  });

  it("leaves through the button that was pressed and publishes Index and Label downstream", async () => {
    const host = createLayerHost();
    const running = runGraph(confirmGraph({ buttons: ["Delete", "Cancel"] }), host);
    const key = await awaitMountedLayer(host.stack);
    host.stack.closeWithResult(key, 1);
    // Both reads go through a downstream node on purpose: that is the path the whitelist in
    // graphParamResolvers.ts governs, and the one that yields `undefined` in silence without it.
    expect(await running).toMatchObject({ took: "button_2_pressed", index: 1, label: "Cancel" });
  });

  it("routes by the pin an add produced, not by position, after a button is deleted", async () => {
    const host = createLayerHost();
    const running = runGraph(
      confirmGraph({
        buttons: ["Delete", "Rename", "Cancel"],
        dropPinIds: ["button_2_label", "button_2_pressed"]
      }),
      host
    );
    const key = await awaitMountedLayer(host.stack);
    expect(host.stack.getState()[0]!.props).toMatchObject({
      buttons: [
        { text: "Delete", index: 0 },
        { text: "Cancel", index: 1 }
      ]
    });
    // Answer 1 is Cancel now, and its branch is still the one its own add produced.
    host.stack.closeWithResult(key, 1);
    expect(await running).toMatchObject({ took: "button_3_pressed", index: 1, label: "Cancel" });
  });

  it("a dismissal is not an answer: it leaves through Dismissed with no index", async () => {
    const host = createLayerHost();
    const running = runGraph(confirmGraph({ buttons: ["Delete", "Cancel"] }), host);
    await awaitMountedLayer(host.stack);
    expect(host.stack.dismissTop()).toBe(true);
    expect(await running).toMatchObject({ took: "dismissed", index: -1, label: "" });
  });

  it("an index no button carries leaves through Dismissed rather than guessing a branch", async () => {
    const host = createLayerHost();
    const running = runGraph(confirmGraph({ buttons: ["Delete", "Cancel"] }), host);
    const key = await awaitMountedLayer(host.stack);
    host.stack.closeWithResult(key, 7);
    expect(await running).toMatchObject({ took: "dismissed", index: -1 });
  });

  it("names the page it could not find", async () => {
    const host = createLayerHost();
    const failure = runGraph(confirmGraph({ surfaceId: "gone", buttons: ["Ok"] }), host);
    await expect(failure).rejects.toBeInstanceOf(BlueprintGraphExecutionError);
    await expect(failure).rejects.toThrow(/gone/);
  });

  /**
   * What an author reads on the card, resolved through the two functions the canvas itself calls:
   * `resolveEffectiveBlueprintCatalogEntry` for the pins and `resolveBlueprintLabel` for the text
   * drawn beside each one.
   *
   * A template label is otherwise rendered verbatim, which prints `Button` over three different
   * buttons and `Pressed` over three different branches - and the card offers nothing else to
   * tell them apart by.
   */
  it("numbers the buttons on the card so the third one can be told from the first", () => {
    const def = allBuiltinBlueprintNodes.find(
      (node) => node.type === BLUEPRINT_NODE_TYPE_LAYER_CONFIRM
    )!;
    const entry = resolveEffectiveBlueprintCatalogEntry(def, {
      __confirmButtonPins: [
        "button_1_label",
        "button_1_pressed",
        "button_2_label",
        "button_2_pressed",
        "button_3_label",
        "button_3_pressed"
      ]
    });
    const labelOf = (pinId: string) => entry.pins.find((pin) => pin.id === pinId)?.label;
    expect([1, 2, 3].map((n) => labelOf(`button_${n}_label`))).toEqual([
      "Button 1",
      "Button 2",
      "Button 3"
    ]);
    expect([1, 2, 3].map((n) => labelOf(`button_${n}_pressed`))).toEqual([
      "Pressed 1",
      "Pressed 2",
      "Pressed 3"
    ]);

    // And through the localization hop, where an ordinal label has no catalogue entry of its
    // own: the number survives and the word is still translated.
    const zh = ((key: string) => (key === "blueprint.port.button" ? "按钮" : key)) as never;
    expect(
      entry.pins
        .filter((pin) => pin.id.endsWith("_label"))
        .map((pin) => resolveBlueprintLabel(pin.label!, zh))
    ).toEqual(["按钮 1", "按钮 2", "按钮 3"]);
  });

  /**
   * A button and its branch are added in one go, and removed the same way. Pinned because the
   * exec output is what a deletion is most likely to strand: it is not a data input, so the
   * removal path had no reason of its own to know about it.
   */
  it("adds and removes a button and its branch together", () => {
    const def = allBuiltinBlueprintNodes.find(
      (node) => node.type === BLUEPRINT_NODE_TYPE_LAYER_CONFIRM
    )!;
    expect(generateNextDynamicInputPinIds(def, {})).toEqual(["button_1_label", "button_1_pressed"]);
    expect(
      getDynamicInputPinRemovalIds(
        def,
        { __confirmButtonPins: ["button_1_label", "button_1_pressed"] },
        "button_1_label"
      )
    ).toEqual(["button_1_label", "button_1_pressed"]);
  });
});
