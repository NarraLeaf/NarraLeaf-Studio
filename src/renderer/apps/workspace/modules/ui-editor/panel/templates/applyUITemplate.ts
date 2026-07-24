import { getInterface } from "@/lib/app/bridge";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UISurface, UIStageSlotId } from "@shared/types/ui-editor/document";
import type { UITemplateFetchedAsset } from "@shared/types/uiTemplateRegistry";

export type ApplyUITemplateResult =
    | {
        ok: true;
        surfaces: UISurface[];
        skippedSlots: UIStageSlotId[];
        /** Declared resources that were fetched but not yet importable (see below). */
        assetsSkipped: number;
    }
    | { ok: false; error: string };

/**
 * Fetch one template's bundle from the store (main process does the network I/O)
 * and import it into the open project's UI document.
 *
 * Asset-free templates apply fully. A template's declared resources are fetched
 * by the main process, but writing them into the project's asset store is not yet
 * wired, so their ids are not remapped and the count is reported back as
 * `assetsSkipped` for the caller to surface — rather than silently importing a
 * document whose images resolve to nothing.
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
    const assetIdMap = await ingestTemplateAssets(bundle.assets);
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
            skippedSlots: imported.skippedSlots,
            assetsSkipped: bundle.assets.length - Object.keys(assetIdMap).length,
        };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}

async function ingestTemplateAssets(assets: UITemplateFetchedAsset[]): Promise<Record<string, string>> {
    // TODO(ui-template-assets): write each fetched resource into the project's asset
    // store and map its original id to the newly assigned project asset id. The
    // assetId remap itself already runs in UIDocumentService.importTemplateBundle
    // once this map is populated; base templates ship no resources, so this is a
    // no-op today and any declared resource is reported as skipped.
    void assets;
    return {};
}
