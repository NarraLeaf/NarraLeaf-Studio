import { useAssetDropTarget } from "@/apps/workspace/dnd/useAssetDropTarget";
import { useWorkspace } from "@/apps/workspace/context";
import {
    openAssetPreviewTabsInEditor,
    setWorkspaceSelectionToPrimaryAsset,
} from "@/apps/workspace/modules/assets/dnd/openDraggedAssetsInEditor";

interface MainEditorEmptyDropZoneProps {
    groupId: string;
}

/**
 * Empty editor canvas drop target: open asset previews in the default editor group.
 */
export function MainEditorEmptyDropZone({ groupId }: MainEditorEmptyDropZoneProps) {
    const { context } = useWorkspace();

    const { dropTargetProps, overlayClassName } = useAssetDropTarget({
        onDrop: ({ wire, resolved }) => {
            if (!context || resolved.length === 0) {
                return;
            }
            const primary = resolved.find(a => a.id === wire.p) ?? resolved[0];
            setWorkspaceSelectionToPrimaryAsset(context, primary);
            openAssetPreviewTabsInEditor(context, resolved, { groupId });
        },
    });

    return (
        <div
            {...dropTargetProps}
            className={`h-full flex items-center justify-center bg-surface relative overflow-hidden rounded-sm transition-colors ${overlayClassName}`}
        >
            <div className="text-center text-fg-subtle relative z-10 pointer-events-none">
                <div className="relative mb-8">
                    <img
                        src="/img/narraleaf-studio/logo-icon-white.png"
                        className="w-64 h-64 mx-auto opacity-5"
                        alt="NarraLeaf Studio Logo"
                    />
                </div>

                <div className="space-y-4">
                    <h1 className="text-4xl font-light text-white/5">NarraLeaf Studio</h1>
                </div>
            </div>
        </div>
    );
}
