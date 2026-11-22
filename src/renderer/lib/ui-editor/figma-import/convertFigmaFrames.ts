/**
 * Figma frames, as the plugin exported them, turned into interface pages.
 *
 * The output is an ordinary `UIDocument` holding one page per frame, which is then put into the
 * project by `UIDocumentService.importTemplateBundle` - the same door a template or a page copied
 * from another project comes through, so ids, text sources and undo are settled there and not here.
 * Pictures are referred to by the export's image keys; the caller writes them into the asset library
 * first and hands the import the map from key to asset id.
 *
 * What becomes what:
 *
 * - A frame, component, instance or group becomes a container. Its own look (fill, stroke, corners,
 *   shadows, clipping) is the container's. Auto layout becomes a stack when a stack can say the same
 *   thing, and free placement at the exact positions Figma computed when it cannot.
 * - A rectangle filled with nothing but a picture becomes an image; any other rectangle, and an
 *   ellipse that is a circle, becomes a container with no children.
 * - Text becomes a text widget, its words held by the element itself.
 * - What the plugin drew into a picture becomes an image laid exactly over where the layer was.
 *
 * Each frame is scaled to fit the project's resolution, as the game itself fits a page to the window,
 * so a 1280x720 design arrives filling a 1920x1080 project rather than in its top-left corner.
 *
 * Every simplification is counted in the report, by kind, with the first few layer names - the author
 * is told where to look rather than left to discover it.
 *
 * Pure: no service, no file.
 *
 * Comments in English per project convention.
 */

import {
    UI_DOCUMENT_SCHEMA_VERSION,
    type UIAppSurface,
    type UIDocument,
    type UIElement,
    type UISurfaceDesignSize,
} from "@shared/types/ui-editor/document";
import {
    CONTAINER_STACK_SPACING_ABS_MAX_PX,
    defaultContainerWidgetProps,
    type ContainerStackAlignItems,
    type ContainerStackJustifyContent,
    type ContainerWidgetProps,
} from "@shared/types/ui-editor/container";
import type { AppearanceModel, AppearanceRowValue } from "@shared/types/ui-editor/appearance";
import { DEFAULT_ELEMENT_EFFECT_VALUES, type EffectShadowStored, type ElementEffectValues } from "@shared/types/ui-editor/effects";
import type { GradientFill } from "@shared/types/ui-editor/gradientFill";
import type { ImageFill, ImageFillMode } from "@shared/types/ui-editor/imageFill";
import {
    createInitialContainerAppearance,
    createInitialImageAppearanceFromProps,
    createInitialTextAppearance,
} from "@/lib/ui-editor/widget-modules/shared/appearance/initialAppearanceModel";
import { defaultTextWidgetProps, type TextWidgetProps } from "@/lib/ui-editor/widget-modules/builtin/text/types";
import type {
    FigmaEffect,
    FigmaExportFile,
    FigmaExportNode,
    FigmaImportNote,
    FigmaImportNoteCode,
    FigmaMatrix,
    FigmaPaint,
} from "./figmaExportFormat";
import { figmaColorToCss, figmaGradientToFill, IDENTITY_MATRIX, placeInParent, round2 } from "./figmaGeometry";

export { FIGMA_IMPORT_NOTE_CODES } from "./figmaExportFormat";
export type { FigmaImportNote, FigmaImportNoteCode } from "./figmaExportFormat";

export type FigmaFontResolver = (family: string, style: string) => string | null;

export type ConvertFigmaFramesOptions = {
    /** The frames to import, by node id; all of them when absent. */
    frameIds?: readonly string[];
    /** The project's resolution, which every page is scaled to fit. */
    targetSize: UISurfaceDesignSize;
    /** Finds the project's font asset for a Figma font, or null. */
    resolveFont?: FigmaFontResolver;
};

export type ConvertFigmaFramesResult = {
    document: UIDocument;
    /** Image keys the document refers to, each once, in the order met. */
    imageRefs: string[];
    notes: FigmaImportNote[];
};

const MAX_EXAMPLES = 3;
const MAX_NAME_LENGTH = 80;

class NoteCollector {
    private readonly byCode = new Map<FigmaImportNoteCode, FigmaImportNote>();

    add(code: FigmaImportNoteCode, example?: string, count = 1): void {
        const note = this.byCode.get(code) ?? { code, count: 0, examples: [] };
        note.count += count;
        if (example && note.examples.length < MAX_EXAMPLES && !note.examples.includes(example)) {
            note.examples.push(example);
        }
        this.byCode.set(code, note);
    }

    list(): FigmaImportNote[] {
        return [...this.byCode.values()];
    }
}

type Context = {
    scale: number;
    file: FigmaExportFile;
    elements: Record<string, UIElement>;
    imageRefs: string[];
    notes: NoteCollector;
    resolveFont?: FigmaFontResolver;
    /** Families already reported, so the report counts fonts rather than text layers. */
    missingFonts: Set<string>;
    nextId: () => string;
};

export function convertFigmaFrames(file: FigmaExportFile, options: ConvertFigmaFramesOptions): ConvertFigmaFramesResult {
    const wanted = options.frameIds ? new Set(options.frameIds) : null;
    const frames = file.frames.filter(frame => !wanted || wanted.has(frame.id));
    const notes = new NoteCollector();
    let counter = 0;
    const ctx: Context = {
        scale: 1,
        file,
        elements: {},
        imageRefs: [],
        notes,
        resolveFont: options.resolveFont,
        missingFonts: new Set(),
        nextId: () => `figma-${++counter}`,
    };
    if (file.skippedHidden && file.skippedHidden > 0) {
        notes.add("hiddenSkipped", undefined, file.skippedHidden);
    }
    for (const note of file.notes ?? []) {
        notes.add(note.code, undefined, note.count);
        for (const example of note.examples) {
            notes.add(note.code, example, 0);
        }
    }

    const target = {
        width: Math.max(1, Math.round(options.targetSize.width)),
        height: Math.max(1, Math.round(options.targetSize.height)),
    };
    const surfaces: UIAppSurface[] = [];
    for (const frame of frames) {
        const width = Math.max(1, num(frame.width, 1));
        const height = Math.max(1, num(frame.height, 1));
        ctx.scale = Math.min(target.width / width, target.height / height);
        if (Math.abs(width / height - target.width / target.height) > 0.01) {
            notes.add("aspectMismatch", cleanName(frame.name));
        }

        const rootId = ctx.nextId();
        const surfaceId = ctx.nextId();
        const frameWidth = round2(width * ctx.scale);
        const frameHeight = round2(height * ctx.scale);
        const frameElement = convertNode(ctx, frame, rootId, {
            x: round2((target.width - frameWidth) / 2),
            y: round2((target.height - frameHeight) / 2),
            width: frameWidth,
            height: frameHeight,
            rotation: 0,
        });
        ctx.elements[rootId] = {
            id: rootId,
            type: "nl.root",
            name: "Root",
            parentId: null,
            childrenIds: frameElement ? [frameElement] : [],
            layout: { x: 0, y: 0, width: target.width, height: target.height, visible: true, opacity: 1 },
        };
        surfaces.push({
            id: surfaceId,
            name: cleanName(frame.name) || "Figma",
            host: "app",
            kind: "appSurface",
            designSize: { ...target },
            rootElementId: rootId,
        });
    }

    return {
        document: {
            schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
            id: "figma-import",
            name: file.source.fileName || "Figma",
            surfaces,
            elements: ctx.elements,
        },
        imageRefs: ctx.imageRefs,
        notes: notes.list(),
    };
}

type Box = { x: number; y: number; width: number; height: number; rotation: number };

/**
 * One node and everything under it, written into `ctx.elements`. Returns the element's id, or null
 * for a node that produced nothing (a picture the plugin could not draw).
 */
function convertNode(ctx: Context, node: FigmaExportNode, parentId: string, box: Box): string | null {
    const name = cleanName(node.name);
    if (node.blendMode && node.kind !== "raster") {
        ctx.notes.add("blendMode", name);
    }
    const layout = {
        x: box.x,
        y: box.y,
        width: Math.max(1, box.width),
        height: Math.max(1, box.height),
        ...(box.rotation !== 0 ? { rotation: round2(box.rotation) } : {}),
        opacity: round2(clamp01(num(node.opacity, 1))),
        visible: true,
    };

    if (node.kind === "raster") {
        if (node.raster?.reason !== "layer") {
            ctx.notes.add("rasterized", name);
        }
        const ref = node.raster?.imageRef;
        if (!ref || !ctx.file.images[ref]) {
            ctx.notes.add("missingImage", name);
            return null;
        }
        return addElement(ctx, parentId, {
            type: "nl.image",
            name,
            layout,
            props: imageProps(ctx, node, { mode: "stretch", assetId: useImage(ctx, ref) }, false),
        });
    }

    if (node.kind === "text" && node.text) {
        return addElement(ctx, parentId, { type: "nl.text", name, layout, props: textProps(ctx, node) });
    }

    const fill = pickFill(ctx, node);
    const children = Array.isArray(node.children) ? node.children : [];
    const isLeafShape = node.kind === "shape" || node.kind === "ellipse";
    if (isLeafShape && children.length === 0 && fill?.type === "IMAGE") {
        const ref = fill.imageRef;
        if (!ref || !ctx.file.images[ref]) {
            ctx.notes.add("missingImage", name);
        }
        return addElement(ctx, parentId, {
            type: "nl.image",
            name,
            layout,
            props: imageProps(ctx, node, {
                mode: imageModeOf(fill.scaleMode),
                assetId: ref && ctx.file.images[ref] ? useImage(ctx, ref) : null,
            }, true, fill.opacity),
        });
    }

    const props = containerProps(ctx, node, fill);
    const id = addElement(ctx, parentId, { type: "nl.container", name, layout, props });
    if (children.length === 0) {
        return id;
    }
    const stacked = props.layoutKind === "stack";
    const childIds: string[] = [];
    for (const child of children) {
        const placed = placeInParent(
            { transform: matrixOf(child.transform), width: num(child.width, 0), height: num(child.height, 0) },
            matrixOf(node.transform),
        );
        const childBox: Box = {
            x: round2(placed.x * ctx.scale),
            y: round2(placed.y * ctx.scale),
            width: round2(placed.width * ctx.scale),
            height: round2(placed.height * ctx.scale),
            rotation: stacked ? 0 : placed.rotation,
        };
        const childId = convertNode(ctx, child, id, childBox);
        if (childId) {
            childIds.push(childId);
        }
    }
    ctx.elements[id].childrenIds = childIds;
    return id;
}

function addElement(
    ctx: Context,
    parentId: string,
    element: Pick<UIElement, "type" | "name" | "layout" | "props">,
): string {
    const id = ctx.nextId();
    ctx.elements[id] = { id, parentId, childrenIds: [], ...element };
    return id;
}

function useImage(ctx: Context, ref: string): string {
    if (!ctx.imageRefs.includes(ref)) {
        ctx.imageRefs.push(ref);
    }
    return ref;
}

/** The fill a widget can draw: the topmost visible one. Leaf shapes with more arrive as pictures. */
function pickFill(ctx: Context, node: FigmaExportNode): FigmaPaint | null {
    const fills = (Array.isArray(node.fills) ? node.fills : []).filter(paint => num(paint.opacity, 1) > 0);
    if (fills.length > 1) {
        ctx.notes.add("multipleFills", cleanName(node.name));
    }
    return fills.length > 0 ? fills[fills.length - 1] : null;
}

function imageModeOf(scaleMode: string): ImageFillMode {
    switch (scaleMode) {
        case "FIT":
            return "contain";
        case "TILE":
            return "tile";
        case "CROP":
            return "stretch";
        default:
            return "cover";
    }
}

/** Fill, stroke, corners and transform: the chrome a container and an image share. */
function chromeProps(ctx: Context, node: FigmaExportNode, fill: FigmaPaint | null) {
    const s = ctx.scale;
    const radii = Array.isArray(node.radii) ? node.radii.map(value => round2(num(value, 0) * s)) : [0, 0, 0, 0];
    const [tl, tr, br, bl] = [radii[0] ?? 0, radii[1] ?? 0, radii[2] ?? 0, radii[3] ?? 0];
    const linked = tl === tr && tr === br && br === bl;

    let fillType: "color" | "image" | "gradient" = "color";
    let backgroundColor = "#FFFFFF";
    let gradientFill: GradientFill | undefined;
    let imageFill: ImageFill | undefined;
    let fillOpacity = 1;
    if (fill?.type === "SOLID") {
        backgroundColor = figmaColorToCss(fill.color);
        fillOpacity = round2(clamp01(num(fill.opacity, 1)));
    } else if (fill && fill.type !== "IMAGE") {
        fillType = "gradient";
        gradientFill = figmaGradientToFill(
            fill.type,
            matrixOf(fill.gradientTransform),
            Array.isArray(fill.gradientStops) ? fill.gradientStops : [],
            num(fill.opacity, 1),
            num(node.width, 1),
            num(node.height, 1),
        );
    } else if (fill?.type === "IMAGE") {
        fillType = "image";
        fillOpacity = round2(clamp01(num(fill.opacity, 1)));
        const ref = fill.imageRef;
        if (!ref || !ctx.file.images[ref]) {
            ctx.notes.add("missingImage", cleanName(node.name));
        }
        imageFill = { mode: imageModeOf(fill.scaleMode), assetId: ref && ctx.file.images[ref] ? useImage(ctx, ref) : null };
    }

    const strokes = (Array.isArray(node.strokes) ? node.strokes : []).filter(paint => num(paint.opacity, 1) > 0);
    const stroke = strokes.length > 0 ? strokes[strokes.length - 1] : null;
    const weights = node.strokeWeights;
    const weight = weights
        ? Math.max(num(weights.top, 0), num(weights.right, 0), num(weights.bottom, 0), num(weights.left, 0))
        : num(node.strokeWeight, 0);
    let borderColor = "#000000";
    let strokeOpacity = 1;
    if (stroke?.type === "SOLID") {
        borderColor = figmaColorToCss(stroke.color);
        strokeOpacity = round2(clamp01(num(stroke.opacity, 1)));
    } else if (stroke && stroke.type !== "IMAGE" && Array.isArray(stroke.gradientStops) && stroke.gradientStops[0]) {
        borderColor = figmaColorToCss(stroke.gradientStops[0].color, num(stroke.opacity, 1));
        ctx.notes.add("paintSimplified", cleanName(node.name));
    } else if (stroke) {
        ctx.notes.add("paintSimplified", cleanName(node.name));
    }
    const hasStroke = Boolean(stroke) && weight > 0;
    let strokeSide = "all";
    if (weights) {
        const edges = (["top", "right", "bottom", "left"] as const).filter(edge => num(weights[edge], 0) > 0);
        strokeSide = edges.length === 4 || edges.length === 0 ? "all" : edges.join(",");
    }

    return {
        backgroundColor,
        borderRadius: linked ? tl : Math.max(tl, tr, br, bl),
        borderRadiusTL: tl,
        borderRadiusTR: tr,
        borderRadiusBL: bl,
        borderRadiusBR: br,
        borderRadiusLinked: linked,
        borderColor,
        borderWidth: hasStroke ? round2(weight * ctx.scale) : 0,
        borderStyle: node.dashed ? "dashed" : "solid",
        backgroundImage: "",
        backgroundFit: "cover",
        imageFill,
        gradientFill,
        fillType,
        fillVisible: Boolean(fill),
        fillOpacity,
        strokeVisible: hasStroke,
        strokeOpacity,
        strokeAlign: (node.strokeAlign === "INSIDE" ? "inside" : node.strokeAlign === "OUTSIDE" ? "outside" : "center") as
            | "inside"
            | "outside"
            | "center",
        strokeSide,
        borderJoin: "miter" as const,
        cornerAdvanced: !linked,
        transformOffsetX: 0,
        transformOffsetY: 0,
        transformScale: 1,
        transformRotation: 0,
        transformOpacity: 1,
    };
}

function containerProps(ctx: Context, node: FigmaExportNode, fill: FigmaPaint | null): ContainerWidgetProps {
    const props: ContainerWidgetProps = {
        ...defaultContainerWidgetProps,
        ...chromeProps(ctx, node, fill),
        clipContent: node.kind === "frame" ? Boolean(node.clipsContent) : false,
    };
    const stack = stackOf(ctx, node);
    if (stack) {
        Object.assign(props, stack);
    }
    const effects = effectsOf(ctx, node, false);
    props.appearance = withEffectRows(createInitialContainerAppearance(props), effects);
    return props;
}

/**
 * The stack an auto-layout frame becomes, or null when it stays free.
 *
 * A stack cannot hold a child placed by position, cannot space wrapped lines differently from items,
 * and clamps its gap; a frame that needs any of those keeps the positions Figma computed instead,
 * which look identical and only lose the flow.
 */
function stackOf(ctx: Context, node: FigmaExportNode): Partial<ContainerWidgetProps> | null {
    const auto = node.autoLayout;
    if (!auto) {
        return null;
    }
    const children = Array.isArray(node.children) ? node.children : [];
    const s = ctx.scale;
    const spaceBetween = auto.primaryAlign === "SPACE_BETWEEN";
    const gap = spaceBetween ? 0 : round2(num(auto.gap, 0) * s);
    const counterGap = auto.wrap ? round2(num(auto.counterGap ?? auto.gap, 0) * s) : gap;
    const blocked =
        children.some(child => child.absolute)
        || Math.abs(gap) > CONTAINER_STACK_SPACING_ABS_MAX_PX
        || (auto.wrap && (spaceBetween || Math.abs(counterGap - gap) > 0.01));
    if (blocked) {
        ctx.notes.add("autoLayoutFlattened", cleanName(node.name));
        return null;
    }
    const justify: Record<string, ContainerStackJustifyContent> = {
        MIN: "start",
        CENTER: "center",
        MAX: "end",
        SPACE_BETWEEN: "space-between",
    };
    const align: Record<string, ContainerStackAlignItems> = { MIN: "start", CENTER: "center", MAX: "end", BASELINE: "start" };
    const padding = auto.padding ?? { top: 0, right: 0, bottom: 0, left: 0 };
    return {
        layoutKind: "stack",
        stackDirection: auto.direction === "HORIZONTAL" ? "horizontal" : "vertical",
        stackGap: gap,
        stackPaddingTop: round2(num(padding.top, 0) * s),
        stackPaddingRight: round2(num(padding.right, 0) * s),
        stackPaddingBottom: round2(num(padding.bottom, 0) * s),
        stackPaddingLeft: round2(num(padding.left, 0) * s),
        stackAlignItems: align[auto.counterAlign] ?? "start",
        stackJustifyContent: justify[auto.primaryAlign] ?? "start",
        stackWrap: Boolean(auto.wrap),
    };
}

function imageProps(
    ctx: Context,
    node: FigmaExportNode,
    imageFill: ImageFill,
    withChrome: boolean,
    paintOpacity = 1,
): Record<string, unknown> {
    const chrome = withChrome ? chromeProps(ctx, { ...node, fills: [] }, null) : null;
    const props: Record<string, unknown> = {
        ...(chrome ?? chromeProps(ctx, { ...node, fills: [], strokes: [], radii: [0, 0, 0, 0] }, null)),
        imageFill,
        imageFlipX: false,
        imageFlipY: false,
        fillType: "image",
        fillVisible: true,
        fillOpacity: round2(clamp01(paintOpacity)),
    };
    const effects = withChrome ? effectsOf(ctx, node, false) : { ...DEFAULT_ELEMENT_EFFECT_VALUES };
    props.effects = effects;
    props.appearance = withEffectRows(createInitialImageAppearanceFromProps(props), effects);
    return props;
}

function textProps(ctx: Context, node: FigmaExportNode): TextWidgetProps {
    const style = node.text!;
    const name = cleanName(node.name);
    const s = ctx.scale;
    const fontSize = Math.max(1, num(style.fontSize, 16));
    const fills = (Array.isArray(node.fills) ? node.fills : []).filter(paint => num(paint.opacity, 1) > 0);
    const top = fills[fills.length - 1];
    let color = "#000000";
    if (top?.type === "SOLID") {
        color = figmaColorToCss(top.color, num(top.opacity, 1));
    } else if (top && top.type !== "IMAGE" && Array.isArray(top.gradientStops) && top.gradientStops[0]) {
        color = figmaColorToCss(top.gradientStops[0].color, num(top.opacity, 1));
        ctx.notes.add("paintSimplified", name);
    }

    let lineHeight = 1.2;
    if (style.lineHeight?.unit === "PIXELS") {
        lineHeight = num(style.lineHeight.value, fontSize * 1.2) / fontSize;
    } else if (style.lineHeight?.unit === "PERCENT") {
        lineHeight = num(style.lineHeight.value, 120) / 100;
    }
    if (style.letterSpacing && num(style.letterSpacing.value, 0) !== 0) {
        ctx.notes.add("letterSpacing", name);
    }
    if (style.mixed) {
        ctx.notes.add("mixedTextStyles", name);
    }
    if (style.align === "JUSTIFIED") {
        ctx.notes.add("justifiedText", name);
    }

    let fontAssetId: string | null = null;
    if (style.fontFamily) {
        fontAssetId = ctx.resolveFont?.(style.fontFamily, style.fontStyle ?? "") ?? null;
        if (!fontAssetId && !ctx.missingFonts.has(style.fontFamily)) {
            ctx.missingFonts.add(style.fontFamily);
            ctx.notes.add("missingFont", style.fontFamily);
        }
    }

    const weight = num(style.fontWeight, 400);
    const italic = /italic|oblique/i.test(style.fontStyle ?? "");
    let characters = typeof style.characters === "string" ? style.characters : "";
    if (style.textCase === "UPPER") characters = characters.toUpperCase();
    if (style.textCase === "LOWER") characters = characters.toLowerCase();

    const effects = effectsOf(ctx, node, true);
    const props: TextWidgetProps = {
        ...defaultTextWidgetProps,
        text: characters,
        fontSize: round2(fontSize * s),
        color,
        fontWeight: weight >= 700 ? "bold" : weight >= 600 ? "600" : "normal",
        fontStyle: italic ? "italic" : "normal",
        textAlign: style.align === "CENTER" ? "center" : style.align === "RIGHT" ? "right" : "left",
        textVerticalAlign: style.verticalAlign === "CENTER" ? "center" : style.verticalAlign === "BOTTOM" ? "end" : "start",
        lineHeight: Math.round(lineHeight * 1000) / 1000,
        fontAssetId,
        textWrapMode: style.autoResize === "WIDTH_AND_HEIGHT" ? "nowrap" : "word",
        effects,
    };
    props.appearance = withEffectRows(createInitialTextAppearance(props), effects);
    return props;
}

/**
 * Figma's effects as effect values. Figma states a blur as a radius, CSS as a standard deviation of
 * half that, which is the value Figma's own CSS export writes.
 */
function effectsOf(ctx: Context, node: FigmaExportNode, forText: boolean): ElementEffectValues {
    const s = ctx.scale;
    const effects = Array.isArray(node.effects) ? node.effects : [];
    const out: ElementEffectValues = { ...DEFAULT_ELEMENT_EFFECT_VALUES };
    const drops = effects.filter(effect => effect.type === "DROP_SHADOW");
    const inners = effects.filter(effect => effect.type === "INNER_SHADOW");
    const shadow = shadowStored(drops, s, false);
    if (forText) {
        out.effectTextShadow = shadow;
    } else {
        out.effectShadow = shadow;
        out.effectInnerShadow = shadowStored(inners, s, true);
    }
    const layerBlur = effects.find(effect => effect.type === "LAYER_BLUR");
    if (layerBlur) {
        out.effectBlur = round2((num(layerBlur.radius, 0) * s) / 2);
    }
    const backgroundBlur = effects.find(effect => effect.type === "BACKGROUND_BLUR");
    if (backgroundBlur && !forText) {
        out.effectBackgroundBlur = round2((num(backgroundBlur.radius, 0) * s) / 2);
    }
    return out;
}

/** One shadow as a structured layer; several as their CSS list, which the effect field also stores. */
function shadowStored(effects: readonly FigmaEffect[], s: number, inset: boolean): EffectShadowStored | null {
    if (effects.length === 0) {
        return null;
    }
    const layers = effects.map(effect => ({
        offsetX: round2(num(effect.offset?.x, 0) * s),
        offsetY: round2(num(effect.offset?.y, 0) * s),
        blur: round2(Math.max(0, num(effect.radius, 0)) * s),
        spread: round2(num(effect.spread, 0) * s),
        color: effect.color ? figmaColorToCss(effect.color) : "rgba(0, 0, 0, 0.25)",
    }));
    if (layers.length === 1) {
        return { storage: "layer", layer: layers[0] };
    }
    return {
        storage: "css",
        css: layers
            .map(layer => `${inset ? "inset " : ""}${layer.offsetX}px ${layer.offsetY}px ${layer.blur}px ${layer.spread}px ${layer.color}`)
            .join(", "),
    };
}

/**
 * The default variant's base rows for the effects, overwritten with `effects`. A container keeps its
 * effects only in its appearance, so writing them anywhere else would not draw them.
 */
function withEffectRows(model: AppearanceModel, effects: ElementEffectValues): AppearanceModel {
    const values: Record<string, AppearanceRowValue> = effects as unknown as Record<string, AppearanceRowValue>;
    return {
        ...model,
        variants: model.variants.map(variant =>
            variant.id !== model.defaultVariantId
                ? variant
                : {
                    ...variant,
                    propertyGroups: variant.propertyGroups.map(group =>
                        Object.prototype.hasOwnProperty.call(values, group.key)
                            ? { ...group, rows: group.rows.map(row => (row.conditions ? row : { ...row, value: values[group.key] })) }
                            : group,
                    ) as typeof variant.propertyGroups,
                },
        ),
    };
}

function matrixOf(raw: unknown): FigmaMatrix {
    if (
        Array.isArray(raw)
        && raw.length === 2
        && raw.every(row => Array.isArray(row) && row.length === 3 && row.every(value => typeof value === "number" && Number.isFinite(value)))
    ) {
        return raw as FigmaMatrix;
    }
    return IDENTITY_MATRIX;
}

function cleanName(raw: unknown): string {
    const text = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
    return text.length > MAX_NAME_LENGTH ? text.slice(0, MAX_NAME_LENGTH) : text;
}

function num(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}
