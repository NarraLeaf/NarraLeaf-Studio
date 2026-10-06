/**
 * The types a graph's pins carry that their declarations leave open, worked out in the editor.
 *
 * Four kinds of node take their types from somewhere else, and this is the one place any of them is
 * answered:
 *
 *  - **The array nodes** (`elementTypeFlow` on their definitions) hand back the items they were
 *    given, so their outputs are typed by what is wired into them. `Get Endings` answers endings,
 *    `Array Filter By Key` on that answers endings too, and `Array Get` on that answers one ending -
 *    which is what lets a field reader at the end of the chain offer an ending's fields.
 *  - **Get Field** reads one field of a struct. Which struct is a persisted param once the node has
 *    been pointed at one (see `effectivePins.ts`); before that, it is whatever is wired in, or - left
 *    unwired inside a list row - the row's own shape.
 *  - **Nodes typed by their own select** (`paramPinTypes`): Get Property set to Position answers a
 *    Vector2D, On Preference Changed for the music volume a number.
 *  - **Get / Set Saved Var**, typed by the variable's declaration in the project's variable table.
 *  - **The list nodes and item heads** (`listRowTypes`), whose rows are the rows of the list they act
 *    on: Item Click on an ending list hands out an ending. Rows wired in are compared with that shape.
 *
 * The answers are stamped onto a copy of each node's params under
 * `BLUEPRINT_NODE_PARAM_INFERRED_PIN_TYPES`, so every consumer that already reads pins through the
 * effective-pin resolver (the canvas, connection checks, the validator, the command-line checker)
 * sees the typed pins without being told about structs. Nothing here is written to the document and
 * nothing is read at run time: the runtime moves the same values whatever the editor calls them.
 *
 * One direction only, from a source towards its readers. Nothing is ever inferred backwards from a
 * reader to what feeds it, so a change downstream can never retype a pin upstream - the property
 * that keeps a wire from turning invalid because of something done at its other end.
 *
 * Comments in English per project convention.
 */

import type { BlueprintGraphEdge, BlueprintGraphIr, BlueprintGraphNode } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_PARAM_FIELD,
    BLUEPRINT_NODE_PARAM_FIELD_STRUCT,
    BLUEPRINT_NODE_PARAM_INFERRED_PIN_TYPES,
    BLUEPRINT_NODE_PARAM_INFERRED_READS_ROW,
    BLUEPRINT_NODE_PARAM_INFERRED_TARGET_WIRED,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD,
    BLUEPRINT_NODE_TYPE_FRAME_GET_PARAM,
    BLUEPRINT_NODE_TYPE_SAVED_GET,
    BLUEPRINT_NODE_TYPE_SAVED_SET,
} from "@shared/types/blueprint/graph";
import { getActiveUIPageParam, getActiveUIPageParams, uiPageParamPinType } from "@shared/types/ui-editor/pageParams";
import { blueprintArrayElementType, blueprintArrayValueType } from "@shared/types/blueprint/valueTypes";
import { resolveUIStruct } from "@shared/types/ui-editor/builtinStructs";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import { findOwningListItemTemplate, resolveListRowContext } from "@shared/types/ui-editor/listItemContext";
import { isListLikeWidgetType } from "@shared/types/ui-editor/list";
import type { BlueprintOwnerRef } from "@shared/types/blueprint/document";
import { resolveListItemContextAvailable } from "@/lib/ui-editor/blueprint-nodes/graphContext";
import {
    findUIStructField,
    uiStructFieldValueType,
    uiStructIdFromValueType,
    uiStructValueType,
    type UIStructDef,
    type UIStructField,
} from "@shared/types/ui-editor/struct";
import { readBlueprintElementRefParams } from "@/lib/ui-editor/blueprint-nodes/built-in/elementRefUtils";
import { blueprintNodeRegistry } from "@/lib/ui-editor/blueprint-nodes/BlueprintNodeRegistry";
import { BLUEPRINT_FIELD_READER_INPUT_PIN, uiPageParamPinId } from "@/lib/ui-editor/blueprint-nodes/effectivePins";
import type { BlueprintNodeDef } from "@/lib/ui-editor/blueprint-nodes/types";
import { blueprintValueTypeForVariable } from "./graphVariableTypeInference";

export type BlueprintStructTypeInferenceContext = {
    /**
     * Resolves a struct id to its fields. Defaults to the shapes the engine owns; an editor passes one
     * that also reads the interface document, where a list's own shape lives.
     */
    resolveStruct?: (structId: string) => UIStructDef | null;
    /** Whether a list row is in scope while this graph runs (see `isListItemScopeReachable`). */
    rowAvailable?: boolean;
    /** The shape of that row, when its list declares one. */
    rowStruct?: UIStructDef | null;
    /** A saved variable's declared type as a pin type, by variable id; unknown ids answer nothing. */
    savedVariableType?: (variableId: string) => string | undefined;
    /**
     * A parameter of the page this graph belongs to, by id, as a pin type - what `Get Page Param`
     * reads. Unknown ids, and a graph that belongs to no page, answer nothing.
     */
    pageParamType?: (paramId: string) => string | undefined;
    /**
     * The shape a list's rows have, by the list's element id - or, given null, of the list this graph
     * belongs to. `undefined` when there is no such list to ask, `null` when it declares no shape.
     */
    listRowStructId?: (listElementId: string | null) => string | null | undefined;
};

/**
 * What a field reader reads when the graph runs.
 *
 *  - `wire`: the value wired into `object`.
 *  - `row`: nothing is wired and nothing pinned the node to a shape, and a list row is in scope.
 *  - `orphan`: the node was pointed at a shape and has since lost its wire. It keeps the shape and
 *    reads nothing until a value of that shape is wired in again.
 *  - `none`: unwired, unpinned and outside any row - there is nothing for it to read.
 */
export type BlueprintFieldReaderSource = "wire" | "row" | "orphan" | "none";

export type BlueprintNodeStructTypes = {
    /** Pin types worked out for this node, by pin id. */
    pinTypes: Record<string, string>;
    /**
     * The shape this node is about: the struct a field reader reads, or the item shape an array node
     * is passing along. Null when nothing upstream says.
     */
    struct: UIStructDef | null;
    /** The struct's id as a pin type spells it, when it has one. */
    structId: string | null;
    /** For a field reader only. */
    readerSource?: BlueprintFieldReaderSource;
    /** For a field reader only: the field it names, when the struct has it. */
    field?: UIStructField | null;
    /** For an array node with a key pin: the key is wired rather than typed, so it is unknown here. */
    keyWired?: boolean;
    /** For a list node: rows of another shape wired into one of its row inputs, and their type. */
    rowMismatch?: { pin: string; givenStructId: string; givenType: string };
    /** For a node that opens a page: its `Page` input is wired, so the page is the wire's. */
    targetWired?: boolean;
};

const EMPTY_INFO: BlueprintNodeStructTypes = Object.freeze({ pinTypes: {}, struct: null, structId: null });

function readParamString(params: Record<string, unknown> | undefined, key: string): string | undefined {
    const value = params?.[key];
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function defaultResolveStruct(structId: string): UIStructDef | null {
    return resolveUIStruct(null, structId);
}

function isSavedVariableNodeType(type: string): boolean {
    return type === BLUEPRINT_NODE_TYPE_SAVED_GET || type === BLUEPRINT_NODE_TYPE_SAVED_SET;
}

/** True for the node types this pass has an opinion about. */
export function isBlueprintStructTypedNodeType(type: string): boolean {
    if (
        type === BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD
        || type === BLUEPRINT_NODE_TYPE_FRAME_GET_PARAM
        || isSavedVariableNodeType(type)
    ) {
        return true;
    }
    const def = blueprintNodeRegistry.get(type);
    return Boolean(def?.elementTypeFlow || def?.paramPinTypes || def?.listRowTypes || def?.pageParamPins);
}

/** The pin a list node is told which list to act on through; see `listNodes.ts`. */
const LIST_TARGET_PIN = "list";

/**
 * Whether rows of one shape carry every field a list draws: each of the list's fields, by name and
 * type, is among theirs.
 *
 * Looser than the library's own equality (`structsAreCompatible`) on purpose. A list draws its rows
 * from its own fields, so rows that carry more - a gallery entry handed to a list that only shows the
 * name and the picture - draw exactly as the list says; only a field the rows lack, or carry as
 * another type, draws empty.
 */
function rowsCarryListFields(rows: UIStructDef, list: UIStructDef): boolean {
    return list.fields.every(field => rows.fields.some(candidate => candidate.key === field.key && candidate.type === field.type));
}

function withPinTypeStamp(
    params: Record<string, unknown> | undefined,
    pinTypes: Record<string, string>,
    readsRow = false,
    targetWired = false,
): Record<string, unknown> | undefined {
    const hasTypes = Object.keys(pinTypes).length > 0;
    const hasStamp =
        params !== undefined &&
        (BLUEPRINT_NODE_PARAM_INFERRED_PIN_TYPES in params
            || BLUEPRINT_NODE_PARAM_INFERRED_READS_ROW in params
            || BLUEPRINT_NODE_PARAM_INFERRED_TARGET_WIRED in params);
    if (!hasTypes && !readsRow && !targetWired && !hasStamp) {
        return params;
    }
    const next = { ...(params ?? {}) };
    if (hasTypes) {
        next[BLUEPRINT_NODE_PARAM_INFERRED_PIN_TYPES] = pinTypes;
    } else {
        delete next[BLUEPRINT_NODE_PARAM_INFERRED_PIN_TYPES];
    }
    if (readsRow) {
        next[BLUEPRINT_NODE_PARAM_INFERRED_READS_ROW] = true;
    } else {
        delete next[BLUEPRINT_NODE_PARAM_INFERRED_READS_ROW];
    }
    if (targetWired) {
        next[BLUEPRINT_NODE_PARAM_INFERRED_TARGET_WIRED] = true;
    } else {
        delete next[BLUEPRINT_NODE_PARAM_INFERRED_TARGET_WIRED];
    }
    return next;
}

/**
 * Work out every struct-typed node in a graph.
 *
 * Memoised per node and resolved on demand, sources first. A cycle - which a data graph should not
 * have, but a half-edited one can - answers "unknown" for the node that closes it rather than
 * looping.
 */
export function analyzeBlueprintStructTypes(
    ir: BlueprintGraphIr,
    ctx: BlueprintStructTypeInferenceContext = {},
): Map<string, BlueprintNodeStructTypes> {
    const nodes = ir.nodes ?? {};
    const resolveStruct = ctx.resolveStruct ?? defaultResolveStruct;
    const incoming = new Map<string, BlueprintGraphEdge>();
    for (const edge of ir.edges ?? []) {
        incoming.set(`${edge.to.nodeId}\0${edge.to.port}`, edge);
    }
    const done = new Map<string, BlueprintNodeStructTypes>();
    const visiting = new Set<string>();

    const outputType = (nodeId: string, port: string): string | undefined => {
        const node = nodes[nodeId];
        if (!node) {
            return undefined;
        }
        const info = infoFor(node);
        const params = withPinTypeStamp(node.params, info.pinTypes, false, info.targetWired === true);
        const entry = blueprintNodeRegistry.resolveCatalogEntryForNode(node.type, params);
        return entry.pins.find(pin => pin.id === port && pin.kind === "output")?.valueType;
    };

    const wiredType = (nodeId: string, port: string): string | undefined => {
        const edge = incoming.get(`${nodeId}\0${port}`);
        return edge ? outputType(edge.from.nodeId, edge.from.port) : undefined;
    };

    const structFor = (valueType: string | undefined): { struct: UIStructDef | null; structId: string | null } => {
        const structId = uiStructIdFromValueType(valueType);
        return { struct: structId ? resolveStruct(structId) : null, structId };
    };

    const analyzeFieldReader = (node: BlueprintGraphNode): BlueprintNodeStructTypes => {
        const fieldId = readParamString(node.params, BLUEPRINT_NODE_PARAM_FIELD);
        const pinned = readParamString(node.params, BLUEPRINT_NODE_PARAM_FIELD_STRUCT);
        const wired = incoming.has(`${node.id}\0${BLUEPRINT_FIELD_READER_INPUT_PIN}`);
        let readerSource: BlueprintFieldReaderSource = "none";
        let struct: UIStructDef | null = null;
        let structId: string | null = null;
        if (pinned) {
            readerSource = wired ? "wire" : "orphan";
            structId = pinned;
            struct = resolveStruct(pinned);
        } else if (wired) {
            readerSource = "wire";
            ({ struct, structId } = structFor(wiredType(node.id, BLUEPRINT_FIELD_READER_INPUT_PIN)));
        } else if (ctx.rowAvailable) {
            readerSource = "row";
            struct = ctx.rowStruct ?? null;
            structId = struct?.id ?? null;
        }
        const field = findUIStructField(struct, fieldId);
        return {
            pinTypes: field ? { value: uiStructFieldValueType(field.type) } : {},
            struct,
            structId,
            readerSource,
            field,
        };
    };

    const analyzeArrayNode = (node: BlueprintGraphNode): BlueprintNodeStructTypes => {
        const flow = blueprintNodeRegistry.get(node.type)?.elementTypeFlow;
        if (!flow) {
            return EMPTY_INFO;
        }
        const element = blueprintArrayElementType(wiredType(node.id, flow.input));
        if (!element) {
            return EMPTY_INFO;
        }
        const pinTypes: Record<string, string> = {};
        for (const [pinId, carries] of Object.entries(flow.outputs)) {
            pinTypes[pinId] = carries === "array" ? blueprintArrayValueType(element) : element;
        }
        const { struct, structId } = structFor(element);
        const keyWired = flow.keyPin ? incoming.has(`${node.id}\0${flow.keyPin}`) : false;
        if (flow.keyPin && struct && !keyWired) {
            const key = readParamString(node.params, flow.keyPin);
            const field = key ? struct.fields.find(candidate => candidate.key === key) : undefined;
            if (field) {
                for (const pinId of flow.keyValuePins ?? []) {
                    pinTypes[pinId] = uiStructFieldValueType(field.type);
                }
            }
        }
        return { pinTypes, struct, structId, keyWired };
    };

    const analyzeParamTypedNode = (
        node: BlueprintGraphNode,
        spec: NonNullable<BlueprintNodeDef["paramPinTypes"]>,
    ): BlueprintNodeStructTypes => {
        const option = readParamString(node.params, spec.param);
        const valueType = option !== undefined && Object.hasOwn(spec.types, option) ? spec.types[option] : undefined;
        if (!valueType) {
            return EMPTY_INFO;
        }
        return {
            pinTypes: Object.fromEntries(spec.pins.map(pinId => [pinId, valueType])),
            ...structFor(valueType),
        };
    };

    const analyzeSavedVariableNode = (node: BlueprintGraphNode): BlueprintNodeStructTypes => {
        const variableId = readParamString(node.params, "savedVariableId");
        const valueType = variableId ? ctx.savedVariableType?.(variableId) : undefined;
        return valueType ? { pinTypes: { value: valueType }, struct: null, structId: null } : EMPTY_INFO;
    };

    /**
     * A node that opens a page: whether its `Page` input is wired, and the shape of the rows each list
     * parameter of the picked page takes. Read from the published declarations, as the pins are.
     */
    const analyzePageParamWriter = (
        node: BlueprintGraphNode,
        spec: NonNullable<BlueprintNodeDef["pageParamPins"]>,
    ): BlueprintNodeStructTypes => {
        if (incoming.has(`${node.id}\0${spec.surfaceParam}`)) {
            return { pinTypes: {}, struct: null, structId: null, targetWired: true };
        }
        const pinTypes: Record<string, string> = {};
        for (const param of getActiveUIPageParams(readParamString(node.params, spec.surfaceParam))) {
            if (param.type === "list") {
                pinTypes[uiPageParamPinId(param.id)] = uiPageParamPinType(param);
            }
        }
        return Object.keys(pinTypes).length > 0 ? { pinTypes, struct: null, structId: null } : EMPTY_INFO;
    };

    const analyzePageParamReader = (node: BlueprintGraphNode): BlueprintNodeStructTypes => {
        const paramId = readParamString(node.params, "paramId");
        const valueType = paramId ? ctx.pageParamType?.(paramId) : undefined;
        return valueType ? { pinTypes: { value: valueType }, struct: null, structId: null } : EMPTY_INFO;
    };

    const analyzeListRowNode = (
        node: BlueprintGraphNode,
        spec: NonNullable<BlueprintNodeDef["listRowTypes"]>,
    ): BlueprintNodeStructTypes => {
        // The list a wire names, followed only through an element literal: anything else that hands
        // out a list is answered at run time, and guessing here would type rows by the wrong list.
        const listEdge = incoming.get(`${node.id}\0${LIST_TARGET_PIN}`);
        let listElementId: string | null = null;
        if (listEdge) {
            const ref = readBlueprintElementRefParams(nodes[listEdge.from.nodeId]?.params);
            if (!ref) {
                return EMPTY_INFO;
            }
            listElementId = ref.elementId;
        }
        const structId = ctx.listRowStructId?.(listElementId);
        if (!structId) {
            return EMPTY_INFO;
        }
        const struct = resolveStruct(structId);
        const rowType = uiStructValueType(structId);
        const typeOf = (carries: "item" | "array") => (carries === "array" ? blueprintArrayValueType(rowType) : rowType);
        const pinTypes: Record<string, string> = {};
        for (const [pinId, carries] of Object.entries({ ...spec.outputs, ...spec.inputs })) {
            pinTypes[pinId] = typeOf(carries);
        }
        let rowMismatch: BlueprintNodeStructTypes["rowMismatch"];
        for (const [pinId, carries] of Object.entries(spec.inputs ?? {})) {
            const given = wiredType(node.id, pinId);
            const givenStructId = uiStructIdFromValueType(carries === "array" ? blueprintArrayElementType(given) : given);
            if (!givenStructId || givenStructId === structId) {
                continue;
            }
            const givenStruct = resolveStruct(givenStructId);
            if (struct && givenStruct && !rowsCarryListFields(givenStruct, struct)) {
                rowMismatch = { pin: pinId, givenStructId, givenType: given as string };
                break;
            }
        }
        return { pinTypes, struct, structId, ...(rowMismatch ? { rowMismatch } : {}) };
    };

    const analyze = (node: BlueprintGraphNode): BlueprintNodeStructTypes => {
        if (node.type === BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD) {
            return analyzeFieldReader(node);
        }
        if (isSavedVariableNodeType(node.type)) {
            return analyzeSavedVariableNode(node);
        }
        if (node.type === BLUEPRINT_NODE_TYPE_FRAME_GET_PARAM) {
            return analyzePageParamReader(node);
        }
        const def = blueprintNodeRegistry.get(node.type);
        if (def?.pageParamPins) {
            return analyzePageParamWriter(node, def.pageParamPins);
        }
        if (def?.elementTypeFlow) {
            return analyzeArrayNode(node);
        }
        if (def?.listRowTypes) {
            return analyzeListRowNode(node, def.listRowTypes);
        }
        return def?.paramPinTypes ? analyzeParamTypedNode(node, def.paramPinTypes) : EMPTY_INFO;
    };

    function infoFor(node: BlueprintGraphNode): BlueprintNodeStructTypes {
        const cached = done.get(node.id);
        if (cached) {
            return cached;
        }
        if (visiting.has(node.id) || !isBlueprintStructTypedNodeType(node.type)) {
            return EMPTY_INFO;
        }
        visiting.add(node.id);
        const info = analyze(node);
        visiting.delete(node.id);
        done.set(node.id, info);
        return info;
    }

    for (const node of Object.values(nodes)) {
        if (isBlueprintStructTypedNodeType(node.type)) {
            infoFor(node);
        }
    }
    return done;
}

/**
 * The graph with every struct-typed node's worked-out pin types stamped on a copy of its params.
 *
 * Returns the same object when nothing needed stamping, so a caller memoising on the graph keeps
 * its cache for every graph that has no struct in it.
 */
export function withInferredBlueprintStructTypes(
    ir: BlueprintGraphIr,
    ctx: BlueprintStructTypeInferenceContext = {},
): BlueprintGraphIr {
    return applyBlueprintStructTypes(ir, analyzeBlueprintStructTypes(ir, ctx));
}

/** {@link withInferredBlueprintStructTypes} for a caller that also needs the analysis itself. */
export function applyBlueprintStructTypes(
    ir: BlueprintGraphIr,
    analysis: ReadonlyMap<string, BlueprintNodeStructTypes>,
): BlueprintGraphIr {
    if (analysis.size === 0) {
        return ir;
    }
    const nodes = ir.nodes ?? {};
    let changed = false;
    const nextNodes: Record<string, BlueprintGraphNode> = {};
    for (const [nodeId, node] of Object.entries(nodes)) {
        const info = analysis.get(nodeId);
        const params = info
            ? withPinTypeStamp(node.params, info.pinTypes, info.readerSource === "row", info.targetWired === true)
            : node.params;
        if (params !== node.params) {
            changed = true;
            nextNodes[nodeId] = { ...node, params };
        } else {
            nextNodes[nodeId] = node;
        }
    }
    return changed ? { ...ir, nodes: nextNodes } : ir;
}

/**
 * The context a graph attached to this element is typed in.
 *
 * Shapes resolve from the interface document first and the engine's own second (`resolveUIStruct`),
 * and the row is whichever list draws or owns the element - the one walk the palette, the inspector
 * and the diagnostics already share.
 */
export function buildBlueprintStructTypeContext(input: {
    uiDocument?: (Pick<UIDocument, "elements"> & Partial<Pick<UIDocument, "structs">>) | null;
    widgetElement?: UIElement | null;
    /** The blueprint's owner. Given, whether a row is in scope is the palette's own answer. */
    owner?: BlueprintOwnerRef;
    isComponentDefinitionGraph?: boolean;
    /** The project's saved variables; their declared types type Get / Set Saved Var. */
    savedVariables?: readonly { id: string; valueType?: string }[];
}): BlueprintStructTypeInferenceContext {
    const document = input.uiDocument ?? null;
    const savedTypes = new Map(
        (input.savedVariables ?? []).map(variable => [variable.id, blueprintValueTypeForVariable(variable.valueType)]),
    );
    // The graph's own list: the list it is attached to, or the list whose item template it is in -
    // the same answer the field pickers give.
    const ownList = document && input.widgetElement
        ? isListLikeWidgetType(input.widgetElement.type)
            ? input.widgetElement
            : (() => {
                  const owning = findOwningListItemTemplate(document, input.widgetElement);
                  return owning ? document.elements[owning.listElementId] ?? null : null;
              })()
        : null;
    const listRowStructId = (listElementId: string | null): string | null | undefined => {
        const list = listElementId ? document?.elements[listElementId] : ownList;
        if (!list || !isListLikeWidgetType(list.type)) {
            return undefined;
        }
        const structId = (list.props as Record<string, unknown> | undefined)?.itemStructId;
        return typeof structId === "string" && structId.trim() ? structId.trim() : null;
    };
    const resolveStruct = (structId: string) => resolveUIStruct(document, structId);
    const row = document && input.widgetElement ? resolveListRowContext(document, input.widgetElement) : null;
    return {
        resolveStruct,
        // The palette's rule, so an unwired reader reads a row exactly where the palette says a row
        // can be. Where nothing establishes the answer - no document to walk, a component definition
        // any instance of which may be the row - a row is not known to be absent, and an unwired
        // reader is a row reader of unknown shape rather than a reader with nothing to read.
        rowAvailable: input.owner
            ? resolveListItemContextAvailable({
                  owner: input.owner,
                  isComponentDefinitionGraph: input.isComponentDefinitionGraph,
                  uiDocument: document,
                  widgetElement: input.widgetElement,
              })
            : document ? row !== null : true,
        rowStruct: row?.structId ? resolveStruct(row.structId) : null,
        savedVariableType: variableId => savedTypes.get(variableId),
        pageParamType: paramId => {
            const param = getActiveUIPageParam(pageSurfaceIdOf(input.owner), paramId);
            return param ? uiPageParamPinType(param) : undefined;
        },
        listRowStructId,
    };
}

/** The page a blueprint belongs to, for the owners that belong to one; null for the rest. */
export function pageSurfaceIdOf(owner: BlueprintOwnerRef | undefined): string | null {
    return owner?.kind === "surfaceMain" || owner?.kind === "widgetMain" || owner?.kind === "widgetValue"
        ? owner.surfaceId
        : null;
}

/**
 * Point a field reader at the shape of the first struct wired into it.
 *
 * Only an unpinned reader is pointed - one placed from the palette, or one reading a list row. From
 * then on the shape is the node's own: unwiring it leaves the shape in place, and a value of another
 * shape is refused at the pin rather than quietly retyping the node and every wire after it. A field
 * the new shape does not have is cleared, so the picker asks for one instead of showing a name that
 * reads nothing.
 *
 * Mutates the target node's params; returns whether it did.
 */
export function pinBlueprintFieldReaderStruct(
    ir: Pick<BlueprintGraphIr, "nodes" | "edges">,
    connection: { source: string; sourceHandle: string; target: string; targetHandle: string },
    ctx: BlueprintStructTypeInferenceContext = {},
): boolean {
    const target = ir.nodes?.[connection.target];
    if (
        !target ||
        target.type !== BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD ||
        connection.targetHandle !== BLUEPRINT_FIELD_READER_INPUT_PIN ||
        readParamString(target.params, BLUEPRINT_NODE_PARAM_FIELD_STRUCT)
    ) {
        return false;
    }
    const typed = withInferredBlueprintStructTypes({ nodes: ir.nodes, edges: ir.edges }, ctx);
    const source = typed.nodes?.[connection.source];
    if (!source) {
        return false;
    }
    const valueType = blueprintNodeRegistry
        .resolveCatalogEntryForNode(source.type, source.params)
        .pins.find(pin => pin.id === connection.sourceHandle && pin.kind === "output")?.valueType;
    const structId = uiStructIdFromValueType(valueType);
    if (!structId) {
        return false;
    }
    const next: Record<string, unknown> = { ...(target.params ?? {}), [BLUEPRINT_NODE_PARAM_FIELD_STRUCT]: structId };
    const struct = (ctx.resolveStruct ?? defaultResolveStruct)(structId);
    if (!findUIStructField(struct, readParamString(next, BLUEPRINT_NODE_PARAM_FIELD))) {
        delete next[BLUEPRINT_NODE_PARAM_FIELD];
    }
    target.params = next;
    return true;
}
