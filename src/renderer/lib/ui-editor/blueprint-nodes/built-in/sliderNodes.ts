/**
 * Slider widget nodes from the documented Blueprint catalog.
 * Comments in English per project convention.
 */

import {
    BLUEPRINT_NODE_TYPE_ELEMENT_SLIDER_GET_NORMALIZED_VALUE,
    BLUEPRINT_NODE_TYPE_ELEMENT_SLIDER_GET_RANGE,
    BLUEPRINT_NODE_TYPE_ELEMENT_SLIDER_GET_VALUE,
    BLUEPRINT_NODE_TYPE_ELEMENT_SLIDER_SET_RANGE,
    BLUEPRINT_NODE_TYPE_ELEMENT_SLIDER_SET_VALUE,
    BLUEPRINT_NODE_TYPE_SLIDER_GET_NORMALIZED_VALUE,
    BLUEPRINT_NODE_TYPE_SLIDER_GET_RANGE,
    BLUEPRINT_NODE_TYPE_SLIDER_GET_VALUE,
    BLUEPRINT_NODE_TYPE_SLIDER_SET_RANGE,
    BLUEPRINT_NODE_TYPE_SLIDER_SET_VALUE,
} from "@shared/types/blueprint/graph";
import { blueprintElementValueType } from "@shared/types/blueprint/valueTypes";
import { BlueprintGraphExecutionError } from "../../behavior-graph/GraphExecutionError";
import type { BlueprintSliderPropertiesPatch } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import type { BlueprintNodeDef, BlueprintNodePinDef } from "../types";
import { requireHostApi } from "./hostApi";
import { resolveDataPinValue } from "./graphParamResolvers";
import { normalizeBlueprintElementRefValue } from "./elementRefUtils";

const READ_GRAPH_KINDS = ["event", "function", "macro"] as const;
const WRITE_GRAPH_KINDS = ["event", "macro"] as const;
const SLIDER_ELEMENT_TYPE = "nl.slider";
const SLIDER_MAGIC_TARGET: NonNullable<BlueprintNodeDef["magicElementTarget"]> = {
    inputPinId: "slider",
    elementTypes: [SLIDER_ELEMENT_TYPE],
};
const SLIDER_SCOPE: BlueprintNodeDef["scope"] = {
    ownerKinds: ["widgetMain"],
    widgetElementTypes: [SLIDER_ELEMENT_TYPE],
};

const execIn: BlueprintNodePinDef = { id: "in", kind: "input", semantic: "exec", label: "In" };
const execNext: BlueprintNodePinDef = { id: "next", kind: "output", semantic: "exec", label: "Next" };
const sliderIn: BlueprintNodePinDef = {
    id: "slider",
    kind: "input",
    semantic: "data",
    valueType: blueprintElementValueType(SLIDER_ELEMENT_TYPE),
    label: "Slider",
};
const floatIn = (id: string, label: string): BlueprintNodePinDef => ({
    id,
    kind: "input",
    semantic: "data",
    valueType: "float",
    label,
    allowInlineLiteral: true,
});
const out = (id: string, label: string): BlueprintNodePinDef => ({
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
        category: elementTarget ? "Element" : "Slider",
        keywords: input.keywords,
        graphKinds: [...READ_GRAPH_KINDS],
        isPure: true,
        pins: elementTarget ? [sliderIn, ...input.pins] : input.pins,
        magicElementTarget: elementTarget ? SLIDER_MAGIC_TARGET : undefined,
        scope: elementTarget ? undefined : SLIDER_SCOPE,
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
        category: elementTarget ? "Element" : "Slider",
        keywords: input.keywords,
        graphKinds: [...WRITE_GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: elementTarget ? [execIn, execNext, sliderIn, ...input.pins] : [execIn, execNext, ...input.pins],
        magicElementTarget: elementTarget ? SLIDER_MAGIC_TARGET : undefined,
        scope: elementTarget ? undefined : SLIDER_SCOPE,
        execute: input.execute,
    };
}

function runtimeSliderRef(ctx: Parameters<BlueprintNodeDef["execute"]>[0], target: "self" | "element") {
    const api = requireHostApi(ctx);
    const ref = normalizeBlueprintElementRefValue(readPin(ctx, "slider"));
    if (ref) {
        if (ref.elementType !== SLIDER_ELEMENT_TYPE) {
            throw new BlueprintGraphExecutionError("Slider node requires an nl.slider element", ctx.node.id);
        }
        const currentSurfaceId = ctx.executionOwner?.surfaceId;
        if (currentSurfaceId && ref.surfaceId !== currentSurfaceId) {
            throw new BlueprintGraphExecutionError("Slider node can only target the current Surface", ctx.node.id);
        }
        return { api, elementId: ref.elementId };
    }
    if (target === "element") {
        throw new BlueprintGraphExecutionError("Slider Element node requires a Slider input", ctx.node.id);
    }
    const elementId = ctx.executionOwner?.elementId;
    if (!elementId) {
        throw new BlueprintGraphExecutionError("Slider node requires a Slider target", ctx.node.id);
    }
    return { api, elementId };
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

function toFiniteNumber(raw: unknown, fallback: number): number {
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(n) ? n : fallback;
}

async function patchCurrentSlider(
    ctx: Parameters<BlueprintNodeDef["execute"]>[0],
    patch: BlueprintSliderPropertiesPatch,
    target: "self" | "element",
) {
    const { api, elementId } = runtimeSliderRef(ctx, target);
    await api.widget.setSliderProperties(elementId, patch);
    return { nextPort: "next" };
}

export const sliderBlueprintNodes: BlueprintNodeDef[] = [
    readNode({
        type: BLUEPRINT_NODE_TYPE_SLIDER_GET_VALUE,
        displayName: "Get Value",
        keywords: ["slider", "get", "value", "mapped"],
        pins: [out("value", "Value")],
        target: "self",
    }),
    readNode({
        type: BLUEPRINT_NODE_TYPE_SLIDER_GET_NORMALIZED_VALUE,
        displayName: "Get Normalized Value",
        keywords: ["slider", "normalized", "ratio", "progress"],
        pins: [out("normalizedValue", "Normalized")],
        target: "self",
    }),
    readNode({
        type: BLUEPRINT_NODE_TYPE_SLIDER_GET_RANGE,
        displayName: "Get Slider Range",
        keywords: ["slider", "range", "min", "max", "step"],
        pins: [out("min", "Min"), out("max", "Max"), out("step", "Step")],
        target: "self",
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_SLIDER_SET_VALUE,
        displayName: "Set Slider Value",
        keywords: ["slider", "set", "value", "mapped"],
        pins: [floatIn("value", "Value")],
        target: "self",
        execute: ctx => patchCurrentSlider(ctx, { value: toFiniteNumber(readPin(ctx, "value"), 0) }, "self"),
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_SLIDER_SET_RANGE,
        displayName: "Set Slider Range",
        keywords: ["slider", "set", "range", "min", "max", "step"],
        pins: [floatIn("min", "Min"), floatIn("max", "Max"), floatIn("step", "Step")],
        target: "self",
        execute: ctx => {
            const { api, elementId } = runtimeSliderRef(ctx, "self");
            const current = api.widget.getSliderProperties(elementId);
            return patchCurrentSlider(ctx, {
                min: toFiniteNumber(readPin(ctx, "min"), current.min),
                max: toFiniteNumber(readPin(ctx, "max"), current.max),
                step: Math.max(0, toFiniteNumber(readPin(ctx, "step"), current.step)),
            }, "self");
        },
    }),
    readNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_SLIDER_GET_VALUE,
        displayName: "Get Slider Value",
        keywords: ["slider", "element", "get", "value", "mapped"],
        pins: [out("value", "Value")],
        target: "element",
    }),
    readNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_SLIDER_GET_NORMALIZED_VALUE,
        displayName: "Get Slider Normalized Value",
        keywords: ["slider", "element", "normalized", "ratio", "progress"],
        pins: [out("normalizedValue", "Normalized")],
        target: "element",
    }),
    readNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_SLIDER_GET_RANGE,
        displayName: "Get Slider Range",
        keywords: ["slider", "element", "range", "min", "max", "step"],
        pins: [out("min", "Min"), out("max", "Max"), out("step", "Step")],
        target: "element",
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_SLIDER_SET_VALUE,
        displayName: "Set Slider Value",
        keywords: ["slider", "element", "set", "value", "mapped"],
        pins: [floatIn("value", "Value")],
        target: "element",
        execute: ctx => patchCurrentSlider(ctx, { value: toFiniteNumber(readPin(ctx, "value"), 0) }, "element"),
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_SLIDER_SET_RANGE,
        displayName: "Set Slider Range",
        keywords: ["slider", "element", "set", "range", "min", "max", "step"],
        pins: [floatIn("min", "Min"), floatIn("max", "Max"), floatIn("step", "Step")],
        target: "element",
        execute: ctx => {
            const { api, elementId } = runtimeSliderRef(ctx, "element");
            const current = api.widget.getSliderProperties(elementId);
            return patchCurrentSlider(ctx, {
                min: toFiniteNumber(readPin(ctx, "min"), current.min),
                max: toFiniteNumber(readPin(ctx, "max"), current.max),
                step: Math.max(0, toFiniteNumber(readPin(ctx, "step"), current.step)),
            }, "element");
        },
    }),
];
