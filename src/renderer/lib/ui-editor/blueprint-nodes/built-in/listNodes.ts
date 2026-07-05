/**
 * List widget blueprint nodes.
 * Comments in English per project convention.
 */

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
import { UI_LIST_LIKE_WIDGET_TYPES } from "@shared/types/ui-editor/list";
import { BlueprintGraphExecutionError } from "../../behavior-graph/GraphExecutionError";
import type { BlueprintNodeDef, BlueprintNodePinDef } from "../types";
import { requireHostApi } from "./hostApi";
import { resolveDataPinValue } from "./graphParamResolvers";
import { normalizeBlueprintElementRefValue } from "./elementRefUtils";

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
    ownerKinds: ["widgetMain"],
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

function readNode(input: {
    type: string;
    displayName: string;
    keywords: string[];
    pins: BlueprintNodePinDef[];
    target?: "self" | "element" | "context";
    requiresListItemContext?: boolean;
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
        execute: () => ({}),
    };
}

function writeNode(input: {
    type: string;
    displayName: string;
    keywords: string[];
    pins?: BlueprintNodePinDef[];
    target: "self" | "element";
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
        const currentSurfaceId = ctx.executionOwner?.surfaceId;
        if (currentSurfaceId && ref.surfaceId !== currentSurfaceId) {
            throw new BlueprintGraphExecutionError("List node can only target the current Surface", ctx.node.id);
        }
        return ref.elementId;
    }
    if (target === "element") {
        throw new BlueprintGraphExecutionError("List Element node requires a List input", ctx.node.id);
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

async function setItems(ctx: Parameters<BlueprintNodeDef["execute"]>[0], items: readonly unknown[], target: "self" | "element") {
    const api = requireHostApi(ctx);
    await api.widget.setListItems(resolveListElementId(ctx, target), items);
    return { nextPort: "next" };
}

function currentItems(ctx: Parameters<BlueprintNodeDef["execute"]>[0], target: "self" | "element"): unknown[] {
    return requireHostApi(ctx).widget.getListProperties(resolveListElementId(ctx, target)).items;
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
];
