import React, { useEffect, useMemo, useState } from "react";
import { widgetModuleRegistry } from "../widget-modules/registryInstance";
import type { UIWidgetModule, DockerBarItem } from "../widget-modules/types";
import type { UIElement } from "@shared/types/ui-editor/document";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import { isUIElementSelection } from "@/lib/workspace/services/ui/UIStore";
import type { SelectionState } from "@/lib/workspace/services/ui/UIStore";
import type { UITool } from "../editor/types";
import { DeferredNumberInput } from "@/lib/components/inputs/DeferredNumberInput";

// Props
type UIEditorDockerBarProps = {
    surfaceId: string;
    stateService: UIEditorStateService;
    documentService: UIDocumentService;
};

// Palette Mode (no selection)
function PaletteDockerBar({
    modules,
    activeInsertType,
    onSelectType,
}: {
    modules: UIWidgetModule[];
    activeInsertType: string | null;
    onSelectType: (type: string) => void;
}) {
    return (
        <div className="flex items-center gap-1">
            {modules.map((mod) => {
                const Icon = mod.icon;
                const isActive = activeInsertType === mod.type;
                return (
                    <button
                        key={mod.type}
                        type="button"
                        className={`flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs font-medium transition-colors ${
                            isActive
                                ? "bg-primary/20 text-white border border-primary/40"
                                : "text-gray-300 hover:bg-white/10 hover:text-white border border-transparent"
                        }`}
                        onClick={() => onSelectType(mod.type)}
                        title={isActive ? `Drawing ${mod.displayName} - drag on canvas to create` : `Insert ${mod.displayName}`}
                    >
                        <Icon className="w-3.5 h-3.5" />
                        {/* <span>{mod.displayName}</span> */}
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
                    <DeferredNumberInput
                        value={item.value}
                        onCommit={item.onChange}
                        min={item.min}
                        max={item.max}
                        step={item.step}
                        disabled={item.disabled}
                        readOnly={item.readOnly}
                        inputClassName="w-16 h-7 rounded-md border border-white/10 bg-white/5 px-2 text-xs text-gray-200 outline-none transition-colors focus:border-primary hover:border-white/20 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        inputProps={{ title: item.tooltip }}
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
}: UIEditorDockerBarProps) {
    const modules = useMemo(() => widgetModuleRegistry.list(), []);
    const [selection, setSelection] = useState<SelectionState>(stateService.getSelection());
    const [tool, setTool] = useState<UITool>(stateService.getTool());
    const [docVersion, setDocVersion] = useState(0);

    useEffect(() => {
        const unsub = stateService.on("selectionChanged", setSelection);
        return unsub;
    }, [stateService]);

    useEffect(() => {
        const unsub = stateService.on("toolChanged", setTool);
        return unsub;
    }, [stateService]);

    useEffect(() => {
        const unsub = documentService.onDocumentChanged(() => {
            setDocVersion((v) => v + 1);
        });
        return unsub;
    }, [documentService]);

    // Active insert type (if in insert mode)
    const activeInsertType = tool.kind === "insert" ? tool.nodeType : null;

    // Handle selecting an insert type from the palette
    const handleSelectType = (type: string) => {
        if (activeInsertType === type) {
            // Toggle off: switch back to select mode
            stateService.setTool({ kind: "select" });
        } else {
            // Enter insert mode with this type
            stateService.setTool({ kind: "insert", nodeType: type });
        }
    };

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

    // Show element docker bar only when there's a selection AND not in insert mode
    const showElementDocker = selectedElement !== null && dockerItems.length > 0 && tool.kind !== "insert";

    return (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center rounded-lg border border-white/15 bg-[#0b0d12]/90 backdrop-blur-sm px-2 py-1.5 shadow-lg shadow-black/30">
            {showElementDocker ? (
                <ElementDockerBar
                    items={dockerItems}
                    moduleName={selectedModule?.displayName ?? "Element"}
                />
            ) : (
                <PaletteDockerBar
                    modules={modules}
                    activeInsertType={activeInsertType}
                    onSelectType={handleSelectType}
                />
            )}
        </div>
    );
}
