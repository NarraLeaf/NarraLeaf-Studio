import { type MouseEvent } from "react";
import { useDndContext, useDraggable, useDroppable } from "@dnd-kit/core";
import { ChevronDown, ChevronRight, Eye, EyeOff, GripVertical, Lock } from "lucide-react";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import { uiElementTypeAcceptsChildren } from "@shared/types/ui-editor/document";
import { DEFAULT_UI_ROOT_NAME } from "@shared/constants/ui-editor";
import { getOutlineVisualChildren } from "@/lib/ui-editor/interaction/outline/outlineDropGeometry";
import { useTranslation } from "@/lib/i18n";

export const OUTLINE_ROOT_WIDGET_TYPE = "nl.root";
const ROW_LEFT_PADDING = 6;
const ROW_INDENT = 16;
const GUIDE_OFFSET = 8;
const OUTLINE_ACTIVE_GAP_HEIGHT = 8;
const OUTLINE_TERMINAL_GAP_HEIGHT = 10;

export type OutlineGapIntent = "child" | "sibling" | "root";

export type OutlineGapDropData = {
    kind: "outline-gap";
    parentId: string;
    visualIndex: number;
    intent: OutlineGapIntent;
    terminalChildDrop?: boolean;
};

export function isOutlineGapDropData(value: unknown): value is OutlineGapDropData {
    if (!value || typeof value !== "object") {
        return false;
    }
    const data = value as Partial<OutlineGapDropData>;
    return data.kind === "outline-gap" && typeof data.parentId === "string" && typeof data.visualIndex === "number";
}

function useActiveOutlineGapData(): OutlineGapDropData | null {
    const { active, over } = useDndContext();
    if (!active || !isOutlineGapDropData(over?.data.current)) {
        return null;
    }
    return over.data.current;
}

function getOutlineElementLabel(element: UIElement): string {
    return element.type === OUTLINE_ROOT_WIDGET_TYPE
        ? DEFAULT_UI_ROOT_NAME
        : element.name ?? element.type;
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

export function OutlineRow({
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
    const { t } = useTranslation();
    const { attributes, listeners, setActivatorNodeRef, setNodeRef, isDragging } = useDraggable({
        id: element.id,
    });

    const hasChildren = element.childrenIds.length > 0;
    const expanded = !isCollapsed(element.id);
    const visible = element.layout.visible !== false;
    const isDimmed = !visible;
    const label = getOutlineElementLabel(element);
    const isPrimary = primaryId === element.id;
    const rowSelected = selectedIds.has(element.id);
    const activeDropGap = useActiveOutlineGapData();
    const isDropParentPreview = activeDropGap?.parentId === element.id;
    const rowPaddingLeft = ROW_LEFT_PADDING + depth * ROW_INDENT;
    const guideLevels = Array.from({ length: depth }, (_, index) => index + 1);
    const rowToneClass = rowSelected
        ? isPrimary
            ? "bg-primary/25 text-white ring-1 ring-primary/45"
            : "bg-primary/[0.12] text-white"
        : isDropParentPreview
          ? "bg-primary/[0.10] text-fg ring-1 ring-primary/25"
          : "text-fg-muted hover:bg-white/[0.055]";
    const rowDropPreviewClass = isDropParentPreview
        ? "shadow-[inset_2px_0_0_rgba(64,168,196,0.55)]"
        : "";

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
                    className="pointer-events-none absolute top-[14px] h-px bg-fill"
                    style={{
                        left: rowPaddingLeft - GUIDE_OFFSET,
                        width: GUIDE_OFFSET,
                    }}
                />
            ) : null}
            <div
                ref={setNodeRef}
                className={`group/outline-row relative flex min-h-[26px] items-center gap-1 rounded text-xs pr-1 transition-[background-color,box-shadow,color,opacity] duration-150 ease-out ${rowToneClass} ${rowDropPreviewClass} ${isDimmed ? "opacity-60" : ""}`}
                style={{ paddingLeft: rowPaddingLeft, opacity: isDragging ? 0 : undefined }}
                onContextMenu={e => onRowContextMenu(element, e)}
            >
                <button
                    type="button"
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-fill-subtle hover:text-white disabled:pointer-events-none disabled:opacity-25"
                    disabled={!hasChildren}
                    aria-label={expanded ? t("common.collapse") : t("common.expand")}
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
                    className="flex h-5 w-4 shrink-0 cursor-grab touch-none items-center justify-center rounded text-fg-subtle/70 opacity-60 transition hover:text-white hover:opacity-100 active:cursor-grabbing group-hover/outline-row:opacity-100 group-focus-within/outline-row:opacity-100"
                    aria-label={t("widgetChrome.outline.dragToReorder")}
                    {...attributes}
                    {...listeners}
                >
                    <GripVertical className="h-3.5 w-3.5" />
                </button>
                {element.type === OUTLINE_ROOT_WIDGET_TYPE ? (
                    <Lock className="h-3 w-3 shrink-0 text-fg-subtle" aria-hidden />
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
                        <span className="min-w-0 max-w-[7rem] truncate font-mono text-2xs font-normal text-fg-subtle opacity-0 transition-opacity group-hover/outline-row:opacity-100">
                            {element.type.replace(/^nl\./, "")}
                        </span>
                    ) : null}
                </button>
                <button
                    type="button"
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-subtle transition hover:bg-fill-subtle hover:text-white disabled:pointer-events-none disabled:opacity-25 ${
                        visible ? "opacity-0 group-hover/outline-row:opacity-100 group-focus-within/outline-row:opacity-100" : "opacity-100"
                    }`}
                    aria-label={visible ? t("common.hide") : t("common.show")}
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
                <OutlineGapDropZone
                    parentId={element.id}
                    depth={depth + 1}
                    visualIndex={0}
                    intent="child"
                    terminalChildDrop
                />
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
            <GripVertical className="h-3.5 w-3.5 shrink-0 text-fg-muted" aria-hidden />
            {element.type === OUTLINE_ROOT_WIDGET_TYPE ? (
                <Lock className="h-3 w-3 shrink-0 text-fg-subtle" aria-hidden />
            ) : (
                <span className="h-3 w-1 shrink-0" />
            )}
            <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
            {element.type !== OUTLINE_ROOT_WIDGET_TYPE ? (
                <span className="min-w-0 max-w-[7rem] truncate font-mono text-2xs font-normal text-fg-subtle">
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
    intent,
    terminalChildDrop = false,
}: {
    parentId: string;
    depth: number;
    visualIndex: number;
    intent: OutlineGapIntent;
    terminalChildDrop?: boolean;
}) {
    const { active } = useDndContext();
    const gapId = `gap:${parentId}:${visualIndex}`;
    const { setNodeRef, isOver } = useDroppable({
        id: gapId,
        data: {
            kind: "outline-gap",
            parentId,
            visualIndex,
            intent,
            terminalChildDrop,
        } satisfies OutlineGapDropData,
    });
    const lineLeft = ROW_LEFT_PADDING + depth * ROW_INDENT;
    const expandedHeight = terminalChildDrop ? OUTLINE_TERMINAL_GAP_HEIGHT : OUTLINE_ACTIVE_GAP_HEIGHT;
    const isActiveDropLine = isOver && active != null;
    return (
        <div
            className="relative overflow-visible transition-[height,opacity] duration-150 ease-out"
            style={{
                marginLeft: lineLeft,
                height: active ? expandedHeight : 0,
                opacity: active ? 1 : 0,
            }}
        >
            <div
                ref={setNodeRef}
                className="absolute left-0 right-2 top-0 z-10"
                data-outline-gap-id={gapId}
                style={{
                    height: active ? expandedHeight : 0,
                    pointerEvents: active ? "auto" : "none",
                }}
            >
                <span
                    aria-hidden
                    className={`pointer-events-none absolute left-0 right-0 top-1/2 -translate-y-1/2 rounded-full transition-[background-color,box-shadow,opacity,height] duration-100 ${
                        isActiveDropLine
                            ? "bg-primary/85 opacity-100 shadow-[0_0_0_1px_rgba(64,168,196,0.22)]"
                            : "bg-primary/40 opacity-30"
                    }`}
                    style={{ height: isActiveDropLine ? 2 : 1 }}
                />
            </div>
        </div>
    );
}

export function OutlineSubtree(props: OutlineRowBase & { parentId: string; depth: number }) {
    const activeDropGap = useActiveOutlineGapData();
    const parent = props.document.elements[props.parentId];
    if (!parent) {
        return null;
    }
    const isDropParentPreview = activeDropGap?.parentId === props.parentId;
    const visualChildren = getOutlineVisualChildren(parent);
    const gapIntent: OutlineGapIntent = parent.type === OUTLINE_ROOT_WIDGET_TYPE ? "root" : "child";
    const lastVisualIndex = visualChildren.length;
    return (
        <div
            className={`rounded-sm transition-colors duration-150 ease-out ${
                isDropParentPreview ? "bg-primary/[0.045]" : ""
            }`}
            data-outline-subtree-parent-id={props.parentId}
        >
            <OutlineGapDropZone
                parentId={props.parentId}
                depth={props.depth}
                visualIndex={0}
                intent={gapIntent}
                terminalChildDrop={gapIntent === "child" && lastVisualIndex === 0}
            />
            {visualChildren.map((childId, index) => {
                const child = props.document.elements[childId];
                const childCanOwnChildren = child != null && uiElementTypeAcceptsChildren(child.type);
                const childHasVisibleChildDrop =
                    childCanOwnChildren && (child.childrenIds.length === 0 || !props.isCollapsed(child.id));
                return (
                    <div key={childId}>
                        {child ? (
                            <OutlineRow
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
                        <OutlineGapDropZone
                            parentId={props.parentId}
                            depth={props.depth}
                            visualIndex={index + 1}
                            intent={childHasVisibleChildDrop ? "sibling" : gapIntent}
                            terminalChildDrop={gapIntent === "child" && index + 1 === lastVisualIndex}
                        />
                    </div>
                );
            })}
        </div>
    );
}
