import React, { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { animate, motion, useMotionValue } from "motion/react";
import { listInsertPaletteEntries } from "../widget-modules/insertPalette";
import type { InsertPaletteEntry } from "../widget-modules/insertPalette";
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
import { MoreHorizontal } from "lucide-react";

// Props
type UIEditorDockerBarProps = {
    surfaceId: string;
    stateService: UIEditorStateService;
    documentService: UIDocumentService;
};

// Palette Mode (no selection)
function PaletteDockerBar({
    primaryEntries,
    overflowEntries,
    activeInsertType,
    onSelectType,
}: {
    primaryEntries: InsertPaletteEntry[];
    overflowEntries: InsertPaletteEntry[];
    activeInsertType: string | null;
    onSelectType: (type: string) => void;
}) {
    const overflowButtonRef = useRef<HTMLButtonElement | null>(null);
    const overflowMenuRef = useRef<HTMLDivElement | null>(null);
    const [overflowOpen, setOverflowOpen] = useState(false);
    const [overflowMenuStyle, setOverflowMenuStyle] = useState<React.CSSProperties>({});

    const stopPointerPropagation = useCallback((event: React.SyntheticEvent) => {
        event.stopPropagation();
    }, []);

    const closeOverflow = useCallback(() => {
        setOverflowOpen(false);
    }, []);

    const selectType = useCallback(
        (type: string) => {
            onSelectType(type);
            closeOverflow();
        },
        [closeOverflow, onSelectType],
    );

    useLayoutEffect(() => {
        if (!overflowOpen) {
            return;
        }

        const positionMenu = () => {
            const buttonRect = overflowButtonRef.current?.getBoundingClientRect();
            const menuRect = overflowMenuRef.current?.getBoundingClientRect();
            if (!buttonRect || !menuRect) {
                return;
            }

            const gap = 10;
            const padding = 8;
            const left = Math.min(
                Math.max(padding, buttonRect.left + buttonRect.width / 2 - menuRect.width / 2),
                window.innerWidth - menuRect.width - padding,
            );
            const top = Math.max(padding, buttonRect.top - menuRect.height - gap);
            setOverflowMenuStyle({
                position: "fixed",
                left,
                top,
                zIndex: 100,
            });
        };

        positionMenu();
        const raf = requestAnimationFrame(positionMenu);
        window.addEventListener("resize", positionMenu);
        window.addEventListener("scroll", positionMenu, true);
        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener("resize", positionMenu);
            window.removeEventListener("scroll", positionMenu, true);
        };
    }, [overflowOpen, overflowEntries.length]);

    useEffect(() => {
        if (!overflowOpen) {
            return;
        }

        const handleMouseDown = (event: MouseEvent) => {
            const target = event.target as Node | null;
            if (!target) {
                return;
            }
            if (overflowButtonRef.current?.contains(target) || overflowMenuRef.current?.contains(target)) {
                return;
            }
            closeOverflow();
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                closeOverflow();
            }
        };

        document.addEventListener("mousedown", handleMouseDown, true);
        document.addEventListener("keydown", handleKeyDown, true);
        return () => {
            document.removeEventListener("mousedown", handleMouseDown, true);
            document.removeEventListener("keydown", handleKeyDown, true);
        };
    }, [closeOverflow, overflowOpen]);

    useEffect(() => {
        if (overflowEntries.length === 0) {
            setOverflowOpen(false);
        }
    }, [overflowEntries.length]);

    const overflowActive = overflowEntries.some(entry => entry.module.type === activeInsertType);

    const overflowMenu = overflowOpen && overflowEntries.length > 0 ? (
        <div
            ref={overflowMenuRef}
            className="min-w-40 rounded-md border border-white/15 bg-[#1e1f22] py-1 shadow-lg shadow-black/30"
            style={overflowMenuStyle}
            onPointerDown={stopPointerPropagation}
            onMouseDown={stopPointerPropagation}
        >
            {overflowEntries.map(entry => {
                const mod = entry.module;
                const Icon = mod.icon;
                const isActive = activeInsertType === mod.type;
                return (
                    <button
                        key={mod.type}
                        type="button"
                        className={`flex h-8 w-full items-center gap-2 px-3 text-left text-xs transition-colors ${
                            isActive
                                ? "bg-primary/20 text-white"
                                : "text-gray-300 hover:bg-white/10 hover:text-white"
                        }`}
                        title={`Insert ${mod.displayName}`}
                        onClick={() => selectType(mod.type)}
                        onPointerDown={stopPointerPropagation}
                        onMouseDown={stopPointerPropagation}
                    >
                        <Icon className="h-3.5 w-3.5 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{mod.displayName}</span>
                    </button>
                );
            })}
        </div>
    ) : null;

    return (
        <div className="flex items-center gap-1">
            {primaryEntries.map((entry) => {
                const mod = entry.module;
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
                        onClick={() => selectType(mod.type)}
                        onPointerDown={stopPointerPropagation}
                        onMouseDown={stopPointerPropagation}
                        title={isActive ? `Drawing ${mod.displayName} - drag on canvas to create` : `Insert ${mod.displayName}`}
                    >
                        <Icon className="w-3.5 h-3.5" />
                        {/* <span>{mod.displayName}</span> */}
                    </button>
                );
            })}
            {overflowEntries.length > 0 ? (
                <>
                    <button
                        ref={overflowButtonRef}
                        type="button"
                        className={`flex h-8 items-center justify-center rounded-md border px-2.5 text-xs font-medium transition-colors ${
                            overflowOpen || overflowActive
                                ? "border-primary/40 bg-primary/20 text-white"
                                : "border-transparent text-gray-300 hover:bg-white/10 hover:text-white"
                        }`}
                        onClick={() => setOverflowOpen(open => !open)}
                        onPointerDown={stopPointerPropagation}
                        onMouseDown={stopPointerPropagation}
                        title="More insert elements"
                        aria-label="More insert elements"
                        aria-haspopup="menu"
                        aria-expanded={overflowOpen}
                    >
                        <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>
                    {typeof document === "undefined" ? overflowMenu : createPortal(overflowMenu, document.body)}
                </>
            ) : null}
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
                            placeholder="-"
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
                : [{ value: MULTI_SELECT_MIXED_VALUE, label: "-" }, ...first.options];
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
            const placeholder = uniformValue ? first.placeholder : "-";
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
    const surfaceKind = useMemo(() => {
        return documentService.getDocument().surfaces.find(surface => surface.id === surfaceId)?.kind;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [documentService, surfaceId]);
    const paletteEntries = useMemo(() => listInsertPaletteEntries(surfaceKind), [surfaceKind]);
    const primaryEntries = useMemo(
        () => paletteEntries.filter(entry => entry.placement === "primary"),
        [paletteEntries],
    );
    const overflowEntries = useMemo(
        () => paletteEntries.filter(entry => entry.placement === "overflow"),
        [paletteEntries],
    );
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
                        primaryEntries={primaryEntries}
                        overflowEntries={selectedElements.length === 0 ? overflowEntries : []}
                        activeInsertType={activeInsertType}
                        onSelectType={handleSelectType}
                    />
                )}
            </DockerBarAnimatedWidthShell>
        </div>
    );
}
