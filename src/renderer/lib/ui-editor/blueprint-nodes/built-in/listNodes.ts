/**
 * List widget blueprint nodes.
 * Comments in English per project convention.
 */

import {
    BLUEPRINT_NODE_TYPE_LIST_APPEND_ITEM,
    BLUEPRINT_NODE_TYPE_LIST_CLEAR,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_COUNT,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_INDEX,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_KEY,
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
    BLUEPRINT_NODE_TYPE_LIST_SET_ITEMS,
    BLUEPRINT_NODE_TYPE_LIST_SET_SELECTED_INDEX,
    BLUEPRINT_NODE_TYPE_LIST_SET_SELECTED_ITEM,
} from "@shared/types/blueprint/graph";
import {
    BLUEPRINT_VALUE_TYPE_ARRAY,
    blueprintElementValueType,
} from "@shared/types/blueprint/valueTypes";
import { BlueprintGraphExecutionError } from "../../behavior-graph/GraphExecutionError";
import type { BlueprintNodeDef, BlueprintNodePinDef } from "../types";
import { requireHostApi } from "./hostApi";
import { resolveDataPinValue } from "./graphParamResolvers";
import { normalizeBlueprintElementRefValue } from "./elementRefUtils";

const READ_GRAPH_KINDS = ["event", "function", "macro"] as const;
const WRITE_GRAPH_KINDS = ["event", "macro"] as const;
const LIST_ELEMENT_TYPE = "nl.list";
const LIST_SCOPE: BlueprintNodeDef["scope"] = { ownerKinds: ["widgetMain", "surfaceMain"] };

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

function readNode(input: {
    type: string;
    displayName: string;
    keywords: string[];
    pins: BlueprintNodePinDef[];
    scope?: BlueprintNodeDef["scope"];
}): BlueprintNodeDef {
    return {
        type: input.type,
        displayName: input.displayName,
        category: "List",
        keywords: input.keywords,
        graphKinds: [...READ_GRAPH_KINDS],
        isPure: true,
        pins: input.pins,
        scope: input.scope,
        execute: () => ({}),
    };
}

function writeNode(input: {
    type: string;
    displayName: string;
    keywords: string[];
    pins?: BlueprintNodePinDef[];
    execute: BlueprintNodeDef["execute"];
}): BlueprintNodeDef {
    return {
        type: input.type,
        displayName: input.displayName,
        category: "List",
        keywords: input.keywords,
        graphKinds: [...WRITE_GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [execIn, execNext, listIn, ...(input.pins ?? [])],
        scope: LIST_SCOPE,
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

function resolveListElementId(ctx: Parameters<BlueprintNodeDef["execute"]>[0]): string {
    const ref = normalizeBlueprintElementRefValue(readPin(ctx, "list"));
    if (ref) {
        if (ref.elementType !== LIST_ELEMENT_TYPE) {
            throw new BlueprintGraphExecutionError("List node requires an nl.list element", ctx.node.id);
        }
        return ref.elementId;
    }
    const elementId = ctx.executionOwner?.elementId;
    if (!elementId) {
        throw new BlueprintGraphExecutionError("List node requires a List target", ctx.node.id);
    }
    return elementId;
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

async function setItems(ctx: Parameters<BlueprintNodeDef["execute"]>[0], items: readonly unknown[]) {
    const api = requireHostApi(ctx);
    await api.widget.setListItems(resolveListElementId(ctx), items);
    return { nextPort: "next" };
}

function currentItems(ctx: Parameters<BlueprintNodeDef["execute"]>[0]): unknown[] {
    return requireHostApi(ctx).widget.getListProperties(resolveListElementId(ctx)).items;
}

export const listBlueprintNodes: BlueprintNodeDef[] = [
    writeNode({
        type: BLUEPRINT_NODE_TYPE_LIST_SET_ITEMS,
        displayName: "Set List Content",
        keywords: ["list", "set", "items", "content", "array"],
        pins: [arrayIn("items", "Items")],
        execute: ctx => setItems(ctx, normalizeArray(readPin(ctx, "items"))),
    }),
    readNode({
        type: BLUEPRINT_NODE_TYPE_LIST_GET_ITEMS,
        displayName: "Get List Content",
        keywords: ["list", "get", "items", "content", "array"],
        pins: [listIn, out("items", "Items", BLUEPRINT_VALUE_TYPE_ARRAY)],
        scope: LIST_SCOPE,
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_LIST_CLEAR,
        displayName: "Clear List",
        keywords: ["list", "clear", "items", "content"],
        execute: ctx => setItems(ctx, []),
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_LIST_APPEND_ITEM,
        displayName: "Append List Item",
        keywords: ["list", "append", "push", "item"],
        pins: [anyIn("item", "Item")],
        execute: ctx => setItems(ctx, [...currentItems(ctx), readPin(ctx, "item")]),
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_LIST_INSERT_ITEM,
        displayName: "Insert List Item",
        keywords: ["list", "insert", "item", "index"],
        pins: [intIn("index", "Index"), anyIn("item", "Item")],
        execute: ctx => {
            const items = currentItems(ctx);
            const index = Math.max(0, Math.min(items.length, toInteger(readPin(ctx, "index"), items.length)));
            const next = [...items];
            next.splice(index, 0, readPin(ctx, "item"));
            return setItems(ctx, next);
        },
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_LIST_REMOVE_ITEM,
        displayName: "Remove List Item",
        keywords: ["list", "remove", "item"],
        pins: [anyIn("item", "Item")],
        execute: ctx => {
            const item = readPin(ctx, "item");
            const items = currentItems(ctx);
            const index = items.findIndex(value => jsonEquals(value, item));
            if (index < 0) {
                return { nextPort: "next" };
            }
            return setItems(ctx, items.filter((_, i) => i !== index));
        },
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_LIST_REMOVE_ITEM_AT,
        displayName: "Remove List Item At",
        keywords: ["list", "remove", "item", "index"],
        pins: [intIn("index", "Index")],
        execute: ctx => {
            const items = currentItems(ctx);
            const index = toInteger(readPin(ctx, "index"), -1);
            if (index < 0 || index >= items.length) {
                return { nextPort: "next" };
            }
            return setItems(ctx, items.filter((_, i) => i !== index));
        },
    }),
    readNode({
        type: BLUEPRINT_NODE_TYPE_LIST_GET_SELECTED_ITEM,
        displayName: "Get Selected Item",
        keywords: ["list", "selected", "item", "get"],
        pins: [listIn, out("item", "Item", "json")],
        scope: LIST_SCOPE,
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_LIST_SET_SELECTED_ITEM,
        displayName: "Set Selected Item",
        keywords: ["list", "selected", "item", "set"],
        pins: [anyIn("item", "Item")],
        execute: async ctx => {
            const api = requireHostApi(ctx);
            const listId = resolveListElementId(ctx);
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
        pins: [listIn, out("index", "Index", "integer")],
        scope: LIST_SCOPE,
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_LIST_SET_SELECTED_INDEX,
        displayName: "Set Selected Index",
        keywords: ["list", "selected", "index", "set"],
        pins: [intIn("index", "Index")],
        execute: async ctx => {
            await requireHostApi(ctx).widget.setListSelectedIndex(resolveListElementId(ctx), toInteger(readPin(ctx, "index"), -1));
            return { nextPort: "next" };
        },
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_LIST_REFRESH_ITEMS,
        displayName: "Refresh List Items",
        keywords: ["list", "refresh", "rerender", "items"],
        execute: ctx => setItems(ctx, currentItems(ctx)),
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_LIST_SCROLL_TO_INDEX,
        displayName: "Scroll To Index",
        keywords: ["list", "scroll", "index"],
        pins: [intIn("index", "Index")],
        execute: async ctx => {
            await requireHostApi(ctx).widget.scrollListToIndex(resolveListElementId(ctx), toInteger(readPin(ctx, "index"), 0));
            return { nextPort: "next" };
        },
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_LIST_SCROLL_TO_TOP,
        displayName: "Scroll To Top",
        keywords: ["list", "scroll", "top"],
        execute: async ctx => {
            await requireHostApi(ctx).widget.scrollListToTop(resolveListElementId(ctx));
            return { nextPort: "next" };
        },
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_LIST_SCROLL_TO_BOTTOM,
        displayName: "Scroll To Bottom",
        keywords: ["list", "scroll", "bottom"],
        execute: async ctx => {
            await requireHostApi(ctx).widget.scrollListToBottom(resolveListElementId(ctx));
            return { nextPort: "next" };
        },
    }),
    readNode({
        type: BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_PROPS,
        displayName: "Get List Item Props",
        keywords: ["list", "item", "props", "context"],
        pins: [out("props", "Props", "json")],
    }),
    readNode({
        type: BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_INDEX,
        displayName: "Get List Item Index",
        keywords: ["list", "item", "index", "context"],
        pins: [out("index", "Index", "integer")],
    }),
    readNode({
        type: BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_COUNT,
        displayName: "Get List Item Count",
        keywords: ["list", "item", "count", "context"],
        pins: [out("count", "Count", "integer")],
    }),
    readNode({
        type: BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_KEY,
        displayName: "Get List Item Key",
        keywords: ["list", "item", "key", "context"],
        pins: [out("key", "Key", "string")],
    }),
];
