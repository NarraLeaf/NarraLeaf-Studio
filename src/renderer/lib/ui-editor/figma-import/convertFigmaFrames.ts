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
 * A frame can instead be a design of the running game: its top-level groups named for Game UI slots
 * (`对话框`, `choice`, `quick menu` ...) each become the Game UI of that slot, wired to do its job, and
 * the rest of the frame (the background, the sprites) is left out - see `convertGameUiFrame`.
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
    type UIDocument,
    type UIElement,
    type UISurface,
    type UISurfaceDesignSize,
} from "@shared/types/ui-editor/document";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { UIInputActionDef } from "@shared/types/ui-editor/inputAction";
import { UI_STRUCT_ID_CHOICE_ITEM, UI_STRUCT_ID_NOTIFICATION_ITEM } from "@shared/types/ui-editor/builtinStructs";
import { defaultListWidgetProps, type ListWidgetProps } from "@/lib/ui-editor/widget-modules/builtin/list/types";
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
    createInitialButtonAppearance,
    createInitialContainerAppearance,
    createInitialImageAppearanceFromProps,
    createInitialTextAppearance,
} from "@/lib/ui-editor/widget-modules/shared/appearance/initialAppearanceModel";
import { defaultTextWidgetProps, type TextWidgetProps } from "@/lib/ui-editor/widget-modules/builtin/text/types";
import { defaultButtonWidgetProps, type ButtonWidgetProps } from "@/lib/ui-editor/widget-modules/builtin/button/types";
import type { AppearanceSystemCondition } from "@shared/types/ui-editor/appearance";
import type { ButtonState } from "./buttonStates";
import type { GameUiSlot, QuickMenuPage } from "./gameUiRoles";
import {
    childrenOf,
    detectFrameTarget,
    gameUiPartsOf,
    layerName as cleanName,
    listOptionsOf,
    matrixOf,
    num,
    readButton,
    readDialog,
    readQuickMenu,
    wordsOf,
    type ButtonShape,
    type DesignFrameTarget,
} from "./gameUiReading";
import { DIALOG_INPUT_ACTIONS, GameUiBlueprints } from "./gameUiBlueprints";
import type {
    FigmaEffect,
    FigmaExportFile,
    FigmaExportNode,
    FigmaImportNote,
    FigmaImportNoteCode,
    FigmaPaint,
} from "./figmaExportFormat";
import { figmaColorToCss, figmaGradientToFill, placeInParent, round2 } from "./figmaGeometry";

export { FIGMA_IMPORT_NOTE_CODES } from "./figmaExportFormat";
export type { FigmaImportNote, FigmaImportNoteCode } from "./figmaExportFormat";

export type FigmaFontResolver = (family: string, style: string) => string | null;

export { detectFrameTarget, gameUiPartsOf } from "./gameUiReading";
export type { DesignFrameTarget, GameUiPart } from "./gameUiReading";

export type ConvertFigmaFramesOptions = {
    /** The frames to import, by node id; all of them when absent. */
    frameIds?: readonly string[];
    /** The project's resolution, which every page is scaled to fit. */
    targetSize: UISurfaceDesignSize;
    /** Finds the project's font asset for a Figma font, or null. */
    resolveFont?: FigmaFontResolver;
    /** What each frame becomes, by node id. A frame not named here is read by `detectFrameTarget`. */
    frameTargets?: Readonly<Record<string, DesignFrameTarget>>;
    /** The project's pages the quick menu and the dialogue box open, by job. */
    pageTargets?: Readonly<Partial<Record<QuickMenuPage, string>>>;
};

/** One Game UI the import brings, and what in it was wired. */
export type ConvertedGameUi = {
    slot: GameUiSlot;
    surfaceId: string;
    name: string;
    /** Parts given their job: the line, the name, a button that opens the Log ... */
    wired: number;
};

export type ConvertFigmaFramesResult = {
    document: UIDocument;
    /** The blueprints the Game UI needs, keyed under the document's ids; null when there are none. */
    blueprints: BlueprintDocument | null;
    /** Image keys the document refers to, each once, in the order met. */
    imageRefs: string[];
    notes: FigmaImportNote[];
    /** How many buttons were made out of state layers or variants. */
    buttons: number;
    gameUi: ConvertedGameUi[];
};

const MAX_EXAMPLES = 3;

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
    buttons: number;
    nextId: () => string;
    /** Each exported node's element, by node id, so a Game UI can find the parts it wires. */
    nodeElements: Map<string, string>;
    blueprints: GameUiBlueprints;
    pageTargets: Readonly<Partial<Record<QuickMenuPage, string>>>;
    /** Layers another Game UI takes, which the one they are drawn inside leaves out. */
    skipNodes: Set<FigmaExportNode>;
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
        buttons: 0,
        nextId: () => `figma-${++counter}`,
        nodeElements: new Map(),
        blueprints: new GameUiBlueprints(),
        pageTargets: options.pageTargets ?? {},
        skipNodes: new Set(),
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
    const surfaces: UISurface[] = [];
    const gameUi: ConvertedGameUi[] = [];
    const actions: Record<string, UIInputActionDef> = {};
    for (const frame of frames) {
        const width = Math.max(1, num(frame.width, 1));
        const height = Math.max(1, num(frame.height, 1));
        ctx.scale = Math.min(target.width / width, target.height / height);
        if (Math.abs(width / height - target.width / target.height) > 0.01) {
            notes.add("aspectMismatch", cleanName(frame.name));
        }

        const frameWidth = round2(width * ctx.scale);
        const frameHeight = round2(height * ctx.scale);
        const frameBox: Box = {
            x: round2((target.width - frameWidth) / 2),
            y: round2((target.height - frameHeight) / 2),
            width: frameWidth,
            height: frameHeight,
            rotation: 0,
        };
        if ((options.frameTargets?.[frame.id] ?? detectFrameTarget(frame)) === "gameUi") {
            convertGameUiFrame(ctx, frame, frameBox, target, { surfaces, gameUi, actions });
            continue;
        }

        const rootId = ctx.nextId();
        const surfaceId = ctx.nextId();
        const frameElement = convertNode(ctx, frame, rootId, frameBox);
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
            ...(Object.keys(actions).length > 0 ? { actions } : {}),
        },
        blueprints: ctx.blueprints.document(),
        imageRefs: ctx.imageRefs,
        notes: notes.list(),
        buttons: ctx.buttons,
        gameUi,
    };
}

type Box = { x: number; y: number; width: number; height: number; rotation: number };

/**
 * One node and everything under it, written into `ctx.elements`. Returns the element's id, or null
 * for a node that produced nothing (a picture the plugin could not draw).
 */
function convertNode(ctx: Context, node: FigmaExportNode, parentId: string, box: Box): string | null {
    const id = convertNodeOnce(ctx, node, parentId, box);
    if (id && typeof node.id === "string") {
        ctx.nodeElements.set(node.id, id);
    }
    return id;
}

function layoutOf(node: FigmaExportNode, box: Box): UIElement["layout"] {
    return {
        x: box.x,
        y: box.y,
        width: Math.max(1, box.width),
        height: Math.max(1, box.height),
        ...(box.rotation !== 0 ? { rotation: round2(box.rotation) } : {}),
        opacity: round2(clamp01(num(node.opacity, 1))),
        visible: true,
    };
}

function convertNodeOnce(ctx: Context, node: FigmaExportNode, parentId: string, box: Box): string | null {
    const name = cleanName(node.name);
    if (node.blendMode && node.kind !== "raster") {
        ctx.notes.add("blendMode", name);
    }
    const layout = layoutOf(node, box);

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

    const button = recognizeButton(ctx, node);
    if (button) {
        ctx.buttons += 1;
        return addElement(ctx, parentId, { type: "nl.button", name, layout, props: buttonProps(ctx, node, button) });
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
        if (ctx.skipNodes.has(child)) continue;
        const childId = convertNode(ctx, child, id, boxInParent(ctx, child, node, stacked));
        if (childId) {
            childIds.push(childId);
        }
    }
    ctx.elements[id].childrenIds = childIds;
    return id;
}

/** Where a child sits in its parent's frame, scaled to the project. */
function boxInParent(ctx: Context, child: FigmaExportNode, parent: FigmaExportNode, stacked = false): Box {
    const placed = placeInParent(
        { transform: matrixOf(child.transform), width: num(child.width, 0), height: num(child.height, 0) },
        matrixOf(parent.transform),
    );
    return {
        x: round2(placed.x * ctx.scale),
        y: round2(placed.y * ctx.scale),
        width: round2(placed.width * ctx.scale),
        height: round2(placed.height * ctx.scale),
        rotation: stacked ? 0 : placed.rotation,
    };
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

type RecognizedButton = ButtonShape;

/** Whether a node is a button drawn in states (`gameUiReading.readButton`); a mixed one is reported by name. */
function recognizeButton(ctx: Context, node: FigmaExportNode): RecognizedButton | null {
    const button = readButton(node);
    if (button === "mixed") {
        ctx.notes.add("buttonNotRecognized", cleanName(node.name));
        return null;
    }
    return button;
}

/** A state's look as button props: its fill, stroke, corner and shadows. */
function buttonLookOf(ctx: Context, look: FigmaExportNode): Record<string, unknown> {
    if (look.kind === "raster") {
        const ref = look.raster?.imageRef;
        const present = Boolean(ref && ctx.file.images[ref]);
        if (!present) {
            ctx.notes.add("missingImage", cleanName(look.name));
        }
        return {
            fillType: "image",
            imageFill: { mode: "stretch", assetId: present ? useImage(ctx, ref!) : null },
            fillVisible: present,
            fillOpacity: 1,
            borderWidth: 0,
            borderStyle: "none",
        };
    }
    const chrome = chromeProps(ctx, look, pickFill(ctx, look));
    const effects = effectsOf(ctx, look, false);
    return {
        backgroundColor: chrome.backgroundColor,
        fillType: chrome.fillType,
        fillOpacity: chrome.fillOpacity,
        fillVisible: chrome.fillVisible,
        imageFill: chrome.imageFill ?? null,
        gradientFill: chrome.gradientFill ?? null,
        borderRadius: chrome.borderRadius,
        borderWidth: chrome.borderWidth,
        borderColor: chrome.borderColor,
        borderStyle: chrome.strokeVisible ? chrome.borderStyle : "none",
        strokeOpacity: chrome.strokeOpacity,
        strokeAlign: chrome.strokeAlign,
        strokeSide: chrome.strokeSide,
        effectShadow: effects.effectShadow,
        effectInnerShadow: effects.effectInnerShadow,
        effectBlur: effects.effectBlur,
        effectBackgroundBlur: effects.effectBackgroundBlur,
    };
}

/** The parts of a label a state may restyle. Read without reporting, which the label itself does. */
function labelLookOf(ctx: Context, text: FigmaExportNode): Record<string, unknown> {
    const style = text.text;
    if (!style) return {};
    const fills = (Array.isArray(text.fills) ? text.fills : []).filter(paint => num(paint.opacity, 1) > 0);
    const top = fills[fills.length - 1];
    const weight = num(style.fontWeight, 400);
    return {
        ...(top?.type === "SOLID" ? { color: figmaColorToCss(top.color, num(top.opacity, 1)) } : {}),
        fontSize: round2(Math.max(1, num(style.fontSize, 16)) * ctx.scale),
        fontWeight: weight >= 700 ? "bold" : weight >= 600 ? "600" : "normal",
    };
}

const STATE_CONDITIONS: Record<Exclude<ButtonState, "default" | "selected">, AppearanceSystemCondition> = {
    hover: { hovered: true },
    pressed: { active: true },
    disabled: { disabled: true },
};

/**
 * A recognised button as `nl.button` props. The default look is the button's own; every other state
 * adds a conditional row to each appearance group it changes, in the order hover, pressed, disabled -
 * the last matching row wins, so pressing (which is also hovering) shows the pressed look.
 */
function buttonProps(ctx: Context, node: FigmaExportNode, button: RecognizedButton): ButtonWidgetProps {
    const base = buttonLookOf(ctx, button.states.default!);
    const props = { ...defaultButtonWidgetProps, ...base, label: "" } as ButtonWidgetProps & Record<string, unknown>;
    props.effects = {
        ...DEFAULT_ELEMENT_EFFECT_VALUES,
        effectShadow: (base.effectShadow as EffectShadowStored | null | undefined) ?? null,
        effectInnerShadow: (base.effectInnerShadow as EffectShadowStored | null | undefined) ?? null,
        effectBlur: num(base.effectBlur, 0),
        effectBackgroundBlur: num(base.effectBackgroundBlur, 0),
    };
    for (const key of ["effectShadow", "effectInnerShadow", "effectBlur", "effectBackgroundBlur"]) {
        delete props[key];
    }

    if (button.label?.text) {
        const text = textProps(ctx, button.label);
        Object.assign(props, {
            label: text.text,
            fontSize: text.fontSize,
            color: text.color,
            fontWeight: text.fontWeight,
            fontAssetId: text.fontAssetId,
            lineHeight: text.lineHeight,
            textAlign: text.textAlign,
            textVerticalAlign: text.textVerticalAlign,
            textWrapMode: text.textWrapMode,
        });
        props.effects.effectTextShadow = text.effects.effectTextShadow;
        // The label sits where it was drawn: the gap on its aligned side becomes the padding.
        const placed = placeInParent(
            { transform: matrixOf(button.label.transform), width: num(button.label.width, 0), height: num(button.label.height, 0) },
            matrixOf(node.transform),
        );
        const left = Math.max(0, placed.x) * ctx.scale;
        const right = Math.max(0, num(node.width, 0) - placed.x - placed.width) * ctx.scale;
        props.paddingX = round2(text.textAlign === "left" ? left : text.textAlign === "right" ? right : Math.min(left, right));
        props.paddingY = 0;
    }

    const model = withEffectRows(createInitialButtonAppearance(props), props.effects);
    const variant = model.variants.find(entry => entry.id === model.defaultVariantId) ?? model.variants[0];
    for (const state of ["hover", "pressed", "disabled"] as const) {
        const look = button.states[state];
        if (!look) continue;
        const values: Record<string, unknown> = {
            ...buttonLookOf(ctx, look),
            ...(button.labels[state] ? labelLookOf(ctx, button.labels[state]!) : {}),
        };
        for (const group of variant.propertyGroups) {
            if (!Object.prototype.hasOwnProperty.call(values, group.key)) continue;
            const baseRow = group.rows.find(row => !row.conditions);
            const value = values[group.key] as AppearanceRowValue;
            if (JSON.stringify(baseRow?.value ?? null) === JSON.stringify(value ?? null)) continue;
            group.rows.push({ conditions: STATE_CONDITIONS[state], value });
        }
    }
    const selected = button.states.selected;
    if (selected) {
        // A look kept while what the button stands for is on, so a variant a blueprint switches to
        // rather than a condition the pointer brings: the default's rows, its base looks replaced.
        const values: Record<string, unknown> = {
            ...buttonLookOf(ctx, selected),
            ...(button.labels.selected ? labelLookOf(ctx, button.labels.selected) : {}),
        };
        const lit = JSON.parse(JSON.stringify(variant)) as typeof variant;
        lit.id = "selected";
        lit.name = "Selected";
        for (const group of lit.propertyGroups) {
            if (!Object.prototype.hasOwnProperty.call(values, group.key)) continue;
            const baseRow = group.rows.find(row => !row.conditions);
            if (baseRow) baseRow.value = values[group.key] as AppearanceRowValue;
        }
        model.variants = [...model.variants.filter(entry => entry.id !== "selected"), lit];
    }
    props.appearance = model;
    return props;
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

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}

// ---------------------------------------------------------------------------
// Game UI
// ---------------------------------------------------------------------------

type GameUiOutput = {
    surfaces: UISurface[];
    gameUi: ConvertedGameUi[];
    actions: Record<string, UIInputActionDef>;
};

const shift = (box: Box, by: { x: number; y: number }): Box => ({ ...box, x: round2(box.x + by.x), y: round2(box.y + by.y) });

/**
 * A game-screen design as the Game UI it holds: one stage surface per part, each laid out where the
 * part sits on the screen, its working parts wired. Whatever in the frame belongs to no part - the
 * background, the sprites, the mock line of story - is the stage's, not the interface's, and stays out.
 */
function convertGameUiFrame(ctx: Context, frame: FigmaExportNode, frameBox: Box, target: UISurfaceDesignSize, out: GameUiOutput): void {
    const parts = gameUiPartsOf(frame);
    for (const part of parts) {
        ctx.skipNodes.add(part.node);
    }
    if (!parts[0]?.whole) {
        for (const child of childrenOf(frame)) {
            if (!ctx.skipNodes.has(child)) ctx.notes.add("gameUiArtSkipped", cleanName(child.name));
        }
    }

    for (const part of parts) {
        const partName = cleanName(part.node.name);
        if (out.gameUi.some(entry => entry.slot === part.slot)) {
            ctx.notes.add("gameUiSlotTwice", partName);
            continue;
        }
        const rootId = ctx.nextId();
        const surfaceId = ctx.nextId();
        const root: UIElement = {
            id: rootId,
            type: "nl.root",
            name: "Root",
            parentId: null,
            childrenIds: [],
            layout: { x: 0, y: 0, width: target.width, height: target.height, visible: true, opacity: 1 },
        };
        ctx.elements[rootId] = root;

        let wired = 0;
        const holds = part.whole || part.node.kind === "group" || part.node.kind === "frame";
        if (!holds) {
            // A single picture named for a slot: drawn where it was, with nothing in it to wire.
            const id = convertNode(ctx, part.node, rootId, shift(boxInParent(ctx, part.node, frame), frameBox));
            if (id) root.childrenIds.push(id);
        } else {
            let hostId = rootId;
            let hostNode = frame;
            let offset = { x: frameBox.x, y: frameBox.y };
            if (!part.whole) {
                const box = shift(boxInParent(ctx, part.node, frame), frameBox);
                const props = containerProps(ctx, part.node, pickFill(ctx, part.node));
                // Its layers are placed by position below, which a stack would override.
                props.layoutKind = "free";
                hostId = addElement(ctx, rootId, { type: "nl.container", name: partName, layout: layoutOf(part.node, { ...box, rotation: 0 }), props });
                ctx.nodeElements.set(part.node.id, hostId);
                root.childrenIds.push(hostId);
                hostNode = part.node;
                offset = { x: 0, y: 0 };
            }
            const children = childrenOf(hostNode).filter(child => !ctx.skipNodes.has(child));
            const place = (child: FigmaExportNode): Box => shift(boxInParent(ctx, child, hostNode), offset);
            if (part.slot === "choice" || part.slot === "notification") {
                wired += convertListPart(ctx, part.slot, surfaceId, hostId, children, place);
            } else {
                for (const child of children) {
                    const id = convertNode(ctx, child, hostId, place(child));
                    if (id) ctx.elements[hostId].childrenIds.push(id);
                }
                if (part.slot === "dialog") {
                    wired += wireDialog(ctx, surfaceId, part.whole ? null : hostId, part.node, children);
                } else {
                    wired += wireQuickMenu(ctx, surfaceId, children);
                }
            }
        }

        const surface: UISurface = {
            id: surfaceId,
            name: partName || part.slot,
            host: "player",
            kind: "stageSurface",
            designSize: { ...target },
            rootElementId: rootId,
            mount: { kind: "slot", slotId: part.slot },
        };
        if (part.slot === "dialog") {
            // The box answers Advance, Hide and (with a Log page to open) Backlog, as the starter's does.
            const logPageId = ctx.pageTargets.log ?? null;
            ctx.blueprints.dialogSurface(surfaceId, logPageId);
            const answered = ["advance", "hide", ...(logPageId ? ["backlog"] : [])];
            surface.actions = answered.map(actionId => ({ actionId }));
            for (const actionId of answered) {
                out.actions[actionId] = DIALOG_INPUT_ACTIONS[actionId];
            }
        }
        out.surfaces.push(surface);
        out.gameUi.push({ slot: part.slot, surfaceId, name: surface.name, wired });
    }
}

/**
 * Gives the dialogue box's parts their jobs: the line becomes the box's sentence, the name follows
 * the speaker (and the plate it sits on shows only while someone speaks), the avatar shows the
 * speaker's face. A part is found by its name; when the line or the name is not named, the largest
 * text is taken for the line and the text just above it for the name, and the report says so.
 *
 * `hostId` is the box's own container, which stays on screen and so can carry the plate's blueprint;
 * null when the frame itself is the box.
 */
function wireDialog(ctx: Context, surfaceId: string, hostId: string | null, partNode: FigmaExportNode, children: readonly FigmaExportNode[]): number {
    const partName = cleanName(partNode.name);
    const reading = readDialog(children, node => {
        const id = ctx.nodeElements.get(node.id);
        return Boolean(id) && (node.kind !== "text" || ctx.elements[id!].type === "nl.text");
    });

    let wired = 0;
    const sentence = reading.sentence;
    if (sentence && reading.sentenceGuessed) ctx.notes.add("dialogLineGuessed", partName);
    let sentenceId: string | null = null;
    if (sentence) {
        sentenceId = ctx.nodeElements.get(sentence.id)!;
        ctx.elements[sentenceId].type = "nl.dialog.sentence";
        wired += 1;
    } else {
        ctx.notes.add("dialogNoLine", partName);
    }

    const nameNode = reading.name;
    if (nameNode && reading.nameGuessed) ctx.notes.add("dialogNameGuessed", cleanName(nameNode.name));
    if (nameNode) {
        const nameId = ctx.nodeElements.get(nameNode.id)!;
        const blueprintId = ctx.blueprints.nametagValue(surfaceId, nameId, "text");
        const element = ctx.elements[nameId];
        element.valueBindings = { ...(element.valueBindings ?? {}), text: { kind: "blueprintValue", blueprintId, valueType: "string" } };
        wired += 1;
        // The plate is the layer the name sits in, when that is a layer of its own inside the box.
        const plate = reading.plate;
        const plateId = plate ? ctx.nodeElements.get(plate.id) : undefined;
        const owner = hostId ?? sentenceId;
        if (plate && plateId && owner) {
            ctx.blueprints.hideWithoutSpeaker(surfaceId, owner, plateId, ctx.elements[plateId].type);
        }
    }

    const face = reading.avatar;
    if (face) {
        const id = ctx.nodeElements.get(face.id)!;
        const element = ctx.elements[id];
        if (element.type === "nl.container" && element.childrenIds.length === 0) {
            // A placeholder shape: an image of the same shape, empty until a speaker has a face.
            element.type = "nl.image";
            element.props = imageProps(ctx, face, { mode: "cover", assetId: null }, true);
        }
        if (element.type === "nl.image") {
            ctx.blueprints.speakerAvatar(surfaceId, id);
            wired += 1;
        }
    }
    return wired;
}

/**
 * The choice menu or the notifications as the list the slot needs. The options drawn (a text, or a
 * group or button holding one) are rows: the first becomes the row every item is drawn from, its
 * words bound to the item's text, and the rest set the spacing and the sample items. Anything else
 * in the part is drawn as it was, behind or in front of the list as it was layered.
 */
function convertListPart(
    ctx: Context,
    slot: "choice" | "notification",
    surfaceId: string,
    hostId: string,
    children: readonly FigmaExportNode[],
    place: (child: FigmaExportNode) => Box,
): number {
    const options = listOptionsOf(children, child => place(child).y);
    const host = ctx.elements[hostId];
    if (options.length === 0) {
        ctx.notes.add("listNotRecognized", host.name);
        for (const child of children) {
            const id = convertNode(ctx, child, hostId, place(child));
            if (id) host.childrenIds.push(id);
        }
        return 0;
    }

    const template = options[0];
    const boxes = options.map(place);
    const first = boxes[0];
    const gap = boxes.length > 1 ? Math.max(0, round2(boxes[1].y - (first.y + first.height))) : slot === "choice" ? 16 : 12;
    const rows = Math.max(boxes.length, slot === "choice" ? 4 : 3);
    const field = slot === "choice" ? "text" : "message";
    const items = slot === "choice"
        ? options.map((option, index) => ({ text: wordsOf(option), index, disabled: false, voiceId: "" }))
        : options.map((option, index) => ({ id: `preview-${index + 1}`, message: wordsOf(option) }));
    const props: ListWidgetProps = {
        ...(JSON.parse(JSON.stringify(defaultListWidgetProps)) as ListWidgetProps),
        itemStructId: slot === "choice" ? UI_STRUCT_ID_CHOICE_ITEM : UI_STRUCT_ID_NOTIFICATION_ITEM,
        itemKeyFieldId: slot === "choice" ? "index" : "id",
        itemGap: gap,
        placeholderCount: rows,
        items,
    };
    props.scrollbar = { ...props.scrollbar, enabled: false, visibility: "hidden" };

    let wired = 0;
    for (const child of children) {
        if (child !== template) {
            if (options.includes(child)) continue;
            const id = convertNode(ctx, child, hostId, place(child));
            if (id) host.childrenIds.push(id);
            continue;
        }
        const listId = addElement(ctx, hostId, {
            type: slot === "choice" ? "nl.choice.list" : "nl.notification.list",
            name: slot === "choice" ? "Choice list" : "Notification list",
            layout: {
                x: Math.min(...boxes.map(box => box.x)),
                y: first.y,
                width: Math.max(...boxes.map(box => box.width)),
                height: round2(rows * first.height + (rows - 1) * gap),
                visible: true,
                opacity: 1,
            },
            props: props as unknown as Record<string, unknown>,
        });
        host.childrenIds.push(listId);
        const rowId = convertNode(ctx, template, listId, { x: 0, y: 0, width: first.width, height: first.height, rotation: 0 });
        if (!rowId) continue;
        const row = ctx.elements[rowId];
        row.extra = { ...(row.extra ?? {}), listSlot: "itemTemplate" };
        ctx.elements[listId].childrenIds = [rowId];
        const words = findWords(ctx, rowId);
        if (words) {
            const element = ctx.elements[words];
            const prop = element.type === "nl.button" ? "label" : "text";
            element.valueBindings = { ...(element.valueBindings ?? {}), [prop]: { kind: "listItemField", fieldId: field } };
            wired += 1;
        } else {
            ctx.notes.add("listNotRecognized", host.name);
        }
        if (slot === "choice") {
            ctx.blueprints.choiceList(surfaceId, listId);
            wired += 1;
        }
    }
    return wired;
}

/** The element under `id` (itself included) that shows a row's words: a text or a labelled button. */
function findWords(ctx: Context, id: string): string | null {
    const element = ctx.elements[id];
    if (element.type === "nl.text" || (element.type === "nl.button" && typeof element.props?.label === "string" && element.props.label)) {
        return id;
    }
    for (const child of element.childrenIds) {
        const found = findWords(ctx, child);
        if (found) return found;
    }
    return null;
}

const PAGE_BLUEPRINT_NAMES: Record<QuickMenuPage, string> = { log: "Log", save: "Save", load: "Load", config: "Config" };

/**
 * Gives the quick menu's buttons their jobs, by name: Auto and Skip turn on and off (and light, when
 * the button has a `selected` look), Log, Save, Load and Config open the project's page for it, Hide
 * hides the dialogue box. The outermost layer with such a name is the button - a group named `Auto`
 * holding a picture and a text is one button, not two.
 */
function wireQuickMenu(ctx: Context, surfaceId: string, children: readonly FigmaExportNode[]): number {
    let wired = 0;
    const lit: { kind: "auto" | "skip"; elementId: string; elementType: string }[] = [];
    for (const { action, node } of readQuickMenu(children, node => ctx.nodeElements.has(node.id))) {
        const id = ctx.nodeElements.get(node.id)!;
        const element = ctx.elements[id];
        if (action === "auto" || action === "skip") {
            const variants = (element.props?.appearance as AppearanceModel | undefined)?.variants ?? [];
            const hasLit = element.type === "nl.button" && variants.some(variant => variant.id === "selected");
            ctx.blueprints.toggle(action, surfaceId, id, element.type, hasLit);
            if (hasLit) lit.push({ kind: action, elementId: id, elementType: element.type });
            wired += 1;
        } else if (action === "hide") {
            ctx.blueprints.toggleDialog(surfaceId, id);
            wired += 1;
        } else {
            const pageId = ctx.pageTargets[action];
            if (pageId) {
                ctx.blueprints.openPage(PAGE_BLUEPRINT_NAMES[action], surfaceId, id, pageId);
                wired += 1;
            } else {
                ctx.notes.add("quickMenuPageMissing", cleanName(node.name));
            }
        }
    }
    ctx.blueprints.quickMenuSurface(surfaceId, lit);
    return wired;
}
