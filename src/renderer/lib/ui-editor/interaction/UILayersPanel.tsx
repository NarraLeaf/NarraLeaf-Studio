import React, { useEffect, useMemo, useState } from "react";
import type { DragEndEvent } from "@dnd-kit/core";
import { closestCorners, DndContext, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { UIElement } from "@shared/types/ui-editor/document";
import { UIEditorStateService } from "@services/ui-editor/UIEditorStateService";

type LayerItemProps = {
    id: string;
    label: string;
};

function SortableLayerItem({ id, label }: LayerItemProps) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
    const style: React.CSSProperties = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.65 : 1,
        padding: 8,
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        cursor: "grab",
        backgroundColor: isDragging ? "rgba(255,255,255,0.08)" : "transparent",
        userSelect: "none",
    };
    return (
        <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
            {label}
        </div>
    );
}

type UILayersPanelProps = {
    surfaceId: string;
};

export function UILayersPanel({ surfaceId }: UILayersPanelProps) {
    const stateService = UIEditorStateService.getInstance();
    const document = stateService.getDocument();
    const surface = document.surfaces.find(surf => surf.id === surfaceId);
    const root = surface ? document.elements[surface.rootElementId] : undefined;
    const childElements = useMemo<UIElement[]>(() => {
        if (!root) {
            return [];
        }
        return root.childrenIds
            .map(id => document.elements[id])
            .filter((element): element is UIElement => Boolean(element));
    }, [root, document.elements]);

    const initialOrder = useMemo(() => childElements.map(element => element.id), [childElements]);
    const [order, setOrder] = useState<string[]>(initialOrder);
    useEffect(() => {
        setOrder(initialOrder);
    }, [initialOrder]);

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: { delay: 100, tolerance: 5 },
        })
    );

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id) {
            return;
        }

        setOrder(prev =>
            arrayMove(prev, prev.indexOf(active.id as string), prev.indexOf(over.id as string))
        );

        console.debug("[UILayersPanel] reorder", active.id, "->", over.id);
    };

    if (!surface || !root) {
        return <div>No surface available</div>;
    }

    return (
        <div style={{ padding: 8, minHeight: 80, backgroundColor: "rgba(0,0,0,0.3)" }}>
            <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
                <SortableContext items={order} strategy={verticalListSortingStrategy}>
                    {order.map(id => {
                        const element = document.elements[id];
                        if (!element) {
                            return null;
                        }
                        const label = element.name ?? element.type ?? id;
                        return <SortableLayerItem key={id} id={id} label={label} />;
                    })}
                </SortableContext>
            </DndContext>
        </div>
    );
}
