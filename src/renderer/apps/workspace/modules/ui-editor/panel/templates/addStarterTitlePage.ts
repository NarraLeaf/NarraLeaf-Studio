import { migrateBlueprintDocumentToLatest } from "@shared/blueprint/migrateBlueprintDocument";
import { normalizeProjectBrandColors } from "@shared/types/brand";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { listSceneIdsInDocumentOrder } from "@shared/types/story";
import type { UISurface } from "@shared/types/ui-editor/document";
import { resolveEntrySurface } from "@shared/types/ui-editor/entrySurface";
import { getInterface } from "@/lib/app/bridge";
import { i18nStore } from "@/lib/i18n";
import { findLibraryAsset, toAssetType } from "@/lib/workspace/services/assets/assetTransferImport";
import { AssetCreateErrorCode } from "@/lib/workspace/services/assets/types";
import type { BrandService } from "@/lib/workspace/services/brand/BrandService";
import type { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import type { ProjectService } from "@/lib/workspace/services/core/ProjectService";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { WorkspaceFreezeService } from "@/lib/workspace/services/core/WorkspaceFreezeService";
import type { Service } from "@/lib/workspace/services/Service";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
import type { BlueprintNodeCatalogService } from "@/lib/workspace/services/ui-editor/BlueprintNodeCatalogService";
import { createCatalogAssetPinResolver } from "@/lib/workspace/services/ui-editor/blueprint/catalogAssetPins";
import { assertValidBlueprintDocument } from "@/lib/workspace/services/ui-editor/blueprint/documentValidation";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import {
    IMPORT_PLACEMENT_FROM_SOURCE,
    type UIDocumentService,
} from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { ProjectTemplateInterfaceContent } from "@shared/types/projectTemplate";
import {
    brandColorsToAdopt,
    isBlankSurface,
    liftStarterTitlePage,
    STARTER_TITLE_PAGE_TEMPLATE_ID,
    templateTextKeys,
    type StarterStartTarget,
} from "./starterTitlePage";

/**
 * Give a project that has no interface yet the starter template's title page, made its entry page.
 *
 * The page is read out of the template now (see `starterTitlePage` for why it is not kept in the
 * code) and goes in the way a page copied from another project does: its files first, under the ids
 * the template gave them, so every widget naming one already resolves; then the palette entries it
 * names; then the page itself through `importTemplateBundle`, which re-identifies it together with
 * its blueprints. Its Start button begins the project's own story.
 *
 * The blank page the project was created with is the entry page until now and holds nothing. It is
 * replaced rather than left beside the title page: kept, it would be a page no player can reach,
 * which the project check reports. A page that has anything on it is never removed.
 */

export type AddStarterTitlePageResult =
    | { ok: true; surface: UISurface }
    /** `frozen`: the workspace stopped taking writes part-way, which its own notice already says. */
    | { ok: false; frozen?: true; error?: string };

type Ports = {
    documents: UIDocumentService;
    blueprints: LocalBlueprintService;
    stories: StoryService;
    assets: AssetsService;
    brand: BrandService;
    project: ProjectService;
    ui: UIService;
    freeze: WorkspaceFreezeService | null;
    catalog: BlueprintNodeCatalogService | null;
};

function readPorts(context: WorkspaceContext): Ports {
    const optional = <T extends Service>(key: Services): T | null => {
        try {
            return context.services.get<T>(key);
        } catch {
            return null;
        }
    };
    return {
        documents: context.services.get<UIDocumentService>(Services.UIDocument),
        blueprints: context.services.get<LocalBlueprintService>(Services.LocalBlueprint),
        stories: context.services.get<StoryService>(Services.Story),
        assets: context.services.get<AssetsService>(Services.Assets),
        brand: context.services.get<BrandService>(Services.Brand),
        project: context.services.get<ProjectService>(Services.Project),
        ui: context.services.get<UIService>(Services.UI),
        freeze: optional<WorkspaceFreezeService>(Services.WorkspaceFreeze),
        catalog: optional<BlueprintNodeCatalogService>(Services.BlueprintNodeCatalog),
    };
}

/**
 * The language the page's words are read in: the one the project's story is written in, which is
 * the one the wizard picked the template's own copy by. A project with none set reads in Studio's.
 */
function contentLocale(project: ProjectService): string {
    try {
        const source = project.getLocalizationConfiguration().sourceLocale.trim();
        if (source) {
            return source;
        }
    } catch {
        // The configuration is still loading; Studio's language is the same default the wizard used.
    }
    return i18nStore.getLocale();
}

/**
 * Where Start begins: the default story's entry scene, the way a game launched from the toolbar
 * begins.
 *
 * A project with no story yet is given one, named after the project, because a Start that names
 * nothing does nothing - and the story panel's New Story makes exactly this story, with its first
 * chapter and scene, the moment an author names one.
 */
async function resolveStartTarget(ports: Ports): Promise<StarterStartTarget | null> {
    let storyId = ports.stories.getDefaultStoryId() ?? ports.stories.listStories()[0]?.id;
    if (!storyId) {
        let name = "";
        try {
            name = ports.project.getProjectConfig().name?.trim() ?? "";
        } catch {
            // Named by the service's own default instead.
        }
        storyId = ports.stories.createStory(name).id;
    }
    const document = await ports.stories.loadStory(storyId);
    const sceneId = document.entrySceneId && document.scenes[document.entrySceneId]
        ? document.entrySceneId
        : listSceneIdsInDocumentOrder(document)[0];
    return sceneId ? { storyId, sceneId } : null;
}

/** The asset record a template ships for `assetId`, with the type it is filed under. */
function findTemplateAssetRecord(
    content: ProjectTemplateInterfaceContent,
    assetId: string,
): { type: string; name: string } | null {
    for (const [type, records] of Object.entries(content.assetRecords)) {
        const record = (records as Record<string, { name?: unknown }> | null)?.[assetId];
        if (record) {
            return { type, name: typeof record.name === "string" && record.name.trim() ? record.name : assetId };
        }
    }
    return null;
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
 * Bring the template's files the page names into the library, under the ids the page names them by.
 *
 * Under the template's own ids for the reason a pasted page's files keep theirs: every prop pointing
 * at one keeps pointing at it, and asking twice files nothing twice. A file that cannot be brought
 * costs the page that one picture or sound, and the project check names it.
 */
async function importTemplateFiles(
    ports: Ports,
    content: ProjectTemplateInterfaceContent,
    assetIds: readonly string[],
    locale: string,
): Promise<void> {
    const missing = assetIds.filter(assetId => !findLibraryAsset(ports.assets.getAssets(), assetId));
    if (missing.length === 0) {
        return;
    }
    const read = await getInterface().projectTemplates.readAssets(STARTER_TITLE_PAGE_TEMPLATE_ID, missing, locale);
    if (!read.success) {
        console.warn("[starterTitlePage] could not read the template's files", read.error);
        return;
    }
    for (const file of read.data) {
        const record = findTemplateAssetRecord(content, file.assetId);
        const type = record ? toAssetType(record.type) : null;
        if (!record || !type) {
            continue;
        }
        const created = await ports.assets.createLocalAssetFromBytes(
            type,
            record.name,
            decodeBase64(file.dataBase64),
            undefined,
            { id: file.assetId },
        );
        if (!created.success && created.code !== AssetCreateErrorCode.IdInUse) {
            console.warn(`[starterTitlePage] could not add "${record.name}"`, created.error);
        }
    }
}

/** The page's editor tab and any of its blueprints' tabs, which would otherwise outlive the page. */
function closeSurfaceTabs(ui: UIService, surfaceId: string): void {
    for (const tab of ui.editor.getAll()) {
        const payload = tab.payload as { surfaceId?: unknown } | undefined;
        if (
            tab.id === `ui-editor:surface:${surfaceId}`
            || (tab.id.startsWith("blueprint-entry:") && payload?.surfaceId === surfaceId)
        ) {
            ui.editor.close(tab.id);
        }
    }
}

function readTemplateBlueprints(raw: unknown): BlueprintDocument | null {
    const document = raw && typeof raw === "object" ? (raw as { blueprintDocument?: unknown }).blueprintDocument : undefined;
    if (!document) {
        return null;
    }
    const migrated = migrateBlueprintDocumentToLatest(document);
    assertValidBlueprintDocument(migrated);
    return migrated;
}

export async function addStarterTitlePage(context: WorkspaceContext): Promise<AddStarterTitlePageResult> {
    const ports = readPorts(context);
    const frozen = () => ports.freeze?.isFrozen() ?? false;
    if (frozen()) {
        return { ok: false, frozen: true };
    }
    const locale = contentLocale(ports.project);
    const read = await getInterface().projectTemplates.readInterface(STARTER_TITLE_PAGE_TEMPLATE_ID, locale);
    if (!read.success) {
        return { ok: false, error: read.error };
    }
    const content = read.data;
    const document = ports.documents.prepareTemplateDocumentForPreview(content.uiDocument);
    let blueprints: BlueprintDocument | null = null;
    try {
        blueprints = readTemplateBlueprints(content.uiGraphs);
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    if (frozen()) {
        return { ok: false, frozen: true };
    }
    if (!document || !blueprints) {
        return { ok: false };
    }

    const startTarget = await resolveStartTarget(ports);
    const lifted = liftStarterTitlePage({
        document,
        blueprints,
        startTarget,
        resolveAssetPins: createCatalogAssetPinResolver(ports.catalog),
    });
    if (frozen()) {
        return { ok: false, frozen: true };
    }
    if (!lifted) {
        return { ok: false };
    }

    await importTemplateFiles(ports, content, lifted.assetIds, content.contentLocale ?? locale);
    if (frozen()) {
        return { ok: false, frozen: true };
    }
    ports.brand.adoptColors(brandColorsToAdopt(
        lifted.brandColorIds,
        normalizeProjectBrandColors((content.brand as { colors?: unknown } | null)?.colors),
        id => Boolean(ports.brand.getColor(id)),
    ));

    const placeholder = resolveEntrySurface(ports.documents.getDocument());
    const imported = ports.documents.importTemplateBundle({
        document: lifted.payload.document,
        graphs: lifted.payload.graphs,
        placement: IMPORT_PLACEMENT_FROM_SOURCE,
        textKeys: templateTextKeys(content.localizationKeys),
    });
    const surface = imported.importedSurfaces[0];
    if (!surface) {
        return { ok: false };
    }
    ports.documents.setEntrySurface(surface.id);
    if (placeholder && isBlankSurface(ports.documents.getDocument(), ports.blueprints.getBlueprintDocument(), placeholder)) {
        closeSurfaceTabs(ports.ui, placeholder.id);
        ports.documents.deleteSurface(placeholder.id);
    }
    await ports.documents.save(ports.documents.getDocument());
    return { ok: true, surface };
}
