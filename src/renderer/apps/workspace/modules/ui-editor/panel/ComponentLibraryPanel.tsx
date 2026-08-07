import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { ChevronDown, Component, Copy, Edit3, MoreVertical, Plus, Search, Trash2 } from "lucide-react";
import { getUIComponentLink, type UIComponentDefinition } from "@shared/types/ui-editor/document";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UIRuntimeBridgeService } from "@/lib/workspace/services/ui-editor/UIRuntimeBridgeService";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import { ContextMenu, type ContextMenuDef, useContextMenu } from "@/lib/components/elements/ContextMenu";
import { createInputDialog } from "@/lib/components/dialogs";
import { useTranslation } from "@/lib/i18n";
import { useFreezeGuard } from "../../../components/ui/freezeGuard";
import { LivePreviewFrame } from "./LivePreviewFrame";

type ComponentLibraryPanelProps = {
    documentService: UIDocumentService | null;
    runtimeBridge: UIRuntimeBridgeService | null;
    uiService: UIService | null;
    onOpenComponent: (component: UIComponentDefinition) => void;
};

const COMPONENT_PREVIEW_HEIGHT = 80;
const COMPONENT_PREVIEW_FRAME_CLASS =
    "mt-2 h-20 w-full overflow-hidden rounded-md border border-edge bg-surface-canvas";

function getComponentPreviewSize(component: UIComponentDefinition): { width: number; height: number } {
    const root = component.elements[component.rootElementId];
    return {
        width: Math.max(1, component.previewMeta?.width ?? root?.layout.width ?? 160),
        height: Math.max(1, component.previewMeta?.height ?? root?.layout.height ?? 88),
    };
}

/**
 * How many elements in the document link to each component, in one pass over the document.
 *
 * The per-component query is a full scan, and the card row asked it once per component on every
 * render - quadratic in a project whose page count and component count both grow with the template
 * store.
 */
function countComponentUsage(documentService: UIDocumentService | null): Record<string, number> {
    if (!documentService) {
        return {};
    }
    const counts: Record<string, number> = {};
    for (const element of Object.values(documentService.getDocument().elements)) {
        const link = getUIComponentLink(element);
        if (link) {
            counts[link.componentId] = (counts[link.componentId] ?? 0) + 1;
        }
    }
    return counts;
}

export function ComponentLibraryPanel({
    documentService,
    runtimeBridge,
    uiService,
    onOpenComponent,
}: ComponentLibraryPanelProps) {
    const { t, tn } = useTranslation();
    // The library is browsable while frozen - search, previews, opening a component for reading - and
    // only creating, renaming, duplicating and deleting are off.
    const freeze = useFreezeGuard();
    const panelRef = useRef<HTMLDivElement | null>(null);
    const [open, setOpen] = useState(true);
    const [components, setComponents] = useState<UIComponentDefinition[]>([]);
    const [query, setQuery] = useState("");
    const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
    const { menuState, showMenu, hideMenu } = useContextMenu();
    const [menuItems, setMenuItems] = useState<ContextMenuDef>([]);
    const inputDialog = useMemo(() => (uiService ? createInputDialog(uiService) : null), [uiService]);

    useEffect(() => {
        if (!documentService) {
            setComponents([]);
            return undefined;
        }
        const refresh = () => {
            const next = [...(documentService.getDocument().components ?? [])];
            setComponents(next);
            setSelectedIds(prev => {
                const available = new Set(next.map(component => component.id));
                const kept = [...prev].filter(id => available.has(id));
                return kept.length === prev.size ? prev : new Set(kept);
            });
        };
        refresh();
        return documentService.onDocumentChanged(refresh);
    }, [documentService]);

    const filteredComponents = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (!needle) {
            return components;
        }
        return components.filter(component => component.name.toLowerCase().includes(needle));
    }, [components, query]);

    const selectedComponents = useMemo(
        () => components.filter(component => selectedIds.has(component.id)),
        [components, selectedIds],
    );

    // `components` is a fresh array on every document change, so this recounts exactly as often as
    // the numbers can move and no more.
    const usageCounts = useMemo(() => countComponentUsage(documentService), [components, documentService]);

    useEffect(() => {
        if (!menuState.visible) {
            return undefined;
        }
        const closeOnWindowBlur = () => hideMenu();
        const closeOnFocusOutside = (event: FocusEvent) => {
            const target = event.target as HTMLElement | null;
            if (!target) {
                return;
            }
            if (panelRef.current?.contains(target)) {
                return;
            }
            if (target.closest('[data-context-menu="true"]')) {
                return;
            }
            hideMenu();
        };
        window.addEventListener("blur", closeOnWindowBlur);
        document.addEventListener("focusin", closeOnFocusOutside, true);
        return () => {
            window.removeEventListener("blur", closeOnWindowBlur);
            document.removeEventListener("focusin", closeOnFocusOutside, true);
        };
    }, [hideMenu, menuState.visible]);

    const toggleSelected = useCallback((componentId: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(componentId)) {
                next.delete(componentId);
            } else {
                next.add(componentId);
            }
            return next;
        });
    }, []);

    const handleCreate = useCallback(async () => {
        if (!documentService) {
            return;
        }
        const suggestedName = t("uiEditor.naming.component", { index: components.length + 1 });
        const name = inputDialog
            ? await inputDialog.show({
                  title: t("uiEditor.componentLibrary.createComponentTitle"),
                  initialValue: suggestedName,
                  required: true,
                  maxLength: 100,
              })
            : suggestedName;
        if (!name) {
            return;
        }
        const component = documentService.createEmptyComponent(name);
        onOpenComponent(component);
    }, [components.length, documentService, inputDialog, onOpenComponent, t]);

    const handleRename = useCallback(async (component: UIComponentDefinition) => {
        if (!documentService || !inputDialog) {
            return;
        }
        const name = await inputDialog.showRenameDialog(component.name, "component");
        if (name) {
            documentService.renameComponent(component.id, name);
        }
    }, [documentService, inputDialog]);

    const handleDuplicate = useCallback((componentIds: string[]) => {
        if (!documentService) {
            return;
        }
        for (const componentId of componentIds) {
            documentService.duplicateComponent(componentId);
        }
    }, [documentService]);

    const handleDelete = useCallback(async (componentIds: string[]) => {
        if (!documentService || componentIds.length === 0) {
            return;
        }
        const usageCount = componentIds.reduce(
            (sum, componentId) => sum + documentService.getComponentUsageCount(componentId),
            0,
        );
        if (usageCount > 0 && uiService) {
            const confirmed = await uiService.showConfirm(
                t("uiEditor.componentLibrary.deleteReferencedTitle"),
                tn("uiEditor.componentLibrary.deleteReferencedDetail", usageCount),
            );
            if (!confirmed) {
                return;
            }
        }
        documentService.deleteComponents(componentIds);
        setSelectedIds(prev => {
            const next = new Set(prev);
            componentIds.forEach(id => next.delete(id));
            return next;
        });
    }, [documentService, uiService, t, tn]);

    const openContextMenu = useCallback(
        (
            event: MouseEvent<HTMLButtonElement | HTMLDivElement>,
            component: UIComponentDefinition,
            options: { selectComponent?: boolean } = {},
        ) => {
            event.preventDefault();
            event.stopPropagation();
            const activeIds = selectedIds.has(component.id) ? [...selectedIds] : [component.id];
            if (options.selectComponent !== false && !selectedIds.has(component.id)) {
                setSelectedIds(new Set([component.id]));
            }
            const items: ContextMenuDef = [
                {
                    id: "open",
                    label: t("common.open"),
                    onClick: () => {
                        hideMenu();
                        onOpenComponent(component);
                    },
                },
                {
                    id: "rename",
                    label: t("uiEditor.componentLibrary.rename"),
                    ...freeze.menuRow(activeIds.length !== 1),
                    onClick: () => {
                        hideMenu();
                        void handleRename(component);
                    },
                },
                {
                    id: "duplicate",
                    label: activeIds.length > 1 ? t("uiEditor.componentLibrary.duplicateSelected") : t("common.duplicate"),
                    ...freeze.menuRow(),
                    onClick: () => {
                        hideMenu();
                        handleDuplicate(activeIds);
                    },
                },
                { id: "sep", separator: true },
                {
                    id: "delete",
                    label: activeIds.length > 1 ? t("uiEditor.componentLibrary.deleteSelected") : t("common.delete"),
                    ...freeze.menuRow(),
                    onClick: () => {
                        hideMenu();
                        void handleDelete(activeIds);
                    },
                },
            ];
            setMenuItems(items);
            showMenu(event);
        },
        [freeze, handleDelete, handleDuplicate, handleRename, hideMenu, onOpenComponent, selectedIds, showMenu, t],
    );

    const selectedCount = selectedIds.size;

    return (
        <div
            ref={panelRef}
            className="shrink-0 border-t border-edge bg-surface-sunken"
            tabIndex={0}
            // The Delete key is a third route to the same deletion the toolbar button and the
            // context-menu row both refuse while frozen; a keystroke has no control to grey out,
            // so `freeze.run` is what stops it. Measured before this: selecting a component and
            // pressing Delete ran the confirm dialog and left the component where it was.
            onKeyDown={freeze.run(event => {
                if (event.key === "Delete" && selectedIds.size > 0) {
                    event.preventDefault();
                    void handleDelete([...selectedIds]);
                }
            })}
        >
            <button
                type="button"
                className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs font-semibold text-fg hover:bg-fill-subtle"
                onClick={() => setOpen(value => !value)}
            >
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "" : "-rotate-90"}`} />
                <Component className="h-3.5 w-3.5" />
                <span className="min-w-0 flex-1">{t("uiEditor.componentLibrary.title")}</span>
                <span className="text-2xs font-normal text-fg-subtle">{components.length}</span>
            </button>
            {open ? (
                <div className="space-y-2 border-t border-edge p-2">
                    <div className="flex items-center gap-1">
                        <div className="relative min-w-0 flex-1">
                            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle" />
                            <input
                                value={query}
                                onChange={event => setQuery(event.target.value)}
                                placeholder={t("common.search")}
                                className="h-8 w-full rounded-md border border-edge bg-fill-subtle pl-8 pr-2 text-xs text-fg outline-none focus:border-primary/60"
                            />
                        </div>
                        <button
                            type="button"
                            className="grid h-8 w-8 place-items-center rounded-md border border-edge text-fg-muted hover:bg-fill hover:text-fg"
                            onClick={() => void handleCreate()}
                            {...freeze.writes(false, t("uiEditor.componentLibrary.createComponent"))}
                            aria-label={t("uiEditor.componentLibrary.createComponent")}
                        >
                            <Plus className="h-4 w-4" />
                        </button>
                    </div>

                    {selectedCount > 0 ? (
                        <div className="flex items-center gap-1 rounded-md border border-edge bg-fill-subtle p-1">
                            <span className="min-w-0 flex-1 px-1 text-2xs text-fg-muted">{t("uiEditor.componentLibrary.selectedCount", { count: selectedCount })}</span>
                            <button
                                type="button"
                                className="grid h-7 w-7 place-items-center rounded-md text-fg-muted hover:bg-fill hover:text-fg"
                                onClick={() => handleDuplicate([...selectedIds])}
                                {...freeze.writes(false, t("uiEditor.componentLibrary.duplicateSelected"))}
                                aria-label={t("uiEditor.componentLibrary.duplicateSelected")}
                            >
                                <Copy className="h-3.5 w-3.5" />
                            </button>
                            <button
                                type="button"
                                className="grid h-7 w-7 place-items-center rounded-md text-danger hover:bg-danger/15"
                                onClick={() => void handleDelete([...selectedIds])}
                                {...freeze.writes(false, t("uiEditor.componentLibrary.deleteSelected"))}
                                aria-label={t("uiEditor.componentLibrary.deleteSelected")}
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    ) : null}

                    <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                        {filteredComponents.length === 0 ? (
                            <div className="rounded-md border border-dashed border-edge px-3 py-4 text-center text-xs text-fg-subtle">
                                {components.length === 0 ? t("uiEditor.componentLibrary.emptyCreate") : t("uiEditor.componentLibrary.noMatches")}
                            </div>
                        ) : (
                            filteredComponents.map(component => {
                                const selected = selectedIds.has(component.id);
                                const root = component.elements[component.rootElementId];
                                const previewSize = getComponentPreviewSize(component);
                                const renderPreview = () =>
                                    runtimeBridge?.renderComponent({
                                        componentId: component.id,
                                        hostAdapter: { host: "app" },
                                        editorChrome: false,
                                    }) ?? null;
                                return (
                                    <div
                                        key={component.id}
                                        className={`group rounded-md border px-2 py-2 transition ${
                                            selected
                                                ? "border-primary/60 bg-primary/10"
                                                : "border-edge bg-fill-subtle hover:border-edge-strong hover:bg-fill"
                                        }`}
                                        onContextMenu={event => openContextMenu(event, component)}
                                        onClick={() => onOpenComponent(component)}
                                        onKeyDown={event => {
                                            if (event.target !== event.currentTarget) {
                                                return;
                                            }
                                            if (event.key === "Enter" || event.key === " ") {
                                                event.preventDefault();
                                                onOpenComponent(component);
                                            }
                                        }}
                                        role="button"
                                        tabIndex={0}
                                    >
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="checkbox"
                                                checked={selected}
                                                onChange={() => toggleSelected(component.id)}
                                                onClick={event => event.stopPropagation()}
                                                className="h-3.5 w-3.5 accent-primary"
                                                aria-label={t("uiEditor.componentLibrary.selectComponent", { name: component.name })}
                                            />
                                            <div
                                                className="min-w-0 flex-1 truncate text-left text-xs font-medium text-fg"
                                                title={component.name}
                                            >
                                                {component.name}
                                            </div>
                                            <button
                                                type="button"
                                                className="grid h-6 w-6 place-items-center rounded-md text-fg-muted opacity-0 hover:bg-fill hover:text-fg group-hover:opacity-100 disabled:cursor-not-allowed disabled:group-hover:opacity-40"
                                                onClick={event => {
                                                    event.stopPropagation();
                                                    void handleRename(component);
                                                }}
                                                // Renaming writes the component library, so it is
                                                // refused while frozen - as the create, duplicate
                                                // and delete buttons above already are, and as the
                                                // context menu's own Rename row is. This one card
                                                // shortcut was the way round all three: the dialog
                                                // opened, took a new name and kept the old one.
                                                {...freeze.writes(false, t("common.rename"))}
                                                aria-label={t("common.rename")}
                                            >
                                                <Edit3 className="h-3.5 w-3.5" />
                                            </button>
                                            <button
                                                type="button"
                                                className="grid h-6 w-6 place-items-center rounded-md text-fg-muted hover:bg-fill hover:text-fg"
                                                onClick={event => openContextMenu(event, component, { selectComponent: false })}
                                                title={t("uiEditor.componentLibrary.componentActions")}
                                                aria-label={t("uiEditor.componentLibrary.componentActions")}
                                            >
                                                <MoreVertical className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                        <LivePreviewFrame
                                            previewId={component.id}
                                            contentRevision={
                                                documentService?.getComponentContentRevision(component.id) ?? 0
                                            }
                                            render={renderPreview}
                                            designWidth={previewSize.width}
                                            designHeight={previewSize.height}
                                            frameHeight={COMPONENT_PREVIEW_HEIGHT}
                                            className={COMPONENT_PREVIEW_FRAME_CLASS}
                                        />
                                        <div className="mt-1 text-2xs text-fg-subtle">
                                            {Math.round(component.previewMeta?.width ?? root?.layout.width ?? 0)}×
                                            {Math.round(component.previewMeta?.height ?? root?.layout.height ?? 0)}
                                            {documentService ? (
                                                <span className="ml-2">
                                                    {t("uiEditor.componentLibrary.refs", { count: usageCounts[component.id] ?? 0 })}
                                                </span>
                                            ) : null}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            ) : null}
            <ContextMenu
                items={menuItems}
                position={menuState.position}
                visible={menuState.visible}
                onClose={hideMenu}
            />
        </div>
    );
}
