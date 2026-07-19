import type { EditorTabDefinition } from "../../registry/types";
import type { SearchJumpTarget } from "@/lib/workspace/services/search/searchIndexModel";
import { parseBlueprintOwnerKey } from "@/lib/workspace/services/search/blueprintOwnerKey";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { Asset } from "@/lib/workspace/services/assets/types";
import { createStorySceneEditorTab } from "../story/scene-editor/openStorySceneEditorTab";
import { createBlueprintEntryEditorTab } from "../blueprint-lite/openBlueprintEditorTab";
import { openAssetPreviewTabsInEditor } from "../assets/dnd/openDraggedAssetsInEditor";

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
            deps.openEditorTab(
                createStorySceneEditorTab(
                    { storyId: target.storyId, sceneId: target.sceneId, activeBlockId: target.blockId },
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
    }
}
