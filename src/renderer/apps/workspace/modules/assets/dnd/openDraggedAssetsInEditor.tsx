import type { ReactNode } from "react";
import { Image, Music } from "lucide-react";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { Asset } from "@/lib/workspace/services/assets/types";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { Services } from "@/lib/workspace/services/services";
import type { WorkspaceContext } from "@/lib/workspace/services/services";
import { FocusArea } from "@/lib/workspace/services/ui/types";
import { ImagePreviewEditor } from "../editors/ImagePreviewEditor";
import { AudioPreviewEditor } from "../editors/AudioPreviewEditor";

export interface OpenAssetPreviewTabsOptions {
    /** Target editor group; omit for default group. */
    groupId?: string;
    /**
     * When set, after opening tabs, return focus to the assets panel silently (click-from-assets UX).
     * Omit for drag-drop onto editor UX (keep editor focused).
     */
    returnFocusToAssetsPanel?: { panelId: string; focusArea: FocusArea };
    /** Show properties sidebar after opening previews (assets panel click behavior). */
    showPropertiesPanel?: boolean;
}

/**
 * Open image/audio preview tabs for the given assets. Skips types without preview editors.
 * Activates the last opened preview tab by default.
 */
export function openAssetPreviewTabsInEditor(
    context: WorkspaceContext,
    assets: Asset[],
    options: OpenAssetPreviewTabsOptions = {}
): void {
    const { groupId, returnFocusToAssetsPanel, showPropertiesPanel } = options;
    const uiService = context.services.get<UIService>(Services.UI);

    const previewable = assets.filter(a => a.type === AssetType.Image || a.type === AssetType.Audio);
    if (previewable.length === 0) {
        return;
    }

    previewable.forEach((asset, index) => {
        const activate = index === previewable.length - 1;
        if (asset.type === AssetType.Image) {
            uiService.editor.open(
                {
                    id: `narraleaf-studio:assets:image-preview-${asset.id}`,
                    title: asset.name,
                    icon: imageIcon(),
                    component: ImagePreviewEditor,
                    closable: true,
                    payload: { asset: asset as Asset<AssetType.Image> },
                },
                groupId,
                { activate }
            );
        } else if (asset.type === AssetType.Audio) {
            uiService.editor.open(
                {
                    id: `narraleaf-studio:assets:audio-preview-${asset.id}`,
                    title: asset.name,
                    icon: audioIcon(),
                    component: AudioPreviewEditor,
                    closable: true,
                    payload: { asset: asset as Asset<AssetType.Audio> },
                },
                groupId,
                { activate }
            );
        }
    });

    if (showPropertiesPanel) {
        uiService.panels.show("narraleaf-studio:properties");
    }

    if (returnFocusToAssetsPanel) {
        uiService.focus.setFocus(returnFocusToAssetsPanel.focusArea, returnFocusToAssetsPanel.panelId, { silent: true });
    }
}

function imageIcon(): ReactNode {
    return <Image className="w-4 h-4" />;
}

function audioIcon(): ReactNode {
    return <Music className="w-4 h-4" />;
}

/**
 * Sync workspace selection to the primary asset of a drag/drop action.
 */
export function setWorkspaceSelectionToPrimaryAsset(context: WorkspaceContext, primary: Asset): void {
    const uiService = context.services.get<UIService>(Services.UI);
    uiService.getStore().setSelection({ type: "asset", data: primary });
}
