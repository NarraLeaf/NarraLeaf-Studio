import type { ReactNode } from "react";
import { Braces, Film, Image, Music, Type } from "lucide-react";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { Asset } from "@/lib/workspace/services/assets/types";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { Services } from "@/lib/workspace/services/services";
import type { WorkspaceContext } from "@/lib/workspace/services/services";
import { FocusArea } from "@/lib/workspace/services/ui/types";
import { ImagePreviewEditor } from "../editors/ImagePreviewEditor";
import { AudioPreviewEditor } from "../editors/AudioPreviewEditor";
import { VideoPreviewEditor } from "../editors/VideoPreviewEditor";
import { FontPreviewEditor } from "../editors/FontPreviewEditor";
import { JsonPreviewEditor } from "../editors/JsonPreviewEditor";

export interface OpenAssetPreviewTabsOptions {
    /** Target editor group; omit for default group. */
    groupId?: string;
    /**
     * Split `groupId` and open into the fresh pane instead of into the group itself — the
     * drag-to-edge landing. Ignored without a `groupId`, and skipped when nothing is previewable,
     * so a rejected drop never strands an empty pane.
     */
    splitInto?: { direction: "horizontal" | "vertical"; side: "before" | "after" };
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
    const { groupId, splitInto, returnFocusToAssetsPanel, showPropertiesPanel } = options;
    const uiService = context.services.get<UIService>(Services.UI);

    const previewable = assets.filter(a =>
        a.type === AssetType.Image ||
        a.type === AssetType.Audio ||
        a.type === AssetType.Video ||
        a.type === AssetType.Font ||
        a.type === AssetType.JSON,
    );
    if (previewable.length === 0) {
        return;
    }

    // Split only now that an open is certain. Falls back to the original group if the split cannot
    // be made, so the previews still land somewhere.
    const targetGroupId =
        splitInto && groupId
            ? uiService.getStore().splitEditorGroupForDrop(groupId, splitInto.direction, splitInto.side) ?? groupId
            : groupId;

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
                targetGroupId,
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
                targetGroupId,
                { activate }
            );
        } else if (asset.type === AssetType.Video) {
            uiService.editor.open(
                {
                    id: `narraleaf-studio:assets:video-preview-${asset.id}`,
                    title: asset.name,
                    icon: videoIcon(),
                    component: VideoPreviewEditor,
                    closable: true,
                    payload: { asset: asset as Asset<AssetType.Video> },
                },
                targetGroupId,
                { activate }
            );
        } else if (asset.type === AssetType.Font) {
            uiService.editor.open(
                {
                    id: `narraleaf-studio:assets:font-preview-${asset.id}`,
                    title: asset.name,
                    icon: fontIcon(),
                    component: FontPreviewEditor,
                    closable: true,
                    payload: { asset: asset as Asset<AssetType.Font> },
                },
                targetGroupId,
                { activate }
            );
        } else if (asset.type === AssetType.JSON) {
            uiService.editor.open(
                {
                    id: `narraleaf-studio:assets:json-preview-${asset.id}`,
                    title: asset.name,
                    icon: jsonIcon(),
                    component: JsonPreviewEditor,
                    closable: true,
                    payload: { asset: asset as Asset<AssetType.JSON> },
                },
                targetGroupId,
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

function videoIcon(): ReactNode {
    return <Film className="w-4 h-4" />;
}

function fontIcon(): ReactNode {
    return <Type className="w-4 h-4" />;
}

function jsonIcon(): ReactNode {
    return <Braces className="w-4 h-4" />;
}
