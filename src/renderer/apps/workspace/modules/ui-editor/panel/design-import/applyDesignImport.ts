import { DEFAULT_UI_SURFACE_SIZE } from "@shared/constants/ui-editor";
import type { UISurface, UISurfaceDesignSize } from "@shared/types/ui-editor/document";
import { Services } from "@/lib/workspace/services/services";
import type { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import type { ProjectService } from "@/lib/workspace/services/core/ProjectService";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { AssetCategory, AssetType } from "@/lib/workspace/services/assets/assetTypes";
import {
    convertFigmaFrames,
    type FigmaFontResolver,
    type FigmaImportNote,
} from "@/lib/ui-editor/figma-import/convertFigmaFrames";
import type { FigmaExportFile } from "@/lib/ui-editor/figma-import/figmaExportFormat";

export type ApplyDesignImportResult = {
    surfaces: UISurface[];
    notes: FigmaImportNote[];
    /** Pictures that could not be written into the asset library; the widgets showing them are empty. */
    imagesSkipped: number;
    /** Buttons made out of state layers or variants. */
    buttons: number;
};

/** The resolution every imported page is fitted to: the project's, as a new page gets. */
export function projectDesignSize(documentService: UIDocumentService): UISurfaceDesignSize {
    try {
        const project = documentService.getContext().services.get<ProjectService>(Services.Project);
        const resolution = project.getProjectConfig().metadata?.resolution;
        if (resolution && resolution.width > 0 && resolution.height > 0) {
            return { width: resolution.width, height: resolution.height };
        }
    } catch {
        // No project service: fall through to the default a new document uses.
    }
    return { ...DEFAULT_UI_SURFACE_SIZE };
}

/** Lowercase letters and digits only, so "Noto Sans SC" meets "NotoSansSC-Bold.ttf". */
function fontKey(text: string): string {
    return text.toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9぀-鿿]+/g, "");
}

/**
 * Finds a font asset for a Figma family and style by name: an asset named for the family and the
 * style first ("Inter Bold" for Inter / Bold), then one named for the family alone.
 */
export function createFontResolver(fonts: readonly { id: string; name: string }[]): FigmaFontResolver {
    const keyed = fonts.map(font => ({ id: font.id, key: fontKey(font.name) })).filter(font => font.key.length > 0);
    return (family, style) => {
        const familyKey = fontKey(family);
        if (!familyKey) {
            return null;
        }
        const styled = fontKey(`${family}${style}`);
        const exact = keyed.find(font => font.key === styled) ?? keyed.find(font => font.key === familyKey);
        if (exact) {
            return exact.id;
        }
        return keyed.find(font => font.key.startsWith(familyKey))?.id ?? null;
    };
}

function clearUnwrittenPictures(value: unknown, refs: ReadonlySet<string>): void {
    if (refs.size === 0 || !value || typeof value !== "object") {
        return;
    }
    if (Array.isArray(value)) {
        value.forEach(item => clearUnwrittenPictures(item, refs));
        return;
    }
    const record = value as Record<string, unknown>;
    for (const [key, child] of Object.entries(record)) {
        if (key === "assetId" && typeof child === "string" && refs.has(child)) {
            record[key] = null;
        } else {
            clearUnwrittenPictures(child, refs);
        }
    }
}

const EXTENSION_BY_MIME: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
};

function decodeBase64(data: string): Uint8Array {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}

function safeFileStem(name: string | undefined, fallback: string): string {
    const stem = (name ?? "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
    return stem || fallback;
}

/**
 * Put the chosen frames of a design (a Figma export, or a PSD or images expressed as one) into the
 * project as pages.
 *
 * The pictures go into the image library first, in a folder of their own named after the Figma
 * file, because the import is what rewrites the document's picture references and needs the new
 * asset ids in hand - the order `applyUITemplate` keeps for the same reason. A picture that cannot
 * be written is counted rather than fatal. The pages arrive through `importTemplateBundle`, which
 * makes them one step on the project's undo stack.
 */
export async function applyDesignImport(
    file: FigmaExportFile,
    frameIds: readonly string[],
    documentService: UIDocumentService,
): Promise<ApplyDesignImportResult> {
    const assets = documentService.getContext().services.get<AssetsService>(Services.Assets);
    const fonts = assets.getOrderedAssets(AssetType.Font).map(asset => ({ id: asset.id, name: asset.name }));
    const converted = convertFigmaFrames(file, {
        frameIds,
        targetSize: projectDesignSize(documentService),
        resolveFont: createFontResolver(fonts),
    });

    const assetIdMap: Record<string, string> = {};
    let imagesSkipped = 0;
    if (converted.imageRefs.length > 0) {
        let groupId: string | undefined;
        const folder = await assets.createGroup(AssetCategory.Image, safeFileStem(file.source.fileName, "Figma"));
        if (folder.success && folder.data) {
            groupId = folder.data.id;
        }
        let index = 0;
        for (const ref of converted.imageRefs) {
            index += 1;
            const image = file.images[ref];
            if (!image) {
                imagesSkipped += 1;
                continue;
            }
            try {
                const extension = EXTENSION_BY_MIME[image.mime] ?? "png";
                const created = await assets.createLocalAssetFromBytes(
                    AssetType.Image,
                    `${safeFileStem(image.name, `image-${index}`)}.${extension}`,
                    image.bytes ?? decodeBase64(image.data ?? ""),
                    groupId,
                );
                if (created.success && created.data) {
                    assetIdMap[ref] = created.data.id;
                } else {
                    imagesSkipped += 1;
                    console.warn(`[design import] could not write picture "${ref}": ${created.error}`);
                }
            } catch (error) {
                imagesSkipped += 1;
                console.warn(`[design import] could not write picture "${ref}"`, error);
            }
        }
    }

    // A picture that did not make it into the library leaves its widget empty rather than pointing at
    // an id the project has never had.
    clearUnwrittenPictures(converted.document, new Set(converted.imageRefs.filter(ref => !assetIdMap[ref])));
    const imported = documentService.importTemplateBundle({
        document: converted.document,
        graphs: null,
        placement: { kind: "appSurface" },
        assetIdMap,
    });
    await documentService.save(documentService.getDocument());
    return { surfaces: imported.importedSurfaces, notes: converted.notes, imagesSkipped, buttons: converted.buttons };
}
