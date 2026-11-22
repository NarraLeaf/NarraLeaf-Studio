/**
 * Plain pictures (PNG, JPEG, WebP) as a design to import: one page holding all of them.
 *
 * What an author hands over is usually one of three things, and the layout serves all three:
 *
 * - **A finished screen as one picture.** It is the canvas, and arrives filling the page.
 * - **Layers exported at the size of the canvas**, transparent around the art. They are all the
 *   canvas's size, so they line up exactly where they were drawn.
 * - **Cut-outs** (a button, a frame, an icon). Nothing records where they went, so they arrive at
 *   their own size in the middle of the canvas, and the report says how many need placing.
 *
 * The canvas is the largest picture. The stack puts the most opaque picture at the bottom - a
 * background covers everything it is under, so it can only have been meant to be under it - and keeps
 * the order the files were picked in among equals.
 *
 * Pure: no service, no file. The caller decodes the pictures and measures their coverage.
 *
 * Comments in English per project convention.
 */

import type { FigmaExportFile, FigmaExportNode, FigmaImportNote } from "./figmaExportFormat";
import { FIGMA_EXPORT_FORMAT, FIGMA_EXPORT_VERSION } from "./figmaExportFormat";

export type DesignPicture = {
    name: string;
    mime: string;
    bytes: Uint8Array;
    width: number;
    height: number;
    /** How much of the picture is opaque, 0..1. */
    coverage: number;
};

const MAX_EXAMPLES = 3;

export function buildImageDesignFile(pictures: readonly DesignPicture[], pageName: string): FigmaExportFile {
    const usable = pictures.filter(picture => picture.width > 0 && picture.height > 0);
    const canvas = usable.reduce<DesignPicture | null>(
        (largest, picture) => (!largest || picture.width * picture.height > largest.width * largest.height ? picture : largest),
        null,
    );
    const width = canvas?.width ?? 1;
    const height = canvas?.height ?? 1;

    const ordered = usable
        .map((picture, index) => ({ picture, index }))
        .sort((a, b) => b.picture.coverage - a.picture.coverage || a.index - b.index)
        .map(entry => entry.picture);

    const images: FigmaExportFile["images"] = {};
    const centred: string[] = [];
    let centredCount = 0;
    const children: FigmaExportNode[] = ordered.map((picture, index) => {
        const ref = `image-${index + 1}`;
        images[ref] = { mime: picture.mime, bytes: picture.bytes, name: picture.name };
        const fills = picture.width === width && picture.height === height;
        if (!fills) {
            centredCount += 1;
            if (centred.length < MAX_EXAMPLES) centred.push(picture.name);
        }
        const x = fills ? 0 : Math.round((width - picture.width) / 2);
        const y = fills ? 0 : Math.round((height - picture.height) / 2);
        return {
            id: ref,
            name: picture.name,
            kind: "raster",
            figmaType: "IMAGE_FILE",
            width: picture.width,
            height: picture.height,
            transform: [[1, 0, x], [0, 1, y]],
            opacity: 1,
            fills: [],
            strokes: [],
            strokeWeight: 0,
            strokeAlign: "CENTER",
            dashed: false,
            radii: [0, 0, 0, 0],
            effects: [],
            clipsContent: false,
            raster: { imageRef: ref, reason: "layer" },
        };
    });

    const notes: FigmaImportNote[] = centredCount > 0 ? [{ code: "imageCentered", count: centredCount, examples: centred }] : [];
    return {
        format: FIGMA_EXPORT_FORMAT,
        version: FIGMA_EXPORT_VERSION,
        source: { fileName: pageName, pageName: "" },
        frames: [{
            id: "images",
            name: pageName,
            kind: "frame",
            figmaType: "IMAGE_FILES",
            width,
            height,
            transform: [[1, 0, 0], [0, 1, 0]],
            opacity: 1,
            fills: [],
            strokes: [],
            strokeWeight: 0,
            strokeAlign: "CENTER",
            dashed: false,
            radii: [0, 0, 0, 0],
            effects: [],
            clipsContent: true,
            children,
        }],
        images,
        notes,
    };
}
