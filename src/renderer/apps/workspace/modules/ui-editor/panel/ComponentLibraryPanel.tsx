import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { ChevronDown, Component, Copy, Edit3, MoreVertical, Plus, Search, Trash2 } from "lucide-react";
import type { UIComponentDefinition } from "@shared/types/ui-editor/document";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UIRuntimeBridgeService } from "@/lib/workspace/services/ui-editor/UIRuntimeBridgeService";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import { ContextMenu, type ContextMenuDef, useContextMenu } from "@/lib/components/elements/ContextMenu";
import { createInputDialog } from "@/lib/components/dialogs";

type ComponentLibraryPanelProps = {
    documentService: UIDocumentService | null;
    runtimeBridge: UIRuntimeBridgeService | null;
    uiService: UIService | null;
    onOpenComponent: (component: UIComponentDefinition) => void;
};

function ComponentPreviewFrame({
    component,
    children,
}: {
    component: UIComponentDefinition;
    children: ReactNode;
}) {
    const frameRef = useRef<HTMLDivElement | null>(null);
    const [frameWidth, setFrameWidth] = useState(0);

    useLayoutEffect(() => {
        const node = frameRef.current;
        if (!node) {
            return undefined;
        }
        const update = () => setFrameWidth(Math.max(0, node.clientWidth));
        update();
        const observer = new ResizeObserver(update);
        observer.observe(node);
        return () => observer.disconnect();
    }, []);

    const root = component.elements[component.rootElementId];
    const designWidth = Math.max(1, component.previewMeta?.width ?? root?.layout.width ?? 160);
    const designHeight = Math.max(1, component.previewMeta?.height ?? root?.layout.height ?? 88);
    const frameHeight = 80;
    const scale = frameWidth > 0 ? Math.min(frameWidth / designWidth, frameHeight / designHeight) : 0;

    return (
        <div ref={frameRef} className="mt-2 h-20 w-full overflow-hidden rounded border border-edge bg-surface-canvas">
            <div className="relative h-full w-full">
                {scale > 0 ? (
                    <div
                        className="pointer-events-none absolute"
                        style={{
                            left: Math.max(0, (frameWidth - designWidth * scale) / 2),
                            top: Math.max(0, (frameHeight - designHeight * scale) / 2),
                            width: designWidth,
                            height: designHeight,
                            transform: `scale(${scale})`,
                            transformOrigin: "top left",
                        }}
                    >
                        {children}
                    </div>
                ) : null}
            </div>
        </div>
    );
}

export function ComponentLibraryPanel({
    documentService,
    runtimeBridge,
    uiService,
    onOpenComponent,
}: ComponentLibraryPanelProps) {
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
        const suggestedName = `Component ${components.length + 1}`;
        const name = inputDialog
            ? await inputDialog.show({
                  title: "Create Component",
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
    }, [components.length, documentService, inputDialog, onOpenComponent]);

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
                "Delete referenced components?",
                `${usageCount} linked instance${usageCount === 1 ? "" : "s"} will show as missing until unlinked or replaced.`,
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
    }, [documentService, uiService]);

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
                    label: "Open",
                    onClick: () => {
                        hideMenu();
                        onOpenComponent(component);
                    },
                },
                {
                    id: "rename",
                    label: "Rename...",
                    disabled: activeIds.length !== 1,
                    onClick: () => {
                        hideMenu();
                        void handleRename(component);
                    },
                },
                {
                    id: "duplicate",
                    label: activeIds.length > 1 ? "Duplicate selected" : "Duplicate",
                    onClick: () => {
                        hideMenu();
                        handleDuplicate(activeIds);
                    },
                },
                { id: "sep", separator: true },
                {
                    id: "delete",
                    label: activeIds.length > 1 ? "Delete selected" : "Delete",
                    onClick: () => {
                        hideMenu();
                        void handleDelete(activeIds);
                    },
                },
            ];
            setMenuItems(items);
            showMenu(event);
        },
        [handleDelete, handleDuplicate, handleRename, hideMenu, onOpenComponent, selectedIds, showMenu],
    );

    const selectedCount = selectedIds.size;

    return (
        <div
            ref={panelRef}
            className="shrink-0 border-t border-edge bg-surface-sunken"
            tabIndex={0}
            onKeyDown={event => {
                if (event.key === "Delete" && selectedIds.size > 0) {
                    event.preventDefault();
                    void handleDelete([...selectedIds]);
                }
            }}
        >
            <button
                type="button"
                className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs font-semibold text-fg hover:bg-fill-subtle"
                onClick={() => setOpen(value => !value)}
            >
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "" : "-rotate-90"}`} />
                <Component className="h-3.5 w-3.5" />
                <span className="min-w-0 flex-1">Component Library</span>
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
                                placeholder="Search"
                                className="h-8 w-full rounded-md border border-edge bg-fill-subtle pl-8 pr-2 text-xs text-fg outline-none focus:border-primary/60"
                            />
                        </div>
                        <button
                            type="button"
                            className="grid h-8 w-8 place-items-center rounded-md border border-edge text-fg-muted hover:bg-fill hover:text-white"
                            onClick={() => void handleCreate()}
                            title="Create component"
                            aria-label="Create component"
                        >
                            <Plus className="h-4 w-4" />
                        </button>
                    </div>

                    {selectedCount > 0 ? (
                        <div className="flex items-center gap-1 rounded-md border border-edge bg-fill-subtle p-1">
                            <span className="min-w-0 flex-1 px-1 text-2xs text-fg-muted">{selectedCount} selected</span>
                            <button
                                type="button"
                                className="grid h-7 w-7 place-items-center rounded text-fg-muted hover:bg-fill hover:text-white"
                                onClick={() => handleDuplicate([...selectedIds])}
                                title="Duplicate selected"
                                aria-label="Duplicate selected"
                            >
                                <Copy className="h-3.5 w-3.5" />
                            </button>
                            <button
                                type="button"
                                className="grid h-7 w-7 place-items-center rounded text-red-300 hover:bg-red-500/15 hover:text-red-100"
                                onClick={() => void handleDelete([...selectedIds])}
                                title="Delete selected"
                                aria-label="Delete selected"
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    ) : null}

                    <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                        {filteredComponents.length === 0 ? (
                            <div className="rounded-md border border-dashed border-edge px-3 py-4 text-center text-xs text-fg-subtle">
                                {components.length === 0 ? "Create a component or add selected elements from the canvas." : "No matches."}
                            </div>
                        ) : (
                            filteredComponents.map(component => {
                                const selected = selectedIds.has(component.id);
                                const root = component.elements[component.rootElementId];
                                const preview = runtimeBridge?.renderComponent({
                                    componentId: component.id,
                                    hostAdapter: { host: "app" },
                                    editorChrome: false,
                                });
                                return (
                                    <div
                                        key={component.id}
                                        className={`group rounded-md border px-2 py-2 transition ${
                                            selected
                                                ? "border-primary/60 bg-primary/10"
                                                : "border-edge bg-white/[0.025] hover:border-edge-strong hover:bg-fill-subtle"
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
                                                aria-label={`Select ${component.name}`}
                                            />
                                            <div
                                                className="min-w-0 flex-1 truncate text-left text-xs font-medium text-fg"
                                                title={component.name}
                                            >
                                                {component.name}
                                            </div>
                                            <button
                                                type="button"
                                                className="grid h-6 w-6 place-items-center rounded text-fg-muted opacity-0 hover:bg-fill hover:text-white group-hover:opacity-100"
                                                onClick={event => {
                                                    event.stopPropagation();
                                                    void handleRename(component);
                                                }}
                                                title="Rename"
                                                aria-label="Rename"
                                            >
                                                <Edit3 className="h-3.5 w-3.5" />
                                            </button>
                                            <button
                                                type="button"
                                                className="grid h-6 w-6 place-items-center rounded text-fg-muted hover:bg-fill hover:text-white"
                                                onClick={event => openContextMenu(event, component, { selectComponent: false })}
                                                title="Component actions"
                                                aria-label="Component actions"
                                            >
                                                <MoreVertical className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                        <ComponentPreviewFrame component={component}>{preview}</ComponentPreviewFrame>
                                        <div className="mt-1 text-2xs text-fg-subtle">
                                            {Math.round(component.previewMeta?.width ?? root?.layout.width ?? 0)}×
                                            {Math.round(component.previewMeta?.height ?? root?.layout.height ?? 0)}
                                            {documentService ? (
                                                <span className="ml-2">
                                                    {documentService.getComponentUsageCount(component.id)} refs
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
