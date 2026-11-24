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
 * The caller trims each picture to its opaque area first and says where the trimmed part sat in the
 * file (`left`, `top`, `sourceWidth`, `sourceHeight`), so a canvas-size layer arrives as an element
 * the size of its art at the place it was drawn, not as a transparent full-screen sheet.
 *
 * Pictures named for button states (`start.png`, `start_hover.png`, `start_pressed.png`) and marked
 * by the caller with a shared `button.key` become one group of state layers, which the converter
 * makes into a button. The caller cuts every state of one button from the same rectangle.
 *
 * The canvas is the largest picture when it has the project's shape - a screen drawn at another
 * resolution, scaled to fit as any page is. Otherwise the canvas is the project's own resolution and
 * every picture arrives at its own size: a single icon or panel is not blown up to fill the screen.
 * The stack puts the most opaque picture at the bottom - a
 * background covers everything it is under, so it can only have been meant to be under it - and keeps
 * the order the files were picked in among equals.
 *
 * Pure: no service, no file. The caller decodes, trims and measures the pictures.
 *
 * Comments in English per project convention.
 */

import type { FigmaExportFile, FigmaExportNode, FigmaImportNote, FigmaMatrix } from "./figmaExportFormat";
import { FIGMA_EXPORT_FORMAT, FIGMA_EXPORT_VERSION } from "./figmaExportFormat";
import { BUTTON_STATES, buttonBaseName, type ButtonState } from "./buttonStates";

export type DesignPicture = {
    name: string;
    mime: string;
    /** The picture as it is imported: trimmed, when the caller trimmed it. */
    bytes: Uint8Array;
    width: number;
    height: number;
    /** How much of the picture is opaque, 0..1. */
    coverage: number;
    /** Where the imported part sat in the original file, and that file's size. */
    left?: number;
    top?: number;
    sourceWidth?: number;
    sourceHeight?: number;
    /** A state of the button named `key`. */
    button?: { key: string; state: ButtonState };
};

const MAX_EXAMPLES = 3;

const translate = (x: number, y: number): FigmaMatrix => [[1, 0, x], [0, 1, y]];

function baseNode(): Omit<FigmaExportNode, "id" | "name" | "kind" | "figmaType" | "width" | "height" | "transform"> {
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

const sourceWidthOf = (picture: DesignPicture) => picture.sourceWidth ?? picture.width;
const sourceHeightOf = (picture: DesignPicture) => picture.sourceHeight ?? picture.height;

/** One thing to place: a picture, or the states of one button. */
type Entry = { name: string; pictures: DesignPicture[]; coverage: number; index: number; button: boolean };

export function buildImageDesignFile(
    pictures: readonly DesignPicture[],
    pageName: string,
    projectSize?: { width: number; height: number },
): FigmaExportFile {
    const usable = pictures.filter(picture => picture.width > 0 && picture.height > 0);
    const largest = usable.reduce<DesignPicture | null>(
        (best, picture) =>
            !best || sourceWidthOf(picture) * sourceHeightOf(picture) > sourceWidthOf(best) * sourceHeightOf(best)
                ? picture
                : best,
        null,
    );
    const screenShaped = (picture: DesignPicture) =>
        !projectSize
        || Math.abs(sourceWidthOf(picture) / sourceHeightOf(picture) - projectSize.width / projectSize.height) <= 0.01;
    const canvas = largest && screenShaped(largest) ? { width: sourceWidthOf(largest), height: sourceHeightOf(largest) } : projectSize;
    const width = canvas?.width ?? 1;
    const height = canvas?.height ?? 1;

    // Buttons with fewer than two states, or without a default, are plain pictures after all.
    const byKey = new Map<string, DesignPicture[]>();
    for (const picture of usable) {
        if (picture.button) byKey.set(picture.button.key, [...(byKey.get(picture.button.key) ?? []), picture]);
    }
    const isButton = (key: string) => {
        const members = byKey.get(key) ?? [];
        return members.length >= 2 && members.some(member => member.button?.state === "default");
    };

    const entries: Entry[] = [];
    const seen = new Set<string>();
    usable.forEach((picture, index) => {
        const key = picture.button?.key;
        if (key && isButton(key)) {
            if (seen.has(key)) return;
            seen.add(key);
            const members = byKey.get(key)!;
            const main = members.find(member => member.button?.state === "default")!;
            entries.push({ name: buttonBaseName(main.name) || main.name, pictures: members, coverage: main.coverage, index, button: true });
            return;
        }
        entries.push({ name: picture.name, pictures: [picture], coverage: picture.coverage, index, button: false });
    });
    entries.sort((a, b) => b.coverage - a.coverage || a.index - b.index);

    const images: FigmaExportFile["images"] = {};
    const centred: string[] = [];
    let centredCount = 0;
    let counter = 0;

    const place = (picture: DesignPicture): { x: number; y: number } => {
        const fills = sourceWidthOf(picture) === width && sourceHeightOf(picture) === height;
        const originX = fills ? 0 : Math.round((width - sourceWidthOf(picture)) / 2);
        const originY = fills ? 0 : Math.round((height - sourceHeightOf(picture)) / 2);
        return { x: originX + (picture.left ?? 0), y: originY + (picture.top ?? 0) };
    };
    const raster = (picture: DesignPicture, name: string): FigmaExportNode => {
        const ref = `image-${++counter}`;
        images[ref] = { mime: picture.mime, bytes: picture.bytes, name: picture.name };
        const at = place(picture);
        return {
            ...baseNode(),
            id: ref,
            name,
            kind: "raster",
            figmaType: "IMAGE_FILE",
            width: picture.width,
            height: picture.height,
            transform: translate(at.x, at.y),
            raster: { imageRef: ref, reason: "layer" },
        };
    };

    const children: FigmaExportNode[] = entries.map(entry => {
        const first = entry.pictures[0];
        const fills = sourceWidthOf(first) === width && sourceHeightOf(first) === height;
        if (!fills) {
            centredCount += 1;
            if (centred.length < MAX_EXAMPLES) centred.push(entry.name);
        }
        if (!entry.button) {
            return raster(first, first.name);
        }
        // The states, default first, each named by its state so the converter reads it as one.
        const order: readonly ButtonState[] = BUTTON_STATES;
        const states = [...entry.pictures].sort(
            (a, b) => order.indexOf(a.button!.state) - order.indexOf(b.button!.state),
        );
        const layers = states.map(state => raster(state, state.button!.state));
        const at = place(states[0]);
        return {
            ...baseNode(),
            id: `button-${++counter}`,
            name: entry.name,
            kind: "group",
            figmaType: "IMAGE_BUTTON",
            width: states[0].width,
            height: states[0].height,
            transform: translate(at.x, at.y),
            children: layers,
        };
    });

    const notes: FigmaImportNote[] = centredCount > 0 ? [{ code: "imageCentered", count: centredCount, examples: centred }] : [];
    return {
        format: FIGMA_EXPORT_FORMAT,
        version: FIGMA_EXPORT_VERSION,
        source: { fileName: pageName, pageName: "" },
        frames: [{
            ...baseNode(),
            id: "images",
            name: pageName,
            kind: "frame",
            figmaType: "IMAGE_FILES",
            width,
            height,
            transform: translate(0, 0),
            clipsContent: true,
            children,
        }],
        images,
        notes,
    };
}
