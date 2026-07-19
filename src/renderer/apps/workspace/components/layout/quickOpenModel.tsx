import { FileText, Image as ImageIcon, Music, PanelsTopLeft, Users, Workflow, File } from "lucide-react";
import type { ReactNode } from "react";
import type { TranslationKey } from "@shared/i18n";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import { CharacterService } from "@/lib/workspace/services/core/CharacterService";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { Asset } from "@/lib/workspace/services/assets/types";
import { parseBlueprintOwnerKey } from "@/lib/workspace/services/search/blueprintOwnerKey";
import { createStorySceneEditorTab } from "../../modules/story/scene-editor/openStorySceneEditorTab";
import { createBlueprintEntryEditorTab } from "../../modules/blueprint-lite/openBlueprintEditorTab";
import { createSurfaceEditorTab } from "../../modules/ui-editor/UISurfacesPanel";
import { openAssetPreviewTabsInEditor } from "../../modules/assets/dnd/openDraggedAssetsInEditor";

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

/**
 * Everything the quick-open picker can jump to, gathered fresh from the live registries: story
 * scenes, characters, UI surfaces, assets, and owned blueprints. Entries open through the same
 * tab creators their panels use, so a picker-opened editor is indistinguishable from a
 * panel-opened one. Call `SearchService.ensureReady()` first when story documents may not be
 * loaded yet — scene listing needs the documents in memory.
 */
export function collectQuickOpenEntries(ctx: WorkspaceContext): QuickOpenEntry[] {
    const entries: QuickOpenEntry[] = [];
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
        for (const scene of Object.values(document.scenes)) {
            entries.push({
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
            });
        }
    }

    // --- Characters (no editor tab: reveal selected in the characters panel) --
    const characterService = ctx.services.get<CharacterService>(Services.Character);
    for (const character of characterService.listCharacter()) {
        const profile = character.profile.getProfile();
        entries.push({
            key: `character:${profile.id}`,
            kind: "character",
            title: profile.name,
            icon: <Users className="h-4 w-4" />,
            open: () => {
                uiService.getStore().setPanelVisibility(CHARACTERS_PANEL_ID, true);
                uiService.getStore().setSelection({ type: "character", data: character });
            },
        });
    }

    // --- UI surfaces --------------------------------------------------------
    const uiDocumentService = ctx.services.get<UIDocumentService>(Services.UIDocument);
    try {
        for (const surface of uiDocumentService.getDocument().surfaces) {
            entries.push({
                key: `surface:${surface.id}`,
                kind: "uiSurface",
                title: surface.name,
                icon: <PanelsTopLeft className="h-4 w-4" />,
                open: () => {
                    uiService.editor.open(createSurfaceEditorTab(surface));
                },
            });
        }
    } catch {
        // UI document not loaded yet — surfaces just don't list.
    }

    // --- Assets -------------------------------------------------------------
    const assetsService = ctx.services.get<AssetsService>(Services.Assets);
    const assetsByType = assetsService.getAssets();
    for (const byId of Object.values(assetsByType)) {
        for (const asset of Object.values(byId) as Asset[]) {
            entries.push({
                key: `asset:${asset.id}`,
                kind: "asset",
                title: asset.name,
                detail: asset.type,
                icon: assetIcon(asset),
                open: () => {
                    if (asset.type === AssetType.Image || asset.type === AssetType.Audio) {
                        openAssetPreviewTabsInEditor(ctx, [asset]);
                        return;
                    }
                    uiService.getStore().setPanelVisibility(ASSETS_PANEL_ID, true);
                    uiService.getStore().setSelection({ type: "asset", data: asset });
                },
            });
        }
    }

    // --- Blueprints (owner-reachable only; unowned ones have no editor) ------
    const blueprintService = ctx.services.get<LocalBlueprintService>(Services.LocalBlueprint);
    try {
        const document = blueprintService.getBlueprintDocument();
        for (const [ownerKey, record] of Object.entries(document.ownerRecords)) {
            const blueprint = document.blueprints[record.activeBlueprintId];
            const owner = blueprint ? parseBlueprintOwnerKey(ownerKey) : null;
            if (!blueprint || !owner) {
                continue;
            }
            entries.push({
                key: `blueprint:${blueprint.id}`,
                kind: "blueprint",
                title: blueprint.name,
                icon: <Workflow className="h-4 w-4" />,
                open: () => {
                    uiService.editor.open(
                        createBlueprintEntryEditorTab({
                            blueprintId: blueprint.id,
                            ownerKind: owner.ownerKind,
                            surfaceId: owner.surfaceId,
                            componentId: owner.componentId,
                            elementId: owner.elementId,
                            propPath: owner.propPath,
                            title: blueprint.name,
                        }),
                    );
                },
            });
        }
    } catch {
        // Blueprint document not loaded — same treatment as surfaces.
    }

    return entries;
}
