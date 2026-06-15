import { useAssetDropTarget } from "@/apps/workspace/dnd/useAssetDropTarget";
import { useWorkspace } from "@/apps/workspace/context";
import {
    openAssetPreviewTabsInEditor,
    setWorkspaceSelectionToPrimaryAsset,
} from "@/apps/workspace/modules/assets/dnd/openDraggedAssetsInEditor";

/**
 * Drop target for an editor group chrome (tab bar + content area): open previews in this group.
 */
export function useEditorGroupAssetDrop(groupId: string) {
    const { context } = useWorkspace();

    return useAssetDropTarget({
        onDrop: ({ wire, resolved }) => {
            if (!context || resolved.length === 0) {
                return;
            }
            const primary = resolved.find(a => a.id === wire.p) ?? resolved[0];
            setWorkspaceSelectionToPrimaryAsset(context, primary);
            openAssetPreviewTabsInEditor(context, resolved, { groupId });
        },
    });
}
