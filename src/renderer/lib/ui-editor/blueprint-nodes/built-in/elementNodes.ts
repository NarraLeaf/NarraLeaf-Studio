/**
 * Magic Element Literal and element-targeted nodes.
 * Comments in English per project convention.
 */

import {
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_BOUNDS,
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_ANIMATE_PROPERTY,
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_OPACITY,
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_POSITION,
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_PROPERTY,
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_ROTATION,
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_SIZE,
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_VARIANT,
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_VISIBLE,
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_PROPERTY,
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_VARIANT,
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_STOP_ANIMATION,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_ANIMATE_PROPERTY,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_BOUNDS,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_OPACITY,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_POSITION,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_PROPERTY,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_ROTATION,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_SIZE,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_VARIANT,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_VISIBLE,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_VARIANT,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_STOP_ANIMATION,
    BLUEPRINT_NODE_TYPE_ELEMENT_REF,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_APPEND_TEXT,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_CLEAR_TEXT,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_ALL_PROPERTIES,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_EFFECTS,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_FONT,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_FONT_SIZE,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_FONT_WEIGHT,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_LINE_HEIGHT,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_TEXT,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_TEXT_ALIGN,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_TEXT_COLOR,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_TEXT_VERTICAL_ALIGN,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_WRAP_MODE,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_ALL_PROPERTIES,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_EFFECTS,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_FONT,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_FONT_SIZE,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_FONT_WEIGHT,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_LINE_HEIGHT,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_TEXT,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_TEXT_ALIGN,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_TEXT_COLOR,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_TEXT_VERTICAL_ALIGN,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_WRAP_MODE,
} from "@shared/types/blueprint/graph";
import {
    BLUEPRINT_VALUE_TYPE_ELEMENT,
    BLUEPRINT_VALUE_TYPE_RGBA_COLOR,
    BLUEPRINT_VALUE_TYPE_VECTOR2D,
    blueprintElementValueType,
    blueprintRGBAColorToCss,
} from "@shared/types/blueprint/valueTypes";
import { normalizeElementEffectValues } from "@shared/types/ui-editor/effects";
import { BlueprintGraphExecutionError } from "../../behavior-graph/GraphExecutionError";
import type {
    BlueprintTextProperties,
    BlueprintTextPropertiesPatch,
} from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import type { BlueprintNodeDef, BlueprintNodePinDef } from "../types";
import { requireHostApi } from "./hostApi";
import { resolveDataPinValue } from "./graphParamResolvers";
import { normalizeBlueprintElementRefValue } from "./elementRefUtils";

const READ_GRAPH_KINDS = ["event", "function", "macro"] as const;
const WRITE_GRAPH_KINDS = ["event", "macro"] as const;
const TEXT_ELEMENT_TYPE = "nl.text";
const DISPLAYABLE_WIDGET_TYPES = ["nl.container", "nl.text", "nl.image", "nl.button", "nl.slider", "nl.list", "nl.frame"];
const APPEARANCE_VARIANT_WIDGET_TYPES = ["nl.container", "nl.text", "nl.image", "nl.button"];
const FONT_WEIGHT_VALUES = ["normal", "600", "bold"] as const;
const TEXT_ALIGN_VALUES = ["left", "center", "right"] as const;
const TEXT_VERTICAL_ALIGN_VALUES = ["start", "center", "end"] as const;
const TEXT_WRAP_MODE_VALUES = ["word", "character", "nowrap"] as const;
const DISPLAYABLE_ANIMATION_PROPERTIES = ["opacity", "offsetX", "offsetY", "scale", "rotation"] as const;
const DISPLAYABLE_ANIMATION_EASINGS = ["linear", "easeIn", "easeOut", "easeInOut", "circIn", "circOut", "circInOut"] as const;
const DISPLAYABLE_ANIMATION_AFTER_MODES = ["hold", "reset"] as const;
const DISPLAYABLE_SET_VARIANT_WAIT_MODES = ["continue", "wait"] as const;
const DISPLAYABLE_GET_PROPERTIES = [
    "position",
    "size",
    "bounds",
    "x",
    "y",
    "width",
    "height",
    "rotation",
    "opacity",
    "visible",
] as const;
const DISPLAYABLE_SET_PROPERTIES = ["x", "y", "width", "height", "rotation", "opacity", "visible"] as const;

const execIn: BlueprintNodePinDef = { id: "in", kind: "input", semantic: "exec", label: "In" };
const execNext: BlueprintNodePinDef = { id: "next", kind: "output", semantic: "exec", label: "Next" };
const elementOut: BlueprintNodePinDef = {
    id: "element",
    kind: "output",
    semantic: "data",
    valueType: BLUEPRINT_VALUE_TYPE_ELEMENT,
    label: "Element",
};
const genericElementIn: BlueprintNodePinDef = {
    id: "element",
    kind: "input",
    semantic: "data",
    valueType: BLUEPRINT_VALUE_TYPE_ELEMENT,
    label: "Element",
};
const textElementIn: BlueprintNodePinDef = {
    ...genericElementIn,
    valueType: blueprintElementValueType(TEXT_ELEMENT_TYPE),
};

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
const colorIn = (id: string, label: string): BlueprintNodePinDef => dataIn(id, label, BLUEPRINT_VALUE_TYPE_RGBA_COLOR);
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
    colorIn("color", "Color"),
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
    out("color", "Color", BLUEPRINT_VALUE_TYPE_RGBA_COLOR),
    out("textAlign", "Text Align", "string"),
    out("textVerticalAlign", "Vertical Align", "string"),
    out("lineHeight", "Line Height", "float"),
    out("textWrapMode", "Wrap Mode", "string"),
    out("effects", "Effects", "json"),
];

function textReadNode(input: {
    type: string;
    displayName: string;
    keywords: string[];
    pins: BlueprintNodePinDef[];
}): BlueprintNodeDef {
    return {
        type: input.type,
        displayName: input.displayName,
        category: "Element",
        keywords: input.keywords,
        graphKinds: [...READ_GRAPH_KINDS],
        isPure: true,
        magicElementTarget: { inputPinId: "element", elementTypes: [TEXT_ELEMENT_TYPE] },
        pins: [textElementIn, ...input.pins],
        execute: () => ({}),
    };
}

function textWriteNode(input: {
    type: string;
    displayName: string;
    keywords: string[];
    pins?: BlueprintNodePinDef[];
    execute: BlueprintNodeDef["execute"];
}): BlueprintNodeDef {
    return {
        type: input.type,
        displayName: input.displayName,
        category: "Element",
        keywords: input.keywords,
        graphKinds: [...WRITE_GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        magicElementTarget: { inputPinId: "element", elementTypes: [TEXT_ELEMENT_TYPE] },
        pins: [execIn, execNext, textElementIn, ...(input.pins ?? [])],
        execute: input.execute,
    };
}

function displayableReadNode(input: {
    type: string;
    displayName: string;
    keywords: string[];
    pins: BlueprintNodePinDef[];
    target: "self" | "element";
    hideInPalette?: boolean;
    inspectorParams?: BlueprintNodeDef["inspectorParams"];
}): BlueprintNodeDef {
    const elementTarget = input.target === "element";
    return {
        type: input.type,
        displayName: input.displayName,
        category: elementTarget ? "Element" : "Displayable",
        keywords: input.keywords,
        graphKinds: [...READ_GRAPH_KINDS],
        hideInPalette: input.hideInPalette,
        isPure: true,
        magicElementTarget: elementTarget ? { inputPinId: "element" } : undefined,
        pins: elementTarget ? [genericElementIn, ...input.pins] : input.pins,
        inspectorParams: input.inspectorParams,
        scope: elementTarget
            ? undefined
            : { ownerKinds: ["widgetMain"], widgetElementTypes: DISPLAYABLE_WIDGET_TYPES },
        execute: () => ({}),
    };
}

function displayableVariantReadNode(input: {
    type: string;
    displayName: string;
    keywords: string[];
    target: "self" | "element";
    hideInPalette?: boolean;
}): BlueprintNodeDef {
    const elementTarget = input.target === "element";
    return {
        type: input.type,
        displayName: input.displayName,
        category: elementTarget ? "Element" : "Displayable",
        keywords: input.keywords,
        graphKinds: [...READ_GRAPH_KINDS],
        hideInPalette: input.hideInPalette,
        isPure: true,
        magicElementTarget: elementTarget
            ? { inputPinId: "element", elementTypes: APPEARANCE_VARIANT_WIDGET_TYPES }
            : undefined,
        pins: elementTarget
            ? [genericElementIn, out("variantId", "Variant", "string")]
            : [out("variantId", "Variant", "string")],
        scope: elementTarget
            ? undefined
            : { ownerKinds: ["widgetMain"], widgetElementTypes: [...APPEARANCE_VARIANT_WIDGET_TYPES] },
        execute: () => ({}),
    };
}

function displayableWriteNode(input: {
    type: string;
    displayName: string;
    keywords: string[];
    pins?: BlueprintNodePinDef[];
    target: "self" | "element";
    elementTypes?: readonly string[];
    inspectorParams?: BlueprintNodeDef["inspectorParams"];
    execute: BlueprintNodeDef["execute"];
}): BlueprintNodeDef {
    const elementTarget = input.target === "element";
    return {
        type: input.type,
        displayName: input.displayName,
        category: elementTarget ? "Element" : "Displayable",
        keywords: input.keywords,
        graphKinds: [...WRITE_GRAPH_KINDS],
        isPure: false,
        isLatent: true,
        magicElementTarget: elementTarget
            ? { inputPinId: "element", elementTypes: input.elementTypes }
            : undefined,
        pins: elementTarget ? [execIn, execNext, genericElementIn, ...(input.pins ?? [])] : [execIn, execNext, ...(input.pins ?? [])],
        inspectorParams: input.inspectorParams,
        scope: elementTarget
            ? undefined
            : { ownerKinds: ["widgetMain"], widgetElementTypes: [...(input.elementTypes ?? DISPLAYABLE_WIDGET_TYPES)] },
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

function resolveElementId(ctx: Parameters<BlueprintNodeDef["execute"]>[0], expectedElementType: string): string {
    const ref = normalizeBlueprintElementRefValue(readPin(ctx, "element"));
    if (!ref) {
        throw new BlueprintGraphExecutionError("Element node requires a bound element input", ctx.node.id);
    }
    if (ref.elementType !== expectedElementType) {
        throw new BlueprintGraphExecutionError(`Element node expected ${expectedElementType}, got ${ref.elementType}`, ctx.node.id);
    }
    const currentSurfaceId = ctx.executionOwner?.surfaceId;
    if (currentSurfaceId && ref.surfaceId !== currentSurfaceId) {
        throw new BlueprintGraphExecutionError("Element node can only target the current Surface", ctx.node.id);
    }
    return ref.elementId;
}

function resolveDisplayableTargetElementId(
    ctx: Parameters<BlueprintNodeDef["execute"]>[0],
    target: "self" | "element",
    allowedElementTypes: readonly string[] = DISPLAYABLE_WIDGET_TYPES,
): string {
    if (target === "self") {
        const elementId = ctx.executionOwner?.elementId;
        if (!elementId) {
            throw new BlueprintGraphExecutionError("Displayable node requires a widget execution owner", ctx.node.id);
        }
        return elementId;
    }
    const ref = normalizeBlueprintElementRefValue(readPin(ctx, "element"));
    if (!ref) {
        throw new BlueprintGraphExecutionError("Displayable Element node requires an Element input", ctx.node.id);
    }
    if (!allowedElementTypes.includes(ref.elementType)) {
        throw new BlueprintGraphExecutionError(`Displayable Element node cannot target ${ref.elementType}`, ctx.node.id);
    }
    const currentSurfaceId = ctx.executionOwner?.surfaceId;
    if (currentSurfaceId && ref.surfaceId !== currentSurfaceId) {
        throw new BlueprintGraphExecutionError("Displayable Element node can only target the current Surface", ctx.node.id);
    }
    return ref.elementId;
}

function toStringValue(raw: unknown, fallback: string): string {
    return raw == null ? fallback : String(raw);
}

function toCssColorValue(raw: unknown, fallback: string): string {
    return raw === undefined || raw === null ? fallback : blueprintRGBAColorToCss(raw);
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

function toBooleanValue(raw: unknown, fallback: boolean): boolean {
    if (raw === undefined || raw === null) {
        return fallback;
    }
    if (typeof raw === "boolean") {
        return raw;
    }
    if (typeof raw === "number") {
        return Number.isFinite(raw) ? raw !== 0 : fallback;
    }
    const normalized = String(raw).trim().toLowerCase();
    if (["true", "1", "yes", "show", "visible"].includes(normalized)) {
        return true;
    }
    if (["false", "0", "no", "hide", "hidden"].includes(normalized)) {
        return false;
    }
    return fallback;
}

function toNullableString(raw: unknown): string | null {
    if (raw === null) {
        return null;
    }
    const s = String(raw ?? "").trim();
    return s.length > 0 ? s : null;
}

function toEnumValue<T extends string>(raw: unknown, allowed: readonly T[], fallback: T): T {
    const value = String(raw ?? "");
    return allowed.includes(value as T) ? (value as T) : fallback;
}

function normalizeOpacityInput(value: number): number {
    const opacity = value > 1 ? value / 100 : value;
    return Math.max(0, Math.min(1, opacity));
}

function shouldWaitForVariantTransition(raw: unknown): boolean {
    if (typeof raw === "boolean") {
        return raw;
    }
    if (typeof raw === "number") {
        return Number.isFinite(raw) ? raw !== 0 : false;
    }
    const normalized = String(raw ?? "").trim().toLowerCase();
    if (normalized === "true" || normalized === "yes") {
        return true;
    }
    if (normalized === "false" || normalized === "no") {
        return false;
    }
    const value = toEnumValue(raw, DISPLAYABLE_SET_VARIANT_WAIT_MODES, "continue");
    return value === "wait";
}

function displayableAnimateInspectorParams(): BlueprintNodeDef["inspectorParams"] {
    return [
        {
            key: "property",
            label: "Property",
            kind: "select",
            options: [
                { value: "opacity", label: "Opacity" },
                { value: "offsetX", label: "Offset X" },
                { value: "offsetY", label: "Offset Y" },
                { value: "scale", label: "Scale" },
                { value: "rotation", label: "Rotation" },
            ],
        },
        { key: "from", label: "From", kind: "number" },
        { key: "to", label: "To", kind: "number" },
        { key: "duration", label: "Duration (s)", kind: "number" },
        { key: "delay", label: "Delay (s)", kind: "number" },
        {
            key: "easing",
            label: "Easing",
            kind: "select",
            options: [
                { value: "linear", label: "Linear" },
                { value: "easeIn", label: "Ease In" },
                { value: "easeOut", label: "Ease Out" },
                { value: "easeInOut", label: "Ease In Out" },
                { value: "circIn", label: "Circ In" },
                { value: "circOut", label: "Circ Out" },
                { value: "circInOut", label: "Circ In Out" },
            ],
        },
        {
            key: "after",
            label: "After",
            kind: "select",
            options: [
                { value: "hold", label: "Hold final value" },
                { value: "reset", label: "Reset after animation" },
            ],
        },
    ];
}

function displayableGetPropertyInspectorParams(): BlueprintNodeDef["inspectorParams"] {
    return [
        {
            key: "property",
            label: "Property",
            kind: "select",
            options: [
                { value: "position", label: "Position" },
                { value: "size", label: "Size" },
                { value: "bounds", label: "Bounds" },
                { value: "x", label: "X" },
                { value: "y", label: "Y" },
                { value: "width", label: "Width" },
                { value: "height", label: "Height" },
                { value: "rotation", label: "Rotation" },
                { value: "opacity", label: "Opacity" },
                { value: "visible", label: "Visible" },
            ],
        },
    ];
}

function displayableSetPropertyInspectorParams(): BlueprintNodeDef["inspectorParams"] {
    return [
        {
            key: "property",
            label: "Property",
            kind: "select",
            options: [
                { value: "x", label: "X" },
                { value: "y", label: "Y" },
                { value: "width", label: "Width" },
                { value: "height", label: "Height" },
                { value: "rotation", label: "Rotation" },
                { value: "opacity", label: "Opacity" },
                { value: "visible", label: "Visible" },
            ],
        },
        { key: "value", label: "Value", kind: "literal" },
    ];
}

async function setDisplayableVariant(ctx: Parameters<BlueprintNodeDef["execute"]>[0], target: "self" | "element") {
    const api = requireHostApi(ctx);
    const elementId = resolveDisplayableTargetElementId(ctx, target, APPEARANCE_VARIANT_WIDGET_TYPES);
    await api.widget.setVariant(elementId, toNullableString(ctx.params.variantId), {
        waitForTransition: shouldWaitForVariantTransition(ctx.params.waitForTransition),
    });
    return { nextPort: "next" };
}

async function setDisplayableProperty(ctx: Parameters<BlueprintNodeDef["execute"]>[0], target: "self" | "element") {
    const api = requireHostApi(ctx);
    const elementId = resolveDisplayableTargetElementId(ctx, target);
    const current = api.widget.getDisplayableProperties(elementId);
    const property = toEnumValue(ctx.params.property, DISPLAYABLE_SET_PROPERTIES, "opacity");
    const raw = readPin(ctx, "value");
    if (property === "visible") {
        await api.widget.setDisplayableProperties(elementId, { visible: toBooleanValue(raw, current.visible) });
        return { nextPort: "next" };
    }
    const fallback =
        property === "x" ? current.position.x :
        property === "y" ? current.position.y :
        property === "width" ? current.size.width :
        property === "height" ? current.size.height :
        property === "rotation" ? current.rotation :
        current.opacity;
    const value = toFiniteNumber(raw, fallback);
    await api.widget.setDisplayableProperties(elementId, {
        [property]: property === "opacity" ? normalizeOpacityInput(value) : value,
    });
    return { nextPort: "next" };
}

async function animateDisplayableProperty(ctx: Parameters<BlueprintNodeDef["execute"]>[0], target: "self" | "element") {
    const api = requireHostApi(ctx);
    const elementId = resolveDisplayableTargetElementId(ctx, target);
    const current = api.widget.getDisplayableProperties(elementId);
    const property = toEnumValue(ctx.params.property, DISPLAYABLE_ANIMATION_PROPERTIES, "opacity");
    const defaultFrom =
        property === "opacity" ? current.opacity :
        property === "rotation" ? current.rotation :
        property === "scale" ? 1 :
        0;
    const defaultTo =
        property === "opacity" ? current.opacity :
        property === "rotation" ? current.rotation :
        property === "scale" ? 1 :
        0;
    const rawFrom = toFiniteNumber(ctx.params.from, defaultFrom);
    const rawTo = toFiniteNumber(ctx.params.to, defaultTo);
    const from = property === "opacity" ? normalizeOpacityInput(rawFrom) : rawFrom;
    const to = property === "opacity" ? normalizeOpacityInput(rawTo) : rawTo;
    const durationMs = Math.max(0, toFiniteNumber(ctx.params.duration, 0.3)) * 1000;
    const delayMs = Math.max(0, toFiniteNumber(ctx.params.delay, 0)) * 1000;
    const easing = toEnumValue(ctx.params.easing, DISPLAYABLE_ANIMATION_EASINGS, "easeOut");
    const after = toEnumValue(ctx.params.after, DISPLAYABLE_ANIMATION_AFTER_MODES, "hold");
    const targetMotion = (() => {
        switch (property) {
            case "opacity":
                return { opacity: [from, to] };
            case "offsetX":
                return { x: [from, to] };
            case "offsetY":
                return { y: [from, to] };
            case "scale":
                return { scale: [from, to] };
            case "rotation":
            default:
                return { rotate: [from, to] };
        }
    })();
    await api.widget.animateDisplayable(elementId, {
        target: targetMotion,
        transition: {
            type: "tween",
            durationMs,
            delayMs,
            easing,
        },
        resetOnComplete: after === "reset",
    });
    return { nextPort: "next" };
}

async function stopDisplayableAnimation(ctx: Parameters<BlueprintNodeDef["execute"]>[0], target: "self" | "element") {
    const api = requireHostApi(ctx);
    await api.widget.stopDisplayableAnimation(resolveDisplayableTargetElementId(ctx, target));
    return { nextPort: "next" };
}

function readTargetText(ctx: Parameters<BlueprintNodeDef["execute"]>[0]): { elementId: string; current: BlueprintTextProperties } {
    const api = requireHostApi(ctx);
    const elementId = resolveElementId(ctx, TEXT_ELEMENT_TYPE);
    return { elementId, current: api.widget.getTextProperties(elementId) };
}

async function patchTargetText(
    ctx: Parameters<BlueprintNodeDef["execute"]>[0],
    patch: BlueprintTextPropertiesPatch,
) {
    const api = requireHostApi(ctx);
    const elementId = resolveElementId(ctx, TEXT_ELEMENT_TYPE);
    await api.widget.setTextProperties(elementId, patch);
    return { nextPort: "next" };
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
        color: toCssColorValue(readPin(ctx, "color"), current.color).trim() || current.color,
        textAlign: toEnumValue(readPin(ctx, "textAlign"), TEXT_ALIGN_VALUES, current.textAlign),
        textVerticalAlign: toEnumValue(
            readPin(ctx, "textVerticalAlign"),
            TEXT_VERTICAL_ALIGN_VALUES,
            current.textVerticalAlign,
        ),
        lineHeight: Math.max(0.1, toFiniteNumber(readPin(ctx, "lineHeight"), current.lineHeight)),
        textWrapMode: toEnumValue(readPin(ctx, "textWrapMode"), TEXT_WRAP_MODE_VALUES, current.textWrapMode),
        effects: normalizeElementEffectValues(readPin(ctx, "effects") ?? current.effects),
    };
}

export const elementBlueprintNodes: BlueprintNodeDef[] = [
    {
        type: BLUEPRINT_NODE_TYPE_ELEMENT_REF,
        displayName: "Element",
        category: "Element",
        keywords: ["element", "widget", "reference", "magic", "literal"],
        graphKinds: ["event", "function", "macro"],
        isPure: true,
        role: "elementLiteral",
        pins: [elementOut],
        execute: () => ({}),
    },
    displayableReadNode({
        type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_POSITION,
        displayName: "Get Position",
        keywords: ["displayable", "position", "layout", "x", "y"],
        pins: [out("position", "Position", BLUEPRINT_VALUE_TYPE_VECTOR2D)],
        target: "self",
        hideInPalette: true,
    }),
    displayableReadNode({
        type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_SIZE,
        displayName: "Get Size",
        keywords: ["displayable", "size", "layout", "width", "height"],
        pins: [out("size", "Size", BLUEPRINT_VALUE_TYPE_VECTOR2D)],
        target: "self",
        hideInPalette: true,
    }),
    displayableReadNode({
        type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_BOUNDS,
        displayName: "Get Bounds",
        keywords: ["displayable", "bounds", "layout", "rect"],
        pins: [out("bounds", "Bounds", "json")],
        target: "self",
        hideInPalette: true,
    }),
    displayableReadNode({
        type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_ROTATION,
        displayName: "Get Rotation",
        keywords: ["displayable", "rotation", "angle"],
        pins: [out("rotation", "Rotation", "float")],
        target: "self",
        hideInPalette: true,
    }),
    displayableReadNode({
        type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_OPACITY,
        displayName: "Get Opacity",
        keywords: ["displayable", "opacity", "alpha"],
        pins: [out("opacity", "Opacity", "float")],
        target: "self",
        hideInPalette: true,
    }),
    displayableReadNode({
        type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_VISIBLE,
        displayName: "Get Visible",
        keywords: ["displayable", "visible", "visibility"],
        pins: [out("visible", "Visible", "boolean")],
        target: "self",
        hideInPalette: true,
    }),
    displayableReadNode({
        type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_PROPERTY,
        displayName: "Get Property",
        keywords: ["displayable", "property", "position", "size", "bounds", "visible"],
        pins: [out("value", "Value", "any")],
        target: "self",
        hideInPalette: false,
        inspectorParams: displayableGetPropertyInspectorParams(),
    }),
    displayableWriteNode({
        type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_PROPERTY,
        displayName: "Set Property",
        keywords: ["displayable", "property", "layout", "visible", "set"],
        pins: [dataIn("value", "Value", "any")],
        target: "self",
        inspectorParams: displayableSetPropertyInspectorParams(),
        execute: ctx => setDisplayableProperty(ctx, "self"),
    }),
    displayableVariantReadNode({
        type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_VARIANT,
        displayName: "Get Variant",
        keywords: ["displayable", "variant", "appearance", "state"],
        target: "self",
        hideInPalette: true,
    }),
    displayableWriteNode({
        type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_VARIANT,
        displayName: "Set Variant",
        keywords: ["displayable", "variant", "appearance", "set", "state"],
        target: "self",
        elementTypes: APPEARANCE_VARIANT_WIDGET_TYPES,
        execute: ctx => setDisplayableVariant(ctx, "self"),
    }),
    displayableWriteNode({
        type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_ANIMATE_PROPERTY,
        displayName: "Animate Property",
        keywords: ["displayable", "animate", "property", "motion", "transition", "tween"],
        target: "self",
        inspectorParams: displayableAnimateInspectorParams(),
        execute: ctx => animateDisplayableProperty(ctx, "self"),
    }),
    displayableWriteNode({
        type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_STOP_ANIMATION,
        displayName: "Stop Animation",
        keywords: ["displayable", "animate", "animation", "motion", "stop"],
        target: "self",
        execute: ctx => stopDisplayableAnimation(ctx, "self"),
    }),
    displayableReadNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_POSITION,
        displayName: "Get Element Position",
        keywords: ["element", "displayable", "position", "layout", "x", "y"],
        pins: [out("position", "Position", BLUEPRINT_VALUE_TYPE_VECTOR2D)],
        target: "element",
        hideInPalette: true,
    }),
    displayableReadNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_SIZE,
        displayName: "Get Element Size",
        keywords: ["element", "displayable", "size", "layout", "width", "height"],
        pins: [out("size", "Size", BLUEPRINT_VALUE_TYPE_VECTOR2D)],
        target: "element",
        hideInPalette: true,
    }),
    displayableReadNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_BOUNDS,
        displayName: "Get Element Bounds",
        keywords: ["element", "displayable", "bounds", "layout", "rect"],
        pins: [out("bounds", "Bounds", "json")],
        target: "element",
        hideInPalette: true,
    }),
    displayableReadNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_ROTATION,
        displayName: "Get Element Rotation",
        keywords: ["element", "displayable", "rotation", "angle"],
        pins: [out("rotation", "Rotation", "float")],
        target: "element",
        hideInPalette: true,
    }),
    displayableReadNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_OPACITY,
        displayName: "Get Element Opacity",
        keywords: ["element", "displayable", "opacity", "alpha"],
        pins: [out("opacity", "Opacity", "float")],
        target: "element",
        hideInPalette: true,
    }),
    displayableReadNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_VISIBLE,
        displayName: "Get Element Visible",
        keywords: ["element", "displayable", "visible", "visibility"],
        pins: [out("visible", "Visible", "boolean")],
        target: "element",
        hideInPalette: true,
    }),
    displayableReadNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_PROPERTY,
        displayName: "Get Element Property",
        keywords: ["element", "displayable", "property", "position", "size", "bounds", "visible"],
        pins: [out("value", "Value", "any")],
        target: "element",
        inspectorParams: displayableGetPropertyInspectorParams(),
    }),
    displayableWriteNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY,
        displayName: "Set Element Property",
        keywords: ["element", "displayable", "property", "layout", "visible", "set"],
        pins: [dataIn("value", "Value", "any")],
        target: "element",
        inspectorParams: displayableSetPropertyInspectorParams(),
        execute: ctx => setDisplayableProperty(ctx, "element"),
    }),
    displayableVariantReadNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_VARIANT,
        displayName: "Get Element Variant",
        keywords: ["element", "displayable", "variant", "appearance", "state"],
        target: "element",
        hideInPalette: true,
    }),
    displayableWriteNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_VARIANT,
        displayName: "Set Element Variant",
        keywords: ["element", "displayable", "variant", "appearance", "set", "state"],
        target: "element",
        elementTypes: APPEARANCE_VARIANT_WIDGET_TYPES,
        execute: ctx => setDisplayableVariant(ctx, "element"),
    }),
    displayableWriteNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_ANIMATE_PROPERTY,
        displayName: "Animate Element Property",
        keywords: ["element", "displayable", "animate", "property", "motion", "transition", "tween"],
        target: "element",
        inspectorParams: displayableAnimateInspectorParams(),
        execute: ctx => animateDisplayableProperty(ctx, "element"),
    }),
    displayableWriteNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_STOP_ANIMATION,
        displayName: "Stop Element Animation",
        keywords: ["element", "displayable", "animate", "animation", "motion", "stop"],
        target: "element",
        execute: ctx => stopDisplayableAnimation(ctx, "element"),
    }),
    textReadNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_TEXT,
        displayName: "Get Text",
        keywords: ["text", "content", "value", "element"],
        pins: [out("text", "Text", "string")],
    }),
    textWriteNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_TEXT,
        displayName: "Set Text",
        keywords: ["text", "content", "set", "value", "element"],
        pins: [stringIn("text", "Text")],
        execute: ctx => patchTargetText(ctx, { text: toStringValue(readPin(ctx, "text"), "") }),
    }),
    textWriteNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_APPEND_TEXT,
        displayName: "Append Text",
        keywords: ["text", "append", "concat", "content", "element"],
        pins: [stringIn("text", "Text")],
        execute: ctx => {
            const { current } = readTargetText(ctx);
            return patchTargetText(ctx, { text: `${current.text}${toStringValue(readPin(ctx, "text"), "")}` });
        },
    }),
    textWriteNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_CLEAR_TEXT,
        displayName: "Clear Text",
        keywords: ["text", "clear", "empty", "element"],
        execute: ctx => patchTargetText(ctx, { text: "" }),
    }),
    textReadNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_FONT,
        displayName: "Get Font",
        keywords: ["text", "font", "asset", "element"],
        pins: [out("fontAssetId", "Font", "string")],
    }),
    textWriteNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_FONT,
        displayName: "Set Font",
        keywords: ["text", "font", "asset", "element"],
        pins: [stringIn("fontAssetId", "Font")],
        execute: ctx => patchTargetText(ctx, { fontAssetId: toFontAssetId(readPin(ctx, "fontAssetId"), null) }),
    }),
    textReadNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_FONT_SIZE,
        displayName: "Get Font Size",
        keywords: ["text", "font", "size", "element"],
        pins: [out("fontSize", "Font Size", "float")],
    }),
    textWriteNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_FONT_SIZE,
        displayName: "Set Font Size",
        keywords: ["text", "font", "size", "element"],
        pins: [floatIn("fontSize", "Font Size")],
        execute: ctx => patchTargetText(ctx, { fontSize: Math.max(1, toFiniteNumber(readPin(ctx, "fontSize"), 16)) }),
    }),
    textReadNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_FONT_WEIGHT,
        displayName: "Get Font Weight",
        keywords: ["text", "font", "weight", "bold", "element"],
        pins: [out("fontWeight", "Font Weight", "string")],
    }),
    textWriteNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_FONT_WEIGHT,
        displayName: "Set Font Weight",
        keywords: ["text", "font", "weight", "bold", "element"],
        pins: [stringIn("fontWeight", "Font Weight")],
        execute: ctx => patchTargetText(ctx, { fontWeight: toEnumValue(readPin(ctx, "fontWeight"), FONT_WEIGHT_VALUES, "normal") }),
    }),
    textReadNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_TEXT_COLOR,
        displayName: "Get Text Color",
        keywords: ["text", "color", "fill", "element"],
        pins: [out("color", "Color", BLUEPRINT_VALUE_TYPE_RGBA_COLOR)],
    }),
    textWriteNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_TEXT_COLOR,
        displayName: "Set Text Color",
        keywords: ["text", "color", "fill", "element"],
        pins: [colorIn("color", "Color")],
        execute: ctx => {
            const { current } = readTargetText(ctx);
            const color = toCssColorValue(readPin(ctx, "color"), current.color).trim() || current.color;
            return patchTargetText(ctx, { color });
        },
    }),
    textReadNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_TEXT_ALIGN,
        displayName: "Get Text Align",
        keywords: ["text", "align", "horizontal", "element"],
        pins: [out("textAlign", "Text Align", "string")],
    }),
    textWriteNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_TEXT_ALIGN,
        displayName: "Set Text Align",
        keywords: ["text", "align", "horizontal", "element"],
        pins: [stringIn("textAlign", "Text Align")],
        execute: ctx => patchTargetText(ctx, { textAlign: toEnumValue(readPin(ctx, "textAlign"), TEXT_ALIGN_VALUES, "left") }),
    }),
    textReadNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_TEXT_VERTICAL_ALIGN,
        displayName: "Get Text Vertical Align",
        keywords: ["text", "align", "vertical", "element"],
        pins: [out("textVerticalAlign", "Vertical Align", "string")],
    }),
    textWriteNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_TEXT_VERTICAL_ALIGN,
        displayName: "Set Text Vertical Align",
        keywords: ["text", "align", "vertical", "element"],
        pins: [stringIn("textVerticalAlign", "Vertical Align")],
        execute: ctx =>
            patchTargetText(ctx, {
                textVerticalAlign: toEnumValue(readPin(ctx, "textVerticalAlign"), TEXT_VERTICAL_ALIGN_VALUES, "start"),
            }),
    }),
    textReadNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_LINE_HEIGHT,
        displayName: "Get Line Height",
        keywords: ["text", "line", "height", "element"],
        pins: [out("lineHeight", "Line Height", "float")],
    }),
    textWriteNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_LINE_HEIGHT,
        displayName: "Set Line Height",
        keywords: ["text", "line", "height", "element"],
        pins: [floatIn("lineHeight", "Line Height")],
        execute: ctx => patchTargetText(ctx, { lineHeight: Math.max(0.1, toFiniteNumber(readPin(ctx, "lineHeight"), 1.4)) }),
    }),
    textReadNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_WRAP_MODE,
        displayName: "Get Wrap Mode",
        keywords: ["text", "wrap", "line", "element"],
        pins: [out("textWrapMode", "Wrap Mode", "string")],
    }),
    textWriteNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_WRAP_MODE,
        displayName: "Set Wrap Mode",
        keywords: ["text", "wrap", "line", "element"],
        pins: [stringIn("textWrapMode", "Wrap Mode")],
        execute: ctx => patchTargetText(ctx, { textWrapMode: toEnumValue(readPin(ctx, "textWrapMode"), TEXT_WRAP_MODE_VALUES, "word") }),
    }),
    textReadNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_EFFECTS,
        displayName: "Get Effects",
        keywords: ["text", "effects", "style", "element"],
        pins: [out("effects", "Effects", "json")],
    }),
    textWriteNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_EFFECTS,
        displayName: "Set Effects",
        keywords: ["text", "effects", "style", "element"],
        pins: [jsonIn("effects", "Effects")],
        execute: ctx => {
            const { current } = readTargetText(ctx);
            return patchTargetText(ctx, { effects: normalizeElementEffectValues(readPin(ctx, "effects") ?? current.effects) });
        },
    }),
    textReadNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_ALL_PROPERTIES,
        displayName: "Get All Properties",
        keywords: ["text", "properties", "all", "element"],
        pins: textAllPropertyOutputs,
    }),
    textWriteNode({
        type: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_ALL_PROPERTIES,
        displayName: "Set All Properties",
        keywords: ["text", "properties", "all", "element"],
        pins: textAllPropertyInputs,
        execute: ctx => {
            const { current } = readTargetText(ctx);
            return patchTargetText(ctx, buildAllPropertiesPatch(ctx, current));
        },
    }),
];
