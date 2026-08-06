import { getInterface } from "@/lib/app/bridge";
import { Services } from "@/lib/workspace/services/services";
import type { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UIComponentDefinition, UISurface, UIStageSlotId } from "@shared/types/ui-editor/document";
import type { UITemplateFetchedAsset } from "@shared/types/uiTemplateRegistry";
import { AssetExtensions, AssetType } from "@/lib/workspace/services/assets/assetTypes";

export type ApplyUITemplateResult =
    | {
        ok: true;
        surfaces: UISurface[];
        /** Library components the template brought with it; empty for surface-only ones. */
        components: UIComponentDefinition[];
        skippedSlots: UIStageSlotId[];
        /** Declared resources that could not be written into the project's assets. */
        assetsSkipped: number;
    }
    | { ok: false; error: string };

/**
 * Fetch one template's bundle from the store (main process does the network I/O)
 * and import it into the open project's UI document.
 *
 * Resources are written into the project's asset store before the document is
 * imported, because the import is what rewrites the document's `assetId`
 * references — it needs the new ids in hand. A resource that cannot be written
 * is counted rather than fatal: the surface is still worth having with one
 * picture missing, and the count is surfaced so the author knows to look.
 */
export async function applyUITemplate(
    templateId: string,
    documentService: UIDocumentService,
): Promise<ApplyUITemplateResult> {
    const result = await getInterface().uiTemplates.fetchBundle(templateId);
    if (!result.success) {
        return { ok: false, error: result.error ?? "Failed to fetch template" };
    }

    const bundle = result.data;
    const assetIdMap = await ingestTemplateAssets(bundle.assets, documentService);
    try {
        const imported = documentService.importTemplateBundle({
            document: bundle.document,
            graphs: bundle.graphs,
            placement: bundle.surface,
            assetIdMap: Object.keys(assetIdMap).length > 0 ? assetIdMap : undefined,
        });
        await documentService.save(documentService.getDocument());
        return {
            ok: true,
            surfaces: imported.importedSurfaces,
            components: imported.importedComponents,
            skippedSlots: imported.skippedSlots,
            assetsSkipped: bundle.assets.length - Object.keys(assetIdMap).length,
        };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * The asset types a template resource may become, in resolution order.
 *
 * Order is load-bearing where extension lists overlap: `svg` is listed by both
 * Image and Font, and a template that ships one means the picture. `json` is
 * claimed by both JSON and Blueprint, and Blueprint is deliberately absent here
 * — a template's logic travels in its `uigraphs.json`, not as a resource.
 */
const TEMPLATE_ASSET_TYPES: AssetType[] = [
    AssetType.Image,
    AssetType.Audio,
    AssetType.Video,
    AssetType.Font,
    AssetType.JSON,
];

/** Which asset type a fetched resource becomes, by file extension then MIME family. */
function resolveTemplateAssetType(asset: UITemplateFetchedAsset): AssetType {
    const extension = asset.fileName.includes(".")
        ? asset.fileName.slice(asset.fileName.lastIndexOf(".") + 1).toLowerCase()
        : "";
    if (extension) {
        for (const type of TEMPLATE_ASSET_TYPES) {
            if (AssetExtensions[type].includes(extension)) {
                return type;
            }
        }
    }
    // A registry may serve a file with no useful extension; the MIME the main
    // process inferred is the only remaining signal.
    const family = asset.mime.slice(0, asset.mime.indexOf("/"));
    if (family === "image") return AssetType.Image;
    if (family === "audio") return AssetType.Audio;
    if (family === "video") return AssetType.Video;
    if (family === "font") return AssetType.Font;
    return AssetType.Other;
}

function decodeBase64(dataBase64: string): Uint8Array {
    const binary = atob(dataBase64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}

/**
 * Write each fetched resource into the project's asset store, returning the map
 * from the template's own `assetId` to the id the project assigned. The remap
 * itself runs inside {@link UIDocumentService.importTemplateBundle}; this only
 * has to produce the map.
 *
 * Names are not made unique here — `createLocalAssetFromBytes` runs the manager's
 * own `resolveUniqueAssetName`, so applying the same template twice yields two
 * assets rather than one silently overwritten.
 */
async function ingestTemplateAssets(
    assets: UITemplateFetchedAsset[],
    documentService: UIDocumentService,
): Promise<Record<string, string>> {
    if (assets.length === 0) {
        return {};
    }
    let assetsService: AssetsService;
    try {
        assetsService = documentService.getContext().services.get<AssetsService>(Services.Assets);
    } catch (error) {
        console.warn("[applyUITemplate] assets service unavailable; template resources skipped", error);
        return {};
    }

    const assetIdMap: Record<string, string> = {};
    for (const asset of assets) {
        try {
            const created = await assetsService.createLocalAssetFromBytes(
                resolveTemplateAssetType(asset),
                asset.fileName,
                decodeBase64(asset.dataBase64),
            );
            if (created.success && created.data) {
                assetIdMap[asset.id] = created.data.id;
            } else {
                console.warn(`[applyUITemplate] could not import "${asset.fileName}": ${created.error}`);
            }
        } catch (error) {
            // One bad resource must not cost the author the whole surface.
            console.warn(`[applyUITemplate] could not import "${asset.fileName}"`, error);
        }
    }
    return assetIdMap;
}
