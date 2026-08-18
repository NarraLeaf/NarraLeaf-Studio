import { describe, expect, it } from "vitest";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import {
  BLUEPRINT_NODE_PARAM_VARIABLE_VALUE_TYPE,
  BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
  BLUEPRINT_NODE_TYPE_LITERAL_FLOAT,
  BLUEPRINT_NODE_TYPE_LITERAL_JSON,
  BLUEPRINT_NODE_TYPE_PERSISTENT_GET,
  BLUEPRINT_NODE_TYPE_PERSISTENT_SET,
  BLUEPRINT_NODE_TYPE_SAVED_GET,
  BLUEPRINT_NODE_TYPE_SAVED_SET
} from "@shared/types/blueprint/graph";
import {
  UI_DOCUMENT_SCHEMA_VERSION,
  type UIDocument,
  type UIElement
} from "@shared/types/ui-editor/document";
import type { Blueprint, BlueprintDocument } from "@shared/types/blueprint/document";
import { HistoryService } from "../history/HistoryService";
import { Services } from "../services";
import { LocalBlueprintService } from "./LocalBlueprintService";

function graphBlueprint(id = "bp-main"): Blueprint {
  return {
    id,
    name: "Main",
    owner: { kind: "surfaceMain", surfaceId: "surface-a" },
    frontend: "visual",
    programKind: "graph",
    members: {
      variables: {},
      fields: {},
      functions: {}
    },
    program: {
      kind: "graph",
      graphs: {
        events: {
          mouseClick: {
            id: "mouseClick",
            name: "Mouse Click",
            graph: {
              nodes: {
                nodeA: {
                  id: "nodeA",
                  type: "test.node",
                  params: {
                    value: 1
                  }
                }
              },
              edges: []
            }
          }
        },
        functions: {}
      }
    }
  };
}

function blueprintDocument(): BlueprintDocument {
  const bp = graphBlueprint();
  return {
    schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
    blueprints: {
      [bp.id]: bp
    },
    ownerRecords: {
      "surfaceMain:surface-a": {
        activeBlueprintId: bp.id,
        privateBlueprintIds: [bp.id],
        initializedFrontend: "visual"
      }
    }
  };
}

function rootElement(): UIElement {
  return {
    id: "root-a",
    type: "nl.root",
    name: "Root",
    parentId: null,
    childrenIds: ["button-a"],
    layout: { x: 0, y: 0, width: 1280, height: 720, visible: true, opacity: 1 }
  };
}

function buttonElement(): UIElement {
  return {
    id: "button-a",
    type: "nl.button",
    name: "Button",
    parentId: "root-a",
    childrenIds: [],
    layout: { x: 0, y: 0, width: 100, height: 40, visible: true, opacity: 1 },
    behavior: {
      events: {
        mouseClick: { kind: "blueprintEvent", blueprintId: "bp-main", eventId: "mouseClick" }
      }
    }
  };
}

function uiDocument(): UIDocument {
  return {
    schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
    id: "ui-doc",
    name: "UI",
    surfaces: [
      {
        id: "surface-a",
        name: "Surface A",
        host: "app",
        kind: "appSurface",
        designSize: { width: 1280, height: 720 },
        rootElementId: "root-a"
      }
    ],
    elements: {
      "root-a": rootElement(),
      "button-a": buttonElement()
    },
    meta: {}
  };
}

type MockRegistryScope = "saved" | "persistent";
type MockRegistryEntry = {
  id: string;
  name: string;
  scope: MockRegistryScope;
  valueType: string;
  defaultValue?: unknown;
  storageKey: string;
  description?: string;
};

function createHarness() {
  const graphDocument = { blueprintDocument: blueprintDocument() };
  const graphMutations = { count: 0 };
  let nextId = 0;
  // In-memory stand-in for VariableRegistryService: persistent-variable CRUD now lives there, and
  // its state is captured into blueprint history so persistent edits undo with the blueprint edit.
  const registry: { schemaVersion: number; entries: Record<string, MockRegistryEntry> } = {
    schemaVersion: 1,
    entries: {}
  };
  // Same idea for SaveSchemaService: the save-field popover lives on a blueprint node card, so its
  // document is captured into blueprint history and restored with the same undo.
  const saveSchema: { schemaVersion: number; fields: Record<string, unknown> } = {
    schemaVersion: 1,
    fields: {}
  };
  const saveSchemaService = {
    getSchema() {
      return saveSchema;
    },
    replaceSchema(next: { schemaVersion: number; fields: Record<string, unknown> }) {
      saveSchema.schemaVersion = next.schemaVersion;
      saveSchema.fields = next.fields;
    }
  };
  const registryService = {
    getRegistry() {
      return registry;
    },
    replaceRegistry(next: { schemaVersion: number; entries: Record<string, MockRegistryEntry> }) {
      registry.schemaVersion = next.schemaVersion;
      registry.entries = next.entries;
    },
    listEntries() {
      return Object.values(registry.entries).sort((a, b) => a.name.localeCompare(b.name));
    },
    listEntriesInScope(scope: MockRegistryScope) {
      return this.listEntries().filter((entry) => entry.scope === scope);
    },
    createEntry(
      scope: MockRegistryScope,
      input?: { name?: string; valueType?: string; defaultValue?: unknown }
    ) {
      const id = `${scope === "saved" ? "saved" : "persist"}-${++nextId}`;
      const entry: MockRegistryEntry = {
        id,
        storageKey: id,
        name: input?.name ?? `${scope}_${id}`,
        scope,
        valueType: input?.valueType ?? "json",
        defaultValue: input?.defaultValue
      };
      registry.entries[id] = entry;
      return entry;
    },
    renameEntry(id: string, name: string) {
      if (registry.entries[id]) {
        registry.entries[id].name = name;
      }
    },
    setEntryValueType(id: string, valueType: string) {
      if (registry.entries[id]) {
        registry.entries[id].valueType = valueType;
      }
    },
    setEntryDefault(id: string, defaultValue: unknown) {
      if (registry.entries[id]) {
        registry.entries[id].defaultValue = defaultValue;
      }
    },
    deleteEntry(id: string) {
      delete registry.entries[id];
    }
  };
  const uidoc = {
    document: uiDocument(),
    getDocument() {
      return this.document;
    },
    restoreDocumentFromHistory(document: UIDocument) {
      this.document = document;
    },
    stripBlueprintLayerBindings(surfaceId: string, blueprintId: string, layerEventId: string) {
      for (const element of Object.values(this.document.elements)) {
        const events = element.behavior?.events;
        if (!events) {
          continue;
        }
        for (const [eventName, binding] of Object.entries(events)) {
          if (
            binding.kind === "blueprintEvent" &&
            binding.blueprintId === blueprintId &&
            binding.eventId === layerEventId
          ) {
            events[eventName] = { kind: "noop" };
          }
        }
      }
    }
  };
  // Blueprint undo stacks live in HistoryService now; this service supplies the snapshots.
  const historyService = new HistoryService();
  const service = new LocalBlueprintService();
  const context = {
    project: {} as any,
    services: {
      get(serviceId: Services) {
        if (serviceId === Services.History) {
          return historyService;
        }
        if (serviceId === Services.UIGraph) {
          return {
            getDocument() {
              return graphDocument;
            },
            applyGraphMutation(mutator: (document: typeof graphDocument) => void) {
              graphMutations.count += 1;
              mutator(graphDocument);
            }
          };
        }
        if (serviceId === Services.UIDocument) {
          return uidoc;
        }
        if (serviceId === Services.Uuid) {
          return { generate: () => `generated-id-${++nextId}` };
        }
        if (serviceId === Services.VariableRegistry) {
          return registryService;
        }
        if (serviceId === Services.SaveSchema) {
          return saveSchemaService;
        }
        throw new Error(`Unexpected service ${serviceId}`);
      }
    } as any
  };
  historyService.setContext(context);
  service.setContext(context);
  return { service, historyService, graphDocument, uidoc, registryService, graphMutations };
}

describe("LocalBlueprintService persistent variables (M-VAR registry)", () => {
  it("delegates CRUD to the registry and undoes/redoes it through blueprint history", () => {
    const { service, registryService } = createHarness();

    const created = service.createPersistentVariable("bp-main", {
      name: "Gold",
      valueType: "number",
      defaultValue: 100
    });
    expect(registryService.listEntries().map((e) => e.name)).toEqual(["Gold"]);
    expect(service.canUndoBlueprint("bp-main")).toBe(true);

    // Undo removes the newly-created variable; redo brings it back.
    expect(service.undoBlueprint("bp-main")).toBe(true);
    expect(registryService.listEntries()).toEqual([]);
    expect(service.redoBlueprint("bp-main")).toBe(true);
    expect(registryService.listEntries().map((e) => e.name)).toEqual(["Gold"]);

    // Rename is on the same undo stack.
    service.renamePersistentVariable("bp-main", created.id, "Coins");
    expect(registryService.getRegistry().entries[created.id].name).toBe("Coins");
    service.undoBlueprint("bp-main");
    expect(registryService.getRegistry().entries[created.id].name).toBe("Gold");

    // Delete then undo restores the entry.
    service.deletePersistentVariable("bp-main", created.id);
    expect(registryService.listEntries()).toEqual([]);
    service.undoBlueprint("bp-main");
    expect(registryService.listEntries().map((e) => e.name)).toEqual(["Gold"]);
  });

  it("retypes through the registry, on the same undo stack", () => {
    const { service, registryService } = createHarness();

    const created = service.createPersistentVariable("bp-main", {
      name: "Gold",
      valueType: "number"
    });
    service.setPersistentVariableValueType("bp-main", created.id, "string");
    expect(registryService.getRegistry().entries[created.id].valueType).toBe("string");

    service.undoBlueprint("bp-main");
    expect(registryService.getRegistry().entries[created.id].valueType).toBe("number");
  });
});

describe("LocalBlueprintService saved variables (M-VAR registry)", () => {
  /**
   * The two scopes share one registry, so the listings are the only thing keeping them apart -
   * and the persistent listing feeds the blueprint member tree and the persistent node picker.
   */
  it("lists each scope separately", () => {
    const { service } = createHarness();

    const persistent = service.createPersistentVariable("bp-main", { name: "Gold" });
    const saved = service.createSavedRegistryVariable("bp-main", { name: "Route Flag" });

    expect(service.listPersistentVariables().map((e) => e.id)).toEqual([persistent.id]);
    expect(service.listSavedVariables().map((e) => e.id)).toEqual([saved.id]);
  });

  it("delegates saved CRUD to the registry and undoes it through blueprint history", () => {
    const { service, registryService } = createHarness();

    const created = service.createSavedRegistryVariable("bp-main", {
      name: "Route Flag",
      valueType: "boolean"
    });
    expect(registryService.getRegistry().entries[created.id]).toMatchObject({
      name: "Route Flag",
      scope: "saved",
      valueType: "boolean"
    });

    service.renameSavedRegistryVariable("bp-main", created.id, "Route");
    service.setSavedRegistryVariableDefault("bp-main", created.id, true);
    service.setSavedRegistryVariableValueType("bp-main", created.id, "string");
    expect(registryService.getRegistry().entries[created.id]).toMatchObject({
      name: "Route",
      defaultValue: true,
      valueType: "string"
    });

    service.undoBlueprint("bp-main");
    expect(registryService.getRegistry().entries[created.id].valueType).toBe("boolean");
  });

  /**
   * The saved twin of the persistent node-ref cleanup: `Get/Set Saved Var` address their variable
   * through `savedVariableId`, so a delete that left the param behind would leave a node that only
   * fails once the story runs it.
   */
  it("clears saved node refs on delete, and leaves other scopes' params alone", () => {
    const { service, graphDocument } = createHarness();

    const saved = service.createSavedRegistryVariable("bp-main", { name: "Route Flag" });
    const persistent = service.createPersistentVariable("bp-main", { name: "Gold" });

    const bp = graphDocument.blueprintDocument.blueprints["bp-main"];
    if (bp.program.kind !== "graph") {
      throw new Error("Expected graph blueprint");
    }
    bp.program.graphs.events.onClick = {
      id: "onClick",
      graph: {
        nodes: {
          getSaved: {
            id: "getSaved",
            type: BLUEPRINT_NODE_TYPE_SAVED_GET,
            params: { savedVariableId: saved.id }
          },
          setSaved: {
            id: "setSaved",
            type: BLUEPRINT_NODE_TYPE_SAVED_SET,
            params: {
              savedVariableId: saved.id,
              [BLUEPRINT_NODE_PARAM_VARIABLE_VALUE_TYPE]: "boolean"
            }
          },
          getPersistent: {
            id: "getPersistent",
            type: BLUEPRINT_NODE_TYPE_PERSISTENT_GET,
            params: { persistentVariableId: persistent.id }
          }
        },
        edges: []
      }
    };

    service.deleteSavedRegistryVariable("bp-main", saved.id);

    const nodes = bp.program.graphs.events.onClick?.graph?.nodes;
    expect(nodes?.getSaved?.params?.savedVariableId).toBeUndefined();
    expect(nodes?.setSaved?.params?.savedVariableId).toBeUndefined();
    expect(nodes?.setSaved?.params?.[BLUEPRINT_NODE_PARAM_VARIABLE_VALUE_TYPE]).toBeUndefined();
    // A different scope's node param is a different identity space; it must not be touched.
    expect(nodes?.getPersistent?.params?.persistentVariableId).toBe(persistent.id);
  });
});

describe("LocalBlueprintService history", () => {
  it("seeds widget value blueprints with an init layer only", () => {
    const { service, graphDocument } = createHarness();

    const blueprintId = service.ensureWidgetValueBlueprint({
      surfaceId: "surface-a",
      elementId: "button-a",
      propPath: "text",
      valueType: "string",
      displayName: "Text value",
      literalValue: "Hello"
    });

    const bp = graphDocument.blueprintDocument.blueprints[blueprintId];
    expect(bp.owner).toEqual({
      kind: "widgetValue",
      surfaceId: "surface-a",
      elementId: "button-a",
      propPath: "text"
    });
    expect(bp.program.kind).toBe("graph");
    if (bp.program.kind !== "graph") {
      throw new Error("Expected graph blueprint");
    }
    expect(Object.keys(bp.program.graphs.events)).toEqual(["init"]);
    const initGraph = bp.program.graphs.events.init?.graph;
    if (!initGraph) {
      throw new Error("Expected init graph");
    }
    const nodeTypes = Object.values(initGraph.nodes ?? {}).map((node) => node.type);
    expect(nodeTypes).toContain(BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT);
    expect(nodeTypes).not.toContain("blueprint.event.head.flush");
  });

  it("seeds JSON widget value blueprints with a JSON literal", () => {
    const { service, graphDocument } = createHarness();

    const blueprintId = service.ensureWidgetValueBlueprint({
      surfaceId: "surface-a",
      elementId: "button-a",
      propPath: "params",
      valueType: "json",
      displayName: "Page props",
      literalValue: { title: "Hello" }
    });

    const bp = graphDocument.blueprintDocument.blueprints[blueprintId];
    expect(bp.meta?.valueType).toBe("json");
    expect(bp.program.kind).toBe("graph");
    if (bp.program.kind !== "graph") {
      throw new Error("Expected graph blueprint");
    }
    const initGraph = bp.program.graphs.events.init?.graph;
    if (!initGraph) {
      throw new Error("Expected init graph");
    }
    const nodes = Object.values(initGraph.nodes ?? {});
    const literal = nodes.find((node) => node.type === BLUEPRINT_NODE_TYPE_LITERAL_JSON);
    expect(literal?.params?.value).toEqual({ title: "Hello" });
  });

  it("seeds float widget value blueprints with a Float literal", () => {
    const { service, graphDocument } = createHarness();

    const blueprintId = service.ensureWidgetValueBlueprint({
      surfaceId: "surface-a",
      elementId: "button-a",
      propPath: "value",
      valueType: "float",
      displayName: "Slider value",
      literalValue: 42.5
    });

    const bp = graphDocument.blueprintDocument.blueprints[blueprintId];
    expect(bp.meta?.valueType).toBe("float");
    expect(bp.program.kind).toBe("graph");
    if (bp.program.kind !== "graph") {
      throw new Error("Expected graph blueprint");
    }
    const initGraph = bp.program.graphs.events.init?.graph;
    if (!initGraph) {
      throw new Error("Expected init graph");
    }
    const nodes = Object.values(initGraph.nodes ?? {});
    const literal = nodes.find((node) => node.type === BLUEPRINT_NODE_TYPE_LITERAL_FLOAT);
    expect(literal?.params?.value).toBe(42.5);
  });

  it("undoes and redoes blueprint member edits", () => {
    const { service, graphDocument } = createHarness();

    const created = service.createBlueprintVariable("bp-main", {
      name: "health",
      valueType: "integer"
    });
    expect(
      graphDocument.blueprintDocument.blueprints["bp-main"].members?.variables[created.id]?.name
    ).toBe("health");
    expect(
      graphDocument.blueprintDocument.blueprints["bp-main"].members?.variables[created.id]
        ?.valueType
    ).toBe("integer");

    expect(service.undoBlueprint("bp-main")).toBe(true);
    expect(
      graphDocument.blueprintDocument.blueprints["bp-main"].members?.variables[created.id]
    ).toBeUndefined();

    expect(service.redoBlueprint("bp-main")).toBe(true);
    expect(
      graphDocument.blueprintDocument.blueprints["bp-main"].members?.variables[created.id]?.name
    ).toBe("health");
    expect(
      graphDocument.blueprintDocument.blueprints["bp-main"].members?.variables[created.id]
        ?.valueType
    ).toBe("integer");
  });

  it("creates persistent variables and clears persistent node refs on delete", () => {
    const { service, graphDocument, registryService } = createHarness();

    const created = service.createPersistentVariable("bp-main", {
      name: "volume",
      valueType: "number",
      defaultValue: 0.5
    });
    // The variable now lives in the M-VAR registry, not the blueprint document.
    expect(registryService.getRegistry().entries[created.id]).toMatchObject({
      id: created.id,
      name: "volume",
      valueType: "number",
      defaultValue: 0.5,
      storageKey: created.id
    });

    service.renamePersistentVariable("bp-main", created.id, "masterVolume");
    service.setPersistentVariableDefault("bp-main", created.id, 0.75);
    expect(registryService.getRegistry().entries[created.id]?.name).toBe("masterVolume");
    expect(registryService.getRegistry().entries[created.id]?.storageKey).toBe(created.id);
    expect(registryService.getRegistry().entries[created.id]?.defaultValue).toBe(0.75);

    const bp = graphDocument.blueprintDocument.blueprints["bp-main"];
    if (bp.program.kind !== "graph") {
      throw new Error("Expected graph blueprint");
    }
    bp.program.graphs.events.mouseClick = {
      id: "mouseClick",
      graph: {
        nodes: {
          getPersistent: {
            id: "getPersistent",
            type: BLUEPRINT_NODE_TYPE_PERSISTENT_GET,
            params: {
              persistentVariableId: created.id,
              [BLUEPRINT_NODE_PARAM_VARIABLE_VALUE_TYPE]: "number"
            }
          }
        },
        edges: []
      }
    };
    bp.program.graphs.functions.readVolume = {
      id: "readVolume",
      graph: {
        nodes: {
          setPersistent: {
            id: "setPersistent",
            type: BLUEPRINT_NODE_TYPE_PERSISTENT_SET,
            params: {
              persistentVariableId: created.id,
              [BLUEPRINT_NODE_PARAM_VARIABLE_VALUE_TYPE]: "number"
            }
          }
        },
        edges: []
      }
    };
    bp.program.graphs.macros = {
      rememberVolume: {
        id: "rememberVolume",
        graph: {
          nodes: {
            getPersistent: {
              id: "getPersistent",
              type: BLUEPRINT_NODE_TYPE_PERSISTENT_GET,
              params: {
                persistentVariableId: created.id,
                [BLUEPRINT_NODE_PARAM_VARIABLE_VALUE_TYPE]: "number"
              }
            }
          },
          edges: []
        }
      }
    };

    service.deletePersistentVariable("bp-main", created.id);

    expect(registryService.getRegistry().entries[created.id]).toBeUndefined();
    const nodes = [
      bp.program.graphs.events.mouseClick?.graph?.nodes?.getPersistent,
      bp.program.graphs.functions.readVolume?.graph?.nodes?.setPersistent,
      bp.program.graphs.macros.rememberVolume?.graph?.nodes?.getPersistent
    ];
    for (const node of nodes) {
      expect(node?.params?.persistentVariableId).toBeUndefined();
      expect(node?.params?.[BLUEPRINT_NODE_PARAM_VARIABLE_VALUE_TYPE]).toBeUndefined();
    }
  });

  it("clears redo after a new edit following undo", () => {
    const { service } = createHarness();

    service.createBlueprintVariable("bp-main", { name: "health" });
    expect(service.undoBlueprint("bp-main")).toBe(true);

    service.createBlueprintVariable("bp-main", { name: "score" });

    expect(service.canRedoBlueprint("bp-main")).toBe(false);
  });

  it("undoes repeated node parameter edits one committed value at a time", () => {
    const { service, graphDocument } = createHarness();

    service.updateEventGraphIr("bp-main", "mouseClick", (ir) => {
      const node = ir.nodes?.nodeA;
      if (node) {
        node.params = { ...(node.params ?? {}), value: 2 };
      }
    });
    service.updateEventGraphIr("bp-main", "mouseClick", (ir) => {
      const node = ir.nodes?.nodeA;
      if (node) {
        node.params = { ...(node.params ?? {}), value: 3 };
      }
    });

    const readValue = () => {
      const bp = graphDocument.blueprintDocument.blueprints["bp-main"];
      if (bp.program.kind !== "graph") {
        return undefined;
      }
      return bp.program.graphs.events.mouseClick?.graph?.nodes?.nodeA?.params?.value;
    };

    expect(readValue()).toBe(3);
    expect(service.undoBlueprint("bp-main")).toBe(true);
    expect(readValue()).toBe(2);
    expect(service.undoBlueprint("bp-main")).toBe(true);
    expect(readValue()).toBe(1);
  });

  it("restores graph connections when undoing an edge deletion", () => {
    const { service, graphDocument } = createHarness();

    service.updateEventGraphIr("bp-main", "mouseClick", (ir) => {
      ir.nodes = {
        ...(ir.nodes ?? {}),
        nodeB: {
          id: "nodeB",
          type: "test.next",
          params: {}
        }
      };
      ir.edges = [{ from: { nodeId: "nodeA", port: "next" }, to: { nodeId: "nodeB", port: "in" } }];
    });
    service.updateEventGraphIr("bp-main", "mouseClick", (ir) => {
      ir.edges = [];
    });

    const readEdges = () => {
      const bp = graphDocument.blueprintDocument.blueprints["bp-main"];
      if (bp.program.kind !== "graph") {
        return undefined;
      }
      return bp.program.graphs.events.mouseClick?.graph?.edges;
    };

    expect(readEdges()).toEqual([]);
    expect(service.undoBlueprint("bp-main")).toBe(true);
    expect(readEdges()).toEqual([
      { from: { nodeId: "nodeA", port: "next" }, to: { nodeId: "nodeB", port: "in" } }
    ]);
  });

  it("restores UI behavior changes recorded in a blueprint transaction", () => {
    const { service, graphDocument, uidoc } = createHarness();

    service.runBlueprintHistoryTransaction("bp-main", () => {
      uidoc.stripBlueprintLayerBindings("surface-a", "bp-main", "mouseClick");
      service.removeEventGraph("bp-main", "mouseClick");
    });

    expect(uidoc.document.elements["button-a"].behavior?.events?.mouseClick.kind).toBe("noop");
    expect(graphDocument.blueprintDocument.blueprints["bp-main"].program.kind).toBe("graph");
    if (graphDocument.blueprintDocument.blueprints["bp-main"].program.kind === "graph") {
      expect(
        graphDocument.blueprintDocument.blueprints["bp-main"].program.graphs.events.mouseClick
      ).toBeUndefined();
    }

    expect(service.undoBlueprint("bp-main")).toBe(true);

    expect(uidoc.document.elements["button-a"].behavior?.events?.mouseClick).toEqual({
      kind: "blueprintEvent",
      blueprintId: "bp-main",
      eventId: "mouseClick"
    });
    const bp = graphDocument.blueprintDocument.blueprints["bp-main"];
    expect(bp.program.kind).toBe("graph");
    if (bp.program.kind === "graph") {
      expect(bp.program.graphs.events.mouseClick?.name).toBe("Mouse Click");
    }
  });
});

describe("LocalBlueprintService function graph order", () => {
  it("maintains the order and survives a canonical rewrite that re-keys the record", () => {
    const { service, graphDocument } = createHarness();
    service.ensureFunctionGraph("bp-main", "zzz", "Z");
    service.ensureFunctionGraph("bp-main", "aaa", "A");
    service.ensureFunctionGraph("bp-main", "mmm", "M");
    service.removeFunctionGraph("bp-main", "mmm");
    expect(service.listFunctionGraphIds("bp-main")).toEqual(["zzz", "aaa"]);

    const bp = graphDocument.blueprintDocument.blueprints["bp-main"];
    if (bp.program.kind !== "graph") {
      throw new Error("test fixture lost its graph program");
    }
    const graphs = bp.program.graphs;
    graphs.functions = Object.fromEntries(
      Object.keys(graphs.functions)
        .sort()
        .map((id) => [id, graphs.functions[id]!])
    );
    expect(Object.keys(graphs.functions)).toEqual(["aaa", "zzz"]);

    expect(service.listFunctionGraphIds("bp-main")).toEqual(["zzz", "aaa"]);
  });
});

describe("LocalBlueprintService event layer order", () => {
  function readGraphs(graphDocument: { blueprintDocument: BlueprintDocument }) {
    const bp = graphDocument.blueprintDocument.blueprints["bp-main"];
    if (bp.program.kind !== "graph") {
      throw new Error("test fixture lost its graph program");
    }
    return bp.program.graphs;
  }

  it("appends a new layer and drops a deleted one from the order", () => {
    const { service, graphDocument } = createHarness();

    service.ensureEventGraph("bp-main", "aaa", "A");
    service.ensureEventGraph("bp-main", "zzz", "Z");
    expect(service.listEventGraphIds("bp-main")).toEqual(["mouseClick", "aaa", "zzz"]);
    expect(readGraphs(graphDocument).eventIds).toEqual(["mouseClick", "aaa", "zzz"]);

    service.removeEventGraph("bp-main", "aaa");
    expect(service.listEventGraphIds("bp-main")).toEqual(["mouseClick", "zzz"]);
    expect(readGraphs(graphDocument).eventIds).toEqual(["mouseClick", "zzz"]);
  });

  it("keeps a layer's place when it is upserted again", () => {
    const { service } = createHarness();

    service.ensureEventGraph("bp-main", "aaa", "A");
    service.ensureEventGraph("bp-main", "zzz", "Z");
    service.ensureEventGraph("bp-main", "mouseClick", "Renamed");

    expect(service.listEventGraphIds("bp-main")).toEqual(["mouseClick", "aaa", "zzz"]);
  });

  it("survives a canonical rewrite that re-keys the record in sorted order", () => {
    const { service, graphDocument } = createHarness();
    service.ensureEventGraph("bp-main", "zzz", "Z");
    service.ensureEventGraph("bp-main", "aaa", "A");
    const authored = ["mouseClick", "zzz", "aaa"];

    // What a save/load round-trip through canonical JSON does to the record: same layers,
    // reinserted in sorted key order. The array is the only thing that still knows.
    const graphs = readGraphs(graphDocument);
    graphs.events = Object.fromEntries(
      Object.keys(graphs.events)
        .sort()
        .map((id) => [id, graphs.events[id]!])
    );
    expect(Object.keys(graphs.events)).toEqual(["aaa", "mouseClick", "zzz"]);

    expect(service.listEventGraphIds("bp-main")).toEqual(authored);
  });
});

describe("LocalBlueprintService ensure* helpers", () => {
  // These run once per surface and once per eligible widget after *every* uidoc mutation. Going
  // through applyBlueprintMutation when there is nothing to write bumps the graph revision, marks
  // uigraphs.json dirty, schedules a save and notifies every subscriber - dozens of times per drag.
  it("writes nothing when the owner record is already what was asked for", () => {
    const { service, graphMutations } = createHarness();

    service.ensureSurfaceMain("surface-a", "Main");
    const afterFirst = graphMutations.count;

    expect(service.ensureSurfaceMain("surface-a", "Main")).toBe("bp-main");
    expect(service.ensureSurfaceMain("surface-a")).toBe("bp-main");
    expect(graphMutations.count).toBe(afterFirst);
  });

  it("still writes when the display name actually changes", () => {
    const { service, graphDocument, graphMutations } = createHarness();

    service.ensureSurfaceMain("surface-a", "Main");
    const afterFirst = graphMutations.count;

    service.ensureSurfaceMain("surface-a", "Renamed");
    expect(graphMutations.count).toBeGreaterThan(afterFirst);
    expect(graphDocument.blueprintDocument.blueprints["bp-main"].name).toBe("Renamed");
  });

  it("still writes the first time an owner is seen", () => {
    const { service, graphDocument, graphMutations } = createHarness();

    const before = graphMutations.count;
    const id = service.ensureWidgetMain("surface-a", "button-a", "Button", "nl.button");

    expect(graphMutations.count).toBeGreaterThan(before);
    expect(
      graphDocument.blueprintDocument.ownerRecords["widgetMain:surface-a:button-a"]
        .activeBlueprintId
    ).toBe(id);

    const afterCreate = graphMutations.count;
    expect(service.ensureWidgetMain("surface-a", "button-a", "Button", "nl.button")).toBe(id);
    expect(graphMutations.count).toBe(afterCreate);
  });
});
