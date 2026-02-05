import React, { useCallback, useEffect, useMemo, useState } from "react";
import { widgetModuleRegistry } from "../widget-modules/registryInstance";
import type { UIWidgetModule, DockerBarItem } from "../widget-modules/types";
import type { UIElement } from "@shared/types/ui-editor/document";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import { isUIElementSelection } from "@/lib/workspace/services/ui/UIStore";
import type { SelectionState } from "@/lib/workspace/services/ui/UIStore";

// ─── Props ──────────────────────────────────────────────────────────────────

type UIEditorDockerBarProps = {
    surfaceId: string;
    stateService: UIEditorStateService;
    documentService: UIDocumentService;
    onInsertElement: (type: string) => void;
};

// ─── Palette Mode (no selection) ────────────────────────────────────────────

function PaletteDockerBar({
    modules,
    onInsertElement,
}: {
    modules: UIWidgetModule[];
    onInsertElement: (type: string) => void;
}) {
    return (
        <div className="flex items-center gap-1">
            {modules.map((mod) => {
                const Icon = mod.icon;
                return (
                    <button
                        key={mod.type}
                        type="button"
                        className="flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs font-medium text-gray-300 transition-colors hover:bg-white/10 hover:text-white"
                        onClick={() => onInsertElement(mod.type)}
                        title={`Insert ${mod.displayName}`}
                    >
                        <Icon className="w-3.5 h-3.5" />
                        <span>{mod.displayName}</span>
                    </button>
                );
            })}
        </div>
    );
}

// ─── Element Docker Items Renderer ──────────────────────────────────────────

function DockerItemRenderer({ item }: { item: DockerBarItem }) {
    switch (item.kind) {
        case "button": {
            const Icon = item.icon;
            return (
                <button
                    type="button"
                    className={`flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs font-medium transition-colors ${
                        item.active
                            ? "bg-primary/20 text-white border border-primary/40"
                            : "text-gray-300 hover:bg-white/10 hover:text-white"
                    } ${item.disabled ? "opacity-50 cursor-not-allowed" : ""}`}
                    onClick={item.onClick}
                    disabled={item.disabled}
                    title={item.tooltip}
                >
                    {Icon && <Icon className="w-3.5 h-3.5" />}
                    {item.label && <span>{item.label}</span>}
                </button>
            );
        }

        case "select": {
            return (
                <div className="flex items-center gap-1.5 h-8" title={item.tooltip}>
                    {item.label && (
                        <span className="text-[11px] text-gray-500 select-none">{item.label}</span>
                    )}
                    <select
                        className="h-7 rounded-md border border-white/10 bg-white/5 px-2 text-xs text-gray-200 outline-none transition-colors focus:border-primary hover:border-white/20"
                        value={item.value}
                        onChange={(e) => {
                            const raw = e.target.value;
                            const numVal = Number(raw);
                            item.onChange(Number.isNaN(numVal) ? raw : numVal);
                        }}
                    >
                        {item.options.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                                {opt.label}
                            </option>
                        ))}
                    </select>
                </div>
            );
        }

        case "number": {
            return (
                <div className="flex items-center gap-1.5 h-8" title={item.tooltip}>
                    {item.label && (
                        <span className="text-[11px] text-gray-500 select-none">{item.label}</span>
                    )}
                    <input
                        type="number"
                        className="w-16 h-7 rounded-md border border-white/10 bg-white/5 px-2 text-xs text-gray-200 outline-none transition-colors focus:border-primary hover:border-white/20 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        value={item.value}
                        min={item.min}
                        max={item.max}
                        step={item.step}
                        onChange={(e) => {
                            const v = Number(e.target.value);
                            if (Number.isFinite(v)) {
                                item.onChange(v);
                            }
                        }}
                    />
                </div>
            );
        }

        case "separator": {
            return <div className="w-px h-5 bg-white/10 mx-1" />;
        }

        default:
            return null;
    }
}

function ElementDockerBar({
    items,
    moduleName,
}: {
    items: DockerBarItem[];
    moduleName: string;
}) {
    return (
        <div className="flex items-center gap-1">
            <span className="text-[11px] text-gray-500 font-medium mr-1 select-none">{moduleName}</span>
            <div className="w-px h-5 bg-white/10 mx-0.5" />
            {items.map((item) => (
                <DockerItemRenderer key={item.id} item={item} />
            ))}
        </div>
    );
}

// ─── Main Docker Bar ────────────────────────────────────────────────────────

export function UIEditorDockerBar({
    surfaceId,
    stateService,
    documentService,
    onInsertElement,
}: UIEditorDockerBarProps) {
    const modules = useMemo(() => widgetModuleRegistry.list(), []);
    const [selection, setSelection] = useState<SelectionState>(stateService.getSelection());
    const [docVersion, setDocVersion] = useState(0);

    useEffect(() => {
        const unsub = stateService.on("selectionChanged", setSelection);
        return unsub;
    }, [stateService]);

    useEffect(() => {
        const unsub = documentService.onDocumentChanged(() => {
            setDocVersion((v) => v + 1);
        });
        return unsub;
    }, [documentService]);

    // Resolve selected element(s)
    const selectedElement = useMemo<UIElement | null>(() => {
        if (!isUIElementSelection(selection)) return null;
        if (selection.data.surfaceId !== surfaceId) return null;
        const doc = documentService.getDocument();
        const primaryId = selection.data.primaryId ?? selection.data.elementIds[selection.data.elementIds.length - 1];
        if (!primaryId) return null;
        return doc.elements[primaryId] ?? null;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selection, surfaceId, documentService, docVersion]);

    // Resolve module for selected element
    const selectedModule = useMemo<UIWidgetModule | null>(() => {
        if (!selectedElement) return null;
        return widgetModuleRegistry.get(selectedElement.type) ?? null;
    }, [selectedElement]);

    // Build docker items for the selected element
    const dockerItems = useMemo<DockerBarItem[]>(() => {
        if (!selectedElement || !selectedModule?.createDockerBarItems) return [];
        return selectedModule.createDockerBarItems({
            element: selectedElement,
            documentService,
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedElement, selectedModule, documentService, docVersion]);

    const hasSelection = selectedElement !== null && dockerItems.length > 0;

    return (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center rounded-lg border border-white/15 bg-[#0b0d12]/90 backdrop-blur-sm px-2 py-1.5 shadow-lg shadow-black/30">
            {hasSelection ? (
                <ElementDockerBar
                    items={dockerItems}
                    moduleName={selectedModule?.displayName ?? "Element"}
                />
            ) : (
                <PaletteDockerBar
                    modules={modules}
                    onInsertElement={onInsertElement}
                />
            )}
        </div>
    );
}
