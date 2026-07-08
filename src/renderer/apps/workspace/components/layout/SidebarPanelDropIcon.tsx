import { useAssetDropTarget } from "@/apps/workspace/dnd/useAssetDropTarget";
import { useWorkspace } from "@/apps/workspace/context";
import type { PanelDefinition } from "@/apps/workspace/registry/types";
import { setWorkspaceSelectionToPrimaryAsset } from "@/apps/workspace/modules/assets/dnd/openDraggedAssetsInEditor";

interface SidebarPanelDropIconProps {
    panel: PanelDefinition;
    active: boolean;
    sidebarVisible: boolean;
    onPanelClick: () => void;
    /** Show sidebar, select panel, and move workspace focus (for drag-drop). */
    onActivateForDrop: () => void;
}

/**
 * Sidebar / bottom bar panel icon that also accepts asset drops from the assets panel.
 */
export function SidebarPanelDropIcon({
    panel,
    active,
    sidebarVisible,
    onPanelClick,
    onActivateForDrop,
}: SidebarPanelDropIconProps) {
    const { context } = useWorkspace();

    const { dropTargetProps, overlayClassName } = useAssetDropTarget({
        onDrop: ({ wire, resolved }) => {
            if (!context || resolved.length === 0) {
                return;
            }
            onActivateForDrop();
            const primary = resolved.find(a => a.id === wire.p) ?? resolved[0];
            setWorkspaceSelectionToPrimaryAsset(context, primary);
        },
    });

    return (
        <button
            type="button"
            {...dropTargetProps}
            className={`
                w-10 h-10 rounded-md flex items-center justify-center transition-colors cursor-default
                ${
                    active && sidebarVisible
                        ? "bg-fill-strong text-white"
                        : "text-fg-muted hover:bg-fill hover:text-white"
                }
                ${overlayClassName}
            `}
            onClick={onPanelClick}
            title={panel.title}
            aria-label={panel.title}
        >
            {panel.icon}
        </button>
    );
}
