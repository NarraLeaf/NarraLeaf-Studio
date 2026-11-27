import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useDraggable } from "@dnd-kit/core";
import { ChevronDown, ChevronRight, Columns2, Component, Eye, EyeOff, Lock, LockOpen, Rows2, Square, type LucideIcon } from "lucide-react";
import {
    isLinkedUIComponentElement,
    isUIFlowLayoutParentElement,
    type UIDocument,
    type UIElement,
} from "@shared/types/ui-editor/document";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import { DEFAULT_UI_ROOT_NAME } from "@shared/constants/ui-editor";
import {
    getOutlineVisualChildren,
    type OutlineDropTarget,
} from "@/lib/ui-editor/interaction/outline/outlineDropGeometry";
import { useTranslation } from "@/lib/i18n";
import { isSurfaceGestureEnabled, type UIEditorReadOnly } from "@/lib/ui-editor/interaction/readOnlyInteraction";
import { isComponentEditorRootElement } from "@/lib/ui-editor/componentEditorRoot";
import { isImeKeyEvent } from "@/lib/utils/imeComposition";

export const OUTLINE_ROOT_WIDGET_TYPE = "nl.root";
const ROW_LEFT_PADDING = 6;
const ROW_INDENT = 16;
const GUIDE_OFFSET = 8;

/**
 * The glyph at the front of a row, so a layer's kind reads at a glance rather than from its name -
 * which is often only "Container 3". The widget's own icon, the one the insert bar shows; a stack or
 * scroll container shows the direction it lays its children out in; a linked component instance shows
 * the component glyph, in the accent colour, as the instance it is (its inside belongs to the
 * component, not to this page).
 */
export function resolveOutlineRowIcon(element: UIElement): { icon: LucideIcon; component: boolean } {
    if (isLinkedUIComponentElement(element)) {
        return { icon: Component, component: true };
    }
    if (element.type === "nl.container" && isUIFlowLayoutParentElement(element)) {
        return { icon: element.props?.stackDirection === "horizontal" ? Columns2 : Rows2, component: false };
    }
    return { icon: widgetModuleRegistry.get(element.type)?.icon ?? Square, component: false };
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
    /** Editor-only: hide the layer on the canvas (the game's own visibility is not touched). */
    onToggleHiddenInEditor: (element: UIElement, event: MouseEvent) => void;
    isHiddenInEditor: (elementId: string) => boolean;
    /** Editor-only: lock the layer against canvas picks. */
    onToggleLocked: (element: UIElement, event: MouseEvent) => void;
    isLocked: (elementId: string) => boolean;
    onStartRename: (element: UIElement) => void;
    /** The row being renamed in place, if any. */
    renamingId: string | null;
    /** A name to keep, or `null` to leave the name as it was. */
    onFinishRename: (element: UIElement, name: string | null) => void;
    /** Where a drag is being held, for the line or highlight that shows it. */
    dropTarget: OutlineDropTarget | null;
    /** The rows being dragged, drawn faded where they were. */
    draggingIds: ReadonlySet<string>;
    onHover: (elementId: string | null) => void;
    /** Reorder, rename, hide and lock go inert; selecting and expanding a branch do not. */
    readOnly: UIEditorReadOnly;
};

/** The name field a row turns into while it is renamed: Enter or leaving it keeps the name, Escape does not. */
function OutlineRenameField({ element, onFinish }: { element: UIElement; onFinish: (name: string | null) => void }) {
    const { t } = useTranslation();
    const [value, setValue] = useState(element.name ?? "");
    const inputRef = useRef<HTMLInputElement | null>(null);
    const finished = useRef(false);
    useEffect(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
    }, []);
    const handleRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (isImeKeyEvent(event)) {
            return;
        }
        event.stopPropagation();
        if (event.key === "Enter") {
            event.preventDefault();
            finish(value);
        } else if (event.key === "Escape") {
            event.preventDefault();
            finish(null);
        }
    };
    const finish = (name: string | null) => {
        if (finished.current) {
            return;
        }
        finished.current = true;
        const trimmed = name?.trim() ?? null;
        onFinish(trimmed && trimmed !== (element.name ?? "") ? trimmed : null);
    };
    return (
        <input
            ref={inputRef}
            value={value}
            aria-label={t("widgetChrome.outline.renameLayer")}
            className="min-w-0 flex-1 rounded-sm border border-primary/60 bg-surface-raised px-1 py-0.5 text-xs text-fg outline-none"
            onChange={event => setValue(event.target.value)}
            onBlur={() => finish(value)}
            onPointerDown={event => event.stopPropagation()}
            onClick={event => event.stopPropagation()}
            onKeyDown={handleRenameKeyDown}
        />
    );
}

export function OutlineRow(props: OutlineRowBase & { element: UIElement; depth: number }) {
    const {
        element,
        depth,
        selectedIds,
        primaryId,
        onSelect,
        isCollapsed,
        toggleCollapsed,
        onRowContextMenu,
        onToggleHiddenInEditor,
        isHiddenInEditor,
        onToggleLocked,
        isLocked,
        onStartRename,
        renamingId,
        onFinishRename,
        dropTarget,
        draggingIds,
        onHover,
        readOnly,
    } = props;
    const { t } = useTranslation();
    const reorderEnabled = isSurfaceGestureEnabled("outlineReorder", readOnly);
    // A component's frame is not moved anywhere, so its row has nothing to drag by.
    const isComponentFrame = isComponentEditorRootElement(element);
    const isRoot = element.type === OUTLINE_ROOT_WIDGET_TYPE;
    const renameEnabled = isSurfaceGestureEnabled("outlineRename", readOnly);
    // The whole row drags, as in every layers panel. dnd-kit's 4px activation keeps a click a click.
    const { attributes, listeners, setNodeRef } = useDraggable({
        id: element.id,
        disabled: !reorderEnabled || isComponentFrame || isRoot,
    });

    const hasChildren = element.childrenIds.length > 0;
    const expanded = !isCollapsed(element.id);
    const hiddenInGame = element.layout.visible === false;
    const hiddenInEditor = isHiddenInEditor(element.id);
    const locked = isLocked(element.id);
    const label = getOutlineElementLabel(element);
    const isPrimary = primaryId === element.id;
    const rowSelected = selectedIds.has(element.id);
    const dropZone = dropTarget?.rowId === element.id ? dropTarget.zone : null;
    const rowPaddingLeft = ROW_LEFT_PADDING + depth * ROW_INDENT;
    const guideLevels = Array.from({ length: depth }, (_, index) => index + 1);
    const rowToneClass = rowSelected
        ? isPrimary
            ? "bg-primary/25 text-fg ring-1 ring-primary/45"
            : "bg-primary/[0.12] text-fg"
        : dropZone === "inside"
          ? "bg-primary/[0.14] text-fg ring-1 ring-primary/60"
          : "text-fg-muted hover:bg-fill-subtle";
    const typeName = isRoot ? undefined : element.type.replace(/^nl\./, "");
    const renaming = renamingId === element.id;

    // The eye and the lock: always shown while they are on (they are the row's state), and over the
    // end of the row on hover otherwise - drawn on top, so the name never reflows as the pointer
    // moves down the list.
    const flagButtonClass =
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg-subtle transition hover:bg-fill hover:text-fg disabled:cursor-not-allowed disabled:opacity-25";

    return (
        <div className="relative select-none" data-outline-row data-outline-row-id={element.id}>
            {guideLevels.map(level => {
                const x = ROW_LEFT_PADDING + level * ROW_INDENT - GUIDE_OFFSET;
                return (
                    <span
                        key={level}
                        aria-hidden
                        className="pointer-events-none absolute bottom-0 top-0 w-px bg-fill-subtle"
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
                data-outline-row-bar
                className={`group/outline-row relative flex min-h-[26px] items-center gap-1 rounded-md text-xs pr-1 transition-[background-color,box-shadow,color,opacity] duration-150 ease-out ${rowToneClass} ${
                    hiddenInGame || hiddenInEditor ? "opacity-60" : ""
                }`}
                style={{ paddingLeft: rowPaddingLeft, opacity: draggingIds.has(element.id) ? 0.35 : undefined }}
                onContextMenu={e => onRowContextMenu(element, e)}
                onMouseEnter={() => onHover(element.id)}
                onMouseLeave={() => onHover(null)}
                onClick={e => {
                    if (!renaming) {
                        onSelect(element.id, e);
                    }
                }}
                onDoubleClick={e => {
                    e.stopPropagation();
                    if (renameEnabled && !isRoot) {
                        onStartRename(element);
                    }
                }}
                {...attributes}
                {...listeners}
                // The row is a drag source to dnd-kit, not a button: it keeps its own tab stops.
                tabIndex={-1}
                role="treeitem"
                aria-selected={rowSelected}
                aria-expanded={hasChildren ? expanded : undefined}
            >
                {dropZone === "before" || dropZone === "after" ? (
                    <span
                        aria-hidden
                        className={`pointer-events-none absolute right-1 z-10 h-0.5 rounded-full bg-primary ${dropZone === "before" ? "-top-px" : "-bottom-px"}`}
                        style={{ left: rowPaddingLeft }}
                    />
                ) : null}
                <button
                    type="button"
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-fill-subtle hover:text-fg disabled:pointer-events-none disabled:opacity-25"
                    disabled={!hasChildren}
                    aria-label={expanded ? t("common.collapse") : t("common.expand")}
                    onClick={e => {
                        e.stopPropagation();
                        if (hasChildren) {
                            toggleCollapsed(element.id);
                        }
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
                <OutlineRowIcon element={element} />
                {renaming ? (
                    <OutlineRenameField element={element} onFinish={name => onFinishRename(element, name)} />
                ) : (
                    <button
                        type="button"
                        className={`flex min-w-0 flex-1 items-center gap-1.5 py-0.5 text-left ${isPrimary ? "font-medium" : ""}`}
                        data-tip={hiddenInGame ? `${typeName ?? label} · ${t("widgetChrome.outline.hiddenInGame")}` : typeName}
                    >
                        <span className={`min-w-0 truncate ${hiddenInGame ? "italic" : ""} ${isLinkedUIComponentElement(element) ? "text-primary" : ""}`}>{label}</span>
                    </button>
                )}
                {!isRoot && !isComponentFrame ? (
                    <div
                        className={`flex shrink-0 items-center ${
                            hiddenInEditor || locked
                                ? ""
                                : "pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 rounded-md bg-surface-raised opacity-0 shadow-sm group-hover/outline-row:pointer-events-auto group-hover/outline-row:opacity-100 group-has-[:focus-visible]/outline-row:pointer-events-auto group-has-[:focus-visible]/outline-row:opacity-100"
                        }`}
                    >
                        {!hiddenInEditor || locked ? (
                            <button
                                type="button"
                                className={`${flagButtonClass} ${locked ? "text-fg" : ""}`}
                                aria-label={locked ? t("widgetChrome.outline.unlock") : t("widgetChrome.outline.lock")}
                                data-tip={locked ? t("widgetChrome.outline.unlock") : t("widgetChrome.outline.lock")}
                                aria-pressed={locked}
                                onPointerDown={e => e.stopPropagation()}
                                onClick={e => onToggleLocked(element, e)}
                            >
                                {locked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
                            </button>
                        ) : null}
                        {!locked || hiddenInEditor ? (
                            <button
                                type="button"
                                className={`${flagButtonClass} ${hiddenInEditor ? "text-fg" : ""}`}
                                aria-label={hiddenInEditor ? t("widgetChrome.outline.showInEditor") : t("widgetChrome.outline.hideInEditor")}
                                data-tip={hiddenInEditor ? t("widgetChrome.outline.showInEditor") : t("widgetChrome.outline.hideInEditor")}
                                aria-pressed={hiddenInEditor}
                                onPointerDown={e => e.stopPropagation()}
                                onClick={e => onToggleHiddenInEditor(element, e)}
                            >
                                {hiddenInEditor ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                            </button>
                        ) : null}
                    </div>
                ) : null}
            </div>
            {hasChildren && expanded ? (
                <OutlineSubtree {...props} parentId={element.id} depth={depth + 1} />
            ) : null}
        </div>
    );
}

function OutlineRowIcon({ element }: { element: UIElement }) {
    const { icon: Icon, component } = resolveOutlineRowIcon(element);
    return <Icon aria-hidden className={`h-3.5 w-3.5 shrink-0 ${component ? "text-primary" : "text-fg-subtle"}`} />;
}

export function OutlineDragPreview({ element, count }: { element: UIElement; count: number }) {
    const { t } = useTranslation();
    const label = count > 1 ? t("widgetChrome.outline.draggingCount", { count }) : getOutlineElementLabel(element);
    return (
        <div className="flex h-[26px] min-w-32 max-w-72 items-center gap-1.5 rounded-md border border-primary/35 bg-surface-raised/90 px-2 text-xs text-fg opacity-90 shadow-lg shadow-black/30">
            {count > 1 ? null : <OutlineRowIcon element={element} />}
            <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
        </div>
    );
}

export function OutlineSubtree(props: OutlineRowBase & { parentId: string; depth: number }) {
    const parent = props.document.elements[props.parentId];
    if (!parent) {
        return null;
    }
    return (
        <div data-outline-subtree-parent-id={props.parentId}>
            {getOutlineVisualChildren(parent).map(childId => {
                const child = props.document.elements[childId];
                return child ? <OutlineRow key={childId} {...props} element={child} depth={props.depth} /> : null;
            })}
        </div>
    );
}
