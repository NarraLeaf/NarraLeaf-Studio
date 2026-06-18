/**
 * Text widget nodes from the documented Blueprint catalog.
 * Comments in English per project convention.
 */

import {
    BLUEPRINT_NODE_TYPE_TEXT_APPEND_TEXT,
    BLUEPRINT_NODE_TYPE_TEXT_CLEAR_TEXT,
    BLUEPRINT_NODE_TYPE_TEXT_GET_ALL_PROPERTIES,
    BLUEPRINT_NODE_TYPE_TEXT_GET_EFFECTS,
    BLUEPRINT_NODE_TYPE_TEXT_GET_FONT,
    BLUEPRINT_NODE_TYPE_TEXT_GET_FONT_SIZE,
    BLUEPRINT_NODE_TYPE_TEXT_GET_FONT_WEIGHT,
    BLUEPRINT_NODE_TYPE_TEXT_GET_LINE_HEIGHT,
    BLUEPRINT_NODE_TYPE_TEXT_GET_TEXT,
    BLUEPRINT_NODE_TYPE_TEXT_GET_TEXT_ALIGN,
    BLUEPRINT_NODE_TYPE_TEXT_GET_TEXT_COLOR,
    BLUEPRINT_NODE_TYPE_TEXT_GET_TEXT_VERTICAL_ALIGN,
    BLUEPRINT_NODE_TYPE_TEXT_GET_WRAP_MODE,
    BLUEPRINT_NODE_TYPE_TEXT_SET_ALL_PROPERTIES,
    BLUEPRINT_NODE_TYPE_TEXT_SET_EFFECTS,
    BLUEPRINT_NODE_TYPE_TEXT_SET_FONT,
    BLUEPRINT_NODE_TYPE_TEXT_SET_FONT_SIZE,
    BLUEPRINT_NODE_TYPE_TEXT_SET_FONT_WEIGHT,
    BLUEPRINT_NODE_TYPE_TEXT_SET_LINE_HEIGHT,
    BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT,
    BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT_ALIGN,
    BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT_COLOR,
    BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT_VERTICAL_ALIGN,
    BLUEPRINT_NODE_TYPE_TEXT_SET_WRAP_MODE,
} from "@shared/types/blueprint/graph";
import { normalizeElementEffectValues } from "@shared/types/ui-editor/effects";
import { BlueprintGraphExecutionError } from "../../behavior-graph/GraphExecutionError";
import type {
    BlueprintTextProperties,
    BlueprintTextPropertiesPatch,
} from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import type { BlueprintNodeDef, BlueprintNodePinDef } from "../types";
import { requireHostApi } from "./hostApi";
import { resolveDataPinValue } from "./graphParamResolvers";

const READ_GRAPH_KINDS = ["event", "function", "macro"] as const;
const WRITE_GRAPH_KINDS = ["event", "macro"] as const;
const FONT_WEIGHT_VALUES = ["normal", "600", "bold"] as const;
const TEXT_ALIGN_VALUES = ["left", "center", "right"] as const;
const TEXT_VERTICAL_ALIGN_VALUES = ["start", "center", "end"] as const;
const TEXT_WRAP_MODE_VALUES = ["word", "character", "nowrap"] as const;
const TEXT_SCOPE: BlueprintNodeDef["scope"] = {
    ownerKinds: ["widgetMain"],
    widgetElementTypes: ["nl.text"],
};

const execIn: BlueprintNodePinDef = { id: "in", kind: "input", semantic: "exec", label: "In" };
const execNext: BlueprintNodePinDef = { id: "next", kind: "output", semantic: "exec", label: "Next" };

const dataIn = (
    id: string,
    label: string,
    valueType: string,
    allowInlineLiteral = false,
): BlueprintNodePinDef => ({
    id,
    kind: "input",
    semantic: "data",
    valueType,
    label,
    allowInlineLiteral,
});
const stringIn = (id: string, label: string): BlueprintNodePinDef => dataIn(id, label, "string", true);
const floatIn = (id: string, label: string): BlueprintNodePinDef => dataIn(id, label, "float", true);
const jsonIn = (id: string, label: string): BlueprintNodePinDef => dataIn(id, label, "json");
const out = (id: string, label: string, valueType: string): BlueprintNodePinDef => ({
    id,
    kind: "output",
    semantic: "data",
    valueType,
    label,
});

const textAllPropertyInputs: BlueprintNodePinDef[] = [
    stringIn("text", "Text"),
    stringIn("fontAssetId", "Font"),
    floatIn("fontSize", "Font Size"),
    stringIn("fontWeight", "Font Weight"),
    stringIn("color", "Color"),
    stringIn("textAlign", "Text Align"),
    stringIn("textVerticalAlign", "Vertical Align"),
    floatIn("lineHeight", "Line Height"),
    stringIn("textWrapMode", "Wrap Mode"),
    jsonIn("effects", "Effects"),
];

const textAllPropertyOutputs: BlueprintNodePinDef[] = [
    out("text", "Text", "string"),
    out("fontAssetId", "Font", "string"),
    out("fontSize", "Font Size", "float"),
    out("fontWeight", "Font Weight", "string"),
    out("color", "Color", "string"),
    out("textAlign", "Text Align", "string"),
    out("textVerticalAlign", "Vertical Align", "string"),
    out("lineHeight", "Line Height", "float"),
    out("textWrapMode", "Wrap Mode", "string"),
    out("effects", "Effects", "json"),
];

function readNode(input: {
    type: string;
    displayName: string;
    keywords: string[];
    pins: BlueprintNodePinDef[];
}): BlueprintNodeDef {
    return {
        type: input.type,
        displayName: input.displayName,
        category: "Text",
        keywords: input.keywords,
        graphKinds: [...READ_GRAPH_KINDS],
        isPure: true,
        pins: input.pins,
        scope: TEXT_SCOPE,
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
        category: "Text",
        keywords: input.keywords,
        graphKinds: [...WRITE_GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        pins: [execIn, execNext, ...(input.pins ?? [])],
        scope: TEXT_SCOPE,
        execute: input.execute,
    };
}

function runtimeTextRef(ctx: Parameters<BlueprintNodeDef["execute"]>[0]) {
    const api = requireHostApi(ctx);
    const elementId = ctx.executionOwner?.elementId;
    if (!elementId) {
        throw new BlueprintGraphExecutionError("Text node requires a widget execution owner", ctx.node.id);
    }
    return { api, elementId };
}

function readCurrentText(ctx: Parameters<BlueprintNodeDef["execute"]>[0]): BlueprintTextProperties {
    const { api, elementId } = runtimeTextRef(ctx);
    return api.widget.getTextProperties(elementId);
}

async function patchCurrentText(
    ctx: Parameters<BlueprintNodeDef["execute"]>[0],
    patch: BlueprintTextPropertiesPatch,
) {
    const { api, elementId } = runtimeTextRef(ctx);
    await api.widget.setTextProperties(elementId, patch);
    return { nextPort: "next" };
}

function readPin(ctx: Parameters<BlueprintNodeDef["execute"]>[0], pinId: string): unknown {
    return resolveDataPinValue(ctx.graph, ctx.node.id, pinId, ctx.params, ctx.blueprintLocals, 0, {
        hostAdapter: ctx.hostAdapter,
        eventPayload: ctx.eventPayload,
        executionOwner: ctx.executionOwner,
    });
}

function toStringValue(raw: unknown, fallback: string): string {
    return raw == null ? fallback : String(raw);
}

function toFontAssetId(raw: unknown, fallback: string | null): string | null {
    if (raw === undefined) {
        return fallback;
    }
    if (raw === null) {
        return null;
    }
    const s = String(raw).trim();
    return s.length > 0 ? s : null;
}

function toFiniteNumber(raw: unknown, fallback: number): number {
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(n) ? n : fallback;
}

function toEnumValue<T extends string>(raw: unknown, allowed: readonly T[], fallback: T): T {
    const value = String(raw ?? "");
    return allowed.includes(value as T) ? (value as T) : fallback;
}

function buildAllPropertiesPatch(
    ctx: Parameters<BlueprintNodeDef["execute"]>[0],
    current: BlueprintTextProperties,
): BlueprintTextProperties {
    return {
        text: toStringValue(readPin(ctx, "text"), current.text),
        fontAssetId: toFontAssetId(readPin(ctx, "fontAssetId"), current.fontAssetId),
        fontSize: Math.max(1, toFiniteNumber(readPin(ctx, "fontSize"), current.fontSize)),
        fontWeight: toEnumValue(readPin(ctx, "fontWeight"), FONT_WEIGHT_VALUES, current.fontWeight),
        color: toStringValue(readPin(ctx, "color"), current.color).trim() || current.color,
        textAlign: toEnumValue(readPin(ctx, "textAlign"), TEXT_ALIGN_VALUES, current.textAlign),
        textVerticalAlign: toEnumValue(
            readPin(ctx, "textVerticalAlign"),
            TEXT_VERTICAL_ALIGN_VALUES,
            current.textVerticalAlign,
        ),
        lineHeight: Math.max(0.1, toFiniteNumber(readPin(ctx, "lineHeight"), current.lineHeight)),
        textWrapMode: toEnumValue(
            readPin(ctx, "textWrapMode"),
            TEXT_WRAP_MODE_VALUES,
            current.textWrapMode,
        ),
        effects: normalizeElementEffectValues(readPin(ctx, "effects") ?? current.effects),
    };
}

export const textBlueprintNodes: BlueprintNodeDef[] = [
    readNode({
        type: BLUEPRINT_NODE_TYPE_TEXT_GET_TEXT,
        displayName: "Get Text",
        keywords: ["text", "content", "value"],
        pins: [out("text", "Text", "string")],
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT,
        displayName: "Set Text",
        keywords: ["text", "content", "set", "value"],
        pins: [stringIn("text", "Text")],
        execute: ctx => patchCurrentText(ctx, { text: toStringValue(readPin(ctx, "text"), "") }),
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_TEXT_APPEND_TEXT,
        displayName: "Append Text",
        keywords: ["text", "append", "concat", "content"],
        pins: [stringIn("text", "Text")],
        execute: ctx => {
            const current = readCurrentText(ctx);
            return patchCurrentText(ctx, { text: `${current.text}${toStringValue(readPin(ctx, "text"), "")}` });
        },
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_TEXT_CLEAR_TEXT,
        displayName: "Clear Text",
        keywords: ["text", "clear", "empty"],
        execute: ctx => patchCurrentText(ctx, { text: "" }),
    }),
    readNode({
        type: BLUEPRINT_NODE_TYPE_TEXT_GET_FONT,
        displayName: "Get Font",
        keywords: ["text", "font", "asset"],
        pins: [out("fontAssetId", "Font", "string")],
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_TEXT_SET_FONT,
        displayName: "Set Font",
        keywords: ["text", "font", "asset"],
        pins: [stringIn("fontAssetId", "Font")],
        execute: ctx => patchCurrentText(ctx, { fontAssetId: toFontAssetId(readPin(ctx, "fontAssetId"), null) }),
    }),
    readNode({
        type: BLUEPRINT_NODE_TYPE_TEXT_GET_FONT_SIZE,
        displayName: "Get Font Size",
        keywords: ["text", "font", "size"],
        pins: [out("fontSize", "Font Size", "float")],
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_TEXT_SET_FONT_SIZE,
        displayName: "Set Font Size",
        keywords: ["text", "font", "size"],
        pins: [floatIn("fontSize", "Font Size")],
        execute: ctx =>
            patchCurrentText(ctx, { fontSize: Math.max(1, toFiniteNumber(readPin(ctx, "fontSize"), 16)) }),
    }),
    readNode({
        type: BLUEPRINT_NODE_TYPE_TEXT_GET_FONT_WEIGHT,
        displayName: "Get Font Weight",
        keywords: ["text", "font", "weight", "bold"],
        pins: [out("fontWeight", "Font Weight", "string")],
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_TEXT_SET_FONT_WEIGHT,
        displayName: "Set Font Weight",
        keywords: ["text", "font", "weight", "bold"],
        pins: [stringIn("fontWeight", "Font Weight")],
        execute: ctx =>
            patchCurrentText(ctx, {
                fontWeight: toEnumValue(readPin(ctx, "fontWeight"), FONT_WEIGHT_VALUES, "normal"),
            }),
    }),
    readNode({
        type: BLUEPRINT_NODE_TYPE_TEXT_GET_TEXT_COLOR,
        displayName: "Get Text Color",
        keywords: ["text", "color", "fill"],
        pins: [out("color", "Color", "string")],
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT_COLOR,
        displayName: "Set Text Color",
        keywords: ["text", "color", "fill"],
        pins: [stringIn("color", "Color")],
        execute: ctx => {
            const current = readCurrentText(ctx);
            const color = toStringValue(readPin(ctx, "color"), current.color).trim() || current.color;
            return patchCurrentText(ctx, { color });
        },
    }),
    readNode({
        type: BLUEPRINT_NODE_TYPE_TEXT_GET_TEXT_ALIGN,
        displayName: "Get Text Align",
        keywords: ["text", "align", "horizontal"],
        pins: [out("textAlign", "Text Align", "string")],
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT_ALIGN,
        displayName: "Set Text Align",
        keywords: ["text", "align", "horizontal"],
        pins: [stringIn("textAlign", "Text Align")],
        execute: ctx =>
            patchCurrentText(ctx, {
                textAlign: toEnumValue(readPin(ctx, "textAlign"), TEXT_ALIGN_VALUES, "left"),
            }),
    }),
    readNode({
        type: BLUEPRINT_NODE_TYPE_TEXT_GET_TEXT_VERTICAL_ALIGN,
        displayName: "Get Text Vertical Align",
        keywords: ["text", "align", "vertical"],
        pins: [out("textVerticalAlign", "Vertical Align", "string")],
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT_VERTICAL_ALIGN,
        displayName: "Set Text Vertical Align",
        keywords: ["text", "align", "vertical"],
        pins: [stringIn("textVerticalAlign", "Vertical Align")],
        execute: ctx =>
            patchCurrentText(ctx, {
                textVerticalAlign: toEnumValue(
                    readPin(ctx, "textVerticalAlign"),
                    TEXT_VERTICAL_ALIGN_VALUES,
                    "start",
                ),
            }),
    }),
    readNode({
        type: BLUEPRINT_NODE_TYPE_TEXT_GET_LINE_HEIGHT,
        displayName: "Get Line Height",
        keywords: ["text", "line", "height"],
        pins: [out("lineHeight", "Line Height", "float")],
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_TEXT_SET_LINE_HEIGHT,
        displayName: "Set Line Height",
        keywords: ["text", "line", "height"],
        pins: [floatIn("lineHeight", "Line Height")],
        execute: ctx =>
            patchCurrentText(ctx, { lineHeight: Math.max(0.1, toFiniteNumber(readPin(ctx, "lineHeight"), 1.4)) }),
    }),
    readNode({
        type: BLUEPRINT_NODE_TYPE_TEXT_GET_WRAP_MODE,
        displayName: "Get Wrap Mode",
        keywords: ["text", "wrap", "line"],
        pins: [out("textWrapMode", "Wrap Mode", "string")],
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_TEXT_SET_WRAP_MODE,
        displayName: "Set Wrap Mode",
        keywords: ["text", "wrap", "line"],
        pins: [stringIn("textWrapMode", "Wrap Mode")],
        execute: ctx =>
            patchCurrentText(ctx, {
                textWrapMode: toEnumValue(readPin(ctx, "textWrapMode"), TEXT_WRAP_MODE_VALUES, "word"),
            }),
    }),
    readNode({
        type: BLUEPRINT_NODE_TYPE_TEXT_GET_EFFECTS,
        displayName: "Get Effects",
        keywords: ["text", "effects", "style"],
        pins: [out("effects", "Effects", "json")],
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_TEXT_SET_EFFECTS,
        displayName: "Set Effects",
        keywords: ["text", "effects", "style"],
        pins: [jsonIn("effects", "Effects")],
        execute: ctx => {
            const current = readCurrentText(ctx);
            return patchCurrentText(ctx, {
                effects: normalizeElementEffectValues(readPin(ctx, "effects") ?? current.effects),
            });
        },
    }),
    readNode({
        type: BLUEPRINT_NODE_TYPE_TEXT_GET_ALL_PROPERTIES,
        displayName: "Get All Properties",
        keywords: ["text", "properties", "all"],
        pins: textAllPropertyOutputs,
    }),
    writeNode({
        type: BLUEPRINT_NODE_TYPE_TEXT_SET_ALL_PROPERTIES,
        displayName: "Set All Properties",
        keywords: ["text", "properties", "all"],
        pins: textAllPropertyInputs,
        execute: ctx => patchCurrentText(ctx, buildAllPropertiesPatch(ctx, readCurrentText(ctx))),
    }),
];
