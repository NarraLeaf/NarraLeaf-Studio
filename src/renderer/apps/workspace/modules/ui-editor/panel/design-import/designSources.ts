import { getInterface } from "@/lib/app/bridge";
import { translate } from "@/lib/i18n";
import type { FileSystemService } from "@/lib/workspace/services/core/FileSystem";
import { parseFigmaExport, type FigmaExportFile } from "@/lib/ui-editor/figma-import/figmaExportFormat";
import { buildImageDesignFile, type DesignPicture } from "@/lib/ui-editor/figma-import/imageDesign";
import { buildPsdDesignFile, planPsdDesign, type PsdBakedPicture, type PsdCropRect } from "@/lib/ui-editor/figma-import/psdDesign";
import { psdLayerKey } from "@shared/utils/psdLayerPlan";
import { basename } from "@shared/utils/path";

/** The file types the picker offers: a Figma export, a PSD, and plain pictures. */
export const DESIGN_IMPORT_EXTENSIONS = ["json", "psd", "psb", "png", "jpg", "jpeg", "webp"];

const IMAGE_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

export type DesignSourceKind = "figma" | "psd" | "images";

/** One row the import dialog lists and the author ticks. */
export type DesignSourceItem = { id: string; name: string; width: number; height: number };

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
export async function openDesignSource(paths: readonly string[], filesystem: FileSystemService): Promise<DesignSource> {
    const kinds = paths.map(path => {
        const extension = extensionOf(path);
        if (extension === "json") return "figma";
        if (extension === "psd" || extension === "psb") return "psd";
        return IMAGE_MIME[extension] ? "images" : "other";
    });
    if (kinds.every(kind => kind === "images")) {
        return openImages(paths, filesystem);
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
        items: file.frames.map(frame => ({ id: frame.id, name: frame.name, width: frame.width, height: frame.height })),
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
        items: [{ id: "psd-document", name: stem, width: document.width, height: document.height }],
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

async function openImages(paths: readonly string[], filesystem: FileSystemService): Promise<DesignSource> {
    const pictures: DesignPicture[] = [];
    for (const path of paths) {
        const read = await filesystem.readRaw(path);
        if (!read.ok) {
            console.warn("[design import] could not read an image", read.error);
            throw new DesignSourceError(translate("uiEditor.designImport.error.imageRead", { name: basename(path) }));
        }
        const mime = IMAGE_MIME[extensionOf(path)];
        try {
            const measured = await measurePicture(read.data, mime);
            pictures.push({ name: stemOf(path), mime, bytes: read.data, ...measured });
        } catch (error) {
            console.warn("[design import] could not decode an image", error);
            throw new DesignSourceError(translate("uiEditor.designImport.error.imageRead", { name: basename(path) }));
        }
    }
    const pageName = pictures.length === 1 ? pictures[0].name : translate("uiEditor.designImport.imagesPageName");
    return {
        kind: "images",
        label: pictures.length === 1 ? basename(paths[0]) : pageName,
        items: pictures.map((picture, index) => ({ id: String(index), name: picture.name, width: picture.width, height: picture.height })),
        pagesFor: ticked => (ticked > 0 ? 1 : 0),
        load: async ids => {
            const chosen = pictures.filter((_, index) => ids.includes(String(index)));
            const name = chosen.length === 1 ? chosen[0].name : pageName;
            return { file: buildImageDesignFile(chosen, name), frameIds: ["images"] };
        },
    };
}

/** Side of the thumbnail opacity is sampled on: enough to tell a background from a cut-out. */
const COVERAGE_SAMPLE = 64;

async function measurePicture(bytes: Uint8Array, mime: string): Promise<{ width: number; height: number; coverage: number }> {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: mime }));
    try {
        const canvas = new OffscreenCanvas(COVERAGE_SAMPLE, COVERAGE_SAMPLE);
        const context = canvas.getContext("2d");
        let coverage = 1;
        if (context) {
            context.drawImage(bitmap, 0, 0, COVERAGE_SAMPLE, COVERAGE_SAMPLE);
            const data = context.getImageData(0, 0, COVERAGE_SAMPLE, COVERAGE_SAMPLE).data;
            let opaque = 0;
            for (let index = 3; index < data.length; index += 4) {
                opaque += data[index] / 255;
            }
            coverage = opaque / (COVERAGE_SAMPLE * COVERAGE_SAMPLE);
        }
        return { width: bitmap.width, height: bitmap.height, coverage };
    } finally {
        bitmap.close();
    }
}

/** A baked full-document PNG cut down to the rectangle its layer occupies. */
async function cropPicture(bytes: Uint8Array, crop: PsdCropRect): Promise<Uint8Array> {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: "image/png" }), crop.left, crop.top, crop.width, crop.height);
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
