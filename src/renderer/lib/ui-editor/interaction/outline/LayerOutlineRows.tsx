import { type CSSProperties, type MouseEvent } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronRight, Eye, EyeOff, GripVertical, Lock } from "lucide-react";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import { DEFAULT_UI_ROOT_NAME } from "@shared/constants/ui-editor";
import { getOutlineVisualChildren } from "@/lib/ui-editor/interaction/outline/outlineDropGeometry";

export const OUTLINE_ROOT_WIDGET_TYPE = "nl.root";

export type OutlineRowBase = {
    document: UIDocument;
    surfaceId: string;
    selectedIds: Set<string>;
    primaryId: string | undefined;
    onSelect: (id: string, event: MouseEvent<HTMLElement>) => void;
    isCollapsed: (elementId: string) => boolean;
    toggleCollapsed: (elementId: string) => void;
    onRowContextMenu: (element: UIElement, event: MouseEvent<HTMLElement>) => void;
    onToggleVisible: (element: UIElement, event: MouseEvent) => void;
    onStartRename: (element: UIElement) => void;
};

export function SortableOutlineRow({
    element,
    depth,
    document,
    surfaceId,
    selectedIds,
    primaryId,
    onSelect,
    isCollapsed,
    toggleCollapsed,
    onRowContextMenu,
    onToggleVisible,
    onStartRename,
}: OutlineRowBase & { element: UIElement; depth: number }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: element.id,
    });
    const style: CSSProperties = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.55 : undefined,
    };

    const hasChildren = element.childrenIds.length > 0;
    const expanded = !isCollapsed(element.id);
    const visible = element.layout.visible !== false;
    const isDimmed = !visible;
    const label =
        element.type === OUTLINE_ROOT_WIDGET_TYPE
            ? DEFAULT_UI_ROOT_NAME
            : element.name ?? element.type ?? element.id;
    const isPrimary = primaryId === element.id;

    return (
        <div ref={setNodeRef} style={style} className="select-none" data-outline-row>
            <div
                className={`group flex items-center gap-1 rounded-md text-xs min-h-[28px] pr-1 ${
                    selectedIds.has(element.id)
                        ? isPrimary
                            ? "bg-primary/30 ring-1 ring-primary/50 text-white"
                            : "bg-primary/15 text-white"
                        : "text-gray-300 hover:bg-white/5"
                } ${isDimmed ? "opacity-60" : ""}`}
                style={{ paddingLeft: 6 + depth * 12 }}
                onContextMenu={e => onRowContextMenu(element, e)}
            >
                <button
                    type="button"
                    className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-gray-500 hover:text-white disabled:opacity-30"
                    disabled={!hasChildren}
                    aria-label={expanded ? "Collapse" : "Expand"}
                    onClick={e => {
                        e.stopPropagation();
                        if (!hasChildren) {
                            return;
                        }
                        toggleCollapsed(element.id);
                    }}
                >
                    {hasChildren ? (
                        expanded ? (
                            <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                            <ChevronRight className="w-3.5 h-3.5" />
                        )
                    ) : (
                        <span className="w-3.5 h-3.5 inline-block" />
                    )}
                </button>
                <button
                    type="button"
                    className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-gray-500 hover:text-white cursor-grab active:cursor-grabbing touch-none"
                    aria-label="Drag to reorder"
                    {...attributes}
                    {...listeners}
                >
                    <GripVertical className="w-3.5 h-3.5" />
                </button>
                {element.type === OUTLINE_ROOT_WIDGET_TYPE ? (
                    <Lock className="w-3 h-3 shrink-0 text-gray-500" aria-hidden />
                ) : (
                    <span className="w-3 shrink-0" />
                )}
                <button
                    type="button"
                    className={`flex-1 text-left truncate py-0.5 ${isPrimary ? "font-medium" : ""}`}
                    onClick={e => onSelect(element.id, e)}
                    onDoubleClick={e => {
                        e.stopPropagation();
                        if (element.type !== OUTLINE_ROOT_WIDGET_TYPE) {
                            onStartRename(element);
                        }
                    }}
                >
                    {label}
                </button>
                <button
                    type="button"
                    className="shrink-0 w-7 h-7 flex items-center justify-center rounded text-gray-500 hover:text-white"
                    aria-label={visible ? "Hide" : "Show"}
                    disabled={element.type === OUTLINE_ROOT_WIDGET_TYPE}
                    onClick={e => onToggleVisible(element, e)}
                >
                    {visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                </button>
            </div>
            {hasChildren && expanded ? (
                <OutlineSubtree
                    parentId={element.id}
                    depth={depth + 1}
                    document={document}
                    surfaceId={surfaceId}
                    selectedIds={selectedIds}
                    primaryId={primaryId}
                    onSelect={onSelect}
                    isCollapsed={isCollapsed}
                    toggleCollapsed={toggleCollapsed}
                    onRowContextMenu={onRowContextMenu}
                    onToggleVisible={onToggleVisible}
                    onStartRename={onStartRename}
                />
            ) : null}
            <OutlineAppendDropZone
                parentId={element.id}
                depth={depth + 1}
                visible={element.childrenIds.length === 0 || expanded}
            />
        </div>
    );
}

export function OutlineAppendDropZone({
    parentId,
    depth,
    visible,
}: {
    parentId: string;
    depth: number;
    visible: boolean;
}) {
    const { setNodeRef, isOver } = useDroppable({
        id: `append:${parentId}`,
        data: { kind: "outline-append", parentId },
    });
    if (!visible) {
        return null;
    }
    return (
        <div
            ref={setNodeRef}
            className={`rounded border border-dashed transition-colors ${
                isOver ? "border-primary/40 bg-primary/10" : "border-white/5"
            }`}
            style={{ marginLeft: 6 + depth * 12, minHeight: 8, marginTop: 2, marginBottom: 2 }}
            title="Drop to append inside this node"
        />
    );
}

export function OutlineSubtree(props: OutlineRowBase & { parentId: string; depth: number }) {
    const parent = props.document.elements[props.parentId];
    if (!parent) {
        return null;
    }
    const visualChildren = getOutlineVisualChildren(parent);
    return (
        <SortableContext items={visualChildren} strategy={verticalListSortingStrategy}>
            {visualChildren.map(childId => {
                const child = props.document.elements[childId];
                if (!child) {
                    return null;
                }
                return (
                    <SortableOutlineRow
                        key={child.id}
                        element={child}
                        depth={props.depth}
                        document={props.document}
                        surfaceId={props.surfaceId}
                        selectedIds={props.selectedIds}
                        primaryId={props.primaryId}
                        onSelect={props.onSelect}
                        isCollapsed={props.isCollapsed}
                        toggleCollapsed={props.toggleCollapsed}
                        onRowContextMenu={props.onRowContextMenu}
                        onToggleVisible={props.onToggleVisible}
                        onStartRename={props.onStartRename}
                    />
                );
            })}
        </SortableContext>
    );
}
