import { describe, expect, it } from "vitest";
import type { Blueprint, BlueprintDocument } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import {
  acquireBlueprintExecutionLocals,
  releaseBlueprintWidgetLocals
} from "./blueprintWidgetLocals";

const VARIABLE_ID = "v1";

function blueprint(id: string, owner: Blueprint["owner"]): Blueprint {
  return {
    id,
    name: id,
    owner,
    frontend: "visual",
    programKind: "graph",
    members: {
      variables: {
        [VARIABLE_ID]: { id: VARIABLE_ID, name: "Count", valueType: "integer", defaultValue: 0 }
      },
      fields: {},
      functions: {}
    },
    bindings: {},
    program: { kind: "graph", graphs: { events: {}, functions: {} } }
  } as unknown as Blueprint;
}

function documentWith(bp: Blueprint): BlueprintDocument {
  return {
    schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
    blueprints: { [bp.id]: bp },
    ownerRecords: {}
  } as unknown as BlueprintDocument;
}

describe("blueprint widget lifecycle locals", () => {
  // Two placements of one component share a component id and every inner element id; only the
  // instance key tells them apart. If it did not, componentising a repeated row would make all the
  // rows share one set of variables.
  it("gives each component instance its own store", () => {
    const bp = blueprint("bp", {
      kind: "componentWidgetMain",
      componentId: "comp",
      elementId: "el"
    });
    const doc = documentWith(bp);
    const acquire = (elementInstanceKey: string) =>
      acquireBlueprintExecutionLocals({
        blueprintDocument: doc,
        currentBlueprintId: "bp",
        elementId: "el",
        elementInstanceKey
      });

    acquire("component:one")[VARIABLE_ID] = 11;
    acquire("component:two")[VARIABLE_ID] = 22;

    expect(acquire("component:one")[VARIABLE_ID]).toBe(11);
    expect(acquire("component:two")[VARIABLE_ID]).toBe(22);
  });

  // The store key gains an instance segment and a different prefix per owner kind; release used to
  // rebuild one fixed form and so matched neither, leaving the values in place for a remount.
  it("releases stores that carry an instance key, and component-owned ones", () => {
    const widget = blueprint("wbp", { kind: "widgetMain", surfaceId: "surface", elementId: "el" });
    const widgetDoc = documentWith(widget);
    const acquireWidget = () =>
      acquireBlueprintExecutionLocals({
        blueprintDocument: widgetDoc,
        currentBlueprintId: "wbp",
        surfaceId: "surface",
        elementId: "el",
        elementInstanceKey: "row:3"
      });
    acquireWidget()[VARIABLE_ID] = 7;
    expect(acquireWidget()[VARIABLE_ID]).toBe(7);
    releaseBlueprintWidgetLocals("surface", "el", "wbp");
    expect(acquireWidget()[VARIABLE_ID]).toBe(0);

    const comp = blueprint("cbp", {
      kind: "componentWidgetMain",
      componentId: "comp",
      elementId: "el"
    });
    const compDoc = documentWith(comp);
    const acquireComp = () =>
      acquireBlueprintExecutionLocals({
        blueprintDocument: compDoc,
        currentBlueprintId: "cbp",
        elementId: "el",
        elementInstanceKey: "component:one"
      });
    acquireComp()[VARIABLE_ID] = 9;
    expect(acquireComp()[VARIABLE_ID]).toBe(9);
    releaseBlueprintWidgetLocals("surface", "el", "cbp", undefined, { componentId: "comp" });
    expect(acquireComp()[VARIABLE_ID]).toBe(0);
  });

  it("leaves another element's store alone", () => {
    const mine = blueprint("bp", { kind: "widgetMain", surfaceId: "surface", elementId: "el" });
    const doc = documentWith(mine);
    const acquireFor = (elementId: string) =>
      acquireBlueprintExecutionLocals({
        blueprintDocument: doc,
        currentBlueprintId: "bp",
        surfaceId: "surface",
        elementId
      });
    acquireFor("el")[VARIABLE_ID] = 5;
    releaseBlueprintWidgetLocals("surface", "other", "bp");
    expect(acquireFor("el")[VARIABLE_ID]).toBe(5);
  });
});
