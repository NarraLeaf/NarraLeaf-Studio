/**
 * List widget blueprint nodes.
 * Comments in English per project convention.
 */

import { isUIElementRefInScope } from "@shared/types/ui-editor/componentInstanceKey";
import { buildUIWidgetAddress } from "@shared/types/ui-editor/widgetAddress";
import {
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_APPEND_ITEM,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_CLEAR,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_GET_ITEMS,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_GET_SELECTED_INDEX,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_GET_SELECTED_ITEM,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_INSERT_ITEM,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_REFRESH_ITEMS,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_REMOVE_ITEM,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_REMOVE_ITEM_AT,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_SCROLL_TO_BOTTOM,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_SCROLL_TO_INDEX,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_SCROLL_TO_TOP,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_SET_ITEMS,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_SET_SELECTED_INDEX,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_SET_SELECTED_ITEM,
    BLUEPRINT_NODE_TYPE_LIST_APPEND_ITEM,
    BLUEPRINT_NODE_TYPE_LIST_CLEAR,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_COUNT,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_INDEX,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_FIND_ITEM_BY_FIELD,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_GET_ITEM_AT,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_GET_LENGTH,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_SET_ITEM_FIELD_AT,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_SORT_BY_FIELD,
    BLUEPRINT_NODE_TYPE_LIST_FIND_ITEM_BY_FIELD,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_AT,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_KEY,
    BLUEPRINT_NODE_TYPE_LIST_GET_LENGTH,
    BLUEPRINT_NODE_TYPE_LIST_SET_ITEM_FIELD_AT,
    BLUEPRINT_NODE_TYPE_LIST_SORT_BY_FIELD,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_PROPS,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEMS,
    BLUEPRINT_NODE_TYPE_LIST_GET_SELECTED_INDEX,
    BLUEPRINT_NODE_TYPE_LIST_GET_SELECTED_ITEM,
    BLUEPRINT_NODE_TYPE_LIST_INSERT_ITEM,
    BLUEPRINT_NODE_TYPE_LIST_REFRESH_ITEMS,
    BLUEPRINT_NODE_TYPE_LIST_REMOVE_ITEM,
    BLUEPRINT_NODE_TYPE_LIST_REMOVE_ITEM_AT,
    BLUEPRINT_NODE_TYPE_LIST_SCROLL_TO_BOTTOM,
    BLUEPRINT_NODE_TYPE_LIST_SCROLL_TO_INDEX,
    BLUEPRINT_NODE_TYPE_LIST_SCROLL_TO_TOP,
    BLUEPRINT_NODE_TYPE_LIST_GET_SCROLL_PROGRESS,
    BLUEPRINT_NODE_TYPE_LIST_GET_SCROLL_OFFSET,
    BLUEPRINT_NODE_TYPE_LIST_IS_SCROLLED_TO_END,
    BLUEPRINT_NODE_TYPE_LIST_IS_SCROLLED_TO_START,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_GET_SCROLL_PROGRESS,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_GET_SCROLL_OFFSET,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_IS_SCROLLED_TO_END,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_IS_SCROLLED_TO_START,
    BLUEPRINT_NODE_TYPE_LIST_SET_ITEMS,
    BLUEPRINT_NODE_TYPE_LIST_SET_SELECTED_INDEX,
    BLUEPRINT_NODE_TYPE_LIST_SET_SELECTED_ITEM,
} from "@shared/types/blueprint/graph";
import {
    BLUEPRINT_VALUE_TYPE_ARRAY,
    blueprintElementValueType,
} from "@shared/types/blueprint/valueTypes";
import {
    coerceUIStructFieldValue,
    findUIStructField,
    sortItemsByField,
    type UIStructDef,
} from "@shared/types/ui-editor/struct";
import { UI_LIST_LIKE_WIDGET_TYPES } from "@shared/types/ui-editor/list";
import { BlueprintGraphExecutionError } from "../../behavior-graph/GraphExecutionError";
import type { BlueprintNodeDef, BlueprintNodePinDef } from "../types";
import { requireHostApi } from "./hostApi";
import { resolveDataPinValue } from "./graphParamResolvers";
import { normalizeBlueprintElementRefValue } from "./elementRefUtils";
import { WIDGET_OWN_GRAPH_OWNER_KINDS } from "../types";

const READ_GRAPH_KINDS = ["event", "function", "macro"] as const;
const WRITE_GRAPH_KINDS = ["event", "macro"] as const;
const LIST_ELEMENT_TYPE = "nl.list";
const LIST_MAGIC_TARGET: NonNullable<BlueprintNodeDef["magicElementTarget"]> = {
    inputPinId: "list",
    elementTypes: [LIST_ELEMENT_TYPE],
};
// Self nodes are available on every list-like widget's own private blueprint (including the
// Game UI slot wrappers); Element-targeted derived nodes stay `nl.list`-only for now.
const LIST_SCOPE: BlueprintNodeDef["scope"] = {
    ownerKinds: [...WIDGET_OWN_GRAPH_OWNER_KINDS],
    widgetElementTypes: [...UI_LIST_LIKE_WIDGET_TYPES],
};

const execIn: BlueprintNodePinDef = { id: "in", kind: "input", semantic: "exec", label: "In" };
const execNext: BlueprintNodePinDef = { id: "next", kind: "output", semantic: "exec", label: "Next" };
const listIn: BlueprintNodePinDef = {
    id: "list",
    kind: "input",
    semantic: "data",
    valueType: blueprintElementValueType(LIST_ELEMENT_TYPE),
    label: "List",
};
const arrayIn = (id: string, label: string): BlueprintNodePinDef => ({
    id,
    kind: "input",
    semantic: "data",
    valueType: BLUEPRINT_VALUE_TYPE_ARRAY,
    label,
});
const anyIn = (id: string, label: string): BlueprintNodePinDef => ({
    id,
    kind: "input",
    semantic: "data",
    valueType: "any",
    label,
});
const intIn = (id: string, label: string): BlueprintNodePinDef => ({
    id,
    kind: "input",
    semantic: "data",
    valueType: "integer",
    label,
    allowInlineLiteral: true,
});
const out = (id: string, label: string, valueType: string): BlueprintNodePinDef => ({
    id,
    kind: "output",
    semantic: "data",
    valueType,
    label,
});

/**
 * The id the field pickers on list nodes fill their options from.
 *
 * A dynamic source rather than a static option list, because the fields belong to the list this
 * node targets and no two lists need agree. The stored value is the field's **id**, so renaming the
 * key an author reads it by does not silently repoint a graph at a field that no longer exists.
 */
export const BLUEPRINT_LIST_ITEM_FIELD_OPTIONS_SOURCE = "listItemFields";

function fieldParam(label = "Field"): NonNullable<BlueprintNodeDef["inspectorParams"]>[number] {
    return {
        key: "field",
        label,
        kind: "select",
        dynamicOptionsSource: BLUEPRINT_LIST_ITEM_FIELD_OPTIONS_SOURCE,
    };
}

function readNode(input: {
    type: string;
    displayName: string;
    keywords: string[];
    pins: BlueprintNodePinDef[];
    target?: "self" | "element" | "context";
    requiresListItemContext?: boolean;
    inspectorParams?: BlueprintNodeDef["inspectorParams"];
}): BlueprintNodeDef {
    const elementTarget = input.target === "element";
    const selfTarget = input.target === "self";
    return {
        type: input.type,
        displayName: input.displayName,
        category: elementTarget ? "Element" : "List",
        keywords: input.keywords,
        graphKinds: [...READ_GRAPH_KINDS],
        isPure: true,
        pins: elementTarget ? [listIn, ...input.pins] : input.pins,
        magicElementTarget: elementTarget ? LIST_MAGIC_TARGET : undefined,
        scope: selfTarget ? LIST_SCOPE : undefined,
        requiresListItemContext: input.requiresListItemContext,
        inspectorParams: input.inspectorParams,
        execute: () => ({}),
    };
}

function writeNode(input: {
    type: string;
    displayName: string;
    keywords: string[];
    pins?: BlueprintNodePinDef[];
    target: "self" | "element";
    inspectorParams?: BlueprintNodeDef["inspectorParams"];
    execute: BlueprintNodeDef["execute"];
}): BlueprintNodeDef {
    const elementTarget = input.target === "element";
    return {
        type: input.type,
        displayName: input.displayName,
        category: elementTarget ? "Element" : "List",
        keywords: input.keywords,
        graphKinds: [...WRITE_GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: elementTarget ? [execIn, execNext, listIn, ...(input.pins ?? [])] : [execIn, execNext, ...(input.pins ?? [])],
        magicElementTarget: elementTarget ? LIST_MAGIC_TARGET : undefined,
        scope: elementTarget ? undefined : LIST_SCOPE,
        inspectorParams: input.inspectorParams,
        execute: input.execute,
    };
}

function readPin(ctx: Parameters<BlueprintNodeDef["execute"]>[0], pinId: string): unknown {
    return resolveDataPinValue(ctx.graph, ctx.node.id, pinId, ctx.params, ctx.blueprintLocals, 0, {
        hostAdapter: ctx.hostAdapter,
        eventPayload: ctx.eventPayload,
        listItemScope: ctx.listItemScope,
        instanceKey: ctx.instanceKey,
        executionOwner: ctx.executionOwner,
        valueExecution: ctx.valueExecution,
    });
}

function resolveListElementId(ctx: Parameters<BlueprintNodeDef["execute"]>[0], target: "self" | "element"): string {
    const ref = normalizeBlueprintElementRefValue(readPin(ctx, "list"));
    if (ref) {
        if (ref.elementType !== LIST_ELEMENT_TYPE) {
            throw new BlueprintGraphExecutionError("List node requires an nl.list element", ctx.node.id);
        }
        if (!isUIElementRefInScope(ref.surfaceId, ctx.executionOwner)) {
            throw new BlueprintGraphExecutionError("List node can only target the current Surface", ctx.node.id);
        }
        return buildUIWidgetAddress(ref.elementId, ctx.instanceKey);
    }
    if (target === "element") {
        throw new BlueprintGraphExecutionError("List Element node requires a List input", ctx.node.id);
    }
    const elementId = ctx.executionOwner?.elementId;
    if (!elementId) {
        throw new BlueprintGraphExecutionError("List node requires a List target", ctx.node.id);
    }
    return buildUIWidgetAddress(elementId, ctx.instanceKey);
}

function normalizeArray(value: unknown): unknown[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return JSON.parse(JSON.stringify(value)) as unknown[];
}

function jsonEquals(a: unknown, b: unknown): boolean {
    try {
        return JSON.stringify(a) === JSON.stringify(b);
    } catch {
        return a === b;
    }
}

function toInteger(value: unknown, fallback: number): number {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

async function setItems(ctx: Parameters<BlueprintNodeDef["execute"]>[0], items: readonly unknown[], target: "self" | "element") {
    const api = requireHostApi(ctx);
    await api.widget.setListItems(resolveListElementId(ctx, target), items);
    return { nextPort: "next" };
}

function currentItems(ctx: Parameters<BlueprintNodeDef["execute"]>[0], target: "self" | "element"): unknown[] {
    return requireHostApi(ctx).widget.getListProperties(resolveListElementId(ctx, target)).items;
}

/** The declared shape of the list this node targets, or null when it declares none. */
function listStructOf(ctx: Parameters<BlueprintNodeDef["execute"]>[0], target: "self" | "element"): UIStructDef | null {
    return requireHostApi(ctx).widget.getListProperties(resolveListElementId(ctx, target)).struct;
}

/**
 * Write one field of one row and hand back the whole list.
 *
 * Rewrites the row rather than the field in place, because the list's content is handed out as a
 * copy: mutating what `getListProperties` returned would change nothing anybody renders.
 */
function withItemFieldSet(
    items: readonly unknown[],
    index: number,
    struct: UIStructDef | null,
    fieldId: string,
    value: unknown,
): unknown[] | null {
    const field = findUIStructField(struct, fieldId);
    if (!field || index < 0 || index >= items.length) {
        return null;
    }
    const next = [...items];
    const current = next[index];
    const source = current && typeof current === "object" && !Array.isArray(current)
        ? (current as Record<string, unknown>)
        : {};
    next[index] = { ...source, [field.key]: coerceUIStructFieldValue(field.type, value) };
    return next;
}

const sortDirectionParam: NonNullable<BlueprintNodeDef["inspectorParams"]>[number] = {
    key: "direction",
    label: "Direction",
    kind: "select",
    options: [
        { value: "ascending", label: "Ascending" },
        { value: "descending", label: "Descending" },
    ],
};

function readFieldId(ctx: Parameters<BlueprintNodeDef["execute"]>[0]): string {
    const raw = ctx.node.params?.field;
    return typeof raw === "string" ? raw.trim() : "";
}

async function setItemFieldAt(ctx: Parameters<BlueprintNodeDef["execute"]>[0], target: "self" | "element") {
    const fieldId = readFieldId(ctx);
    if (!fieldId) {
        throw new BlueprintGraphExecutionError("Set Item Field At needs a field", ctx.node.id);
    }
    const next = withItemFieldSet(
        currentItems(ctx, target),
        toInteger(readPin(ctx, "index"), -1),
        listStructOf(ctx, target),
        fieldId,
        readPin(ctx, "value"),
    );
    // A row that is not there and a field that is not declared are both "nothing to write". Left as
    // a quiet no-op rather than an error: a graph writing into the row it was just handed is the
    // ordinary case, and a list that shrank underneath it should not stop the chain.
    return next ? setItems(ctx, next, target) : { nextPort: "next" };
}

async function sortListByField(ctx: Parameters<BlueprintNodeDef["execute"]>[0], target: "self" | "element") {
    const fieldId = readFieldId(ctx);
    if (!fieldId) {
        throw new BlueprintGraphExecutionError("Sort List By Field needs a field", ctx.node.id);
    }
    const descending = ctx.node.params?.direction === "descending";
    return setItems(
        ctx,
        sortItemsByField(currentItems(ctx, target), listStructOf(ctx, target), fieldId, descending),
        target,
    );
}

export const listBlueprintNodes: BlueprintNodeDef[] = [
    writeNode({
        type: BLUEPRINT_NODE_TYPE_LIST_SET_ITEMS,
        displayName: "Set List Content",
        keywords: ["list", "set", "items", "content", "array"],
        pins: [arrayIn("items", "Items")],
        target: "self",
        execute: ctx => setItems(ctx, normalizeArray(readPin(ctx, "items")), "self"),
    }),
    readNode({
        type: BLUEPRINT_NODE_TYPE_LIST_GET_ITEMS,
        displayName: "Get List Content",
        keywords: ["list", "get", "items", "content", "array"],
        pins: [out("items", "Items", BLUEPRINT_VALUE_TYPE_ARRAY)],
        target: "self",
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_LIST_CLEAR,
        displayName: "Clear List",
        keywords: ["list", "clear", "items", "content"],
        target: "self",
        execute: ctx => setItems(ctx, [], "self"),
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_LIST_APPEND_ITEM,
        displayName: "Append List Item",
        keywords: ["list", "append", "push", "item"],
        pins: [anyIn("item", "Item")],
        target: "self",
        execute: ctx => setItems(ctx, [...currentItems(ctx, "self"), readPin(ctx, "item")], "self"),
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_LIST_INSERT_ITEM,
        displayName: "Insert List Item",
        keywords: ["list", "insert", "item", "index"],
        pins: [intIn("index", "Index"), anyIn("item", "Item")],
        target: "self",
        execute: ctx => {
            const items = currentItems(ctx, "self");
            const index = Math.max(0, Math.min(items.length, toInteger(readPin(ctx, "index"), items.length)));
            const next = [...items];
            next.splice(index, 0, readPin(ctx, "item"));
            return setItems(ctx, next, "self");
        },
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_LIST_REMOVE_ITEM,
        displayName: "Remove List Item",
        keywords: ["list", "remove", "item"],
        pins: [anyIn("item", "Item")],
        target: "self",
        execute: ctx => {
            const item = readPin(ctx, "item");
            const items = currentItems(ctx, "self");
            const index = items.findIndex(value => jsonEquals(value, item));
            if (index < 0) {
                return { nextPort: "next" };
            }
            return setItems(ctx, items.filter((_, i) => i !== index), "self");
        },
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_LIST_REMOVE_ITEM_AT,
        displayName: "Remove List Item At",
        keywords: ["list", "remove", "item", "index"],
        pins: [intIn("index", "Index")],
        target: "self",
        execute: ctx => {
            const items = currentItems(ctx, "self");
            const index = toInteger(readPin(ctx, "index"), -1);
            if (index < 0 || index >= items.length) {
                return { nextPort: "next" };
            }
            return setItems(ctx, items.filter((_, i) => i !== index), "self");
        },
    }),
    readNode({
        type: BLUEPRINT_NODE_TYPE_LIST_GET_SELECTED_ITEM,
        displayName: "Get Selected Item",
        keywords: ["list", "selected", "item", "get"],
        pins: [out("item", "Item", "json")],
        target: "self",
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_LIST_SET_SELECTED_ITEM,
        displayName: "Set Selected Item",
        keywords: ["list", "selected", "item", "set"],
        pins: [anyIn("item", "Item")],
        target: "self",
        execute: async ctx => {
            const api = requireHostApi(ctx);
            const listId = resolveListElementId(ctx, "self");
            const item = readPin(ctx, "item");
            const index = api.widget.getListProperties(listId).items.findIndex(value => jsonEquals(value, item));
            if (index >= 0) {
                await api.widget.setListSelectedIndex(listId, index);
            }
            return { nextPort: "next" };
        },
    }),
    readNode({
        type: BLUEPRINT_NODE_TYPE_LIST_GET_SELECTED_INDEX,
        displayName: "Get Selected Index",
        keywords: ["list", "selected", "index", "get"],
        pins: [out("index", "Index", "integer")],
        target: "self",
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_LIST_SET_SELECTED_INDEX,
        displayName: "Set Selected Index",
        keywords: ["list", "selected", "index", "set"],
        pins: [intIn("index", "Index")],
        target: "self",
        execute: async ctx => {
            await requireHostApi(ctx).widget.setListSelectedIndex(resolveListElementId(ctx, "self"), toInteger(readPin(ctx, "index"), -1));
            return { nextPort: "next" };
        },
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_LIST_REFRESH_ITEMS,
        displayName: "Refresh List Items",
        keywords: ["list", "refresh", "rerender", "items"],
        target: "self",
        execute: ctx => setItems(ctx, currentItems(ctx, "self"), "self"),
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_LIST_SCROLL_TO_INDEX,
        displayName: "Scroll To Index",
        keywords: ["list", "scroll", "index"],
        pins: [intIn("index", "Index")],
        target: "self",
        execute: async ctx => {
            await requireHostApi(ctx).widget.scrollListToIndex(resolveListElementId(ctx, "self"), toInteger(readPin(ctx, "index"), 0));
            return { nextPort: "next" };
        },
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_LIST_SCROLL_TO_TOP,
        displayName: "Scroll To Top",
        keywords: ["list", "scroll", "top"],
        target: "self",
        execute: async ctx => {
            await requireHostApi(ctx).widget.scrollListToTop(resolveListElementId(ctx, "self"));
            return { nextPort: "next" };
        },
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_LIST_SCROLL_TO_BOTTOM,
        displayName: "Scroll To Bottom",
        keywords: ["list", "scroll", "bottom"],
        target: "self",
        execute: async ctx => {
            await requireHostApi(ctx).widget.scrollListToBottom(resolveListElementId(ctx, "self"));
            return { nextPort: "next" };
        },
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_LIST_SET_ITEMS,
        displayName: "Set List Content",
        keywords: ["list", "element", "set", "items", "content", "array"],
        pins: [arrayIn("items", "Items")],
        target: "element",
        execute: ctx => setItems(ctx, normalizeArray(readPin(ctx, "items")), "element"),
    }),
    readNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_LIST_GET_ITEMS,
        displayName: "Get List Content",
        keywords: ["list", "element", "get", "items", "content", "array"],
        pins: [out("items", "Items", BLUEPRINT_VALUE_TYPE_ARRAY)],
        target: "element",
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_LIST_CLEAR,
        displayName: "Clear List",
        keywords: ["list", "element", "clear", "items", "content"],
        target: "element",
        execute: ctx => setItems(ctx, [], "element"),
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_LIST_APPEND_ITEM,
        displayName: "Append List Item",
        keywords: ["list", "element", "append", "push", "item"],
        pins: [anyIn("item", "Item")],
        target: "element",
        execute: ctx => setItems(ctx, [...currentItems(ctx, "element"), readPin(ctx, "item")], "element"),
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_LIST_INSERT_ITEM,
        displayName: "Insert List Item",
        keywords: ["list", "element", "insert", "item", "index"],
        pins: [intIn("index", "Index"), anyIn("item", "Item")],
        target: "element",
        execute: ctx => {
            const items = currentItems(ctx, "element");
            const index = Math.max(0, Math.min(items.length, toInteger(readPin(ctx, "index"), items.length)));
            const next = [...items];
            next.splice(index, 0, readPin(ctx, "item"));
            return setItems(ctx, next, "element");
        },
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_LIST_REMOVE_ITEM,
        displayName: "Remove List Item",
        keywords: ["list", "element", "remove", "item"],
        pins: [anyIn("item", "Item")],
        target: "element",
        execute: ctx => {
            const item = readPin(ctx, "item");
            const items = currentItems(ctx, "element");
            const index = items.findIndex(value => jsonEquals(value, item));
            if (index < 0) {
                return { nextPort: "next" };
            }
            return setItems(ctx, items.filter((_, i) => i !== index), "element");
        },
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_LIST_REMOVE_ITEM_AT,
        displayName: "Remove List Item At",
        keywords: ["list", "element", "remove", "item", "index"],
        pins: [intIn("index", "Index")],
        target: "element",
        execute: ctx => {
            const items = currentItems(ctx, "element");
            const index = toInteger(readPin(ctx, "index"), -1);
            if (index < 0 || index >= items.length) {
                return { nextPort: "next" };
            }
            return setItems(ctx, items.filter((_, i) => i !== index), "element");
        },
    }),
    readNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_LIST_GET_SELECTED_ITEM,
        displayName: "Get Selected Item",
        keywords: ["list", "element", "selected", "item", "get"],
        pins: [out("item", "Item", "json")],
        target: "element",
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_LIST_SET_SELECTED_ITEM,
        displayName: "Set Selected Item",
        keywords: ["list", "element", "selected", "item", "set"],
        pins: [anyIn("item", "Item")],
        target: "element",
        execute: async ctx => {
            const api = requireHostApi(ctx);
            const listId = resolveListElementId(ctx, "element");
            const item = readPin(ctx, "item");
            const index = api.widget.getListProperties(listId).items.findIndex(value => jsonEquals(value, item));
            if (index >= 0) {
                await api.widget.setListSelectedIndex(listId, index);
            }
            return { nextPort: "next" };
        },
    }),
    readNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_LIST_GET_SELECTED_INDEX,
        displayName: "Get Selected Index",
        keywords: ["list", "element", "selected", "index", "get"],
        pins: [out("index", "Index", "integer")],
        target: "element",
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_LIST_SET_SELECTED_INDEX,
        displayName: "Set Selected Index",
        keywords: ["list", "element", "selected", "index", "set"],
        pins: [intIn("index", "Index")],
        target: "element",
        execute: async ctx => {
            await requireHostApi(ctx).widget.setListSelectedIndex(resolveListElementId(ctx, "element"), toInteger(readPin(ctx, "index"), -1));
            return { nextPort: "next" };
        },
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_LIST_REFRESH_ITEMS,
        displayName: "Refresh List Items",
        keywords: ["list", "element", "refresh", "rerender", "items"],
        target: "element",
        execute: ctx => setItems(ctx, currentItems(ctx, "element"), "element"),
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_LIST_SCROLL_TO_INDEX,
        displayName: "Scroll To Index",
        keywords: ["list", "element", "scroll", "index"],
        pins: [intIn("index", "Index")],
        target: "element",
        execute: async ctx => {
            await requireHostApi(ctx).widget.scrollListToIndex(resolveListElementId(ctx, "element"), toInteger(readPin(ctx, "index"), 0));
            return { nextPort: "next" };
        },
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_LIST_SCROLL_TO_TOP,
        displayName: "Scroll To Top",
        keywords: ["list", "element", "scroll", "top"],
        target: "element",
        execute: async ctx => {
            await requireHostApi(ctx).widget.scrollListToTop(resolveListElementId(ctx, "element"));
            return { nextPort: "next" };
        },
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_LIST_SCROLL_TO_BOTTOM,
        displayName: "Scroll To Bottom",
        keywords: ["list", "element", "scroll", "bottom"],
        target: "element",
        execute: async ctx => {
            await requireHostApi(ctx).widget.scrollListToBottom(resolveListElementId(ctx, "element"));
            return { nextPort: "next" };
        },
    }),
    /**
     * Where the list is, asked at the moment the graph runs.
     *
     * The Scroll head tells a graph the list has moved; these tell a graph where it ended up. The
     * difference matters to anything triggered by something other than the list - a wheel handler on
     * the page around it cannot be told, it has to ask - and mirroring the head's answer into a
     * variable instead is the shape that silently goes stale.
     */
    readNode({
        type: BLUEPRINT_NODE_TYPE_LIST_GET_SCROLL_PROGRESS,
        displayName: "Get Scroll Progress",
        keywords: ["list", "scroll", "progress", "position", "fraction"],
        pins: [out("progress", "Progress", "float")],
        target: "self",
    }),
    readNode({
        type: BLUEPRINT_NODE_TYPE_LIST_GET_SCROLL_OFFSET,
        displayName: "Get Scroll Offset",
        keywords: ["list", "scroll", "offset", "pixels", "position"],
        pins: [out("offset", "Offset", "float"), out("maxOffset", "Max Offset", "float")],
        target: "self",
    }),
    readNode({
        type: BLUEPRINT_NODE_TYPE_LIST_IS_SCROLLED_TO_END,
        displayName: "Is Scrolled To End",
        keywords: ["list", "scroll", "end", "bottom", "edge"],
        pins: [out("atEnd", "At End", "boolean")],
        target: "self",
    }),
    readNode({
        type: BLUEPRINT_NODE_TYPE_LIST_IS_SCROLLED_TO_START,
        displayName: "Is Scrolled To Start",
        keywords: ["list", "scroll", "start", "top", "edge"],
        pins: [out("atStart", "At Start", "boolean")],
        target: "self",
    }),
    readNode({
        type: BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_PROPS,
        displayName: "Get List Item Props",
        keywords: ["list", "item", "props", "context"],
        pins: [out("props", "Props", "json")],
        requiresListItemContext: true,
    }),
    readNode({
        type: BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_INDEX,
        displayName: "Get List Item Index",
        keywords: ["list", "item", "index", "context"],
        pins: [out("index", "Index", "integer")],
        requiresListItemContext: true,
    }),
    readNode({
        type: BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_COUNT,
        displayName: "Get List Item Count",
        keywords: ["list", "item", "count", "context"],
        pins: [out("count", "Count", "integer")],
        requiresListItemContext: true,
    }),
    readNode({
        type: BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_KEY,
        displayName: "Get List Item Key",
        keywords: ["list", "item", "key", "context"],
        pins: [out("key", "Key", "string")],
        requiresListItemContext: true,
    }),
    readNode({
        type: BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD,
        displayName: "Get Item Field",
        keywords: ["list", "item", "field", "value", "read", "row", "column"],
        pins: [out("value", "Value", "any")],
        inspectorParams: [fieldParam()],
        requiresListItemContext: true,
    }),
    readNode({
        type: BLUEPRINT_NODE_TYPE_LIST_GET_LENGTH,
        displayName: "Get List Length",
        keywords: ["list", "length", "count", "size", "rows"],
        pins: [out("length", "Length", "integer")],
        target: "self",
    }),
    readNode({
        type: BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_AT,
        displayName: "Get Item At",
        keywords: ["list", "item", "index", "at", "row", "get"],
        pins: [intIn("index", "Index"), out("item", "Item", "json")],
        target: "self",
    }),
    readNode({
        type: BLUEPRINT_NODE_TYPE_LIST_FIND_ITEM_BY_FIELD,
        displayName: "Find Item By Field",
        keywords: ["list", "find", "search", "field", "item", "index", "lookup"],
        pins: [
            anyIn("value", "Value"),
            out("index", "Index", "integer"),
            out("item", "Item", "json"),
            out("found", "Found", "boolean"),
        ],
        inspectorParams: [fieldParam()],
        target: "self",
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_LIST_SET_ITEM_FIELD_AT,
        displayName: "Set Item Field At",
        keywords: ["list", "item", "field", "set", "write", "row", "update"],
        pins: [intIn("index", "Index"), anyIn("value", "Value")],
        inspectorParams: [fieldParam()],
        target: "self",
        execute: ctx => setItemFieldAt(ctx, "self"),
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_LIST_SORT_BY_FIELD,
        displayName: "Sort List By Field",
        keywords: ["list", "sort", "order", "field", "ascending", "descending"],
        pins: [],
        inspectorParams: [fieldParam(), sortDirectionParam],
        target: "self",
        execute: ctx => sortListByField(ctx, "self"),
    }),
    readNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_LIST_GET_LENGTH,
        displayName: "Get List Length",
        keywords: ["list", "element", "length", "count", "size", "rows"],
        pins: [out("length", "Length", "integer")],
        target: "element",
    }),
    readNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_LIST_GET_ITEM_AT,
        displayName: "Get Item At",
        keywords: ["list", "element", "item", "index", "at", "row", "get"],
        pins: [intIn("index", "Index"), out("item", "Item", "json")],
        target: "element",
    }),
    readNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_LIST_FIND_ITEM_BY_FIELD,
        displayName: "Find Item By Field",
        keywords: ["list", "element", "find", "search", "field", "item", "index", "lookup"],
        pins: [
            anyIn("value", "Value"),
            out("index", "Index", "integer"),
            out("item", "Item", "json"),
            out("found", "Found", "boolean"),
        ],
        inspectorParams: [fieldParam()],
        target: "element",
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_LIST_SET_ITEM_FIELD_AT,
        displayName: "Set Item Field At",
        keywords: ["list", "element", "item", "field", "set", "write", "row", "update"],
        pins: [intIn("index", "Index"), anyIn("value", "Value")],
        inspectorParams: [fieldParam()],
        target: "element",
        execute: ctx => setItemFieldAt(ctx, "element"),
    }),
    readNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_LIST_GET_SCROLL_PROGRESS,
        displayName: "Get Scroll Progress",
        keywords: ["list", "element", "scroll", "progress", "position", "fraction"],
        pins: [out("progress", "Progress", "float")],
        target: "element",
    }),
    readNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_LIST_GET_SCROLL_OFFSET,
        displayName: "Get Scroll Offset",
        keywords: ["list", "element", "scroll", "offset", "pixels", "position"],
        pins: [out("offset", "Offset", "float"), out("maxOffset", "Max Offset", "float")],
        target: "element",
    }),
    readNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_LIST_IS_SCROLLED_TO_END,
        displayName: "Is Scrolled To End",
        keywords: ["list", "element", "scroll", "end", "bottom", "edge"],
        pins: [out("atEnd", "At End", "boolean")],
        target: "element",
    }),
    readNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_LIST_IS_SCROLLED_TO_START,
        displayName: "Is Scrolled To Start",
        keywords: ["list", "element", "scroll", "start", "top", "edge"],
        pins: [out("atStart", "At Start", "boolean")],
        target: "element",
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_LIST_SORT_BY_FIELD,
        displayName: "Sort List By Field",
        keywords: ["list", "element", "sort", "order", "field", "ascending", "descending"],
        pins: [],
        inspectorParams: [fieldParam(), sortDirectionParam],
        target: "element",
        execute: ctx => sortListByField(ctx, "element"),
    }),
];
