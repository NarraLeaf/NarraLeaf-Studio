import type { CSSProperties, MouseEvent } from "react";
import type { DraggableAttributes } from "@dnd-kit/core";
import { useAssetDropTarget } from "@/apps/workspace/dnd/useAssetDropTarget";
import { useWorkspace } from "@/apps/workspace/context";
import type { PanelDefinition } from "@/apps/workspace/registry/types";
import { setWorkspaceSelectionToPrimaryAsset } from "@/apps/workspace/modules/assets/dnd/openDraggedAssetsInEditor";

/**
 * Drag-to-reorder wiring supplied by the sortable rail. When present, the icon becomes a
 * `@dnd-kit/sortable` item; when absent the icon renders as a plain (non-draggable) button.
 */
export interface SidebarPanelSortable {
    setNodeRef: (element: HTMLElement | null) => void;
    style: CSSProperties;
    attributes: DraggableAttributes;
    listeners: Record<string, unknown> | undefined;
    isDragging: boolean;
}

interface SidebarPanelDropIconProps {
    panel: PanelDefinition;
    active: boolean;
    sidebarVisible: boolean;
    onPanelClick: () => void;
    /** Show sidebar, select panel, and move workspace focus (for drag-drop). */
    onActivateForDrop: () => void;
    /** Right-click on this icon (opens the rail's visibility context menu). */
    onContextMenu?: (event: MouseEvent) => void;
    /** Optional sortable bindings from the enclosing rail (enables drag-to-reorder). */
    sortable?: SidebarPanelSortable;
}

/**
 * Sidebar / bottom bar panel icon that also accepts asset drops from the assets panel.
 * Optionally participates in drag-to-reorder when the enclosing rail provides `sortable`.
 */
export function SidebarPanelDropIcon({
    panel,
    active,
    sidebarVisible,
    onPanelClick,
    onActivateForDrop,
    onContextMenu,
    sortable,
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

    // A rail action has no panel body, so there is nowhere to drop an asset *into*: accepting one
    // would activate the sidebar onto an empty panel. It reads as a plain button instead.
    const acceptsAssetDrop = !panel.railAction;

    return (
        <button
            type="button"
            ref={sortable?.setNodeRef}
            style={sortable?.style}
            {...(acceptsAssetDrop ? dropTargetProps : {})}
            {...sortable?.attributes}
            {...sortable?.listeners}
            className={`
                w-10 h-10 rounded-md flex items-center justify-center transition-colors cursor-default
                ${
                    active && sidebarVisible
                        ? "bg-fill-strong text-fg"
                        : "text-fg-muted hover:bg-fill hover:text-fg"
                }
                ${sortable?.isDragging ? "opacity-50 ring-2 ring-primary/60" : ""}
                ${acceptsAssetDrop ? overlayClassName : ""}
            `}
            onClick={onPanelClick}
            onContextMenu={onContextMenu}
            title={panel.title}
            aria-label={panel.title}
        >
            {panel.icon}
        </button>
    );
}
