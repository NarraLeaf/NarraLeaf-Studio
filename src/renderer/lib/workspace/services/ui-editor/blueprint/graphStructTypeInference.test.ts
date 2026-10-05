/**
 * Struct types on blueprint pins: what an ending is, as far as the editor can follow it.
 *
 * The runtime moves the same values it always did; these are the editor's promises about them - that
 * `Get Endings` hands out endings, that filtering them still hands out endings, that one of them has
 * `isReached`, and that a reader pointed at an ending keeps reading endings once its wire is gone.
 */

import { beforeAll, describe, expect, it } from "vitest";
import type { BlueprintGraphIr } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_PARAM_FIELD,
    BLUEPRINT_NODE_PARAM_FIELD_STRUCT,
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_FILTER,
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_FIRST,
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_LENGTH,
    BLUEPRINT_NODE_TYPE_DATA_JSON_GET,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK,
    BLUEPRINT_NODE_TYPE_GAME_GET_ENDINGS,
    BLUEPRINT_NODE_TYPE_GAME_HISTORY_GET,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD,
    BLUEPRINT_NODE_TYPE_LOG,
    BLUEPRINT_NODE_PARAM_EVENT_HEAD_PREFERENCE_KEY,
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_GET,
    BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE,
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_PROPERTY,
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_PROPERTY,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_PREFERENCE_CHANGED,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_PREFERENCE_CHANGED,
    BLUEPRINT_NODE_TYPE_FLOW_FOR_EACH,
    BLUEPRINT_NODE_TYPE_MATH_ADD,
    BLUEPRINT_NODE_TYPE_PERSISTENT_GET,
    BLUEPRINT_NODE_TYPE_SAVED_GET,
    BLUEPRINT_NODE_TYPE_STRING_SPLIT,
} from "@shared/types/blueprint/graph";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import type { UIStructDef } from "@shared/types/ui-editor/struct";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { blueprintNodeRegistry } from "@/lib/ui-editor/blueprint-nodes/BlueprintNodeRegistry";
import { isValidBlueprintPinConnection } from "@/lib/ui-editor/blueprint-nodes/connectionPolicy";
import {
    analyzeBlueprintStructTypes,
    buildBlueprintStructTypeContext,
    pinBlueprintFieldReaderStruct,
    withInferredBlueprintStructTypes,
} from "./graphStructTypeInference";
import { validateBlueprintGraphIr } from "./graphValidation";
import { blueprintValueTypeForVariable, withInferredBlueprintVariableValueTypeParam } from "./graphVariableTypeInference";

beforeAll(() => {
    registerCoreBlueprintNodes();
});

type NodeSpec = { type: string; params?: Record<string, unknown> };

function graph(nodes: Record<string, NodeSpec>, edges: string[]): BlueprintGraphIr {
    return {
        nodes: Object.fromEntries(
            Object.entries(nodes).map(([id, spec]) => [id, { id, type: spec.type, params: spec.params ?? {} }]),
        ),
        edges: edges.map(edge => {
            const [from, to] = edge.split("->").map(part => part.trim());
            const [fromNode, fromPort] = from!.split(".");
            const [toNode, toPort] = to!.split(".");
            return { from: { nodeId: fromNode!, port: fromPort! }, to: { nodeId: toNode!, port: toPort! } };
        }),
    };
}

/** A pin's type the way every consumer reads it: off the effective pins of the typed graph. */
function pinType(ir: BlueprintGraphIr, nodeId: string, pinId: string, kind: "input" | "output"): string | undefined {
    const typed = withInferredBlueprintStructTypes(ir, buildBlueprintStructTypeContext({}));
    const node = typed.nodes![nodeId]!;
    return blueprintNodeRegistry
        .resolveCatalogEntryForNode(node.type, node.params)
        .pins.find(pin => pin.id === pinId && pin.kind === kind)?.valueType;
}

const ENDINGS_CHAIN = () =>
    graph(
        {
            endings: { type: BLUEPRINT_NODE_TYPE_GAME_GET_ENDINGS },
            reached: { type: BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_FILTER, params: { key: "isReached" } },
            first: { type: BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_FIRST },
            name: { type: BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD, params: { field: "name" } },
        },
        ["endings.endings -> reached.array", "reached.result -> first.array", "first.item -> name.object"],
    );

describe("types that follow the wires", () => {
    it("types an engine shape at its source", () => {
        expect(pinType(ENDINGS_CHAIN(), "endings", "endings", "output")).toBe("array<struct:nl.ending>");
    });

    it("passes the item type through the array nodes", () => {
        const ir = ENDINGS_CHAIN();
        expect(pinType(ir, "reached", "result", "output")).toBe("array<struct:nl.ending>");
        expect(pinType(ir, "first", "item", "output")).toBe("struct:nl.ending");
    });

    it("types a reader's output by the field it names", () => {
        expect(pinType(ENDINGS_CHAIN(), "name", "value", "output")).toBe("string");
        const isReached = ENDINGS_CHAIN();
        isReached.nodes!.name!.params = { field: "isReached" };
        expect(pinType(isReached, "name", "value", "output")).toBe("boolean");
    });

    it("gives a keyed array node's value the type of the field its key names", () => {
        const ir = ENDINGS_CHAIN();
        const typed = withInferredBlueprintStructTypes(ir, {});
        const node = typed.nodes!.reached!;
        const value = blueprintNodeRegistry
            .resolveCatalogEntryForNode(node.type, node.params)
            .pins.find(pin => pin.id === "value" && pin.kind === "input");
        expect(value?.valueType).toBe("boolean");
        // The tick box on the card is what replaces wiring a Boolean node into it.
        expect(value?.allowInlineLiteral).toBe(true);
    });

    it("leaves an array nobody typed as it was", () => {
        const ir = graph(
            { first: { type: BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_FIRST } },
            [],
        );
        expect(pinType(ir, "first", "item", "output")).toBe("json");
    });

    it("never types a pin upstream from what reads it", () => {
        const reader = ENDINGS_CHAIN();
        const without = graph({ endings: { type: BLUEPRINT_NODE_TYPE_GAME_GET_ENDINGS } }, []);
        expect(pinType(reader, "endings", "endings", "output")).toBe(pinType(without, "endings", "endings", "output"));
    });

    it("answers unknown for a node that closes a loop instead of looping", () => {
        const ir = graph(
            {
                a: { type: BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_FILTER },
                b: { type: BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_FILTER },
            },
            ["a.result -> b.array", "b.result -> a.array"],
        );
        expect(() => analyzeBlueprintStructTypes(ir, {})).not.toThrow();
    });
});

describe("what a field reader reads", () => {
    const LIST_STRUCT: UIStructDef = {
        id: "rowShape",
        fields: [{ id: "f1", key: "title", type: "string" }, { id: "f2", key: "unlocked", type: "boolean" }],
    };
    const LIST = { id: "list", type: "nl.list", props: { itemStructId: "rowShape" } } as unknown as UIElement;
    const LABEL = { id: "label", type: "nl.text", parentId: "list", props: {} } as unknown as UIElement;
    const DOCUMENT = {
        elements: { list: LIST, label: LABEL },
        structs: { rowShape: LIST_STRUCT },
    } as unknown as UIDocument;

    const reader = (params: Record<string, unknown>) =>
        graph({ read: { type: BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD, params } }, []);

    it("reads the row it sits in when nothing is wired and nothing pinned it", () => {
        const ctx = buildBlueprintStructTypeContext({ uiDocument: DOCUMENT, widgetElement: LABEL });
        const info = analyzeBlueprintStructTypes(reader({ field: "f2" }), ctx).get("read");
        expect(info?.readerSource).toBe("row");
        expect(info?.struct?.id).toBe("rowShape");
        expect(info?.pinTypes.value).toBe("boolean");
    });

    it("has nothing to read outside a row", () => {
        const loose = { id: "loose", type: "nl.text", props: {} } as unknown as UIElement;
        const ctx = buildBlueprintStructTypeContext({
            uiDocument: { ...DOCUMENT, elements: { ...DOCUMENT.elements, loose } } as UIDocument,
            widgetElement: loose,
        });
        expect(analyzeBlueprintStructTypes(reader({ field: "f2" }), ctx).get("read")?.readerSource).toBe("none");
    });

    it("keeps the shape it was pointed at once its wire is gone", () => {
        const ctx = buildBlueprintStructTypeContext({ uiDocument: DOCUMENT, widgetElement: LABEL });
        const info = analyzeBlueprintStructTypes(
            reader({ [BLUEPRINT_NODE_PARAM_FIELD_STRUCT]: "nl.ending", field: "isReached" }),
            ctx,
        ).get("read");
        // Not the row, even though a row is in scope: an orphan reads its own shape or nothing.
        expect(info?.readerSource).toBe("orphan");
        expect(info?.struct?.id).toBe("nl.ending");
        expect(pinType(reader({ [BLUEPRINT_NODE_PARAM_FIELD_STRUCT]: "nl.ending" }), "read", "object", "input")).toBe(
            "struct:nl.ending",
        );
    });

    it("requires its input only once it has a shape of its own", () => {
        const optional = (params: Record<string, unknown>) =>
            blueprintNodeRegistry
                .resolveCatalogEntryForNode(BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD, params)
                .pins.find(pin => pin.id === "object")?.optional;
        expect(optional({})).toBe(true);
        expect(optional({ [BLUEPRINT_NODE_PARAM_FIELD_STRUCT]: "nl.ending" })).toBe(false);
    });
});

describe("pointing a reader at the first shape wired in", () => {
    const wiring = { source: "first", sourceHandle: "item", target: "read", targetHandle: "object" };

    it("pins the reader the wire lands on, and keeps a field the shape has", () => {
        const ir = graph(
            {
                endings: { type: BLUEPRINT_NODE_TYPE_GAME_GET_ENDINGS },
                first: { type: BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_FIRST },
                read: { type: BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD, params: { field: "name" } },
            },
            ["endings.endings -> first.array", "first.item -> read.object"],
        );
        expect(pinBlueprintFieldReaderStruct(ir, wiring)).toBe(true);
        expect(ir.nodes!.read!.params).toMatchObject({ [BLUEPRINT_NODE_PARAM_FIELD_STRUCT]: "nl.ending", field: "name" });
    });

    it("clears a field the new shape does not have", () => {
        const ir = graph(
            {
                endings: { type: BLUEPRINT_NODE_TYPE_GAME_GET_ENDINGS },
                first: { type: BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_FIRST },
                read: { type: BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD, params: { field: "title" } },
            },
            ["endings.endings -> first.array", "first.item -> read.object"],
        );
        pinBlueprintFieldReaderStruct(ir, wiring);
        expect(ir.nodes!.read!.params?.[BLUEPRINT_NODE_PARAM_FIELD]).toBeUndefined();
    });

    it("leaves a reader that already has a shape alone", () => {
        const ir = graph(
            {
                history: { type: BLUEPRINT_NODE_TYPE_GAME_HISTORY_GET },
                first: { type: BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_FIRST },
                read: {
                    type: BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD,
                    params: { [BLUEPRINT_NODE_PARAM_FIELD_STRUCT]: "nl.ending", field: "name" },
                },
            },
            ["history.entries -> first.array", "first.item -> read.object"],
        );
        expect(pinBlueprintFieldReaderStruct(ir, wiring)).toBe(false);
        expect(ir.nodes!.read!.params?.[BLUEPRINT_NODE_PARAM_FIELD_STRUCT]).toBe("nl.ending");
    });
});

describe("which wires a struct pin takes", () => {
    const connects = (ir: BlueprintGraphIr, from: string, to: string): boolean => {
        const typed = withInferredBlueprintStructTypes(ir, {});
        const [fromNode, fromPort] = from.split(".");
        const [toNode, toPort] = to.split(".");
        return isValidBlueprintPinConnection({
            sourceType: typed.nodes![fromNode!]!.type,
            sourcePort: fromPort!,
            targetType: typed.nodes![toNode!]!.type,
            targetPort: toPort!,
            sourceParams: typed.nodes![fromNode!]!.params,
            targetParams: typed.nodes![toNode!]!.params,
        });
    };

    it("still feeds a typed array everywhere a plain one went", () => {
        const ir = graph(
            {
                endings: { type: BLUEPRINT_NODE_TYPE_GAME_GET_ENDINGS },
                count: { type: BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_LENGTH },
                json: { type: BLUEPRINT_NODE_TYPE_DATA_JSON_GET },
            },
            [],
        );
        expect(connects(ir, "endings.endings", "count.array")).toBe(true);
        expect(connects(ir, "endings.endings", "json.json")).toBe(true);
    });

    it("still feeds a struct into an untyped object pin", () => {
        const ir = graph(
            {
                endings: { type: BLUEPRINT_NODE_TYPE_GAME_GET_ENDINGS },
                first: { type: BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_FIRST },
                json: { type: BLUEPRINT_NODE_TYPE_DATA_JSON_GET },
            },
            ["endings.endings -> first.array"],
        );
        expect(connects(ir, "first.item", "json.json")).toBe(true);
    });

    it("refuses untyped json into a reader, and another shape into a pinned one", () => {
        const ir = graph(
            {
                untyped: { type: BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_FIRST },
                history: { type: BLUEPRINT_NODE_TYPE_GAME_HISTORY_GET },
                entry: { type: BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_FIRST },
                endingReader: {
                    type: BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD,
                    params: { [BLUEPRINT_NODE_PARAM_FIELD_STRUCT]: "nl.ending" },
                },
                anyReader: { type: BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD },
            },
            ["history.entries -> entry.array"],
        );
        expect(connects(ir, "untyped.item", "anyReader.object")).toBe(false);
        expect(connects(ir, "entry.item", "anyReader.object")).toBe(true);
        expect(connects(ir, "entry.item", "endingReader.object")).toBe(false);
    });
});

describe("what the canvas says about fields", () => {
    const live = (nodes: Record<string, NodeSpec>, edges: string[]) =>
        graph(
            { head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK }, log: { type: BLUEPRINT_NODE_TYPE_LOG }, ...nodes },
            ["head.then -> log.in", ...edges],
        );
    const codes = (ir: BlueprintGraphIr, uiDocument: UIDocument | null = { elements: {} } as unknown as UIDocument) =>
        validateBlueprintGraphIr(ir, { blueprintId: "bp", graphKind: "event", graphId: "g", uiDocument })
            .filter(item => item.target?.kind === "node")
            .map(item => `${item.code}@${(item.target as { nodeId: string }).nodeId}`);

    it("names a field the shape does not have", () => {
        const ir = live(
            {
                endings: { type: BLUEPRINT_NODE_TYPE_GAME_GET_ENDINGS },
                first: { type: BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_FIRST },
                read: { type: BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD, params: { struct: "nl.ending", field: "title" } },
            },
            ["endings.endings -> first.array", "first.item -> read.object", "read.value -> log.value"],
        );
        expect(codes(ir)).toContain("node.field_missing@read");
    });

    it("names a key that is not a field of the items", () => {
        const ir = live(
            {
                endings: { type: BLUEPRINT_NODE_TYPE_GAME_GET_ENDINGS },
                reached: { type: BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_FILTER, params: { key: "isreached" } },
                count: { type: BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_LENGTH },
            },
            ["endings.endings -> reached.array", "reached.result -> count.array", "count.length -> log.value"],
        );
        expect(codes(ir)).toContain("node.key_not_a_field@reached");
    });

    it("says a reader outside any row has nothing connected, and a pinned one that lost its wire the same", () => {
        const loose = live(
            { read: { type: BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD, params: { field: "name" } } },
            ["read.value -> log.value"],
        );
        expect(codes(loose)).toContain("node.input_missing@read");
        const orphan = live(
            { read: { type: BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD, params: { struct: "nl.ending", field: "name" } } },
            ["read.value -> log.value"],
        );
        expect(codes(orphan).filter(code => code === "node.input_missing@read")).toHaveLength(1);
    });

    it("says nothing about an unwired reader when there was no document to tell whether a row is in scope", () => {
        const ir = live(
            { read: { type: BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD, params: { field: "name" } } },
            ["read.value -> log.value"],
        );
        expect(codes(ir, null)).not.toContain("node.input_missing@read");
    });
});

describe("types a node's own select picks", () => {
    it("types Get Property by the property it reads", () => {
        const of = (property: string) =>
            pinType(graph({ get: { type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_PROPERTY, params: { property } } }, []), "get", "value", "output");
        expect(of("position")).toBe("Vector2D");
        expect(of("size")).toBe("Vector2D");
        expect(of("bounds")).toBe("Rect");
        expect(of("opacity")).toBe("float");
        expect(of("visible")).toBe("boolean");
        expect(of("nonsense")).toBe("any");
    });

    it("types Set Property's value without giving the card a second editor for it", () => {
        const typed = withInferredBlueprintStructTypes(
            graph({ set: { type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_PROPERTY, params: { property: "opacity" } } }, []),
            buildBlueprintStructTypeContext({}),
        );
        const pin = blueprintNodeRegistry
            .resolveCatalogEntryForNode(BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_PROPERTY, typed.nodes!.set!.params)
            .pins.find(candidate => candidate.id === "value");
        expect(pin?.valueType).toBe("float");
        expect(pin?.allowInlineLiteral).toBeFalsy();
    });

    it("types a preference's change by the preference, and leaves any preference's change json", () => {
        const one = graph(
            { head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_PREFERENCE_CHANGED, params: { [BLUEPRINT_NODE_PARAM_EVENT_HEAD_PREFERENCE_KEY]: "bgmVolume" } } },
            [],
        );
        expect(pinType(one, "head", "value", "output")).toBe("float");
        expect(pinType(one, "head", "previousValue", "output")).toBe("float");
        const any = graph({ head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_PREFERENCE_CHANGED } }, []);
        expect(pinType(any, "head", "value", "output")).toBe("json");
    });

    it("wires a typed preference into a number, and still into the json it went to before", () => {
        const ir = graph(
            {
                head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_PREFERENCE_CHANGED, params: { [BLUEPRINT_NODE_PARAM_EVENT_HEAD_PREFERENCE_KEY]: "bgmVolume" } },
            },
            [],
        );
        const typed = withInferredBlueprintStructTypes(ir, buildBlueprintStructTypeContext({}));
        const wire = (targetType: string, targetPort: string) =>
            isValidBlueprintPinConnection({
                sourceType: BLUEPRINT_NODE_TYPE_EVENT_HEAD_PREFERENCE_CHANGED,
                sourcePort: "value",
                sourceParams: typed.nodes!.head!.params,
                targetType,
                targetPort,
                targetParams: {},
            });
        expect(wire(BLUEPRINT_NODE_TYPE_MATH_ADD, "a")).toBe(true);
        expect(wire(BLUEPRINT_NODE_TYPE_DATA_JSON_GET, "json")).toBe(true);
    });
});

describe("saved variables", () => {
    const SAVED = [{ id: "affection", valueType: "number" }, { id: "metAlice", valueType: "boolean" }];

    it("types Get and Set Saved Var by the variable's declaration, a number as a float", () => {
        const ir = graph(
            {
                get: { type: BLUEPRINT_NODE_TYPE_SAVED_GET, params: { savedVariableId: "affection" } },
                flag: { type: BLUEPRINT_NODE_TYPE_SAVED_GET, params: { savedVariableId: "metAlice" } },
                unknown: { type: BLUEPRINT_NODE_TYPE_SAVED_GET, params: { savedVariableId: "gone" } },
            },
            [],
        );
        const typed = withInferredBlueprintStructTypes(ir, buildBlueprintStructTypeContext({ savedVariables: SAVED }));
        const out = (nodeId: string) =>
            blueprintNodeRegistry
                .resolveCatalogEntryForNode(BLUEPRINT_NODE_TYPE_SAVED_GET, typed.nodes![nodeId]!.params)
                .pins.find(pin => pin.id === "value")?.valueType;
        expect(out("get")).toBe("float");
        expect(out("flag")).toBe("boolean");
        expect(out("unknown")).toBe("any");
    });

    it("does not make a story condition that returns a number variable an error it was not before", () => {
        const ir = graph(
            {
                get: { type: BLUEPRINT_NODE_TYPE_SAVED_GET, params: { savedVariableId: "affection" } },
                ret: { type: BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE },
            },
            ["get.value -> ret.value"],
        );
        const findings = validateBlueprintGraphIr(ir, {
            blueprintId: "bp",
            graphKind: "event",
            graphId: "main",
            blueprintOwner: { kind: "storyAction", blueprintId: "bp", mode: "condition" },
            validSavedVariableIds: new Set(["affection"]),
            savedVariables: SAVED,
        });
        expect(findings.map(finding => finding.code)).not.toContain("condition.return_not_boolean");
    });

    it("reads a persistent number variable as a float", () => {
        expect(blueprintValueTypeForVariable("number")).toBe("float");
        expect(blueprintValueTypeForVariable("boolean")).toBe("boolean");
        expect(
            isValidBlueprintPinConnection({
                sourceType: BLUEPRINT_NODE_TYPE_PERSISTENT_GET,
                sourcePort: "value",
                sourceParams: withInferredBlueprintVariableValueTypeParam(
                    BLUEPRINT_NODE_TYPE_PERSISTENT_GET,
                    { persistentVariableId: "volume" },
                    { persistentVariables: [{ value: "volume", valueType: "number" }] },
                ),
                targetType: BLUEPRINT_NODE_TYPE_MATH_ADD,
                targetPort: "a",
                targetParams: {},
            }),
        ).toBe(true);
    });
});

describe("arrays of plain values, and looping over typed arrays", () => {
    it("hands out strings from Split, and one string from Array Get on it", () => {
        const ir = graph(
            { split: { type: BLUEPRINT_NODE_TYPE_STRING_SPLIT }, get: { type: BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_GET } },
            ["split.result -> get.array"],
        );
        expect(pinType(ir, "split", "result", "output")).toBe("array<string>");
        expect(pinType(ir, "get", "item", "output")).toBe("string");
    });

    it("gives For Each's item the type of what it loops over", () => {
        const ir = graph(
            { endings: { type: BLUEPRINT_NODE_TYPE_GAME_GET_ENDINGS }, each: { type: BLUEPRINT_NODE_TYPE_FLOW_FOR_EACH } },
            ["endings.endings -> each.items"],
        );
        expect(pinType(ir, "each", "item", "output")).toBe("struct:nl.ending");
        expect(pinType(graph({ each: { type: BLUEPRINT_NODE_TYPE_FLOW_FOR_EACH } }, []), "each", "item", "output")).toBe("json");
    });
});
