import { getInterface } from "@/lib/app/bridge";
import { translate } from "@/lib/i18n";
import type { FileSystemService } from "@/lib/workspace/services/core/FileSystem";
import { parseFigmaExport, type FigmaExportFile, type FigmaExportNode } from "@/lib/ui-editor/figma-import/figmaExportFormat";
import { gameUiPartsOf } from "@/lib/ui-editor/figma-import/convertFigmaFrames";
import type { GameUiSlot } from "@/lib/ui-editor/figma-import/gameUiRoles";
import type { PsdLayerNode } from "@shared/types/psdImport";
import { buildImageDesignFile, type DesignPicture } from "@/lib/ui-editor/figma-import/imageDesign";
import { buildPsdDesignFile, planPsdDesign, type PsdBakedPicture, type PsdCropRect } from "@/lib/ui-editor/figma-import/psdDesign";
import { psdLayerKey } from "@shared/utils/psdLayerPlan";
import { buttonBaseName, buttonStateOfName, type ButtonState } from "@/lib/ui-editor/figma-import/buttonStates";
import { basename } from "@shared/utils/path";

/** The file types the picker offers: a Figma export, a PSD, and plain pictures. */
export const DESIGN_IMPORT_EXTENSIONS = ["json", "psd", "psb", "png", "jpg", "jpeg", "webp"];

const IMAGE_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

export type DesignSourceKind = "figma" | "psd" | "images";

/**
 * One row the import dialog lists and the author ticks. `gameUi` is the Game UI slots its layers are
 * named for, read from the outline so the dialog can offer to import the row as Game UI before
 * anything is loaded; empty for a row that can only be a page.
 */
export type DesignSourceItem = { id: string; name: string; width: number; height: number; gameUi: GameUiSlot[] };

/** The slots a frame's parts fill, each once. */
function slotsOf(frame: FigmaExportNode): GameUiSlot[] {
    return [...new Set(gameUiPartsOf(frame).map(part => part.slot))];
}

/** A PSD layer tree as far as `gameUiPartsOf` reads one: names, and which layers are groups. */
function psdOutline(name: string, layers: readonly PsdLayerNode[] | undefined): FigmaExportNode {
    return {
        id: name,
        name,
        kind: "group",
        children: (layers ?? []).filter(layer => !layer.hidden).map(layer =>
            layer.children ? psdOutline(layer.name, layer.children) : ({ id: layer.name, name: layer.name, kind: "raster" } as FigmaExportNode)),
    } as FigmaExportNode;
}

/**
 * A design file read far enough to show what is in it.
 *
 * The expensive part - baking a PSD's layers, decoding a Figma export's pictures - waits for `load`,
 * which runs when the author presses Import, so opening a large file only costs reading its outline.
 */
export type DesignSource = {
    kind: DesignSourceKind;
    /** What the dialog names it by: the file, or how many images. */
    label: string;
    detail?: string;
    items: DesignSourceItem[];
    /** Pages the import adds for this many ticked rows. */
    pagesFor: (ticked: number) => number;
    load: (itemIds: readonly string[]) => Promise<{ file: FigmaExportFile; frameIds: string[] }>;
};

/** A failure whose message is already the author's sentence. */
export class DesignSourceError extends Error {}

function extensionOf(path: string): string {
    const name = basename(path);
    return name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
}

function stemOf(path: string): string {
    const name = basename(path);
    return name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;
}

/**
 * Open what the picker returned: one Figma export, one PSD, or any number of pictures. Anything else
 * - two PSDs, a PSD with pictures - is refused with a sentence that says what can be picked.
 */
export async function openDesignSource(
    paths: readonly string[],
    filesystem: FileSystemService,
    projectSize: { width: number; height: number },
): Promise<DesignSource> {
    const kinds = paths.map(path => {
        const extension = extensionOf(path);
        if (extension === "json") return "figma";
        if (extension === "psd" || extension === "psb") return "psd";
        return IMAGE_MIME[extension] ? "images" : "other";
    });
    if (kinds.every(kind => kind === "images")) {
        return openImages(paths, filesystem, projectSize);
    }
    if (paths.length === 1 && kinds[0] === "figma") {
        return openFigmaExport(paths[0], filesystem);
    }
    if (paths.length === 1 && kinds[0] === "psd") {
        return openPsd(paths[0], filesystem);
    }
    throw new DesignSourceError(translate("uiEditor.designImport.error.mixed"));
}

async function openFigmaExport(path: string, filesystem: FileSystemService): Promise<DesignSource> {
    const content = await filesystem.read(path, "utf-8");
    if (!content.ok) {
        console.warn("[design import] could not read the export", content.error);
        throw new DesignSourceError(translate("uiEditor.designImport.error.read"));
    }
    const parsed = parseFigmaExport(content.data);
    if (!parsed.ok) {
        const reason = parsed.reason === "notJson" ? "notExport" : parsed.reason;
        throw new DesignSourceError(translate(`uiEditor.designImport.error.${reason}`));
    }
    const file = parsed.file;
    return {
        kind: "figma",
        label: basename(path),
        detail: file.source.pageName || undefined,
        items: file.frames.map(frame => ({ id: frame.id, name: frame.name, width: frame.width, height: frame.height, gameUi: slotsOf(frame) })),
        pagesFor: ticked => ticked,
        load: async ids => ({ file, frameIds: [...ids] }),
    };
}

async function openPsd(path: string, filesystem: FileSystemService): Promise<DesignSource> {
    const read = await getInterface().readPsd(path);
    if (!read.success) {
        console.warn("[design import] could not read the PSD", read.error);
        throw new DesignSourceError(translate("uiEditor.designImport.error.psdRead"));
    }
    const document = read.data.document;
    const stem = stemOf(path);
    return {
        kind: "psd",
        label: basename(path),
        items: [{
            id: "psd-document",
            name: stem,
            width: document.width,
            height: document.height,
            gameUi: slotsOf(psdOutline(stem, document.layers)),
        }],
        pagesFor: ticked => (ticked > 0 ? 1 : 0),
        load: async () => {
            const plan = planPsdDesign(document);
            const pictures = new Map<string, PsdBakedPicture>();
            if (plan.targets.length > 0) {
                const baked = await getInterface().bakePsd({ filePath: path, layers: plan.targets });
                if (!baked.success) {
                    console.warn("[design import] could not bake the PSD", baked.error);
                    throw new DesignSourceError(translate("uiEditor.designImport.error.bake"));
                }
                for (const layer of baked.data.layers) {
                    const key = psdLayerKey(layer);
                    const crop = plan.crops[key];
                    if (!crop) continue;
                    try {
                        const bytes = await filesystem.readRaw(layer.filePath);
                        if (!bytes.ok) continue;
                        pictures.set(key, { ...crop, bytes: await cropPicture(bytes.data, crop) });
                    } catch (error) {
                        // Reported as a missing picture by the builder.
                        console.warn(`[design import] could not cut out "${layer.name}"`, error);
                    }
                }
            }
            return { file: buildPsdDesignFile(document, plan, pictures), frameIds: ["psd-document"] };
        },
    };
}

async function openImages(
    paths: readonly string[],
    filesystem: FileSystemService,
    projectSize: { width: number; height: number },
): Promise<DesignSource> {
    type Read = { path: string; stem: string; mime: string; bytes: Uint8Array; measured: MeasuredPicture };
    const reads: Read[] = [];
    for (const path of paths) {
        const read = await filesystem.readRaw(path);
        if (!read.ok) {
            console.warn("[design import] could not read an image", read.error);
            throw new DesignSourceError(translate("uiEditor.designImport.error.imageRead", { name: basename(path) }));
        }
        const mime = IMAGE_MIME[extensionOf(path)];
        try {
            reads.push({ path, stem: stemOf(path), mime, bytes: read.data, measured: await measurePicture(read.data, mime) });
        } catch (error) {
            console.warn("[design import] could not decode an image", error);
            throw new DesignSourceError(translate("uiEditor.designImport.error.imageRead", { name: basename(path) }));
        }
    }

    // Files named for the states of one button (`start.png`, `start_hover.png` ...) share a key. A
    // file with no state word is the default look of the button whose states name it.
    const stateOf = (stem: string): ButtonState | null => buttonStateOfName(stem);
    const keyOf = (stem: string) => buttonBaseName(stem).toLowerCase();
    const statedKeys = new Set(reads.filter(read => stateOf(read.stem)).map(read => keyOf(read.stem)));
    const buttonOf = (read: Read): { key: string; state: ButtonState } | undefined => {
        const key = keyOf(read.stem);
        if (!statedKeys.has(key)) return undefined;
        return { key, state: stateOf(read.stem) ?? "default" };
    };
    // Every state of one button is cut from the union of their opaque areas, so the looks line up.
    const groupBounds = new Map<string, PictureBounds>();
    for (const read of reads) {
        const button = buttonOf(read);
        if (!button) continue;
        groupBounds.set(button.key, unionBounds(groupBounds.get(button.key) ?? null, read.measured.bounds));
    }

    const pictures: DesignPicture[] = [];
    for (const read of reads) {
        const button = buttonOf(read);
        const { width, height } = read.measured;
        const bounds = (button ? groupBounds.get(button.key) : read.measured.bounds) ?? { left: 0, top: 0, width, height };
        const whole = bounds.left === 0 && bounds.top === 0 && bounds.width === width && bounds.height === height;
        pictures.push({
            name: read.stem,
            mime: whole ? read.mime : "image/png",
            bytes: whole ? read.bytes : await cropPicture(read.bytes, bounds, read.mime),
            width: bounds.width,
            height: bounds.height,
            coverage: read.measured.coverage,
            left: bounds.left,
            top: bounds.top,
            sourceWidth: width,
            sourceHeight: height,
            ...(button ? { button } : {}),
        });
    }
    const pageName = pictures.length === 1 ? pictures[0].name : translate("uiEditor.designImport.imagesPageName");
    return {
        kind: "images",
        label: pictures.length === 1 ? basename(paths[0]) : pageName,
        items: pictures.map((picture, index) => ({
            id: String(index),
            name: picture.name,
            width: picture.sourceWidth ?? picture.width,
            height: picture.sourceHeight ?? picture.height,
            gameUi: [],
        })),
        pagesFor: ticked => (ticked > 0 ? 1 : 0),
        load: async ids => {
            const chosen = pictures.filter((_, index) => ids.includes(String(index)));
            const name = chosen.length === 1 ? chosen[0].name : pageName;
            return { file: buildImageDesignFile(chosen, name, projectSize), frameIds: ["images"] };
        },
    };
}

type PictureBounds = { left: number; top: number; width: number; height: number };
type MeasuredPicture = { width: number; height: number; coverage: number; bounds: PictureBounds };

function unionBounds(a: PictureBounds | null, b: PictureBounds): PictureBounds {
    if (!a) return b;
    const left = Math.min(a.left, b.left);
    const top = Math.min(a.top, b.top);
    const right = Math.max(a.left + a.width, b.left + b.width);
    const bottom = Math.max(a.top + a.height, b.top + b.height);
    return { left, top, width: right - left, height: bottom - top };
}

/**
 * A picture's size, how much of it is opaque, and the rectangle its opaque pixels occupy. A picture
 * with nothing opaque keeps its whole rectangle, so it still arrives as something to select.
 */
async function measurePicture(bytes: Uint8Array, mime: string): Promise<MeasuredPicture> {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: mime }));
    try {
        const { width, height } = bitmap;
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext("2d");
        if (!context) {
            return { width, height, coverage: 1, bounds: { left: 0, top: 0, width, height } };
        }
        context.drawImage(bitmap, 0, 0);
        const data = context.getImageData(0, 0, width, height).data;
        let opaque = 0;
        let minX = width, minY = height, maxX = -1, maxY = -1;
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                const alpha = data[(y * width + x) * 4 + 3];
                if (alpha === 0) continue;
                opaque += alpha / 255;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
        const bounds = maxX < 0
            ? { left: 0, top: 0, width, height }
            : { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
        return { width, height, coverage: opaque / Math.max(1, width * height), bounds };
    } finally {
        bitmap.close();
    }
}

/** A picture cut down to a rectangle of it, as a PNG. */
async function cropPicture(bytes: Uint8Array, crop: PsdCropRect, mime = "image/png"): Promise<Uint8Array> {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: mime }), crop.left, crop.top, crop.width, crop.height);
    try {
        const canvas = new OffscreenCanvas(crop.width, crop.height);
        const context = canvas.getContext("2d");
        if (!context) {
            throw new Error("No 2D context");
        }
        context.drawImage(bitmap, 0, 0);
        const blob = await canvas.convertToBlob({ type: "image/png" });
        return new Uint8Array(await blob.arrayBuffer());
    } finally {
        bitmap.close();
    }
}
