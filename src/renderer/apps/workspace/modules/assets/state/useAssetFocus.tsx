import { useState, useCallback } from "react";
import { Asset } from "@/lib/workspace/services/assets/types";
import { WorkspaceContext } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { Services } from "@/lib/workspace/services/services";
import { FocusArea } from "@/lib/workspace/services/ui/types";
import { Image } from "lucide-react";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { ImagePreviewEditor } from "../editors/ImagePreviewEditor";

export interface UseAssetFocusParams {
    context: WorkspaceContext | null;
    panelId: string;
}

export function useAssetFocus({ context, panelId }: UseAssetFocusParams) {
    const [focusedItemId, setFocusedItemId] = useState<string | null>(null);

    const handleAssetClick = useCallback((asset: Asset, isMultiSelectMode: boolean) => {
        if (!context) return;

        const uiService = context.services.get<UIService>(Services.UI);
        uiService.getStore().setSelection({ type: "asset", data: asset });
        uiService.focus.setFocus(FocusArea.LeftPanel, panelId);
        setFocusedItemId(`asset:${asset.id}`);

        if (!isMultiSelectMode) {
            if (asset.type === AssetType.Image) {
                // Always activate the tab so the editor shows content.
                // We will immediately return focus to the left panel to avoid stealing global shortcuts.
                uiService.editor.open({
                    id: `narraleaf-studio:assets:image-preview-${asset.id}`,
                    title: asset.name,
                    icon: <Image className="w-4 h-4" />,
                    component: ImagePreviewEditor,
                    closable: true,
                    payload: { asset: asset as Asset<AssetType.Image> },
                }, undefined, { activate: true });

                // Return focus to assets panel silently so keyboard shortcuts remain scoped correctly
                uiService.focus.setFocus(FocusArea.LeftPanel, panelId, { silent: true });
            }
            uiService.panels.show("narraleaf-studio:properties");
        }
    }, [context, panelId]);

    const handleGroupFocus = useCallback((groupId: string) => {
        if (!context) return;

        const uiService = context.services.get<UIService>(Services.UI);
        // Ensure panel gets focus when group is focused
        uiService.focus.setFocus(FocusArea.LeftPanel, panelId);
        setFocusedItemId(`group:${groupId}`);
    }, [context, panelId]);

    const setFocusToPanel = useCallback(() => {
        if (context) {
            const uiService = context.services.get<UIService>(Services.UI);
            uiService.focus.setFocus(FocusArea.LeftPanel, panelId);
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
