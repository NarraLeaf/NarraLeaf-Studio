import { useEffect, useMemo, useState, useCallback, type MouseEvent, type ReactNode } from "react";
import type { DragEndEvent } from "@dnd-kit/core";
import { closestCorners, DndContext, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { UIElement } from "@shared/types/ui-editor/document";
import { UIEditorStateService } from "@services/ui-editor/UIEditorStateService";
import { isUIElementSelection } from "@services/ui/UIStore";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";

type UILayersPanelProps = {
    surfaceId: string;
};

const LayerRow = ({
    label,
    depth,
    selected,
    onClick,
}: {
    label: string;
    depth: number;
    selected: boolean;
    onClick: (event: MouseEvent<HTMLDivElement>) => void;
}) => (
    <div
        className={`flex items-center gap-2 px-3 py-1 rounded-md cursor-pointer text-xs ${
            selected ? "bg-primary/20 text-white" : "text-gray-300 hover:bg-white/5"
        }`}
        style={{ marginLeft: depth * 12, paddingLeft: 12 }}
        onClick={onClick}
    >
        <span className="w-2 h-2 rounded-full border border-white/20" />
        <span className="truncate">{label}</span>
    </div>
);

const TreeChildren = ({
    parent,
    documentElements,
    depth,
    handleSelect,
    isSelected,
}: {
    parent: UIElement;
    documentElements: Record<string, UIElement>;
    depth: number;
    handleSelect: (id: string, event: MouseEvent<HTMLDivElement>) => void;
    isSelected: (id: string) => boolean;
}) => {
    return (
        <>
            {parent.childrenIds.map(childId => {
                const child = documentElements[childId];
                if (!child) {
                    return null;
                }
                const label = child.name ?? child.type ?? child.id;
                return (
                    <div key={child.id}>
                        <LayerRow
                            label={label}
                            depth={depth}
                            selected={isSelected(child.id)}
                            onClick={event => {
                                event.stopPropagation();
                                handleSelect(child.id, event);
                            }}
                        />
                        <TreeChildren
                            parent={child}
                            documentElements={documentElements}
                            depth={depth + 1}
                            handleSelect={handleSelect}
                            isSelected={isSelected}
                        />
                    </div>
                );
            })}
        </>
    );
};

function SortableLayerItem({
    id,
    label,
    depth,
    selected,
    onClick,
    childrenNodes,
}: {
    id: string;
    label: string;
    depth: number;
    selected: boolean;
    onClick: (event: MouseEvent<HTMLDivElement>) => void;
    childrenNodes?: ReactNode;
}) {
    const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
    const style: React.CSSProperties = {
        transform: CSS.Transform.toString(transform),
        transition,
    };

    return (
        <div ref={setNodeRef} style={style}>
            <LayerRow label={label} depth={depth} selected={selected} onClick={onClick} {...attributes} {...listeners} />
            {childrenNodes}
        </div>
    );
}

export function UILayersPanel({ surfaceId }: UILayersPanelProps) {
    const stateService = UIEditorStateService.getInstance();
    const { context } = useWorkspace();
    const documentService = useMemo<UIDocumentService | null>(() => {
        if (!context) {
            return null;
        }
        return context.services.get<UIDocumentService>(Services.UIDocument);
    }, [context]);

    const [docVersion, setDocVersion] = useState(0);

    useEffect(() => {
        if (!documentService) {
            return;
        }
        const unsubscribe = documentService.onDocumentChanged(() => {
            setDocVersion(version => version + 1);
        });
        return unsubscribe;
    }, [documentService]);

    const document = documentService?.getDocument() ?? stateService.getDocument();
    const surface = document?.surfaces.find(surf => surf.id === surfaceId);
    const root = surface ? document.elements[surface.rootElementId] : undefined;

    const childElements = useMemo(() => {
        if (!root) {
            return [];
        }
        return root.childrenIds
            .map(id => document.elements[id])
            .filter((element): element is UIElement => Boolean(element));
    }, [root, document.elements, docVersion]);

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
        if (!root || !documentService || !over || active.id === over.id) {
            return;
        }
        const fromIndex = order.indexOf(active.id as string);
        const toIndex = order.indexOf(over.id as string);
        if (fromIndex === -1 || toIndex === -1) {
            return;
        }
        const nextOrder = arrayMove(order, fromIndex, toIndex);
        setOrder(nextOrder);
        documentService.reorderChildren(root.id, nextOrder);
    };

    const selection = stateService.getSelection();
    const selectionData = isUIElementSelection(selection) ? selection.data : null;
    const selectedIds = useMemo(() => new Set(selectionData?.elementIds ?? []), [selectionData]);
    const lastPrimaryId = selectionData?.primaryId ?? selectionData?.elementIds?.[selectionData.elementIds.length - 1];

    const indexMap = useMemo(() => {
        if (!root) {
            return new Map<string, number>();
        }
        const nodes: string[] = [];
        const traverse = (element: UIElement) => {
            nodes.push(element.id);
            element.childrenIds.forEach(childId => {
                const child = document.elements[childId];
                if (child) {
                    traverse(child);
                }
            });
        };
        traverse(root);
        return new Map(nodes.map((id, index) => [id, index]));
    }, [root, document.elements]);

    const handleLayerClick = useCallback(
        (id: string, event: MouseEvent<HTMLDivElement>) => {
            const baseIndex = lastPrimaryId ? indexMap.get(lastPrimaryId) : undefined;
            const clickedIndex = indexMap.get(id);
            let nextIds: string[] = [];

            if (event.shiftKey && baseIndex !== undefined && clickedIndex !== undefined) {
                const [start, end] = [baseIndex, clickedIndex].sort((a, b) => a - b);
                const nodesInRange = Array.from(indexMap.entries())
                    .filter(([, idx]) => idx >= start && idx <= end)
                    .sort((a, b) => a[1] - b[1])
                    .map(([nodeId]) => nodeId);
                nextIds = nodesInRange;
            } else if (event.metaKey || event.ctrlKey) {
                if (selectedIds.has(id)) {
                    nextIds = Array.from(selectedIds).filter(existing => existing !== id);
                } else {
                    nextIds = [...selectedIds, id];
                }
                if (nextIds.length === 0) {
                    nextIds = [id];
                }
            } else {
                nextIds = [id];
            }

            stateService.setUIElementSelection({
                editor: "ui",
                surfaceId,
                elementIds: nextIds,
                primaryId: id,
            });
        },
        [indexMap, lastPrimaryId, selectedIds, stateService, surfaceId]
    );

    if (!surface || !root) {
        return <div className="p-4 text-xs text-gray-500">No surface available</div>;
    }

    return (
        <div className="space-y-3 px-2 py-2">
            <div className="text-xs uppercase tracking-wide text-gray-400">Layers</div>
            <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
                <SortableContext items={order} strategy={verticalListSortingStrategy}>
                    {order.map(id => {
                        const element = document.elements[id];
                        if (!element) {
                            return null;
                        }
                        const label = element.name ?? element.type ?? element.id;
                        return (
                            <SortableLayerItem
                                key={id}
                                id={id}
                                label={label}
                                depth={0}
                                selected={selectedIds.has(id)}
                                onClick={event => handleLayerClick(id, event)}
                                childrenNodes={
                                    <TreeChildren
                                        parent={element}
                                        documentElements={document.elements}
                                        depth={1}
                                        handleSelect={handleLayerClick}
                                        isSelected={id => selectedIds.has(id)}
                                    />
                                }
                            />
                        );
                    })}
                </SortableContext>
            </DndContext>
        </div>
    );
}
