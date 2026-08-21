import type { EditorTabDefinition } from "../../registry/types";
import type { SearchJumpTarget } from "@/lib/workspace/services/search/searchIndexModel";
import { parseBlueprintOwnerKey } from "@/lib/workspace/services/search/blueprintOwnerKey";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { AssetSetService } from "@/lib/workspace/services/assets/AssetSetService";
import type { Asset } from "@/lib/workspace/services/assets/types";
import { CharacterService } from "@/lib/workspace/services/core/CharacterService";
import { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { createStorySceneEditorTab } from "../story/scene-editor/openStorySceneEditorTab";
import { nextStoryRevealToken } from "../story/scene-editor/storySceneEditorTabId";
import { createBlueprintEntryEditorTab } from "../blueprint-lite/openBlueprintEditorTab";
import { openAssetPreviewTabsInEditor } from "../assets/dnd/openDraggedAssetsInEditor";
import { requestAssetSetReveal } from "../assets/assetSetReveal";
import { createSurfaceEditorTab } from "../ui-editor/UISurfacesPanel";
import { openSceneFlowTab } from "../story-flow/openSceneFlowTab";
import { createCharacterEditorTab } from "../characters/state/useCharacterFocus";
import { STORY_VARIABLES_PANEL_ID } from "../story-variables/storyVariablesPanelId";

export interface SearchJumpDeps {
    openEditorTab: (tab: EditorTabDefinition<any>) => void;
    setPanelVisibility: (panelId: string, visible: boolean) => void;
    /** Needed by asset hits (live asset lookup + preview tabs); other targets work without it. */
    context?: WorkspaceContext | null;
}

const LOCALIZATION_PANEL_ID = "narraleaf-studio:localization";
const ASSETS_PANEL_ID = "narraleaf-studio:assets";

/**
 * Navigate to a search hit. Shared by the search panel and the command palette's search mode.
 *
 * Every target rides an existing navigation affordance: story hits reuse the scene editor's
 * `activeBlockId` deep link (re-opening an existing tab replaces its payload, so the deep link
 * fires on already-open tabs too), blueprint hits reuse the entry tab's focus fields, and named
 * keys reveal the localization panel. Returns false when the target cannot be resolved.
 */
export function jumpToSearchTarget(target: SearchJumpTarget, deps: SearchJumpDeps): boolean {
    switch (target.kind) {
        case "storyBlock":
            // Tokened so that jumping to a hit, reading around it, and jumping back to the same hit
            // is two navigations rather than one. See `nextStoryRevealToken`.
            deps.openEditorTab(
                createStorySceneEditorTab(
                    {
                        storyId: target.storyId,
                        sceneId: target.sceneId,
                        activeBlockId: target.blockId,
                        revealToken: nextStoryRevealToken(),
                    },
                    target.sceneName || target.storyName,
                ),
            );
            return true;
        case "storyScene":
            deps.openEditorTab(
                createStorySceneEditorTab(
                    { storyId: target.storyId, sceneId: target.sceneId },
                    target.sceneName || target.storyName,
                ),
            );
            return true;
        case "storyFlow": {
            // A story has no single editor; its flow map is the view OF a story rather than of one
            // of its scenes, which is what makes it the right landing place for the story's name.
            if (!deps.context) {
                return false;
            }
            openSceneFlowTab(deps.context, target.storyId, target.storyName);
            return true;
        }
        case "character": {
            const context = deps.context;
            if (!context) {
                return false;
            }
            const character = context.services
                .get<CharacterService>(Services.Character)
                .getCharacter(target.characterId);
            if (!character) {
                return false;
            }
            // The character's own editor, which is what "open a character" means everywhere else in
            // the workspace — the cast list has opened one since it gained a tab, and a search hit
            // that instead revealed the panel and selected a row was the odd one out. The selection
            // still follows so the inspector rail shows who was opened.
            deps.openEditorTab(createCharacterEditorTab(character));
            context.services.get<UIService>(Services.UI).getStore().setSelection({ type: "character", data: character });
            return true;
        }
        case "uiSurface": {
            const context = deps.context;
            if (!context) {
                return false;
            }
            const surface = context.services
                .get<UIDocumentService>(Services.UIDocument)
                .getDocument()
                .surfaces.find(candidate => candidate.id === target.surfaceId);
            if (!surface) {
                return false;
            }
            deps.openEditorTab(createSurfaceEditorTab(surface));
            return true;
        }
        case "blueprint": {
            const owner = parseBlueprintOwnerKey(target.ownerKey);
            if (!owner) {
                return false;
            }
            deps.openEditorTab(
                createBlueprintEntryEditorTab({
                    blueprintId: target.blueprintId,
                    ownerKind: owner.ownerKind,
                    surfaceId: owner.surfaceId,
                    componentId: owner.componentId,
                    elementId: owner.elementId,
                    propPath: owner.propPath,
                    focusEventId: target.focusEventId,
                    focusFunctionId: target.focusFunctionId,
                    focusNodeId: target.focusNodeId,
                }),
            );
            return true;
        }
        case "localizationKey":
            deps.setPanelVisibility(LOCALIZATION_PANEL_ID, true);
            return true;
        case "storyVariable":
            // A saved or persistent variable is declared in the variables panel rather than by any
            // row, so the panel IS its address — the same bargain `localizationKey` makes above. The
            // panel cannot yet be told which entry to reveal; the target carries the identity so that
            // the day it can, nothing that produces one of these has to change.
            deps.setPanelVisibility(STORY_VARIABLES_PANEL_ID, true);
            return true;
        case "assetSet": {
            const context = deps.context;
            if (!context) {
                return false;
            }
            // A set has no preview editor - it is a row in the assets panel with an inspector, so
            // this is the `asset` case's second arm and nothing more. Resolved live for the same
            // reason that one is: the declaration may be gone, and a jump that reveals the panel
            // with nothing selected is worse than one that declines.
            const set = context.services.get<AssetSetService>(Services.AssetSets).getSet(target.assetSetId);
            if (!set) {
                return false;
            }
            deps.setPanelVisibility(ASSETS_PANEL_ID, true);
            context.services.get<UIService>(Services.UI).getStore().setSelection({ type: "assetSet", data: set });
            // Selecting it fills the inspector; this puts the ROW on screen. They are different
            // questions - a set can be several folders down from anything the panel is currently
            // drawing, and an inspector for a row nobody can see reads as a jump that half worked.
            requestAssetSetReveal(ASSETS_PANEL_ID, target.assetSetId);
            return true;
        }
        case "asset": {
            const context = deps.context;
            if (!context) {
                return false;
            }
            // Resolve the live asset - the index only carries ids, and the asset may be gone.
            const assetsMap = context.services.get<AssetsService>(Services.Assets).getAssets();
            const asset = Object.values(assetsMap)
                .flatMap(byId => Object.values(byId) as Asset[])
                .find(candidate => candidate.id === target.assetId);
            if (!asset) {
                return false;
            }
            if (asset.type === AssetType.Image || asset.type === AssetType.Audio) {
                openAssetPreviewTabsInEditor(context, [asset]);
                return true;
            }
            // No preview editor for this type - reveal it selected in the assets panel instead.
            deps.setPanelVisibility(ASSETS_PANEL_ID, true);
            context.services.get<UIService>(Services.UI).getStore().setSelection({ type: "asset", data: asset });
            return true;
        }
        case "assetSet": {
            const context = deps.context;
            if (!context) {
                return false;
            }
            // A set has no preview editor - it is a row in the assets panel with an inspector, so
            // this is the `asset` case's second arm and nothing more. Resolved live for the same
            // reason that one is: the declaration may be gone, and a jump that reveals the panel
            // with nothing selected is worse than one that declines.
            const set = context.services.get<AssetSetService>(Services.AssetSets).getSet(target.assetSetId);
            if (!set) {
                return false;
            }
            deps.setPanelVisibility(ASSETS_PANEL_ID, true);
            context.services.get<UIService>(Services.UI).getStore().setSelection({ type: "assetSet", data: set });
            return true;
        }
    }
}
