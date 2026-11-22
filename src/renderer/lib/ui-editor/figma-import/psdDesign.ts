/**
 * A PSD as a design to import: which layers to bake, what is flattened onto what, where each picture
 * is cut out, and the frame the converter turns into a page.
 *
 * Unlike a character, an interface keeps the PSD's structure: a group is a container, a layer is an
 * image at the place Photoshop drew it, and the stack order is Photoshop's. The bake (main process,
 * `bakePsd`) draws each layer at full document size with its opacity and mask multiplied in; the
 * caller cuts each picture down to the rectangle planned here, so a 40px icon is a 40px image rather
 * than a full-screen one.
 *
 * What the engine cannot draw is settled the way Photoshop shows it, without asking:
 *
 * - A clipped layer is flattened onto the layer it clips to.
 * - A layer with a blend mode the bake can reproduce is flattened onto the layer under it in the same
 *   group. A mode it cannot reproduce, or one with nothing under it, stays a plain layer and is
 *   reported.
 * - Hidden layers are left out.
 * - Layer styles are not drawn by the bake; the layers that have them are reported.
 *
 * Pure: no service, no file.
 *
 * Comments in English per project convention.
 */

import type { PsdBakeTarget, PsdDocument, PsdLayerNode } from "@shared/types/psdImport";
import { canMergeBlendMode, isUnsupportedBlend, psdLayerKey, psdLayerReference } from "@shared/utils/psdLayerPlan";
import type { FigmaExportFile, FigmaExportNode, FigmaImportNote, FigmaImportNoteCode, FigmaMatrix } from "./figmaExportFormat";
import { FIGMA_EXPORT_FORMAT, FIGMA_EXPORT_VERSION } from "./figmaExportFormat";

export type PsdCropRect = { left: number; top: number; width: number; height: number };

export type PsdDesignNode =
    | { kind: "group"; name: string; opacity: number; blendMode: string; children: PsdDesignNode[] }
    | { kind: "layer"; key: string; name: string; blendMode: string };

export type PsdDesignPlan = {
    /** One per layer that becomes an image, with what is flattened onto it. */
    targets: PsdBakeTarget[];
    /** Where each target's picture is cut out of its full-document bake, by layer key. */
    crops: Record<string, PsdCropRect>;
    /** The groups and layers that arrive, bottom first. */
    tree: PsdDesignNode[];
    notes: FigmaImportNote[];
    skippedHidden: number;
};

/** A baked, cut-out picture: its bytes and where it sits in the document. */
export type PsdBakedPicture = PsdCropRect & { bytes: Uint8Array };

const MAX_EXAMPLES = 3;

type Bounds = { left: number; top: number; right: number; bottom: number };

function boundsOf(node: PsdLayerNode): Bounds | null {
    const b = node.bounds;
    if (!b || b.right <= b.left || b.bottom <= b.top) {
        return null;
    }
    return { ...b };
}

function union(a: Bounds | null, b: Bounds | null): Bounds | null {
    if (!a) return b;
    if (!b) return a;
    return {
        left: Math.min(a.left, b.left),
        top: Math.min(a.top, b.top),
        right: Math.max(a.right, b.right),
        bottom: Math.max(a.bottom, b.bottom),
    };
}

export function planPsdDesign(document: PsdDocument): PsdDesignPlan {
    const notes = new Map<FigmaImportNoteCode, FigmaImportNote>();
    const note = (code: FigmaImportNoteCode, example: string) => {
        const entry = notes.get(code) ?? { code, count: 0, examples: [] };
        entry.count += 1;
        if (example && entry.examples.length < MAX_EXAMPLES && !entry.examples.includes(example)) {
            entry.examples.push(example);
        }
        notes.set(code, entry);
    };
    let skippedHidden = 0;
    const targets = new Map<string, PsdBakeTarget>();
    const extents = new Map<string, Bounds>();

    const walk = (nodes: readonly PsdLayerNode[], parentHidden: boolean): PsdDesignNode[] => {
        const out: PsdDesignNode[] = [];
        /** The layer each leaf's pixels end up on, so a clip onto a merged layer follows it. */
        const host = new Map<string, string>();
        /** The nearest layer below that is not clipped - what a clipped layer clips to. */
        let clipBase: PsdLayerNode | null = null;
        /** The nearest layer below that arrives as an image of its own, in this group. */
        let below: string | null = null;

        for (const node of nodes) {
            if (node.hidden) {
                if (!parentHidden) {
                    skippedHidden += 1;
                }
                if (!node.clipping) {
                    clipBase = node;
                }
                continue;
            }
            if (node.children) {
                const children = walk(node.children, false);
                if (children.length > 0) {
                    out.push({ kind: "group", name: node.name, opacity: node.opacity, blendMode: node.blendMode, children });
                }
                clipBase = node;
                below = null;
                continue;
            }
            const key = psdLayerKey(node);
            if (node.styled) {
                note("layerStyles", node.name);
            }
            const bounds = boundsOf(node);

            if (node.clipping) {
                const baseKey = clipBase && !clipBase.children && !clipBase.hidden ? host.get(psdLayerKey(clipBase)) : undefined;
                const target = baseKey ? targets.get(baseKey) : undefined;
                if (!target) {
                    note("clipBaseDropped", node.name);
                    continue;
                }
                target.mergeFrom = [...(target.mergeFrom ?? []), { ...psdLayerReference(node), clip: true }];
                host.set(key, baseKey!);
                continue;
            }
            clipBase = node;

            const unsupported = isUnsupportedBlend(node.blendMode);
            if (unsupported && canMergeBlendMode(node.blendMode) && below) {
                const target = targets.get(below)!;
                target.mergeFrom = [...(target.mergeFrom ?? []), psdLayerReference(node)];
                const grown = union(extents.get(below) ?? null, bounds);
                if (grown) extents.set(below, grown);
                host.set(key, below);
                note("blendMerged", node.name);
                continue;
            }
            if (!bounds) {
                // An empty layer draws nothing; it is not worth an element.
                continue;
            }
            if (unsupported) {
                note("blendMode", node.name);
            }
            targets.set(key, { ...psdLayerReference(node), name: node.name });
            extents.set(key, bounds);
            host.set(key, key);
            below = key;
            out.push({ kind: "layer", key, name: node.name, blendMode: unsupported ? node.blendMode : "normal" });
        }
        return out;
    };

    const tree = walk(document.layers, false);
    const crops: Record<string, PsdCropRect> = {};
    for (const [key, extent] of extents) {
        const left = Math.max(0, Math.floor(extent.left));
        const top = Math.max(0, Math.floor(extent.top));
        const right = Math.min(document.width, Math.ceil(extent.right));
        const bottom = Math.min(document.height, Math.ceil(extent.bottom));
        if (right > left && bottom > top) {
            crops[key] = { left, top, width: right - left, height: bottom - top };
        }
    }
    const pruned = prune(tree, crops);
    return {
        targets: [...targets.values()].filter(target => crops[psdLayerKey(target)]),
        crops,
        tree: pruned,
        notes: [...notes.values()],
        skippedHidden,
    };
}

/** The tree without layers that have nothing to cut out, and without groups left empty by that. */
function prune(nodes: PsdDesignNode[], crops: Record<string, PsdCropRect>): PsdDesignNode[] {
    const out: PsdDesignNode[] = [];
    for (const node of nodes) {
        if (node.kind === "layer") {
            if (crops[node.key]) out.push(node);
            continue;
        }
        const children = prune(node.children, crops);
        if (children.length > 0) out.push({ ...node, children });
    }
    return out;
}

const translate = (x: number, y: number): FigmaMatrix => [[1, 0, x], [0, 1, y]];

function emptyNode(): Omit<FigmaExportNode, "id" | "name" | "kind" | "figmaType" | "width" | "height" | "transform"> {
    return {
        opacity: 1,
        fills: [],
        strokes: [],
        strokeWeight: 0,
        strokeAlign: "CENTER",
        dashed: false,
        radii: [0, 0, 0, 0],
        effects: [],
        clipsContent: false,
    };
}

/**
 * The frame the converter reads, from the plan and the pictures that came back from the bake. A
 * layer whose picture is missing is left out, and reported as a missing picture.
 */
export function buildPsdDesignFile(
    document: PsdDocument,
    plan: PsdDesignPlan,
    pictures: ReadonlyMap<string, PsdBakedPicture>,
): FigmaExportFile {
    const images: FigmaExportFile["images"] = {};
    let missing = 0;
    const missingNames: string[] = [];
    let counter = 0;

    const build = (nodes: readonly PsdDesignNode[]): { built: FigmaExportNode[]; extent: Bounds | null } => {
        const built: FigmaExportNode[] = [];
        let extent: Bounds | null = null;
        for (const node of nodes) {
            if (node.kind === "layer") {
                const picture = pictures.get(node.key);
                if (!picture) {
                    missing += 1;
                    if (missingNames.length < MAX_EXAMPLES) missingNames.push(node.name);
                    continue;
                }
                const ref = `psd-${++counter}`;
                images[ref] = { mime: "image/png", bytes: picture.bytes, name: node.name };
                built.push({
                    ...emptyNode(),
                    id: ref,
                    name: node.name,
                    kind: "raster",
                    figmaType: "PSD_LAYER",
                    width: picture.width,
                    height: picture.height,
                    transform: translate(picture.left, picture.top),
                    raster: { imageRef: ref, reason: "layer" },
                });
                extent = union(extent, {
                    left: picture.left,
                    top: picture.top,
                    right: picture.left + picture.width,
                    bottom: picture.top + picture.height,
                });
                continue;
            }
            const inner = build(node.children);
            if (!inner.extent || inner.built.length === 0) {
                continue;
            }
            const box = inner.extent;
            built.push({
                ...emptyNode(),
                id: `psd-group-${++counter}`,
                name: node.name,
                kind: "group",
                figmaType: "PSD_GROUP",
                width: box.right - box.left,
                height: box.bottom - box.top,
                transform: translate(box.left, box.top),
                opacity: Number.isFinite(node.opacity) ? node.opacity : 1,
                ...(isUnsupportedBlend(node.blendMode) ? { blendMode: node.blendMode } : {}),
                children: inner.built,
            });
            extent = union(extent, box);
        }
        return { built, extent };
    };

    const { built } = build(plan.tree);
    const stem = document.fileName.replace(/\.(psd|psb)$/i, "") || document.fileName;
    const notes = [...plan.notes];
    if (missing > 0) {
        notes.push({ code: "missingImage", count: missing, examples: missingNames });
    }
    return {
        format: FIGMA_EXPORT_FORMAT,
        version: FIGMA_EXPORT_VERSION,
        source: { fileName: stem, pageName: "" },
        frames: [{
            ...emptyNode(),
            id: "psd-document",
            name: stem,
            kind: "frame",
            figmaType: "PSD_DOCUMENT",
            width: document.width,
            height: document.height,
            transform: translate(0, 0),
            clipsContent: true,
            children: built,
        }],
        images,
        skippedHidden: plan.skippedHidden,
        notes,
    };
}
