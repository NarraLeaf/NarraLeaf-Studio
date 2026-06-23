/**
 * Slider widget nodes from the documented Blueprint catalog.
 * Comments in English per project convention.
 */

import {
    BLUEPRINT_NODE_TYPE_SLIDER_GET_NORMALIZED_VALUE,
    BLUEPRINT_NODE_TYPE_SLIDER_GET_RANGE,
    BLUEPRINT_NODE_TYPE_SLIDER_GET_VALUE,
    BLUEPRINT_NODE_TYPE_SLIDER_SET_RANGE,
    BLUEPRINT_NODE_TYPE_SLIDER_SET_VALUE,
} from "@shared/types/blueprint/graph";
import { BlueprintGraphExecutionError } from "../../behavior-graph/GraphExecutionError";
import type { BlueprintSliderPropertiesPatch } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import type { BlueprintNodeDef, BlueprintNodePinDef } from "../types";
import { requireHostApi } from "./hostApi";
import { resolveDataPinValue } from "./graphParamResolvers";

const READ_GRAPH_KINDS = ["event", "function", "macro"] as const;
const WRITE_GRAPH_KINDS = ["event", "macro"] as const;
const SLIDER_SCOPE: BlueprintNodeDef["scope"] = {
    ownerKinds: ["widgetMain"],
    widgetElementTypes: ["nl.slider"],
};

const execIn: BlueprintNodePinDef = { id: "in", kind: "input", semantic: "exec", label: "In" };
const execNext: BlueprintNodePinDef = { id: "next", kind: "output", semantic: "exec", label: "Next" };
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
}): BlueprintNodeDef {
    return {
        type: input.type,
        displayName: input.displayName,
        category: "Slider",
        keywords: input.keywords,
        graphKinds: [...READ_GRAPH_KINDS],
        isPure: true,
        pins: input.pins,
        scope: SLIDER_SCOPE,
        execute: () => ({}),
    };
}

function writeNode(input: {
    type: string;
    displayName: string;
    keywords: string[];
    pins: BlueprintNodePinDef[];
    execute: BlueprintNodeDef["execute"];
}): BlueprintNodeDef {
    return {
        type: input.type,
        displayName: input.displayName,
        category: "Slider",
        keywords: input.keywords,
        graphKinds: [...WRITE_GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [execIn, execNext, ...input.pins],
        scope: SLIDER_SCOPE,
        execute: input.execute,
    };
}

function runtimeSliderRef(ctx: Parameters<BlueprintNodeDef["execute"]>[0]) {
    const api = requireHostApi(ctx);
    const elementId = ctx.executionOwner?.elementId;
    if (!elementId) {
        throw new BlueprintGraphExecutionError("Slider node requires a widget execution owner", ctx.node.id);
    }
    return { api, elementId };
}

function readPin(ctx: Parameters<BlueprintNodeDef["execute"]>[0], pinId: string): unknown {
    return resolveDataPinValue(ctx.graph, ctx.node.id, pinId, ctx.params, ctx.blueprintLocals, 0, {
        hostAdapter: ctx.hostAdapter,
        eventPayload: ctx.eventPayload,
        executionOwner: ctx.executionOwner,
    });
}

function toFiniteNumber(raw: unknown, fallback: number): number {
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(n) ? n : fallback;
}

async function patchCurrentSlider(
    ctx: Parameters<BlueprintNodeDef["execute"]>[0],
    patch: BlueprintSliderPropertiesPatch,
) {
    const { api, elementId } = runtimeSliderRef(ctx);
    await api.widget.setSliderProperties(elementId, patch);
    return { nextPort: "next" };
}

export const sliderBlueprintNodes: BlueprintNodeDef[] = [
    readNode({
        type: BLUEPRINT_NODE_TYPE_SLIDER_GET_VALUE,
        displayName: "Get Slider Value",
        keywords: ["slider", "value", "mapped"],
        pins: [out("value", "Value")],
    }),
    readNode({
        type: BLUEPRINT_NODE_TYPE_SLIDER_GET_NORMALIZED_VALUE,
        displayName: "Get Normalized Value",
        keywords: ["slider", "normalized", "ratio", "progress"],
        pins: [out("normalizedValue", "Normalized")],
    }),
    readNode({
        type: BLUEPRINT_NODE_TYPE_SLIDER_GET_RANGE,
        displayName: "Get Slider Range",
        keywords: ["slider", "range", "min", "max", "step"],
        pins: [out("min", "Min"), out("max", "Max"), out("step", "Step")],
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_SLIDER_SET_VALUE,
        displayName: "Set Slider Value",
        keywords: ["slider", "set", "value", "mapped"],
        pins: [floatIn("value", "Value")],
        execute: ctx => patchCurrentSlider(ctx, { value: toFiniteNumber(readPin(ctx, "value"), 0) }),
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_SLIDER_SET_RANGE,
        displayName: "Set Slider Range",
        keywords: ["slider", "set", "range", "min", "max", "step"],
        pins: [floatIn("min", "Min"), floatIn("max", "Max"), floatIn("step", "Step")],
        execute: ctx => {
            const { api, elementId } = runtimeSliderRef(ctx);
            const current = api.widget.getSliderProperties(elementId);
            return patchCurrentSlider(ctx, {
                min: toFiniteNumber(readPin(ctx, "min"), current.min),
                max: toFiniteNumber(readPin(ctx, "max"), current.max),
                step: Math.max(0, toFiniteNumber(readPin(ctx, "step"), current.step)),
            });
        },
    }),
];
