/**
 * Text input widget nodes, mirroring the slider's self/element node pairing.
 * Comments in English per project convention.
 */

import {
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_INPUT_CLEAR,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_INPUT_GET_VALUE,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_INPUT_SET_VALUE,
    BLUEPRINT_NODE_TYPE_TEXT_INPUT_CLEAR,
    BLUEPRINT_NODE_TYPE_TEXT_INPUT_GET_VALUE,
    BLUEPRINT_NODE_TYPE_TEXT_INPUT_SET_VALUE,
} from "@shared/types/blueprint/graph";
import { blueprintElementValueType } from "@shared/types/blueprint/valueTypes";
import { BlueprintGraphExecutionError } from "../../behavior-graph/GraphExecutionError";
import type { BlueprintTextInputPropertiesPatch } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import type { BlueprintNodeDef, BlueprintNodePinDef } from "../types";
import { requireHostApi } from "./hostApi";
import { resolveDataPinValue } from "./graphParamResolvers";
import { normalizeBlueprintElementRefValue } from "./elementRefUtils";

const READ_GRAPH_KINDS = ["event", "function", "macro"] as const;
const WRITE_GRAPH_KINDS = ["event", "macro"] as const;
const TEXT_INPUT_ELEMENT_TYPE = "nl.textInput";
const TEXT_INPUT_MAGIC_TARGET: NonNullable<BlueprintNodeDef["magicElementTarget"]> = {
    inputPinId: "textInput",
    elementTypes: [TEXT_INPUT_ELEMENT_TYPE],
};
const TEXT_INPUT_SCOPE: BlueprintNodeDef["scope"] = {
    ownerKinds: ["widgetMain"],
    widgetElementTypes: [TEXT_INPUT_ELEMENT_TYPE],
};

const execIn: BlueprintNodePinDef = { id: "in", kind: "input", semantic: "exec", label: "In" };
const execNext: BlueprintNodePinDef = { id: "next", kind: "output", semantic: "exec", label: "Next" };
const textInputIn: BlueprintNodePinDef = {
    id: "textInput",
    kind: "input",
    semantic: "data",
    valueType: blueprintElementValueType(TEXT_INPUT_ELEMENT_TYPE),
    label: "Text Input",
};
const stringIn = (id: string, label: string): BlueprintNodePinDef => ({
    id,
    kind: "input",
    semantic: "data",
    valueType: "string",
    label,
    allowInlineLiteral: true,
});
const stringOut = (id: string, label: string): BlueprintNodePinDef => ({
    id,
    kind: "output",
    semantic: "data",
    valueType: "string",
    label,
});
const intOut = (id: string, label: string): BlueprintNodePinDef => ({
    id,
    kind: "output",
    semantic: "data",
    valueType: "float",
    label,
});

function readNode(input: {
    type: string;
    displayName: string;
    keywords: string[];
    pins: BlueprintNodePinDef[];
    target: "self" | "element";
}): BlueprintNodeDef {
    const elementTarget = input.target === "element";
    return {
        type: input.type,
        displayName: input.displayName,
        category: elementTarget ? "Element" : "Text Input",
        keywords: input.keywords,
        graphKinds: [...READ_GRAPH_KINDS],
        isPure: true,
        pins: elementTarget ? [textInputIn, ...input.pins] : input.pins,
        magicElementTarget: elementTarget ? TEXT_INPUT_MAGIC_TARGET : undefined,
        scope: elementTarget ? undefined : TEXT_INPUT_SCOPE,
        execute: () => ({}),
    };
}

function writeNode(input: {
    type: string;
    displayName: string;
    keywords: string[];
    pins: BlueprintNodePinDef[];
    target: "self" | "element";
    execute: BlueprintNodeDef["execute"];
}): BlueprintNodeDef {
    const elementTarget = input.target === "element";
    return {
        type: input.type,
        displayName: input.displayName,
        category: elementTarget ? "Element" : "Text Input",
        keywords: input.keywords,
        graphKinds: [...WRITE_GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: elementTarget ? [execIn, execNext, textInputIn, ...input.pins] : [execIn, execNext, ...input.pins],
        magicElementTarget: elementTarget ? TEXT_INPUT_MAGIC_TARGET : undefined,
        scope: elementTarget ? undefined : TEXT_INPUT_SCOPE,
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

function runtimeTextInputRef(ctx: Parameters<BlueprintNodeDef["execute"]>[0], target: "self" | "element") {
    const api = requireHostApi(ctx);
    const ref = normalizeBlueprintElementRefValue(readPin(ctx, "textInput"));
    if (ref) {
        if (ref.elementType !== TEXT_INPUT_ELEMENT_TYPE) {
            throw new BlueprintGraphExecutionError(
                "Text Input node requires an nl.textInput element",
                ctx.node.id,
            );
        }
        const currentSurfaceId = ctx.executionOwner?.surfaceId;
        if (currentSurfaceId && ref.surfaceId !== currentSurfaceId) {
            throw new BlueprintGraphExecutionError(
                "Text Input node can only target the current Surface",
                ctx.node.id,
            );
        }
        return { api, elementId: ref.elementId };
    }
    if (target === "element") {
        throw new BlueprintGraphExecutionError(
            "Text Input Element node requires a Text Input input",
            ctx.node.id,
        );
    }
    const elementId = ctx.executionOwner?.elementId;
    if (!elementId) {
        throw new BlueprintGraphExecutionError("Text Input node requires a Text Input target", ctx.node.id);
    }
    return { api, elementId };
}

function toStringValue(raw: unknown): string {
    if (typeof raw === "string") {
        return raw;
    }
    return raw === undefined || raw === null ? "" : String(raw);
}

async function patchCurrentTextInput(
    ctx: Parameters<BlueprintNodeDef["execute"]>[0],
    patch: BlueprintTextInputPropertiesPatch,
    target: "self" | "element",
) {
    const { api, elementId } = runtimeTextInputRef(ctx, target);
    await api.widget.setTextInputProperties(elementId, patch);
    return { nextPort: "next" };
}

export const textInputBlueprintNodes: BlueprintNodeDef[] = [
    readNode({
        type: BLUEPRINT_NODE_TYPE_TEXT_INPUT_GET_VALUE,
        displayName: "Get Text",
        keywords: ["text", "input", "get", "value", "content"],
        pins: [stringOut("value", "Value"), intOut("length", "Length")],
        target: "self",
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_TEXT_INPUT_SET_VALUE,
        displayName: "Set Text",
        keywords: ["text", "input", "set", "value", "content"],
        pins: [stringIn("value", "Value")],
        target: "self",
        execute: ctx => patchCurrentTextInput(ctx, { value: toStringValue(readPin(ctx, "value")) }, "self"),
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_TEXT_INPUT_CLEAR,
        displayName: "Clear Text",
        keywords: ["text", "input", "clear", "empty", "reset"],
        pins: [],
        target: "self",
        execute: ctx => patchCurrentTextInput(ctx, { value: "" }, "self"),
    }),
    readNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_INPUT_GET_VALUE,
        displayName: "Get Text",
        keywords: ["text", "input", "get", "value", "element"],
        pins: [stringOut("value", "Value"), intOut("length", "Length")],
        target: "element",
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_INPUT_SET_VALUE,
        displayName: "Set Text",
        keywords: ["text", "input", "set", "value", "element"],
        pins: [stringIn("value", "Value")],
        target: "element",
        execute: ctx => patchCurrentTextInput(ctx, { value: toStringValue(readPin(ctx, "value")) }, "element"),
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_INPUT_CLEAR,
        displayName: "Clear Text",
        keywords: ["text", "input", "clear", "empty", "element"],
        pins: [],
        target: "element",
        execute: ctx => patchCurrentTextInput(ctx, { value: "" }, "element"),
    }),
];
