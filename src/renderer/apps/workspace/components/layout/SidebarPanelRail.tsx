import type { CSSProperties } from "react";
import {
    DndContext,
    PointerSensor,
    closestCenter,
    useSensor,
    useSensors,
    type DragEndEvent,
} from "@dnd-kit/core";
import {
    SortableContext,
    arrayMove,
    useSortable,
    verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { PanelDefinition } from "@/apps/workspace/registry/types";
import { SidebarPanelDropIcon } from "./SidebarPanelDropIcon";

interface SidebarPanelRailProps {
    panels: PanelDefinition[];
    activeId: string | null;
    sidebarVisible: boolean;
    onPanelClick: (panelId: string) => void;
    onActivateForDrop?: (panelId: string) => void;
    /** Commit a new panel order (ids in display order) for this dock area. */
    onReorder: (orderedIds: string[]) => void;
}

/**
 * Renders a dock area's panel icons as a vertical drag-to-reorder list.
 *
 * Each rail owns its own {@link DndContext}, so a drag is physically confined to a single dock
 * area — an icon from the bottom rail can never be dropped into the left/right rail. Reordering
 * within the group commits through `onReorder`.
 */
export function SidebarPanelRail({
    panels,
    activeId,
    sidebarVisible,
    onPanelClick,
    onActivateForDrop,
    onReorder,
}: SidebarPanelRailProps) {
    // A small activation distance lets plain clicks still select the panel; only a real drag reorders.
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
    const ids = panels.map(panel => panel.id);

    const handleDragEnd = (event: DragEndEvent) => {
        const activeDragId = String(event.active.id);
        const overId = event.over ? String(event.over.id) : null;
        if (!overId || activeDragId === overId) {
            return;
        }
        const from = ids.indexOf(activeDragId);
        const to = ids.indexOf(overId);
        if (from === -1 || to === -1) {
            return;
        }
        onReorder(arrayMove(ids, from, to));
    };

    return (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                {panels.map(panel => (
                    <SortableSidebarPanelIcon
                        key={panel.id}
                        panel={panel}
                        active={activeId === panel.id}
                        sidebarVisible={sidebarVisible}
                        onPanelClick={() => onPanelClick(panel.id)}
                        onActivateForDrop={() => onActivateForDrop?.(panel.id)}
                    />
                ))}
            </SortableContext>
        </DndContext>
    );
}

interface SortableSidebarPanelIconProps {
    panel: PanelDefinition;
    active: boolean;
    sidebarVisible: boolean;
    onPanelClick: () => void;
    onActivateForDrop: () => void;
}

function SortableSidebarPanelIcon({
    panel,
    active,
    sidebarVisible,
    onPanelClick,
    onActivateForDrop,
}: SortableSidebarPanelIconProps) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: panel.id,
    });

    // Constrain movement to the vertical axis so icons never drift out of their narrow rail
    // (dnd-kit's FLIP scale factor is dropped for the same reason as the story-row list).
    const style: CSSProperties = {
        transform: transform ? `translate3d(0, ${transform.y}px, 0)` : undefined,
        transition,
        zIndex: isDragging ? 20 : undefined,
        touchAction: "none",
    };

    return (
        <SidebarPanelDropIcon
            panel={panel}
            active={active}
            sidebarVisible={sidebarVisible}
            onPanelClick={onPanelClick}
            onActivateForDrop={onActivateForDrop}
            sortable={{ setNodeRef, style, attributes, listeners, isDragging }}
        />
    );
}
