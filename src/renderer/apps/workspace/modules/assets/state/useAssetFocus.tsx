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

    const handleAssetClick = useCallback((asset: Asset, isMultiSelectMode: boolean) => {
        if (!context) return;

        const uiService = context.services.get<UIService>(Services.UI);
        uiService.getStore().setSelection({ type: "asset", data: asset });
        uiService.focus.setFocus(focusArea, panelId);
        setFocusedItemId(`asset:${asset.id}`);

        if (!isMultiSelectMode) {
            openAssetPreviewTabsInEditor(context, [asset], {
                returnFocusToAssetsPanel: { panelId, focusArea },
                showPropertiesPanel: true,
            });
        }
    }, [context, panelId, focusArea]);

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
        handleGroupFocus,
        setFocusToPanel
    };
}
