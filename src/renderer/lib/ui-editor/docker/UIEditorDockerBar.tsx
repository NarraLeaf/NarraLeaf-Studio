import React, { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, animate, motion, useMotionValue } from "motion/react";
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
import { isLinkedUIComponentElement, type UIElement } from "@shared/types/ui-editor/document";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import type { UIRuntimeBridgeService } from "@/lib/workspace/services/ui-editor/UIRuntimeBridgeService";
import { isUIElementSelection } from "@/lib/workspace/services/ui/UIStore";
import type { SelectionState } from "@/lib/workspace/services/ui/UIStore";
import type { UITool } from "../editor/types";
import { DeferredNumberInput } from "@/lib/components/inputs/DeferredNumberInput";
import { Select } from "@/lib/components/elements/Select";
import { Component, MoreHorizontal, Search, X } from "lucide-react";
import { isComponentEditorRootElement } from "@/lib/ui-editor/componentEditorRoot";
import { useTranslation } from "@/lib/i18n";

// Props
type UIEditorDockerBarProps = {
    surfaceId: string;
    stateService: UIEditorStateService;
    documentService: UIDocumentService;
    runtimeBridge?: UIRuntimeBridgeService | null;
    enableComponents?: boolean;
};

// Palette Mode (no selection)
function PaletteDockerBar({
    primaryEntries,
    overflowEntries,
    activeInsertType,
    componentsActive,
    onSelectType,
    onOpenComponents,
}: {
    primaryEntries: InsertPaletteEntry[];
    overflowEntries: InsertPaletteEntry[];
    activeInsertType: string | null;
    componentsActive: boolean;
    onSelectType: (type: string) => void;
    onOpenComponents?: () => void;
}) {
    const { t } = useTranslation();
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

    const overflowActive = componentsActive || overflowEntries.some(entry => entry.module.type === activeInsertType);
    const showComponentsEntry = Boolean(onOpenComponents);
    const showOverflowMenu = overflowEntries.length > 0 || showComponentsEntry;

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
        if (!showOverflowMenu) {
            setOverflowOpen(false);
        }
    }, [showOverflowMenu]);

    const overflowMenu = overflowOpen && showOverflowMenu ? (
        <div
            ref={overflowMenuRef}
            className="min-w-40 rounded-md border border-edge bg-surface-raised py-1 shadow-lg shadow-black/30"
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
                                ? "bg-primary/20 text-fg"
                                : "text-fg-muted hover:bg-fill hover:text-fg"
                        }`}
                        title={t("widgetChrome.docker.insert", { name: mod.displayName })}
                        onClick={() => selectType(mod.type)}
                        onPointerDown={stopPointerPropagation}
                        onMouseDown={stopPointerPropagation}
                    >
                        <Icon className="h-3.5 w-3.5 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{mod.displayName}</span>
                    </button>
                );
            })}
            {showComponentsEntry ? (
                <>
                    {overflowEntries.length > 0 ? <div className="my-1 h-px bg-fill" /> : null}
                    <button
                        type="button"
                        className={`flex h-8 w-full items-center gap-2 px-3 text-left text-xs transition-colors ${
                            componentsActive
                                ? "bg-primary/20 text-fg"
                                : "text-fg-muted hover:bg-fill hover:text-fg"
                        }`}
                        title={t("widgetChrome.docker.openComponentLibrary")}
                        onClick={() => {
                            onOpenComponents?.();
                            closeOverflow();
                        }}
                        onPointerDown={stopPointerPropagation}
                        onMouseDown={stopPointerPropagation}
                    >
                        <Component className="h-3.5 w-3.5 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{t("widgetChrome.docker.components")}</span>
                    </button>
                </>
            ) : null}
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
                                ? "bg-primary/20 text-fg border border-primary/40"
                                : "text-fg-muted hover:bg-fill hover:text-fg border border-transparent"
                        }`}
                        onClick={() => selectType(mod.type)}
                        onPointerDown={stopPointerPropagation}
                        onMouseDown={stopPointerPropagation}
                        title={isActive ? t("widgetChrome.docker.drawing", { name: mod.displayName }) : t("widgetChrome.docker.insert", { name: mod.displayName })}
                    >
                        <Icon className="w-3.5 h-3.5" />
                        {/* <span>{mod.displayName}</span> */}
                    </button>
                );
            })}
            {showOverflowMenu ? (
                <>
                    <button
                        ref={overflowButtonRef}
                        type="button"
                        className={`flex h-8 items-center justify-center rounded-md border px-2.5 text-xs font-medium transition-colors ${
                            overflowOpen || overflowActive
                                ? "border-primary/40 bg-primary/20 text-fg"
                                : "border-transparent text-fg-muted hover:bg-fill hover:text-fg"
                        }`}
                        onClick={() => setOverflowOpen(open => !open)}
                        onPointerDown={stopPointerPropagation}
                        onMouseDown={stopPointerPropagation}
                        title={t("widgetChrome.docker.moreInsertElements")}
                        aria-label={t("widgetChrome.docker.moreInsertElements")}
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
                            ? "bg-primary/20 text-fg border border-primary/40"
                            : "text-fg-muted hover:bg-fill hover:text-fg"
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
                        <span className="text-2xs text-fg-subtle select-none shrink-0">{item.label}</span>
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
                        <span className="text-2xs text-fg-subtle select-none">{item.label}</span>
                    )}
                    <DeferredNumberInput
                        value={item.value}
                        onCommit={item.onChange}
                        min={item.min}
                        max={item.max}
                        step={item.step}
                        disabled={item.disabled}
                        readOnly={item.readOnly}
                        inputClassName="w-16 h-7 rounded-md border border-edge bg-fill-subtle px-2 text-xs text-fg outline-none transition-colors focus:border-primary hover:border-edge-strong [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
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
            return <div className="w-px h-5 bg-fill mx-1" />;
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
            className={`inline-block overflow-hidden rounded-lg border border-edge bg-surface-overlay/90 backdrop-blur-sm shadow-lg shadow-black/30 ${shellUsesMvWidth ? "" : "w-max"}`}
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
            <span className="text-2xs text-fg-subtle font-medium mr-1 select-none">{moduleName}</span>
            <div className="w-px h-5 bg-fill mx-0.5" />
            {items.map((item) => (
                <DockerItemRenderer key={item.id} item={item} />
            ))}
        </div>
    );
}

function MultiSelectDockerBar({ items }: { items: DockerBarItem[] }) {
    const { t } = useTranslation();
    return (
        <div className="flex items-center gap-1">
            <span className="text-2xs text-fg-subtle font-medium mr-1 select-none">{t("widgetChrome.docker.multiple")}</span>
            <div className="w-px h-5 bg-fill mx-0.5" />
            {items.map((item) => (
                <DockerItemRenderer key={`multi-${item.id}`} item={item} />
            ))}
        </div>
    );
}

function ComponentPreview({
    componentId,
    runtimeBridge,
    width,
    height,
}: {
    componentId: string;
    runtimeBridge?: UIRuntimeBridgeService | null;
    width: number;
    height: number;
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

    const designWidth = Math.max(1, width);
    const designHeight = Math.max(1, height);
    const previewHeight = 104;
    const scale = frameWidth > 0 ? Math.min(frameWidth / designWidth, previewHeight / designHeight) : 0;
    const content = runtimeBridge?.renderComponent({
        componentId,
        hostAdapter: { host: "app" },
        editorChrome: false,
    });

    return (
        <div ref={frameRef} className="h-[104px] overflow-hidden rounded-md border border-edge bg-surface-canvas">
            <div className="relative h-full w-full">
                {content && scale > 0 ? (
                    <div
                        className="pointer-events-none absolute"
                        style={{
                            left: Math.max(0, (frameWidth - designWidth * scale) / 2),
                            top: Math.max(0, (previewHeight - designHeight * scale) / 2),
                            width: designWidth,
                            height: designHeight,
                            transform: `scale(${scale})`,
                            transformOrigin: "top left",
                        }}
                    >
                        {content}
                    </div>
                ) : null}
            </div>
        </div>
    );
}

function ComponentsLibraryModal({
    documentService,
    runtimeBridge,
    open,
    activeComponentId,
    onSelectComponent,
    onClose,
}: {
    documentService: UIDocumentService;
    runtimeBridge?: UIRuntimeBridgeService | null;
    open: boolean;
    activeComponentId: string | null;
    onSelectComponent: (componentId: string) => void;
    onClose: () => void;
}) {
    const { t } = useTranslation();
    const panelRef = useRef<HTMLDivElement | null>(null);
    const searchRef = useRef<HTMLInputElement | null>(null);
    const [query, setQuery] = useState("");

    const components = documentService.getDocument().components ?? [];
    const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (!needle) {
            return components;
        }
        return components.filter(component => component.name.toLowerCase().includes(needle));
    }, [components, query]);

    useEffect(() => {
        if (!open) {
            return undefined;
        }
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                onClose();
            }
        };
        document.addEventListener("keydown", handleKeyDown, true);
        return () => {
            document.removeEventListener("keydown", handleKeyDown, true);
        };
    }, [onClose, open]);

    useEffect(() => {
        if (!open) {
            setQuery("");
            return undefined;
        }
        const frame = window.requestAnimationFrame(() => {
            searchRef.current?.focus();
        });
        return () => window.cancelAnimationFrame(frame);
    }, [open]);

    const stopPointerPropagation = useCallback((event: React.SyntheticEvent) => {
        event.stopPropagation();
    }, []);

    return (
        <AnimatePresence>
            {open ? (
                <motion.div
                    key="component-library-modal"
                    className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center p-6"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18, ease: "easeOut" }}
                    onPointerDown={stopPointerPropagation}
                    onMouseDown={stopPointerPropagation}
                >
                    <motion.div
                        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.18, ease: "easeOut" }}
                        onClick={onClose}
                    />
                    <motion.div
                        ref={panelRef}
                        tabIndex={-1}
                        role="dialog"
                        aria-modal="true"
                        aria-label={t("widgetChrome.docker.componentLibrary")}
                        className="relative flex h-[min(760px,calc(100%-3rem))] w-[min(1100px,calc(100%-3rem))] flex-col overflow-hidden rounded-lg border border-edge bg-surface-overlay shadow-2xl"
                        initial={{ opacity: 0, scale: 0.96, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.98, y: 6 }}
                        transition={{ type: "tween", duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                        onPointerDown={stopPointerPropagation}
                        onMouseDown={stopPointerPropagation}
                    >
                        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-edge px-6">
                            <Component className="h-4 w-4 text-fg-muted" />
                            <div className="min-w-0 flex-1">
                                <div className="text-sm font-semibold text-fg">{t("widgetChrome.docker.componentLibrary")}</div>
                            </div>
                            <div className="relative w-72 max-w-[40vw]">
                                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle" />
                                <input
                                    ref={searchRef}
                                    value={query}
                                    onChange={event => setQuery(event.target.value)}
                                    placeholder={t("widgetChrome.docker.searchComponents")}
                                    className="h-8 w-full rounded-md border border-edge bg-fill-subtle pl-8 pr-2 text-xs text-fg outline-none focus:border-primary/60"
                                />
                            </div>
                            <button
                                type="button"
                                className="grid h-8 w-8 place-items-center rounded-md text-fg-muted hover:bg-fill hover:text-fg"
                                onClick={onClose}
                                title={t("common.close")}
                                aria-label={t("common.close")}
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                            {filtered.length === 0 ? (
                                <div className="flex h-full items-center justify-center text-sm text-fg-subtle">
                                    {components.length === 0 ? t("widgetChrome.docker.noComponents") : t("widgetChrome.docker.noMatchingComponents")}
                                </div>
                            ) : (
                                <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
                                    {filtered.map(component => {
                                        const root = component.elements[component.rootElementId];
                                        const active = activeComponentId === component.id;
                                        return (
                                            <button
                                                key={component.id}
                                                type="button"
                                                className={`rounded-md border p-2 text-left transition ${
                                                    active
                                                        ? "border-primary/70 bg-primary/15"
                                                        : "border-edge bg-fill-subtle hover:border-edge-strong hover:bg-fill"
                                                }`}
                                                onClick={() => {
                                                    onSelectComponent(component.id);
                                                    onClose();
                                                }}
                                            >
                                                <ComponentPreview
                                                    componentId={component.id}
                                                    runtimeBridge={runtimeBridge}
                                                    width={component.previewMeta?.width ?? root?.layout.width ?? 180}
                                                    height={component.previewMeta?.height ?? root?.layout.height ?? 104}
                                                />
                                                <div className="mt-2 truncate text-xs font-medium text-fg">{component.name}</div>
                                                <div className="text-2xs text-fg-subtle">
                                                    {Math.round(component.previewMeta?.width ?? root?.layout.width ?? 0)}×
                                                    {Math.round(component.previewMeta?.height ?? root?.layout.height ?? 0)}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </motion.div>
                </motion.div>
            ) : null}
        </AnimatePresence>
    );
}

// ─── Main Docker Bar ────────────────────────────────────────────────────────

export function UIEditorDockerBar({
    surfaceId,
    stateService,
    documentService,
    runtimeBridge,
    enableComponents = true,
}: UIEditorDockerBarProps) {
    const { t } = useTranslation();
    const surface = useMemo(() => {
        return documentService.getDocument().surfaces.find(candidate => candidate.id === surfaceId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [documentService, surfaceId]);
    const paletteEntries = useMemo(() => listInsertPaletteEntries(surface), [surface]);
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
    const [componentsLibraryOpen, setComponentsLibraryOpen] = useState(false);

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
    const activeComponentId = tool.kind === "insert" ? tool.componentId ?? null : null;

    // Handle selecting an insert type from the palette
    const handleSelectType = (type: string) => {
        if (activeInsertType === type && !activeComponentId) {
            // Toggle off: switch back to select mode
            stateService.setTool({ kind: "select" });
        } else {
            // Enter insert mode with this type
            stateService.setTool({ kind: "insert", nodeType: type });
        }
    };

    const handleSelectComponent = (componentId: string) => {
        if (activeComponentId === componentId) {
            stateService.setTool({ kind: "select" });
            return;
        }
        const component = documentService.getComponent(componentId);
        const root = component ? component.elements[component.rootElementId] : null;
        if (!component || !root) {
            return;
        }
        stateService.setTool({ kind: "insert", nodeType: root.type, componentId });
    };

    // Resolve selected element(s)
    const selectedElements = useMemo<UIElement[]>(() => {
        if (!isUIElementSelection(selection)) return [];
        if (selection.data.surfaceId !== surfaceId) return [];
        const doc = documentService.getDocument();
        return selection.data.elementIds
            .map((elementId) => doc.elements[elementId])
            .filter((element): element is UIElement =>
                Boolean(element) && element.type !== "nl.root" && !isComponentEditorRootElement(element)
            );
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
            stateService,
            surfaceId,
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedElement, selectedModule, documentService, docVersion]);

    const multiSelectItems = useMemo<DockerBarItem[]>(() => {
        if (selectedElements.length < 2) {
            return [];
        }
        if (selectedElements.some(element => isLinkedUIComponentElement(element))) {
            return [];
        }
        const itemGroups = selectedElements.map((element) => {
            const mod = widgetModuleRegistry.get(element.type);
            if (!mod) {
                return null;
            }
            const context = { element, documentService, stateService, surfaceId };
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
    const showElementDocker =
        selectedElement !== null &&
        !isLinkedUIComponentElement(selectedElement) &&
        dockerItems.length > 0 &&
        tool.kind !== "insert";

    return (
        <div className="pointer-events-none absolute inset-0 z-20">
            <div className="pointer-events-auto absolute bottom-3 left-1/2 -translate-x-1/2">
                <DockerBarAnimatedWidthShell>
                    {showMultiSelectDocker ? (
                        <MultiSelectDockerBar items={multiSelectItems} />
                    ) : showElementDocker ? (
                        <ElementDockerBar
                            items={dockerItems}
                            moduleName={selectedModule?.displayName ?? t("widgetChrome.docker.element")}
                        />
                    ) : (
                        <PaletteDockerBar
                            primaryEntries={primaryEntries}
                            overflowEntries={selectedElements.length === 0 ? overflowEntries : []}
                            activeInsertType={activeComponentId ? null : activeInsertType}
                            componentsActive={componentsLibraryOpen || Boolean(activeComponentId)}
                            onSelectType={handleSelectType}
                            onOpenComponents={enableComponents ? () => setComponentsLibraryOpen(true) : undefined}
                        />
                    )}
                </DockerBarAnimatedWidthShell>
            </div>
            <ComponentsLibraryModal
                documentService={documentService}
                runtimeBridge={runtimeBridge}
                open={componentsLibraryOpen}
                activeComponentId={activeComponentId}
                onSelectComponent={handleSelectComponent}
                onClose={() => setComponentsLibraryOpen(false)}
            />
        </div>
    );
}
