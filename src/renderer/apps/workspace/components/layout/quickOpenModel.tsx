import { FileText, Image as ImageIcon, Music, PanelsTopLeft, Users, Workflow, File } from "lucide-react";
import type { ReactNode } from "react";
import type { TranslationKey } from "@shared/i18n";
import { blueprintDisplayName, ownerLabelKey } from "@shared/types/ui-editor/ownerLabels";
import { workspaceStoryBlueprintSummary } from "@/lib/story/storyBlueprintSummary";
import type { BlueprintNodeCatalogService } from "@/lib/workspace/services/ui-editor/BlueprintNodeCatalogService";
import { translate } from "@/lib/i18n";
import { listScenesInDocumentOrder } from "@shared/types/story";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import { CharacterService } from "@/lib/workspace/services/core/CharacterService";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import { AssetType, categoryOfAssetType, type AssetCategory } from "@/lib/workspace/services/assets/assetTypes";
import type { Asset, AssetGroup } from "@/lib/workspace/services/assets/types";
import { parseBlueprintOwnerKey } from "@/lib/workspace/services/search/blueprintOwnerKey";
import { resolveBlueprintOwnerPath } from "@/lib/workspace/services/search/sources/blueprintSource";
import { createStorySceneEditorTab } from "../../modules/story/scene-editor/openStorySceneEditorTab";
import { createBlueprintEntryEditorTab } from "../../modules/blueprint-lite/openBlueprintEditorTab";
import { blueprintOwnerOpenTarget } from "../../modules/search/blueprintJumpTarget";
import { createSurfaceEditorTab } from "../../modules/ui-editor/UISurfacesPanel";
import { openAssetPreviewTabsInEditor } from "../../modules/assets/dnd/openDraggedAssetsInEditor";
import { groupPath } from "../../modules/assets/browser/assetBrowserModel";
import { blueprintPlaceDetails, distinguishQuickOpenDetails, type QuickOpenPlacedRow } from "./quickOpenPlaces";

export type QuickOpenKind = "scene" | "character" | "uiSurface" | "asset" | "blueprint";

export interface QuickOpenEntry {
    key: string;
    kind: QuickOpenKind;
    title: string;
    /** Secondary text (story name, asset type…), also matched by the fuzzy filter. */
    detail?: string;
    icon: ReactNode;
    /** Open the entity in its editor (or reveal it where no editor exists). */
    open: (ctx: WorkspaceContext) => void;
}

export const QUICK_OPEN_KIND_LABEL_KEYS: Record<QuickOpenKind, TranslationKey> = {
    scene: "workspace.shell.quickOpen.kinds.scene" as TranslationKey,
    character: "workspace.shell.quickOpen.kinds.character" as TranslationKey,
    uiSurface: "workspace.shell.quickOpen.kinds.uiSurface" as TranslationKey,
    asset: "workspace.shell.quickOpen.kinds.asset" as TranslationKey,
    blueprint: "workspace.shell.quickOpen.kinds.blueprint" as TranslationKey,
};

const CHARACTERS_PANEL_ID = "narraleaf-studio:characters";
const ASSETS_PANEL_ID = "narraleaf-studio:assets";

/** How a place in a tree reads on a detail line: outermost first, as blueprint owners read. */
const PATH_SEPARATOR = " › ";

/** How a detail line adds one more thing it says about the row, as a value binding's suffix does. */
const DETAIL_SEPARATOR = " · ";

function assetIcon(asset: Asset): ReactNode {
    switch (asset.type) {
        case AssetType.Image:
            return <ImageIcon className="h-4 w-4" />;
        case AssetType.Audio:
            return <Music className="h-4 w-4" />;
        default:
            return <File className="h-4 w-4" />;
    }
}

/** A row's detail with one more thing said after it, or that thing alone when the row had none. */
function withMore(detail: string | undefined, more: string): string {
    return detail ? `${detail}${DETAIL_SEPARATOR}${more}` : more;
}

/** A row that has nothing left to say about where it is, told apart by its place in the list. */
function numberedDetail(detail: string | undefined, ordinal: number): string {
    return withMore(detail, translate("workspace.shell.quickOpen.ordinal", { n: ordinal }));
}

/**
 * Everything the quick-open picker can jump to, gathered fresh from the live registries: story
 * scenes, characters, UI surfaces, assets, and owned blueprints. Entries open through the same
 * tab creators their panels use, so a picker-opened editor is indistinguishable from a
 * panel-opened one. Call `SearchService.ensureReady()` first when story documents may not be
 * loaded yet — scene listing needs the documents in memory.
 *
 * Every row's detail is settled last, over all of them together: a name can repeat within a kind - two
 * chapters' "Corridor", two folders' "bg" - and a row that reads like another one says where it is
 * until it no longer does (see `distinguishQuickOpenDetails`).
 */
export function collectQuickOpenEntries(ctx: WorkspaceContext): QuickOpenEntry[] {
    const entries: QuickOpenEntry[] = [];
    // One per entry, in step: how that entry's detail can read, plainest first.
    const placed: QuickOpenPlacedRow[] = [];
    const add = (entry: QuickOpenEntry, details: readonly (string | undefined)[]) => {
        entries.push(entry);
        placed.push({ kind: entry.kind, title: entry.title, details });
    };
    const uiService = ctx.services.get<UIService>(Services.UI);

    // --- Story scenes -------------------------------------------------------
    const storyService = ctx.services.get<StoryService>(Services.Story);
    for (const storyEntry of storyService.listStories()) {
        let document;
        try {
            document = storyService.getStoryDocument(storyEntry.id);
        } catch {
            continue; // Not loaded (ensureReady not awaited) — skip rather than throw.
        }
        const chapterOf = new Map<string, string>();
        for (const chapter of document.chapters ?? []) {
            for (const sceneId of chapter.sceneIds ?? []) {
                if (!chapterOf.has(sceneId)) {
                    chapterOf.set(sceneId, chapter.name);
                }
            }
        }
        for (const scene of listScenesInDocumentOrder(document)) {
            // The story, then the chapter inside it, as the story panel files the scene.
            const chapter = chapterOf.get(scene.id);
            const details = chapter ? [document.name, `${document.name}${PATH_SEPARATOR}${chapter}`] : [document.name];
            add({
                key: `scene:${document.id}:${scene.id}`,
                kind: "scene",
                title: scene.name,
                detail: document.name,
                icon: <FileText className="h-4 w-4" />,
                open: () => {
                    uiService.editor.open(
                        createStorySceneEditorTab({ storyId: document.id, sceneId: scene.id }, scene.name),
                    );
                },
            }, details);
        }
    }

    // --- Characters (no editor tab: reveal selected in the characters panel) --
    const characterService = ctx.services.get<CharacterService>(Services.Character);
    for (const character of characterService.listCharacter()) {
        const profile = character.profile.getProfile();
        // A character carries no detail of its own; the group it is filed in is where it is.
        const groupId = character.profile.getGroupId();
        const group = groupId ? characterService.getGroup(groupId)?.name : undefined;
        add({
            key: `character:${profile.id}`,
            kind: "character",
            title: profile.name,
            icon: <Users className="h-4 w-4" />,
            open: () => {
                uiService.getStore().setPanelVisibility(CHARACTERS_PANEL_ID, true);
                uiService.getStore().setSelection({ type: "character", data: character });
            },
        }, group ? [undefined, group] : []);
    }

    // --- UI surfaces --------------------------------------------------------
    const uiDocumentService = ctx.services.get<UIDocumentService>(Services.UIDocument);
    try {
        for (const surface of uiDocumentService.getDocument().surfaces) {
            // A page and a Game UI may share a name; the interface panel lists them apart.
            const surfaceKind = translate(surface.kind === "appSurface" ? "uiEditor.surfaceKind.page" : "uiEditor.surfaceKind.gameUi");
            add({
                key: `surface:${surface.id}`,
                kind: "uiSurface",
                title: surface.name,
                icon: <PanelsTopLeft className="h-4 w-4" />,
                open: () => {
                    uiService.editor.open(createSurfaceEditorTab(surface));
                },
            }, [undefined, surfaceKind]);
        }
    } catch {
        // UI document not loaded yet — surfaces just don't list.
    }

    // --- Assets -------------------------------------------------------------
    const assetsService = ctx.services.get<AssetsService>(Services.Assets);
    const assetsByType = assetsService.getAssets();
    // The folders of each category, read once and only for a category whose assets are listed.
    const foldersByCategory = new Map<AssetCategory, readonly AssetGroup[]>();
    const folderPath = (asset: Asset): string | undefined => {
        if (!asset.groupId) {
            return undefined;
        }
        const category = categoryOfAssetType(asset.type);
        let folders = foldersByCategory.get(category);
        if (!folders) {
            try {
                folders = assetsService.getGroupAssetsManager().getGroups(category);
            } catch {
                folders = []; // Folders not loaded yet - the row says only its type.
            }
            foldersByCategory.set(category, folders);
        }
        const path = groupPath(asset.groupId, folders).map(folder => folder.name);
        return path.length > 0 ? path.join(PATH_SEPARATOR) : undefined;
    };
    for (const byId of Object.values(assetsByType)) {
        for (const asset of Object.values(byId) as Asset[]) {
            // The kind of asset in the interface's words (Image, 图片, 画像), the noun the
            // properties panel heads the same asset with - not the enum value the library stores.
            const kind = translate(`dialogs.noun.${asset.type}`);
            // Then the folder it is filed in, from the category's root down.
            const folder = folderPath(asset);
            add({
                key: `asset:${asset.id}`,
                kind: "asset",
                title: asset.name,
                detail: kind,
                icon: assetIcon(asset),
                open: () => {
                    if (asset.type === AssetType.Image || asset.type === AssetType.Audio) {
                        openAssetPreviewTabsInEditor(ctx, [asset], { preview: true });
                        return;
                    }
                    uiService.getStore().setPanelVisibility(ASSETS_PANEL_ID, true);
                    uiService.getStore().setSelection({ type: "asset", data: asset });
                },
            }, folder ? [kind, withMore(kind, folder)] : [kind]);
        }
    }

    // --- Blueprints (owner-reachable only; unowned ones have no editor) ------
    const blueprintService = ctx.services.get<LocalBlueprintService>(Services.LocalBlueprint);
    try {
        const document = blueprintService.getBlueprintDocument();
        // A story blueprint nobody named is listed by what it does, as its row reads.
        const whatItDoes = workspaceStoryBlueprintSummary(
            document,
            ctx.services.get<BlueprintNodeCatalogService>(Services.BlueprintNodeCatalog),
            translate,
        );
        for (const [ownerKey, record] of Object.entries(document.ownerRecords)) {
            const blueprint = document.blueprints[record.blueprintId];
            const owner = blueprint ? parseBlueprintOwnerKey(ownerKey) : null;
            if (!blueprint || !owner) {
                continue;
            }
            const title = blueprintDisplayName(blueprint, translate, whatItDoes(blueprint));
            // Whose blueprint it is - the page, component or control it hangs on - named as the search
            // panel names it. Blueprints take their owner's name, so a page's same-named controls (a
            // slider's "Track", a rail item named after the page) say which control above them they
            // are in; a value binding hangs on the same control as that control's logic, so only its
            // kind can tell the two apart.
            const path = resolveBlueprintOwnerPath(ctx, ownerKey);
            const details = blueprintPlaceDetails(path
                ? { path, suffix: owner.ownerKind === "widgetValue" ? translate(ownerLabelKey("widgetValue")) : undefined }
                : undefined);
            add({
                key: `blueprint:${blueprint.id}`,
                kind: "blueprint",
                title,
                // Settled below with every other row.
                detail: undefined,
                icon: <Workflow className="h-4 w-4" />,
                // Addressed and named as the interface panel and the inspector open it, so picking a
                // blueprint whose editor is already open focuses that tab instead of adding another.
                open: () => {
                    uiService.editor.open(createBlueprintEntryEditorTab(blueprintOwnerOpenTarget(blueprint.id, owner, ctx)));
                },
            }, details);
        }
    } catch {
        // Blueprint document not loaded — same treatment as surfaces.
    }

    const settled = distinguishQuickOpenDetails(placed, numberedDetail);
    entries.forEach((entry, index) => {
        entry.detail = settled[index];
    });
    return entries;
}
