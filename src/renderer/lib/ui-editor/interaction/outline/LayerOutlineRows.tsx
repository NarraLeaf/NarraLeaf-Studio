import { type CSSProperties, type MouseEvent } from "react";
import { useDndContext, useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronRight, Eye, EyeOff, GripVertical, Lock } from "lucide-react";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import { uiElementTypeAcceptsChildren } from "@shared/types/ui-editor/document";
import { DEFAULT_UI_ROOT_NAME } from "@shared/constants/ui-editor";
import { getOutlineVisualChildren } from "@/lib/ui-editor/interaction/outline/outlineDropGeometry";

export const OUTLINE_ROOT_WIDGET_TYPE = "nl.root";
const ROW_LEFT_PADDING = 6;
const ROW_INDENT = 16;
const GUIDE_OFFSET = 8;

export type OutlineGapDropData = {
    kind: "outline-gap";
    parentId: string;
    visualIndex: number;
};

function getOutlineElementLabel(element: UIElement): string {
    return element.type === OUTLINE_ROOT_WIDGET_TYPE
        ? DEFAULT_UI_ROOT_NAME
        : element.name ?? element.type ?? element.id;
}

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
    const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } = useSortable({
        id: element.id,
    });
    const style: CSSProperties = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0 : undefined,
    };

    const hasChildren = element.childrenIds.length > 0;
    const expanded = !isCollapsed(element.id);
    const visible = element.layout.visible !== false;
    const isDimmed = !visible;
    const label = getOutlineElementLabel(element);
    const isPrimary = primaryId === element.id;
    const rowSelected = selectedIds.has(element.id);
    const rowPaddingLeft = ROW_LEFT_PADDING + depth * ROW_INDENT;
    const guideLevels = Array.from({ length: depth }, (_, index) => index + 1);

    return (
        <div className="relative select-none" data-outline-row>
            {guideLevels.map(level => {
                const x = ROW_LEFT_PADDING + level * ROW_INDENT - GUIDE_OFFSET;
                return (
                    <span
                        key={level}
                        aria-hidden
                        className="pointer-events-none absolute bottom-0 top-0 w-px bg-white/[0.055]"
                        style={{ left: x }}
                    />
                );
            })}
            {depth > 0 ? (
                <span
                    aria-hidden
                    className="pointer-events-none absolute top-[14px] h-px bg-white/[0.09]"
                    style={{
                        left: rowPaddingLeft - GUIDE_OFFSET,
                        width: GUIDE_OFFSET,
                    }}
                />
            ) : null}
            <div
                ref={setNodeRef}
                className={`group/outline-row relative flex min-h-[26px] items-center gap-1 rounded text-xs pr-1 transition-colors ${
                    rowSelected
                        ? isPrimary
                            ? "bg-primary/25 text-white ring-1 ring-primary/45"
                            : "bg-primary/[0.12] text-white"
                        : "text-gray-300 hover:bg-white/[0.055]"
                } ${isDimmed ? "opacity-60" : ""}`}
                style={{ ...style, paddingLeft: rowPaddingLeft }}
                onContextMenu={e => onRowContextMenu(element, e)}
            >
                <button
                    type="button"
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-gray-500 transition-colors hover:bg-white/5 hover:text-white disabled:pointer-events-none disabled:opacity-25"
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
                    ref={setActivatorNodeRef}
                    className="flex h-5 w-4 shrink-0 cursor-grab touch-none items-center justify-center rounded text-gray-500/70 opacity-60 transition hover:text-white hover:opacity-100 active:cursor-grabbing group-hover/outline-row:opacity-100 group-focus-within/outline-row:opacity-100"
                    aria-label="Drag to reorder"
                    {...attributes}
                    {...listeners}
                >
                    <GripVertical className="h-3.5 w-3.5" />
                </button>
                {element.type === OUTLINE_ROOT_WIDGET_TYPE ? (
                    <Lock className="h-3 w-3 shrink-0 text-gray-500" aria-hidden />
                ) : (
                    <span className="h-3 w-1 shrink-0" />
                )}
                <button
                    type="button"
                    className={`flex min-w-0 flex-1 items-center gap-1.5 py-0.5 text-left ${
                        isPrimary ? "font-medium" : ""
                    }`}
                    onClick={e => onSelect(element.id, e)}
                    onDoubleClick={e => {
                        e.stopPropagation();
                        if (element.type !== OUTLINE_ROOT_WIDGET_TYPE) {
                            onStartRename(element);
                        }
                    }}
                >
                    <span className="min-w-0 truncate">{label}</span>
                    {element.type !== OUTLINE_ROOT_WIDGET_TYPE ? (
                        <span className="min-w-0 max-w-[7rem] truncate font-mono text-[10px] font-normal text-gray-500 opacity-0 transition-opacity group-hover/outline-row:opacity-100">
                            {element.type.replace(/^nl\./, "")}
                        </span>
                    ) : null}
                </button>
                <button
                    type="button"
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-500 transition hover:bg-white/5 hover:text-white disabled:pointer-events-none disabled:opacity-25 ${
                        visible ? "opacity-0 group-hover/outline-row:opacity-100 group-focus-within/outline-row:opacity-100" : "opacity-100"
                    }`}
                    aria-label={visible ? "Hide" : "Show"}
                    disabled={element.type === OUTLINE_ROOT_WIDGET_TYPE}
                    onClick={e => onToggleVisible(element, e)}
                >
                    {visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
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
            {!hasChildren && uiElementTypeAcceptsChildren(element.type) ? (
                <OutlineGapDropZone parentId={element.id} depth={depth + 1} visualIndex={0} />
            ) : null}
        </div>
    );
}

export function OutlineDragPreview({ element }: { element: UIElement }) {
    const visible = element.layout.visible !== false;
    const label = getOutlineElementLabel(element);

    return (
        <div
            className={`flex h-[26px] min-w-40 max-w-72 items-center gap-1 rounded border border-primary/35 bg-[#15181d]/90 px-2 pr-2 text-xs text-white opacity-90 shadow-lg shadow-black/30 ${
                visible ? "" : "opacity-70"
            }`}
        >
            <GripVertical className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />
            {element.type === OUTLINE_ROOT_WIDGET_TYPE ? (
                <Lock className="h-3 w-3 shrink-0 text-gray-500" aria-hidden />
            ) : (
                <span className="h-3 w-1 shrink-0" />
            )}
            <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
            {element.type !== OUTLINE_ROOT_WIDGET_TYPE ? (
                <span className="min-w-0 max-w-[7rem] truncate font-mono text-[10px] font-normal text-gray-500">
                    {element.type.replace(/^nl\./, "")}
                </span>
            ) : null}
        </div>
    );
}

export function OutlineGapDropZone({
    parentId,
    depth,
    visualIndex,
}: {
    parentId: string;
    depth: number;
    visualIndex: number;
}) {
    const { active } = useDndContext();
    const { setNodeRef, isOver } = useDroppable({
        id: `gap:${parentId}:${visualIndex}`,
        disabled: !active,
        data: {
            kind: "outline-gap",
            parentId,
            visualIndex,
        } satisfies OutlineGapDropData,
    });
    const lineLeft = ROW_LEFT_PADDING + depth * ROW_INDENT;
    return (
        <div
            ref={setNodeRef}
            className="relative overflow-hidden transition-[height,opacity] duration-150 ease-out"
            style={{
                height: active ? 10 : 0,
                marginLeft: lineLeft,
                opacity: active ? 1 : 0,
            }}
            title="Drop here"
        >
            <span
                aria-hidden
                className={`absolute left-0 right-2 top-1/2 h-0.5 -translate-y-1/2 rounded-full transition-opacity ${
                    isOver ? "bg-primary opacity-100 shadow-[0_0_0_1px_rgba(64,168,196,0.28)]" : "bg-primary/40 opacity-0"
                }`}
            />
        </div>
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
            <OutlineGapDropZone parentId={props.parentId} depth={props.depth} visualIndex={0} />
            {visualChildren.map((childId, index) => {
                const child = props.document.elements[childId];
                return (
                    <div key={childId}>
                        {child ? (
                            <SortableOutlineRow
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
                        ) : null}
                        <OutlineGapDropZone parentId={props.parentId} depth={props.depth} visualIndex={index + 1} />
                    </div>
                );
            })}
        </SortableContext>
    );
}
