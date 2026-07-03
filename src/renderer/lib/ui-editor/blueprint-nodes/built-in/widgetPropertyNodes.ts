/**
 * Targeted built-in widget property nodes.
 * Self nodes never expose an Element input; Element nodes always require an explicit typed ref.
 */

import {
    BLUEPRINT_VALUE_TYPE_IMAGE_ASSET,
    BLUEPRINT_VALUE_TYPE_IMAGE_ASSET_NULLABLE,
    blueprintElementValueType,
    normalizeBlueprintImageAssetValue,
} from "@shared/types/blueprint/valueTypes";
import {
    BLUEPRINT_NODE_TYPE_BUTTON_SET_POINTER,
    BLUEPRINT_NODE_TYPE_ELEMENT_BUTTON_SET_POINTER,
    BLUEPRINT_NODE_TYPE_ELEMENT_FRAME_SET_PAGE,
    BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_CLEAR_ASSET,
    BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_GET_CROP_RECT,
    BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_GET_ASSET,
    BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_GET_FIT_MODE,
    BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_GET_FLIP_X,
    BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_GET_FLIP_Y,
    BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_SET_CROP_RECT,
    BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_SET_ASSET,
    BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_SET_FIT_MODE,
    BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_SET_FLIP_X,
    BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_SET_FLIP_Y,
    BLUEPRINT_NODE_TYPE_FRAME_WIDGET_SET_PAGE,
    BLUEPRINT_NODE_TYPE_IMAGE_ASSET_LITERAL,
    BLUEPRINT_NODE_TYPE_IMAGE_CLEAR_ASSET,
    BLUEPRINT_NODE_TYPE_IMAGE_GET_CROP_RECT,
    BLUEPRINT_NODE_TYPE_IMAGE_GET_ASSET,
    BLUEPRINT_NODE_TYPE_IMAGE_GET_FIT_MODE,
    BLUEPRINT_NODE_TYPE_IMAGE_GET_FLIP_X,
    BLUEPRINT_NODE_TYPE_IMAGE_GET_FLIP_Y,
    BLUEPRINT_NODE_TYPE_IMAGE_SET_CROP_RECT,
    BLUEPRINT_NODE_TYPE_IMAGE_SET_ASSET,
    BLUEPRINT_NODE_TYPE_IMAGE_SET_FIT_MODE,
    BLUEPRINT_NODE_TYPE_IMAGE_SET_FLIP_X,
    BLUEPRINT_NODE_TYPE_IMAGE_SET_FLIP_Y,
} from "@shared/types/blueprint/graph";
import { isButtonCursorValue, type ButtonCursorValue } from "@shared/types/ui-editor/appearance";
import type { ImageFillCropPlacement, ImageFillMode } from "@shared/types/ui-editor/imageFill";
import { BlueprintGraphExecutionError } from "../../behavior-graph/GraphExecutionError";
import type { BlueprintNodeDef, BlueprintNodePinDef } from "../types";
import { BLUEPRINT_FRAME_TARGET_SURFACE_OPTIONS_SOURCE } from "../frameTargetSurfaceOptions";
import { normalizeBlueprintElementRefValue } from "./elementRefUtils";
import { resolveDataPinValue } from "./graphParamResolvers";
import { requireHostApi } from "./hostApi";

const READ_GRAPH_KINDS = ["event", "function", "macro"] as const;
const WRITE_GRAPH_KINDS = ["event", "macro"] as const;

type TargetMode = "self" | "element";
type WidgetTarget = {
    key: string;
    elementType: string;
    label: string;
    supportsVariant?: boolean;
};

const WIDGET_TARGETS: WidgetTarget[] = [
    { key: "container", elementType: "nl.container", label: "Container", supportsVariant: true },
    { key: "text", elementType: "nl.text", label: "Text" },
    { key: "image", elementType: "nl.image", label: "Image" },
    { key: "button", elementType: "nl.button", label: "Button", supportsVariant: true },
    { key: "slider", elementType: "nl.slider", label: "Slider" },
    { key: "list", elementType: "nl.list", label: "List" },
    { key: "frame", elementType: "nl.frame", label: "Frame" },
];

const execIn: BlueprintNodePinDef = { id: "in", kind: "input", semantic: "exec", label: "In" };
const execNext: BlueprintNodePinDef = { id: "next", kind: "output", semantic: "exec", label: "Next" };

const dataIn = (id: string, label: string, valueType: string, allowInlineLiteral = false): BlueprintNodePinDef => ({
    id,
    kind: "input",
    semantic: "data",
    valueType,
    label,
    allowInlineLiteral,
});

const boolIn = (id: string, label: string): BlueprintNodePinDef => dataIn(id, label, "boolean");
const floatIn = (id: string, label: string): BlueprintNodePinDef => dataIn(id, label, "float", true);
const stringIn = (id: string, label: string): BlueprintNodePinDef => dataIn(id, label, "string", true);
const jsonIn = (id: string, label: string): BlueprintNodePinDef => dataIn(id, label, "json");
const optionalJsonIn = (id: string, label: string): BlueprintNodePinDef => ({
    ...jsonIn(id, label),
    optional: true,
});
const imageAssetNullableIn = (id: string, label: string): BlueprintNodePinDef =>
    dataIn(id, label, BLUEPRINT_VALUE_TYPE_IMAGE_ASSET_NULLABLE, true);
const out = (id: string, label: string, valueType: string): BlueprintNodePinDef => ({
    id,
    kind: "output",
    semantic: "data",
    valueType,
    label,
});

function elementIn(target: WidgetTarget): BlueprintNodePinDef {
    return {
        id: "element",
        kind: "input",
        semantic: "data",
        valueType: blueprintElementValueType(target.elementType),
        label: target.label,
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

function resolveTargetElementId(
    ctx: Parameters<BlueprintNodeDef["execute"]>[0],
    target: WidgetTarget,
    mode: TargetMode,
): string {
    if (mode === "self") {
        const elementId = ctx.executionOwner?.elementId;
        if (!elementId) {
            throw new BlueprintGraphExecutionError(`${target.label} node requires a widget execution owner`, ctx.node.id);
        }
        return elementId;
    }
    const ref = normalizeBlueprintElementRefValue(readPin(ctx, "element"));
    if (!ref) {
        throw new BlueprintGraphExecutionError(`${target.label} Element node requires an Element input`, ctx.node.id);
    }
    if (ref.elementType !== target.elementType) {
        throw new BlueprintGraphExecutionError(
            `${target.label} Element node expected ${target.elementType}, got ${ref.elementType}`,
            ctx.node.id,
        );
    }
    const currentSurfaceId = ctx.executionOwner?.surfaceId;
    if (currentSurfaceId && ref.surfaceId !== currentSurfaceId) {
        throw new BlueprintGraphExecutionError(`${target.label} Element node can only target the current Surface`, ctx.node.id);
    }
    return ref.elementId;
}

function toBooleanValue(raw: unknown, fallback: boolean): boolean {
    if (raw === undefined || raw === null) {
        return fallback;
    }
    if (typeof raw === "boolean") {
        return raw;
    }
    return raw === "true" || raw === "1";
}

function toNullableString(raw: unknown): string | null {
    if (raw === null) {
        return null;
    }
    const s = String(raw ?? "").trim();
    return s.length > 0 ? s : null;
}

function toButtonCursorValue(raw: unknown, fallback: ButtonCursorValue): ButtonCursorValue {
    return isButtonCursorValue(raw) ? raw : fallback;
}

function toRecordValue(raw: unknown): Record<string, unknown> {
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
}

function readOptionalFramePropsPatch(ctx: Parameters<BlueprintNodeDef["execute"]>[0]): { params?: Record<string, unknown> } {
    const props = readPin(ctx, "props");
    return props === undefined ? {} : { params: toRecordValue(props) };
}

function readNode(input: {
    type: string;
    displayName: string;
    keywords: string[];
    output?: BlueprintNodePinDef;
    outputs?: BlueprintNodePinDef[];
    target: WidgetTarget;
    mode: TargetMode;
    category?: string;
    hideInPalette?: boolean;
}): BlueprintNodeDef {
    const elementTarget = input.mode === "element";
    const outputs = input.outputs ?? (input.output ? [input.output] : []);
    return {
        type: input.type,
        displayName: input.displayName,
        category: input.category ?? (elementTarget ? "Element" : input.target.label),
        keywords: input.keywords,
        graphKinds: [...READ_GRAPH_KINDS],
        hideInPalette: input.hideInPalette,
        isPure: true,
        pins: elementTarget ? [elementIn(input.target), ...outputs] : outputs,
        magicElementTarget: elementTarget ? { inputPinId: "element", elementTypes: [input.target.elementType] } : undefined,
        scope: elementTarget ? undefined : { ownerKinds: ["widgetMain"], widgetElementTypes: [input.target.elementType] },
        execute: () => ({}),
    };
}

function writeNode(input: {
    type: string;
    displayName: string;
    keywords: string[];
    pins?: BlueprintNodePinDef[];
    target: WidgetTarget;
    mode: TargetMode;
    category?: string;
    hideInPalette?: boolean;
    inspectorParams?: BlueprintNodeDef["inspectorParams"];
    execute: BlueprintNodeDef["execute"];
}): BlueprintNodeDef {
    const elementTarget = input.mode === "element";
    return {
        type: input.type,
        displayName: input.displayName,
        category: input.category ?? (elementTarget ? "Element" : input.target.label),
        keywords: input.keywords,
        graphKinds: [...WRITE_GRAPH_KINDS],
        hideInPalette: input.hideInPalette,
        isPure: false,
        isLatent: true,
        pins: elementTarget
            ? [execIn, execNext, elementIn(input.target), ...(input.pins ?? [])]
            : [execIn, execNext, ...(input.pins ?? [])],
        inspectorParams: input.inspectorParams,
        magicElementTarget: elementTarget ? { inputPinId: "element", elementTypes: [input.target.elementType] } : undefined,
        scope: elementTarget ? undefined : { ownerKinds: ["widgetMain"], widgetElementTypes: [input.target.elementType] },
        execute: input.execute,
    };
}

function commonNodes(target: WidgetTarget, mode: TargetMode): BlueprintNodeDef[] {
    const prefix = mode === "element" ? `blueprint.element.${target.key}` : `blueprint.${target.key}`;
    const labelPrefix = mode === "element" ? `${target.label} ` : "";
    const nodes: BlueprintNodeDef[] = [
        readNode({
            type: `${prefix}.getVisible`,
            displayName: `Get ${labelPrefix}Visible`,
            keywords: [target.key, "visible", "show", "hide"],
            output: out("visible", "Visible", "boolean"),
            target,
            mode,
        }),
        writeNode({
            type: `${prefix}.setVisible`,
            displayName: `Set ${labelPrefix}Visible`,
            keywords: [target.key, "visible", "show", "hide", "set"],
            pins: [boolIn("visible", "Visible")],
            target,
            mode,
            execute: async ctx => {
                const api = requireHostApi(ctx);
                const elementId = resolveTargetElementId(ctx, target, mode);
                const current = api.widget.getCommonProperties(elementId);
                await api.widget.setVisible(elementId, toBooleanValue(readPin(ctx, "visible"), current.visible));
                return { nextPort: "next" };
            },
        }),
        readNode({
            type: `${prefix}.getEnabled`,
            displayName: `Get ${labelPrefix}Enabled`,
            keywords: [target.key, "enabled", "disabled", "interaction"],
            output: out("enabled", "Enabled", "boolean"),
            target,
            mode,
        }),
        writeNode({
            type: `${prefix}.setEnabled`,
            displayName: `Set ${labelPrefix}Enabled`,
            keywords: [target.key, "enabled", "disabled", "interaction", "set"],
            pins: [boolIn("enabled", "Enabled")],
            target,
            mode,
            execute: async ctx => {
                const api = requireHostApi(ctx);
                const elementId = resolveTargetElementId(ctx, target, mode);
                const current = api.widget.getCommonProperties(elementId);
                await api.widget.setEnabled(elementId, toBooleanValue(readPin(ctx, "enabled"), current.enabled));
                return { nextPort: "next" };
            },
        }),
    ];
    if (target.supportsVariant) {
        nodes.push(
            readNode({
                type: `${prefix}.getVariant`,
                displayName: `Get ${labelPrefix}Variant`,
                keywords: [target.key, "variant", "appearance"],
                output: out("variantId", "Variant", "string"),
                target,
                mode,
                hideInPalette: true,
            }),
            writeNode({
                type: `${prefix}.setVariant`,
                displayName: `Set ${labelPrefix}Variant`,
                keywords: [target.key, "variant", "appearance", "set"],
                target,
                mode,
                hideInPalette: true,
                execute: async ctx => {
                    const api = requireHostApi(ctx);
                    await api.widget.setVariant(
                        resolveTargetElementId(ctx, target, mode),
                        toNullableString(readPin(ctx, "variantId")),
                    );
                    return { nextPort: "next" };
                },
            }),
        );
    }
    return nodes;
}

function buttonNodes(target: WidgetTarget, mode: TargetMode): BlueprintNodeDef[] {
    const prefix = mode === "element" ? "blueprint.element.button" : "blueprint.button";
    const labelPrefix = mode === "element" ? "Button " : "";
    const setPointerType = mode === "element" ? BLUEPRINT_NODE_TYPE_ELEMENT_BUTTON_SET_POINTER : BLUEPRINT_NODE_TYPE_BUTTON_SET_POINTER;
    return [
        readNode({
            type: `${prefix}.getLabel`,
            displayName: `Get ${labelPrefix}Label`,
            keywords: ["button", "label", "text"],
            output: out("label", "Label", "string"),
            target,
            mode,
        }),
        writeNode({
            type: `${prefix}.setLabel`,
            displayName: `Set ${labelPrefix}Label`,
            keywords: ["button", "label", "text", "set"],
            pins: [stringIn("label", "Label")],
            target,
            mode,
            execute: async ctx => {
                await requireHostApi(ctx).widget.setButtonProperties(
                    resolveTargetElementId(ctx, target, mode),
                    { label: String(readPin(ctx, "label") ?? "") },
                );
                return { nextPort: "next" };
            },
        }),
        writeNode({
            type: setPointerType,
            displayName: `Set ${labelPrefix}Pointer`,
            keywords: ["button", "pointer", "cursor", "mouse", "set"],
            target,
            mode,
            inspectorParams: [
                {
                    key: "cursor",
                    label: "Pointer",
                    kind: "buttonCursor",
                },
            ],
            execute: async ctx => {
                const api = requireHostApi(ctx);
                const elementId = resolveTargetElementId(ctx, target, mode);
                await api.widget.setButtonProperties(
                    elementId,
                    { cursor: toButtonCursorValue(readPin(ctx, "cursor"), "auto") },
                );
                return { nextPort: "next" };
            },
        }),
    ];
}

function containerNodes(target: WidgetTarget, mode: TargetMode): BlueprintNodeDef[] {
    const prefix = mode === "element" ? "blueprint.element.container" : "blueprint.container";
    const labelPrefix = mode === "element" ? "Container " : "";
    return [
        readNode({
            type: `${prefix}.getClipContent`,
            displayName: `Get ${labelPrefix}Clip Content`,
            keywords: ["container", "clip", "overflow"],
            output: out("clipContent", "Clip", "boolean"),
            target,
            mode,
        }),
        writeNode({
            type: `${prefix}.setClipContent`,
            displayName: `Set ${labelPrefix}Clip Content`,
            keywords: ["container", "clip", "overflow", "set"],
            pins: [boolIn("clipContent", "Clip")],
            target,
            mode,
            execute: async ctx => {
                const api = requireHostApi(ctx);
                const elementId = resolveTargetElementId(ctx, target, mode);
                const current = api.widget.getContainerProperties(elementId);
                await api.widget.setContainerProperties(elementId, {
                    clipContent: toBooleanValue(readPin(ctx, "clipContent"), current.clipContent),
                });
                return { nextPort: "next" };
            },
        }),
    ];
}

const IMAGE_FILL_MODES: readonly ImageFillMode[] = ["cover", "contain", "stretch", "crop", "tile"];

function toImageFillMode(raw: unknown, fallback: ImageFillMode): ImageFillMode {
    return IMAGE_FILL_MODES.includes(raw as ImageFillMode) ? raw as ImageFillMode : fallback;
}

function toFiniteNumber(raw: unknown, fallback: number): number {
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(n) ? n : fallback;
}

function readImageCropRect(
    ctx: Parameters<BlueprintNodeDef["execute"]>[0],
    fallback: ImageFillCropPlacement,
): ImageFillCropPlacement {
    return {
        leftPct: toFiniteNumber(readPin(ctx, "leftPct"), fallback.leftPct),
        topPct: toFiniteNumber(readPin(ctx, "topPct"), fallback.topPct),
        widthPct: toFiniteNumber(readPin(ctx, "widthPct"), fallback.widthPct),
        heightPct: toFiniteNumber(readPin(ctx, "heightPct"), fallback.heightPct),
    };
}

function imageNodes(target: WidgetTarget, mode: TargetMode): BlueprintNodeDef[] {
    const types = mode === "element"
        ? {
            getAsset: BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_GET_ASSET,
            setAsset: BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_SET_ASSET,
            clearAsset: BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_CLEAR_ASSET,
            getFitMode: BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_GET_FIT_MODE,
            setFitMode: BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_SET_FIT_MODE,
            getCropRect: BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_GET_CROP_RECT,
            setCropRect: BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_SET_CROP_RECT,
            getFlipX: BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_GET_FLIP_X,
            setFlipX: BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_SET_FLIP_X,
            getFlipY: BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_GET_FLIP_Y,
            setFlipY: BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_SET_FLIP_Y,
        }
        : {
            getAsset: BLUEPRINT_NODE_TYPE_IMAGE_GET_ASSET,
            setAsset: BLUEPRINT_NODE_TYPE_IMAGE_SET_ASSET,
            clearAsset: BLUEPRINT_NODE_TYPE_IMAGE_CLEAR_ASSET,
            getFitMode: BLUEPRINT_NODE_TYPE_IMAGE_GET_FIT_MODE,
            setFitMode: BLUEPRINT_NODE_TYPE_IMAGE_SET_FIT_MODE,
            getCropRect: BLUEPRINT_NODE_TYPE_IMAGE_GET_CROP_RECT,
            setCropRect: BLUEPRINT_NODE_TYPE_IMAGE_SET_CROP_RECT,
            getFlipX: BLUEPRINT_NODE_TYPE_IMAGE_GET_FLIP_X,
            setFlipX: BLUEPRINT_NODE_TYPE_IMAGE_SET_FLIP_X,
            getFlipY: BLUEPRINT_NODE_TYPE_IMAGE_GET_FLIP_Y,
            setFlipY: BLUEPRINT_NODE_TYPE_IMAGE_SET_FLIP_Y,
        };
    const cropRectPins = [
        floatIn("leftPct", "Left %"),
        floatIn("topPct", "Top %"),
        floatIn("widthPct", "Width %"),
        floatIn("heightPct", "Height %"),
    ];
    const category = mode === "element" ? "Element" : "Image";
    return [
        readNode({
            type: types.getAsset,
            displayName: "Get Image Asset",
            keywords: ["image", "asset", "source"],
            output: out("asset", "Asset", BLUEPRINT_VALUE_TYPE_IMAGE_ASSET_NULLABLE),
            target,
            mode,
            category,
        }),
        writeNode({
            type: types.setAsset,
            displayName: "Set Image Asset",
            keywords: ["image", "asset", "source", "set"],
            pins: [imageAssetNullableIn("asset", "Asset")],
            target,
            mode,
            category,
            execute: async ctx => {
                const assetInput = readPin(ctx, "asset");
                const legacyAssetIdInput = assetInput === undefined ? readPin(ctx, "assetId") : undefined;
                await requireHostApi(ctx).widget.setImageProperties(
                    resolveTargetElementId(ctx, target, mode),
                    { asset: normalizeBlueprintImageAssetValue(assetInput === undefined ? legacyAssetIdInput : assetInput) },
                );
                return { nextPort: "next" };
            },
        }),
        writeNode({
            type: types.clearAsset,
            displayName: "Clear Image Asset",
            keywords: ["image", "asset", "source", "clear", "remove"],
            target,
            mode,
            category,
            execute: async ctx => {
                await requireHostApi(ctx).widget.setImageProperties(
                    resolveTargetElementId(ctx, target, mode),
                    { asset: null },
                );
                return { nextPort: "next" };
            },
        }),
        readNode({
            type: types.getFitMode,
            displayName: "Get Image Fit Mode",
            keywords: ["image", "fit", "mode", "cover", "contain", "stretch", "crop", "tile"],
            output: out("fitMode", "Fit Mode", "string"),
            target,
            mode,
            category,
        }),
        writeNode({
            type: types.setFitMode,
            displayName: "Set Image Fit Mode",
            keywords: ["image", "fit", "mode", "cover", "contain", "stretch", "crop", "tile", "set"],
            pins: [stringIn("fitMode", "Fit Mode")],
            target,
            mode,
            category,
            execute: async ctx => {
                const api = requireHostApi(ctx);
                const elementId = resolveTargetElementId(ctx, target, mode);
                const current = api.widget.getImageProperties(elementId);
                await api.widget.setImageProperties(elementId, {
                    fitMode: toImageFillMode(readPin(ctx, "fitMode"), current.fitMode),
                });
                return { nextPort: "next" };
            },
        }),
        readNode({
            type: types.getCropRect,
            displayName: "Get Image Crop Rect",
            keywords: ["image", "crop", "rect", "placement"],
            outputs: [
                out("leftPct", "Left %", "float"),
                out("topPct", "Top %", "float"),
                out("widthPct", "Width %", "float"),
                out("heightPct", "Height %", "float"),
            ],
            target,
            mode,
            category,
        }),
        writeNode({
            type: types.setCropRect,
            displayName: "Set Image Crop Rect",
            keywords: ["image", "crop", "rect", "placement", "set"],
            pins: cropRectPins,
            target,
            mode,
            category,
            execute: async ctx => {
                const api = requireHostApi(ctx);
                const elementId = resolveTargetElementId(ctx, target, mode);
                const current = api.widget.getImageProperties(elementId);
                await api.widget.setImageProperties(elementId, {
                    fitMode: "crop",
                    cropRect: readImageCropRect(ctx, current.cropRect),
                });
                return { nextPort: "next" };
            },
        }),
        readNode({
            type: types.getFlipX,
            displayName: "Get Image Flip X",
            keywords: ["image", "flip", "x", "horizontal"],
            output: out("flipX", "Flip X", "boolean"),
            target,
            mode,
            category,
        }),
        writeNode({
            type: types.setFlipX,
            displayName: "Set Image Flip X",
            keywords: ["image", "flip", "x", "horizontal", "set"],
            pins: [boolIn("flipX", "Flip X")],
            target,
            mode,
            category,
            execute: async ctx => {
                const api = requireHostApi(ctx);
                const elementId = resolveTargetElementId(ctx, target, mode);
                const current = api.widget.getImageProperties(elementId);
                await api.widget.setImageProperties(elementId, {
                    flipX: toBooleanValue(readPin(ctx, "flipX"), current.flipX),
                });
                return { nextPort: "next" };
            },
        }),
        readNode({
            type: types.getFlipY,
            displayName: "Get Image Flip Y",
            keywords: ["image", "flip", "y", "vertical"],
            output: out("flipY", "Flip Y", "boolean"),
            target,
            mode,
            category,
        }),
        writeNode({
            type: types.setFlipY,
            displayName: "Set Image Flip Y",
            keywords: ["image", "flip", "y", "vertical", "set"],
            pins: [boolIn("flipY", "Flip Y")],
            target,
            mode,
            category,
            execute: async ctx => {
                const api = requireHostApi(ctx);
                const elementId = resolveTargetElementId(ctx, target, mode);
                const current = api.widget.getImageProperties(elementId);
                await api.widget.setImageProperties(elementId, {
                    flipY: toBooleanValue(readPin(ctx, "flipY"), current.flipY),
                });
                return { nextPort: "next" };
            },
        }),
    ];
}

function frameNodes(target: WidgetTarget, mode: TargetMode): BlueprintNodeDef[] {
    const prefix = mode === "element" ? "blueprint.element.frame" : "blueprint.frameWidget";
    const labelPrefix = mode === "element" ? "Frame " : "";
    const setPageType =
        mode === "element" ? BLUEPRINT_NODE_TYPE_ELEMENT_FRAME_SET_PAGE : BLUEPRINT_NODE_TYPE_FRAME_WIDGET_SET_PAGE;
    return [
        readNode({
            type: `${prefix}.getTargetPage`,
            displayName: `Get ${labelPrefix}Target Page`,
            keywords: ["frame", "page", "surface", "target"],
            output: out("targetSurfaceId", "Page", "string"),
            target,
            mode,
        }),
        writeNode({
            type: setPageType,
            displayName: "Set Frame Page",
            keywords: ["frame", "page", "surface", "target", "set", "set frame page"],
            pins: [optionalJsonIn("props", "Page props")],
            target,
            mode,
            inspectorParams: [
                {
                    key: "targetSurfaceId",
                    label: "Page",
                    kind: "select",
                    dynamicOptionsSource: BLUEPRINT_FRAME_TARGET_SURFACE_OPTIONS_SOURCE,
                    emptyOptionLabel: "None",
                },
            ],
            execute: async ctx => {
                await requireHostApi(ctx).widget.setFrameProperties(
                    resolveTargetElementId(ctx, target, mode),
                    {
                        targetSurfaceId: toNullableString(readPin(ctx, "targetSurfaceId")),
                        ...readOptionalFramePropsPatch(ctx),
                    },
                );
                return { nextPort: "next" };
            },
        }),
        readNode({
            type: `${prefix}.getParams`,
            displayName: `Get ${labelPrefix}Params`,
            keywords: ["frame", "page", "params"],
            output: out("params", "Params", "json"),
            target,
            mode,
        }),
        writeNode({
            type: `${prefix}.setParams`,
            displayName: `Set ${labelPrefix}Params`,
            keywords: ["frame", "page", "params", "set"],
            pins: [jsonIn("params", "Params")],
            target,
            mode,
            execute: async ctx => {
                const params = readPin(ctx, "params");
                await requireHostApi(ctx).widget.setFrameProperties(
                    resolveTargetElementId(ctx, target, mode),
                    { params: toRecordValue(params) },
                );
                return { nextPort: "next" };
            },
        }),
    ];
}

function nodesForTarget(target: WidgetTarget): BlueprintNodeDef[] {
    const outNodes: BlueprintNodeDef[] = [];
    for (const mode of ["self", "element"] as const) {
        outNodes.push(...commonNodes(target, mode));
        if (target.key === "button") {
            outNodes.push(...buttonNodes(target, mode));
        }
        if (target.key === "container") {
            outNodes.push(...containerNodes(target, mode));
        }
        if (target.key === "image") {
            outNodes.push(...imageNodes(target, mode));
        }
        if (target.key === "frame") {
            outNodes.push(...frameNodes(target, mode));
        }
    }
    return outNodes;
}

export const imageAssetBlueprintNodes: BlueprintNodeDef[] = [
    {
        type: BLUEPRINT_NODE_TYPE_IMAGE_ASSET_LITERAL,
        displayName: "Image Asset",
        category: "Image",
        keywords: ["image", "asset", "literal", "resource", "picture"],
        graphKinds: ["event", "function", "macro"],
        isPure: true,
        role: "imageAssetLiteral",
        pins: [
            {
                id: "value",
                kind: "output",
                semantic: "data",
                valueType: BLUEPRINT_VALUE_TYPE_IMAGE_ASSET,
                label: "Asset",
            },
        ],
        execute: () => ({}),
    },
];

export const widgetPropertyBlueprintNodes: BlueprintNodeDef[] = [
    ...imageAssetBlueprintNodes,
    ...WIDGET_TARGETS.flatMap(nodesForTarget),
];
