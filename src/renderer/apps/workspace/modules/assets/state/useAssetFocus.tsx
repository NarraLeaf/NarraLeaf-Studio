import { useState, useCallback } from "react";
import { Asset } from "@/lib/workspace/services/assets/types";
import { WorkspaceContext } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { Services } from "@/lib/workspace/services/services";
import { FocusArea } from "@/lib/workspace/services/ui/types";
import { openAssetPreviewTabsInEditor } from "../dnd/openDraggedAssetsInEditor";

export interface UseAssetFocusParams {
    context: WorkspaceContext | null;
    panelId: string;
    focusArea: FocusArea;
}

export function useAssetFocus({ context, panelId, focusArea }: UseAssetFocusParams) {
    const [focusedItemId, setFocusedItemId] = useState<string | null>(null);

    /**
     * Show an asset, as the pane's preview or as a tab of its own.
     *
     * Clicking down a folder of images is the case the preview tab is for: each look replaces the
     * one before it, and a double click on the row is how the author says to keep one.
     */
    const showAsset = useCallback((asset: Asset, isMultiSelectMode: boolean, preview: boolean) => {
        if (!context) return;

        const uiService = context.services.get<UIService>(Services.UI);
        uiService.getStore().setSelection({ type: "asset", data: asset });
        uiService.focus.setFocus(focusArea, panelId);
        setFocusedItemId(`asset:${asset.id}`);

        if (!isMultiSelectMode) {
            openAssetPreviewTabsInEditor(context, [asset], {
                returnFocusToAssetsPanel: { panelId, focusArea },
                showPropertiesPanel: true,
                preview,
            });
        }
    }, [context, panelId, focusArea]);

    const handleAssetClick = useCallback(
        (asset: Asset, isMultiSelectMode: boolean) => showAsset(asset, isMultiSelectMode, true),
        [showAsset],
    );

    const handleAssetOpen = useCallback(
        (asset: Asset) => showAsset(asset, false, false),
        [showAsset],
    );

    const handleGroupFocus = useCallback((groupId: string) => {
        if (!context) return;

        const uiService = context.services.get<UIService>(Services.UI);
        // Ensure panel gets focus when group is focused
        uiService.focus.setFocus(focusArea, panelId);
        setFocusedItemId(`group:${groupId}`);
    }, [context, panelId, focusArea]);

    const setFocusToPanel = useCallback(() => {
        if (context) {
            const uiService = context.services.get<UIService>(Services.UI);
            uiService.focus.setFocus(focusArea, panelId);
        }
    }, [context, panelId]);

    return {
        focusedItemId,
        setFocusedItemId,
        handleAssetClick,
        handleAssetOpen,
        handleGroupFocus,
        setFocusToPanel
    };
}
