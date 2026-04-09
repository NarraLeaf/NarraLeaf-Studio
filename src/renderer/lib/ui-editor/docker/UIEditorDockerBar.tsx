import React, { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { animate, motion, useMotionValue } from "motion/react";
import { listInsertPaletteModules } from "../widget-modules/insertPalette";
import { widgetModuleRegistry } from "../widget-modules/registryInstance";
import type {
    UIWidgetModule,
    DockerBarItem,
    DockerBarButton,
    DockerBarSelect,
    DockerBarNumberInput,
} from "../widget-modules/types";
import type { UIElement } from "@shared/types/ui-editor/document";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import { isUIElementSelection } from "@/lib/workspace/services/ui/UIStore";
import type { SelectionState } from "@/lib/workspace/services/ui/UIStore";
import type { UITool } from "../editor/types";
import { DeferredNumberInput } from "@/lib/components/inputs/DeferredNumberInput";
import { Select } from "@/lib/components/elements/Select";

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
    const stopPointerPropagation = useCallback(
        (event: React.SyntheticEvent) => {
            event.stopPropagation();
        },
        []
    );

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
                <div
                    className="flex items-center gap-1.5 h-8"
                    title={item.tooltip}
                    onPointerDown={stopPointerPropagation}
                    onPointerDownCapture={stopPointerPropagation}
                    onMouseDownCapture={stopPointerPropagation}
                >
                    {item.label && (
                        <span className="text-[11px] text-gray-500 select-none shrink-0">{item.label}</span>
                    )}
                    {/* Fixed-width shell + fullWidth trigger avoids a gap: min-w on Select alone
                        stretches the wrapper while the inner Button stayed content-sized. */}
                    <div className="w-[5.5rem] shrink-0">
                        <Select
                            options={item.options}
                            value={item.value}
                            onChange={(raw) => {
                                const numVal = Number(raw);
                                item.onChange(Number.isNaN(numVal) ? raw : numVal);
                            }}
                            size="sm"
                            placeholder="—"
                            fullWidth
                            portalMenu
                            menuPlacement="above"
                        />
                    </div>
                </div>
            );
        }

        case "number": {
            return (
                <div
                    className="flex items-center gap-1.5 h-8"
                    title={item.tooltip}
                    onPointerDown={stopPointerPropagation}
                    onPointerDownCapture={stopPointerPropagation}
                    onMouseDownCapture={stopPointerPropagation}
                >
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
                        inputProps={{
                            title: item.tooltip,
                            onMouseDown: stopPointerPropagation,
                            onPointerDown: stopPointerPropagation,
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

const MULTI_SELECT_MIXED_VALUE = "__multi-select-mixed__";

/** Experimental docker width easing: Penner easeOutExpo (0–1), compatible with Motion `ease`. */
function easeOutExpo(t: number): number {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return 1 - Math.pow(2, -10 * t);
}

const DOCKER_BAR_WIDTH_DURATION_S = 0.25;

/**
 * Experimental: animates shell width to match measured inner content (easeOutExpo via Motion).
 * Inner uses w-max; outer clips overflow during resize.
 */
function DockerBarAnimatedWidthShell({ children }: { children: React.ReactNode }) {
    const measureRef = useRef<HTMLDivElement>(null);
    const widthMv = useMotionValue(0);
    const widthBoundToMvRef = useRef(false);
    const [shellUsesMvWidth, setShellUsesMvWidth] = useState(false);
    const playbackRef = useRef<ReturnType<typeof animate> | null>(null);

    useLayoutEffect(() => {
        const el = measureRef.current;
        if (!el) {
            return;
        }

        const applyWidth = (next: number) => {
            if (!widthBoundToMvRef.current) {
                widthMv.set(next);
                widthBoundToMvRef.current = true;
                setShellUsesMvWidth(true);
                return;
            }
            playbackRef.current?.stop();
            playbackRef.current = animate(widthMv, next, {
                type: "tween",
                duration: DOCKER_BAR_WIDTH_DURATION_S,
                ease: easeOutExpo,
            });
        };

        const measure = () => {
            applyWidth(Math.ceil(el.getBoundingClientRect().width));
        };

        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => {
            ro.disconnect();
            playbackRef.current?.stop();
        };
    }, [widthMv]);

    return (
        <motion.div
            className={`inline-block overflow-hidden rounded-lg border border-white/15 bg-[#0b0d12]/90 backdrop-blur-sm shadow-lg shadow-black/30 ${shellUsesMvWidth ? "" : "w-max"}`}
            style={shellUsesMvWidth ? { width: widthMv } : undefined}
        >
            <div ref={measureRef} className="flex items-center px-2 py-1.5 w-max">
                {children}
            </div>
        </motion.div>
    );
}

function wrapMultiSelectItem(base: DockerBarItem, sources: DockerBarItem[]): DockerBarItem | null {
    switch (base.kind) {
        case "button": {
            const buttonSources = sources.filter((source) => source.kind === "button") as DockerBarButton[];
            if (buttonSources.length !== sources.length) {
                return null;
            }
            return {
                ...buttonSources[0],
                onClick: () => {
                    buttonSources.forEach((source) => {
                        if (!source.disabled) {
                            source.onClick();
                        }
                    });
                },
                disabled: buttonSources.every((source) => source.disabled),
            };
        }
        case "select": {
            const selectSources = sources.filter((source) => source.kind === "select") as DockerBarSelect[];
            if (selectSources.length !== sources.length) {
                return null;
            }
            const first = selectSources[0];
            const values = selectSources.map((source) => source.value);
            const uniformValue = values.every((value) => value === values[0]);
            const options = uniformValue
                ? first.options
                : [{ value: MULTI_SELECT_MIXED_VALUE, label: "—" }, ...first.options];
            return {
                ...first,
                value: uniformValue ? first.value : MULTI_SELECT_MIXED_VALUE,
                options,
                onChange: (nextValue: string | number) => {
                    if (nextValue === MULTI_SELECT_MIXED_VALUE) {
                        return;
                    }
                    selectSources.forEach((source) => {
                        source.onChange(nextValue);
                    });
                },
            };
        }
        case "number": {
            const numberSources = sources.filter((source) => source.kind === "number") as DockerBarNumberInput[];
            if (numberSources.length !== sources.length) {
                return null;
            }
            const first = numberSources[0];
            const values = numberSources.map((source) => source.value);
            const uniformValue = values.every((value) => value === values[0]);
            const placeholder = uniformValue ? first.placeholder : "—";
            const inputProps = { ...(first.inputProps ?? {}) };
            if (!inputProps.title) {
                inputProps.title = first.tooltip;
            }
            return {
                ...first,
                value: uniformValue ? first.value : Number.NaN,
                placeholder,
                inputProps,
                onChange: (nextValue: number) => {
                    numberSources.forEach((source) => {
                        source.onChange(nextValue);
                    });
                },
            };
        }
        case "separator": {
            return base;
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

function MultiSelectDockerBar({ items }: { items: DockerBarItem[] }) {
    return (
        <div className="flex items-center gap-1">
            <span className="text-[11px] text-gray-500 font-medium mr-1 select-none">Multiple</span>
            <div className="w-px h-5 bg-white/10 mx-0.5" />
            {items.map((item) => (
                <DockerItemRenderer key={`multi-${item.id}`} item={item} />
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
    const modules = useMemo(() => listInsertPaletteModules(), []);
    const [selection, setSelection] = useState<SelectionState>(stateService.getSelection());
    const [tool, setTool] = useState<UITool>(stateService.getTool());
    const [docVersion, setDocVersion] = useState(0);

    useEffect(() => {
        const unsub = stateService.on("selectionChanged", selection => {
            startTransition(() => {
                setSelection(selection);
            });
        });
        return unsub;
    }, [stateService]);

    useEffect(() => {
        const unsub = stateService.on("toolChanged", setTool);
        return unsub;
    }, [stateService]);

    useEffect(() => {
        const unsub = documentService.onDocumentChanged(() => {
            startTransition(() => {
                setDocVersion((v) => v + 1);
            });
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
    const selectedElements = useMemo<UIElement[]>(() => {
        if (!isUIElementSelection(selection)) return [];
        if (selection.data.surfaceId !== surfaceId) return [];
        const doc = documentService.getDocument();
        return selection.data.elementIds
            .map((elementId) => doc.elements[elementId])
            .filter((element): element is UIElement => Boolean(element));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selection, surfaceId, documentService, docVersion]);
    const selectedElement = selectedElements[selectedElements.length - 1] ?? null;

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

    const multiSelectItems = useMemo<DockerBarItem[]>(() => {
        if (selectedElements.length < 2) {
            return [];
        }
        const itemGroups = selectedElements.map((element) => {
            const mod = widgetModuleRegistry.get(element.type);
            if (!mod) {
                return null;
            }
            const context = { element, documentService };
            return (
                mod.createMultiSelectDockerBarItems?.(context) ??
                mod.createDockerBarItems?.(context) ??
                []
            );
        });
        if (itemGroups.some((group) => !group || group.length === 0)) {
            return [];
        }
        const [firstGroup, ...restGroups] = itemGroups as DockerBarItem[][];
        if (!firstGroup) {
            return [];
        }
        const aggregated: DockerBarItem[] = [];
        for (const baseItem of firstGroup) {
            const sources = [baseItem];
            let missing = false;
            for (const group of restGroups) {
                const match = group.find((other) => other.id === baseItem.id && other.kind === baseItem.kind);
                if (!match) {
                    missing = true;
                    break;
                }
                sources.push(match);
            }
            if (missing) {
                continue;
            }
            const wrapped = wrapMultiSelectItem(baseItem, sources);
            if (wrapped) {
                aggregated.push(wrapped);
            }
        }
        return aggregated;
    }, [selectedElements, documentService]);
    const showMultiSelectDocker = multiSelectItems.length > 0;

    // Show element docker bar only when there's a selection AND not in insert mode
    const showElementDocker = selectedElement !== null && dockerItems.length > 0 && tool.kind !== "insert";

    return (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20">
            <DockerBarAnimatedWidthShell>
                {showMultiSelectDocker ? (
                    <MultiSelectDockerBar items={multiSelectItems} />
                ) : showElementDocker ? (
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
            </DockerBarAnimatedWidthShell>
        </div>
    );
}
