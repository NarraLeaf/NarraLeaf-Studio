import { describe, expect, it } from "vitest";
import type { Blueprint, BlueprintDocument, BlueprintGraphIr, BlueprintOwnerRef } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument } from "@shared/types/ui-editor/document";
import {
    BLUEPRINT_NODE_PARAMS_FN_PARAM_PIN_IDS,
    BLUEPRINT_NODE_PARAMS_FN_PARAM_PIN_LABELS,
    BLUEPRINT_NODE_PARAMS_FN_PARAM_PIN_TYPES,
    BLUEPRINT_NODE_PARAMS_FN_RETURN_PIN_IDS,
    BLUEPRINT_NODE_PARAMS_FN_RETURN_PIN_LABELS,
    BLUEPRINT_NODE_PARAMS_FN_RETURN_PIN_TYPES,
    BLUEPRINT_NODE_TYPE_FN_HEAD,
    BLUEPRINT_NODE_TYPE_FN_RETURN,
} from "@shared/types/blueprint/graph";
import { ownerRefToIndexKey } from "./ownerKeys";
import {
    buildBlueprintFnSignatureSnapshot,
    collectDeclaredBlueprintFns,
    createBlueprintFnRef,
    findBlueprintFnByRef,
    isBlueprintFnSnapshotStale,
    isBlueprintFnVisibleToOwner,
    listCallableBlueprintFnOptions,
    parseBlueprintFnRef,
} from "./fnCatalog";

function fnHeadNode(name: string): { id?: string; type: string; params: Record<string, unknown> } {
    return {
        type: BLUEPRINT_NODE_TYPE_FN_HEAD,
        params: {
            name,
            [BLUEPRINT_NODE_PARAMS_FN_PARAM_PIN_IDS]: ["param_1_value"],
            [BLUEPRINT_NODE_PARAMS_FN_PARAM_PIN_LABELS]: { param_1_value: "count" },
            [BLUEPRINT_NODE_PARAMS_FN_PARAM_PIN_TYPES]: { param_1_value: "integer" },
        },
    };
}

function fnReturnNode(): { type: string; params: Record<string, unknown> } {
    return {
        type: BLUEPRINT_NODE_TYPE_FN_RETURN,
        params: {
            [BLUEPRINT_NODE_PARAMS_FN_RETURN_PIN_IDS]: ["ret_1_value"],
            [BLUEPRINT_NODE_PARAMS_FN_RETURN_PIN_LABELS]: { ret_1_value: "result" },
            [BLUEPRINT_NODE_PARAMS_FN_RETURN_PIN_TYPES]: { ret_1_value: "string" },
        },
    };
}

function graphBlueprint(id: string, owner: BlueprintOwnerRef, ir: BlueprintGraphIr): Blueprint {
    return {
        id,
        name: id,
        owner,
        frontend: "visual",
        programKind: "graph",
        members: { variables: {}, fields: {}, functions: {} },
        bindings: {},
        program: { kind: "graph", graphs: { events: { main: { id: "main", graph: ir } }, functions: {} } },
    };
}

function testDocument(): BlueprintDocument {
    const blueprints: Record<string, Blueprint> = {
        "bp-global": graphBlueprint("bp-global", { kind: "globalMain" }, {
            nodes: { "g-head": { id: "g-head", ...fnHeadNode("GlobalFn") } },
            edges: [],
        }),
        "bp-s1": graphBlueprint("bp-s1", { kind: "surfaceMain", surfaceId: "s1" }, {
            nodes: {
                "s1-head": { id: "s1-head", ...fnHeadNode("SurfaceFn") },
                "s1-ret": { id: "s1-ret", ...fnReturnNode() },
            },
            edges: [{ from: { nodeId: "s1-head", port: "then" }, to: { nodeId: "s1-ret", port: "in" } }],
        }),
        "bp-w1": graphBlueprint("bp-w1", { kind: "widgetMain", surfaceId: "s1", elementId: "button" }, {
            nodes: {
                "w1-head": { id: "w1-head", ...fnHeadNode("WidgetFn") },
                // Not wired to the head: must NOT contribute return declarations.
                "w1-ret-unreachable": { id: "w1-ret-unreachable", ...fnReturnNode() },
            },
            edges: [],
        }),
        // Inactive revision: owner record points at bp-w1-style active id, so this is ignored.
        "bp-w1-stale": graphBlueprint("bp-w1-stale", { kind: "widgetMain", surfaceId: "s1", elementId: "button" }, {
            nodes: { "stale-head": { id: "stale-head", ...fnHeadNode("StaleFn") } },
            edges: [],
        }),
    };
    return {
        schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
        blueprints,
        ownerRecords: {
            [ownerRefToIndexKey({ kind: "globalMain" })]: {
                activeBlueprintId: "bp-global",
                privateBlueprintIds: ["bp-global"],
            },
            [ownerRefToIndexKey({ kind: "surfaceMain", surfaceId: "s1" })]: {
                activeBlueprintId: "bp-s1",
                privateBlueprintIds: ["bp-s1"],
            },
            [ownerRefToIndexKey({ kind: "widgetMain", surfaceId: "s1", elementId: "button" })]: {
                activeBlueprintId: "bp-w1",
                privateBlueprintIds: ["bp-w1", "bp-w1-stale"],
            },
        },
    };
}

function testUiDocument(): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [
            {
                id: "s1",
                name: "Menu",
                host: "app",
                kind: "appSurface",
                designSize: { width: 320, height: 180 },
                rootElementId: "root",
            },
        ],
        elements: {
            root: { id: "root", type: "nl.root", parentId: null, childrenIds: ["button"], layout: { x: 0, y: 0, width: 320, height: 180 } },
            button: { id: "button", type: "nl.button", name: "Confirm", parentId: "root", childrenIds: [], layout: { x: 0, y: 0, width: 80, height: 24 } },
        },
    };
}

describe("fnCatalog", () => {
    it("collects declarations from active graph blueprints with params and reachable returns", () => {
        const decls = collectDeclaredBlueprintFns(testDocument());
        const byName = new Map(decls.map(d => [d.name, d]));

        expect([...byName.keys()].sort()).toEqual(["GlobalFn", "SurfaceFn", "WidgetFn"]);
        expect(byName.get("StaleFn")).toBeUndefined();

        const surfaceFn = byName.get("SurfaceFn")!;
        expect(surfaceFn.params).toEqual([{ pinId: "param_1_value", name: "count", valueType: "integer" }]);
        expect(surfaceFn.returns).toEqual([{ pinId: "ret_1_value", name: "result", valueType: "string" }]);

        // Return node not exec-reachable from the head contributes nothing.
        expect(byName.get("WidgetFn")!.returns).toEqual([]);
    });

    it("round-trips fn refs and rejects malformed values", () => {
        const ref = createBlueprintFnRef("bp:with:colons", "head/1");
        expect(parseBlueprintFnRef(ref)).toEqual({ blueprintId: "bp:with:colons", headNodeId: "head/1" });
        expect(parseBlueprintFnRef("")).toBeNull();
        expect(parseBlueprintFnRef("not-a-ref")).toBeNull();
        expect(parseBlueprintFnRef(undefined)).toBeNull();
    });

    it("resolves declarations by ref and ignores stale or unknown targets", () => {
        const doc = testDocument();
        const decl = findBlueprintFnByRef(doc, createBlueprintFnRef("bp-s1", "s1-head"));
        expect(decl?.name).toBe("SurfaceFn");
        expect(findBlueprintFnByRef(doc, createBlueprintFnRef("bp-s1", "missing"))).toBeNull();
        expect(findBlueprintFnByRef(doc, createBlueprintFnRef("bp-w1-stale", "stale-head"))).toBeNull();
    });

    it("applies the scoping matrix", () => {
        const globalOwner: BlueprintOwnerRef = { kind: "globalMain" };
        const surfaceDecl: BlueprintOwnerRef = { kind: "surfaceMain", surfaceId: "s1" };
        const widgetDecl: BlueprintOwnerRef = { kind: "widgetMain", surfaceId: "s1", elementId: "button" };

        const callerSurfaceS1: BlueprintOwnerRef = { kind: "surfaceMain", surfaceId: "s1" };
        const callerWidgetS1: BlueprintOwnerRef = { kind: "widgetMain", surfaceId: "s1", elementId: "other" };
        const callerValueS1: BlueprintOwnerRef = { kind: "widgetValue", surfaceId: "s1", elementId: "other", propPath: "props.text" };
        const callerWidgetS2: BlueprintOwnerRef = { kind: "widgetMain", surfaceId: "s2", elementId: "x" };
        const callerComponent: BlueprintOwnerRef = { kind: "componentWidgetMain", componentId: "c", elementId: "x" };

        // Global decls: visible everywhere (incl. widgetValue as host-widget identity).
        for (const caller of [globalOwner, callerSurfaceS1, callerWidgetS1, callerValueS1, callerWidgetS2]) {
            expect(isBlueprintFnVisibleToOwner(globalOwner, caller)).toBe(true);
        }
        // Surface/widget decls: same surface only.
        for (const decl of [surfaceDecl, widgetDecl]) {
            expect(isBlueprintFnVisibleToOwner(decl, callerSurfaceS1)).toBe(true);
            expect(isBlueprintFnVisibleToOwner(decl, callerWidgetS1)).toBe(true);
            expect(isBlueprintFnVisibleToOwner(decl, callerValueS1)).toBe(true);
            expect(isBlueprintFnVisibleToOwner(decl, callerWidgetS2)).toBe(false);
            expect(isBlueprintFnVisibleToOwner(decl, globalOwner)).toBe(false);
        }
        // Component blueprints are out of scope in v1.
        expect(isBlueprintFnVisibleToOwner(globalOwner, callerComponent)).toBe(false);
        expect(isBlueprintFnVisibleToOwner(widgetDecl, callerComponent)).toBe(false);
    });

    it("lists dropdown options with scope-disambiguated labels", () => {
        const options = listCallableBlueprintFnOptions({
            blueprintDocument: testDocument(),
            uiDocument: testUiDocument(),
            caller: { kind: "widgetMain", surfaceId: "s1", elementId: "other" },
        });
        expect(options.map(o => o.label)).toEqual(["GlobalFn (Global)", "SurfaceFn (Menu)", "WidgetFn (Confirm)"]);

        const globalOnly = listCallableBlueprintFnOptions({
            blueprintDocument: testDocument(),
            uiDocument: testUiDocument(),
            caller: { kind: "globalMain" },
        });
        expect(globalOnly.map(o => o.label)).toEqual(["GlobalFn (Global)"]);
    });

    it("detects stale signature snapshots", () => {
        const doc = testDocument();
        const decl = findBlueprintFnByRef(doc, createBlueprintFnRef("bp-s1", "s1-head"))!;
        const snapshot = buildBlueprintFnSignatureSnapshot(decl);

        expect(isBlueprintFnSnapshotStale(snapshot, decl)).toBe(false);
        expect(isBlueprintFnSnapshotStale(undefined, decl)).toBe(true);
        expect(isBlueprintFnSnapshotStale({ ...snapshot, name: "Renamed" }, decl)).toBe(true);
        expect(
            isBlueprintFnSnapshotStale(
                {
                    ...snapshot,
                    params: [{ pinId: "param_1_value", name: "count", valueType: "string" }],
                },
                decl,
            ),
        ).toBe(true);
    });
});
