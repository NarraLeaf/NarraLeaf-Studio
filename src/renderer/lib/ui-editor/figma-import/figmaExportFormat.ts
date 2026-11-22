/**
 * The file the NarraLeaf Figma plugin (`tools/figma-plugin`) writes, and the check that a file read
 * from disk is one.
 *
 * The plugin stays close to Figma's own vocabulary - paints, effects, auto layout, an absolute
 * transform per node - and decides only what it alone can decide: which layers have no widget to
 * become and so have to be drawn into a picture while Figma can still draw them. Everything that maps
 * a Figma concept onto a widget happens on this side, in `convertFigmaFrames.ts`, where it can be
 * tested and changed without asking every author to reinstall a plugin.
 *
 * Images travel inside the file as base64, keyed by the id the plugin gave them. One file is one
 * thing to pick and one thing to send, which a folder of pictures beside a JSON file is not.
 *
 * Comments in English per project convention.
 */

import { isRecord } from "@shared/utils/isRecord";

export const FIGMA_EXPORT_FORMAT = "narraleaf.figma-export";
export const FIGMA_EXPORT_VERSION = 1;

/** A colour as Figma stores it: each channel 0..1. */
export type FigmaRGBA = { r: number; g: number; b: number; a: number };

/** Figma's 2x3 affine matrix, `[[a, c, tx], [b, d, ty]]`. */
export type FigmaMatrix = [[number, number, number], [number, number, number]];

export type FigmaGradientType = "GRADIENT_LINEAR" | "GRADIENT_RADIAL" | "GRADIENT_ANGULAR" | "GRADIENT_DIAMOND";

export type FigmaPaint =
    | { type: "SOLID"; color: FigmaRGBA; opacity: number }
    | {
        type: FigmaGradientType;
        /** Maps the node's unit square onto gradient space, as the plugin API reports it. */
        gradientTransform: FigmaMatrix;
        gradientStops: { position: number; color: FigmaRGBA }[];
        opacity: number;
    }
    | {
        type: "IMAGE";
        /** Key into {@link FigmaExportFile.images}; null when the plugin could not read the picture. */
        imageRef: string | null;
        scaleMode: "FILL" | "FIT" | "CROP" | "TILE";
        opacity: number;
    };

export type FigmaEffect = {
    type: "DROP_SHADOW" | "INNER_SHADOW" | "LAYER_BLUR" | "BACKGROUND_BLUR";
    color?: FigmaRGBA;
    offset?: { x: number; y: number };
    radius: number;
    spread?: number;
};

export type FigmaAutoLayout = {
    direction: "HORIZONTAL" | "VERTICAL";
    gap: number;
    /** Gap between wrapped lines; absent when the frame does not wrap. */
    counterGap?: number;
    padding: { top: number; right: number; bottom: number; left: number };
    primaryAlign: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
    counterAlign: "MIN" | "CENTER" | "MAX" | "BASELINE";
    wrap: boolean;
};

export type FigmaTextStyle = {
    characters: string;
    fontFamily: string;
    fontStyle: string;
    fontWeight: number;
    fontSize: number;
    lineHeight: { unit: "PIXELS" | "PERCENT" | "AUTO"; value: number };
    letterSpacing: { unit: "PIXELS" | "PERCENT"; value: number };
    align: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
    verticalAlign: "TOP" | "CENTER" | "BOTTOM";
    autoResize: "NONE" | "WIDTH_AND_HEIGHT" | "HEIGHT" | "TRUNCATE";
    textCase: "ORIGINAL" | "UPPER" | "LOWER" | "TITLE" | "SMALL_CAPS" | "SMALL_CAPS_FORCED";
    /** More than one style runs through the text; the fields above are its first run's. */
    mixed: boolean;
};

/**
 * What a node is to the converter. `raster` is a layer the plugin drew into a picture; the others
 * are drawn by widgets.
 */
export type FigmaExportNodeKind = "frame" | "group" | "shape" | "ellipse" | "text" | "raster";

export type FigmaExportNode = {
    id: string;
    name: string;
    kind: FigmaExportNodeKind;
    /** Figma's own node type, kept for messages. */
    figmaType: string;
    width: number;
    height: number;
    /**
     * Where the node sits on the page. For a `raster` node this is a plain translation to the top
     * left of the picture, which already has any rotation drawn into it.
     */
    transform: FigmaMatrix;
    opacity: number;
    fills: FigmaPaint[];
    strokes: FigmaPaint[];
    strokeWeight: number;
    strokeAlign: "INSIDE" | "OUTSIDE" | "CENTER";
    /** Per-edge weights, when the node has them and they differ. */
    strokeWeights?: { top: number; right: number; bottom: number; left: number };
    dashed: boolean;
    /** Corner radii, top-left, top-right, bottom-right, bottom-left. */
    radii: [number, number, number, number];
    effects: FigmaEffect[];
    clipsContent: boolean;
    autoLayout?: FigmaAutoLayout;
    /** Placed by position inside an auto-layout parent rather than by its flow. */
    absolute?: boolean;
    /** A non-normal blend mode Figma reported; kept for the report. */
    blendMode?: string;
    text?: FigmaTextStyle;
    raster?: { imageRef: string; reason: string };
    children?: FigmaExportNode[];
};

export type FigmaExportImage = {
    mime: string;
    /** The picture's bytes, base64. */
    data: string;
    name?: string;
};

export type FigmaExportFile = {
    format: typeof FIGMA_EXPORT_FORMAT;
    version: number;
    source: { fileName: string; pageName: string };
    frames: FigmaExportNode[];
    images: Record<string, FigmaExportImage>;
    /** Layers left out because they were hidden; counted by the plugin. */
    skippedHidden?: number;
};

export type FigmaExportParseResult =
    | { ok: true; file: FigmaExportFile }
    | { ok: false; reason: "notJson" | "notExport" | "tooNew" | "noFrames" };

/**
 * Read a file the plugin wrote. Only the envelope is checked here: a node with a field missing is
 * read with that field's neutral value by the converter, so a hand-trimmed file still imports what it
 * describes rather than being refused whole.
 */
export function parseFigmaExport(text: string): FigmaExportParseResult {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        return { ok: false, reason: "notJson" };
    }
    if (!isRecord(raw) || raw.format !== FIGMA_EXPORT_FORMAT) {
        return { ok: false, reason: "notExport" };
    }
    if (typeof raw.version !== "number" || raw.version > FIGMA_EXPORT_VERSION) {
        return { ok: false, reason: "tooNew" };
    }
    const frames = Array.isArray(raw.frames) ? raw.frames.filter(isRecord) : [];
    if (frames.length === 0) {
        return { ok: false, reason: "noFrames" };
    }
    const source = isRecord(raw.source) ? raw.source : {};
    const images: Record<string, FigmaExportImage> = {};
    if (isRecord(raw.images)) {
        for (const [key, value] of Object.entries(raw.images)) {
            if (isRecord(value) && typeof value.data === "string" && typeof value.mime === "string") {
                images[key] = {
                    mime: value.mime,
                    data: value.data,
                    ...(typeof value.name === "string" ? { name: value.name } : {}),
                };
            }
        }
    }
    return {
        ok: true,
        file: {
            format: FIGMA_EXPORT_FORMAT,
            version: raw.version,
            source: {
                fileName: typeof source.fileName === "string" ? source.fileName : "",
                pageName: typeof source.pageName === "string" ? source.pageName : "",
            },
            frames: frames as unknown as FigmaExportNode[],
            images,
            ...(typeof raw.skippedHidden === "number" ? { skippedHidden: raw.skippedHidden } : {}),
        },
    };
}
