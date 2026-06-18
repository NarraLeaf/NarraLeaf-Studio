import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState, useRef } from "react";
import { flushSync } from "react-dom";
import Selecto from "react-selecto";
import Moveable, { type OnClick, type OnClickGroup } from "react-moveable";
import { ViewportTransform, clientToSurface, Rect2D } from "../geometry";
import { isHTMLElement } from "./utils";
import { useSurfaceInteractionEvents } from "./useSurfaceInteractionEvents";
import { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import { isUIElementSelection } from "@/lib/workspace/services/ui/UIStore";
import { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UISurface } from "@shared/types/ui-editor/document";
import type { ActiveSnapGuides } from "@/lib/ui-editor/snapping/types";
import type { UITool } from "@/lib/ui-editor/editor/types";
import { PRIMARY_OUTLINE_STRONG, PRIMARY_OUTLINE_WEAK, SELECTABLE_TARGET } from "./constants";
import type { InsertPreview, InsertToolDragState } from "./useSurfaceInteractionEvents";
import { useTransformController } from "./controllers/TransformController";
import { useImageCropController } from "./controllers/ImageCropController";
import { useWidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { useUIDocumentRevision } from "@/lib/ui-editor/hooks/useUIDocumentRevision";
import { SnapGuidesOverlay } from "@/lib/ui-editor/snapping/SnapGuidesOverlay";
import {
    isUiContainerDrillLockHit,
    markSuppressNextCanvasWidgetDoubleClick,
    promoteHitToDirectChildOfSurfaceRoot,
    shouldPromoteToSurfaceRootChild,
} from "./containerDrillSelection";
import {
    getSingleSelectedElementId,
    isMoveableInteractionTarget,
} from "./surfaceInlineTextEditActivation";
import { beginInlineTextEdit, isInlineTextEditableElement } from "./inlineTextEdit";
import { beginImageCropEdit } from "./imageCropEdit";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import type { FloatingToolbarItem } from "@/lib/ui-editor/widget-modules/types";
import { resolveFloatingToolbarPosition } from "./floatingToolbarPosition";

function InsertPreviewOverlay({ preview, viewport }: { preview: InsertPreview; viewport: ViewportTransform }) {
    const x = Math.min(preview.startX, preview.currentX);
    const y = Math.min(preview.startY, preview.currentY);
    const width = Math.abs(preview.currentX - preview.startX);
    const height = Math.abs(preview.currentY - preview.startY);

    // Convert surface coordinates to viewport(screen) coordinates.
    // The canvas transform is: translate(offsetX, offsetY) scale(scale).
    // Therefore: viewport = surface * scale + offset.
    const screenX = x * viewport.scale + viewport.offsetX;
    const screenY = y * viewport.scale + viewport.offsetY;
    const screenWidth = width * viewport.scale;
    const screenHeight = height * viewport.scale;

    return (
        <div
            className="absolute pointer-events-none border-2 border-dashed border-primary bg-primary/10 rounded-none"
            style={{
                left: screenX,
                top: screenY,
                width: screenWidth,
                height: screenHeight,
            }}
        >
            <div className="absolute -top-6 left-0 text-[10px] text-primary font-mono whitespace-nowrap">
                {Math.round(width)} × {Math.round(height)}
            </div>
        </div>
    );
}

type Props = {
    surfaceId: string;
    surface: UISurface;
    containerRef: React.RefObject<HTMLElement | null>;
    stateService: UIEditorStateService;
    documentService: UIDocumentService;
    showOutlines?: boolean;
    openSurfaceEditor?: (surfaceId: string) => void;
};
export function UIEditorInteractionLayer({
    surfaceId,
    surface,
    containerRef,
    stateService,
    documentService,
    showOutlines = true,
    openSurfaceEditor,
}: Props) {
    const [selection, setSelection] = useState(stateService.getSelection());
    const previousSelectedTargets = useRef<HTMLElement[]>([]);
    const outlineCache = useRef<WeakMap<HTMLElement, { outline?: string; outlineOffset?: string }>>(new WeakMap());
    const documentRevision = useUIDocumentRevision(documentService);
    type MoveableInstance = React.ElementRef<typeof Moveable>;
    const moveableRef = useRef<MoveableInstance | null>(null);

    // Insert mode drag-to-create state
    const [insertPreview, setInsertPreview] = useState<InsertPreview | null>(null);
    const insertPreviewRef = useRef<InsertPreview | null>(null);
    const insertState = useRef<InsertToolDragState | null>(null);

    const [snapGuides, setSnapGuidesState] = useState<ActiveSnapGuides | null>(() => stateService.getSnapGuides());
    const altKeyRef = useRef(false);

    const scheduleMoveableRectUpdate = useCallback(() => {
        // Keep the overlay controller aligned after DOM/layout updates.
        requestAnimationFrame(() => {
            moveableRef.current?.updateRect?.();
        });
    }, []);

    useEffect(() => {
        const unsubscribe = stateService.on("selectionChanged", setSelection);
        return () => unsubscribe();
    }, [stateService]);


    const [tool, setTool] = useState<UITool>(stateService.getTool());
    const [viewport, setViewport] = useState<ViewportTransform>(stateService.getViewportTransform());

    useEffect(() => {
        const unsubscribe = stateService.on("toolChanged", setTool);
        return () => unsubscribe();
    }, [stateService]);

    useEffect(() => {
        const unsubscribe = stateService.on("viewportChanged", setViewport);
        return () => unsubscribe();
    }, [stateService]);

    useEffect(() => {
        setSnapGuidesState(stateService.getSnapGuides());
        return stateService.on("snapGuidesChanged", setSnapGuidesState);
    }, [stateService]);

    useEffect(() => {
        const isAltKey = (e: KeyboardEvent) => e.key === "Alt" || e.code === "AltLeft" || e.code === "AltRight";

        const down = (e: KeyboardEvent) => {
            if (isAltKey(e)) {
                altKeyRef.current = true;
            }
        };
        const up = (e: KeyboardEvent) => {
            if (isAltKey(e)) {
                altKeyRef.current = false;
            }
        };
        const resetAlt = () => {
            altKeyRef.current = false;
        };
        window.addEventListener("keydown", down);
        window.addEventListener("keyup", up);
        window.addEventListener("blur", resetAlt);
        document.addEventListener("visibilitychange", resetAlt);
        return () => {
            window.removeEventListener("keydown", down);
            window.removeEventListener("keyup", up);
            window.removeEventListener("blur", resetAlt);
            document.removeEventListener("visibilitychange", resetAlt);
        };
    }, []);

    // containerRef.current is often null on the first render (sibling viewport not committed yet).
    // Reading it only during render leaves Selecto's dragContainer stuck on the pointer-events-none
    // overlay parent, so mousedown never reaches the listener. Sync after layout so Selecto/Moveable
    // attach to the real viewport.
    const [surfaceElement, setSurfaceElement] = useState<HTMLElement | null>(null);
    useLayoutEffect(() => {
        setSurfaceElement(containerRef.current);
    }, [containerRef]);

    const widgetRuntimeStore = useWidgetRuntimeStateStore();

    useEffect(() => {
        const root = containerRef.current;
        if (!root || !widgetRuntimeStore) {
            return undefined;
        }
        const down = (e: PointerEvent) => {
            if (e.button !== 0) {
                return;
            }
            const t = e.target as HTMLElement | null;
            const el = t?.closest("[data-ui-element-id]") as HTMLElement | null;
            const id = el?.dataset.uiElementId ?? null;
            widgetRuntimeStore.setActivePointerTarget(id);
        };
        const up = () => widgetRuntimeStore.setActivePointerTarget(null);
        root.addEventListener("pointerdown", down, true);
        window.addEventListener("pointerup", up, true);
        window.addEventListener("pointercancel", up, true);
        return () => {
            root.removeEventListener("pointerdown", down, true);
            window.removeEventListener("pointerup", up, true);
            window.removeEventListener("pointercancel", up, true);
        };
    }, [containerRef, widgetRuntimeStore]);

    useEffect(() => {
        const root = containerRef.current;
        if (!root || !widgetRuntimeStore) {
            return undefined;
        }
        const focusIn = (e: FocusEvent) => {
            const t = e.target as HTMLElement | null;
            const el = t?.closest("[data-ui-element-id]") as HTMLElement | null;
            widgetRuntimeStore.setFocusedTarget(el?.dataset.uiElementId ?? null);
        };
        const focusOut = (e: FocusEvent) => {
            const next = e.relatedTarget as Node | null;
            if (next && root.contains(next)) {
                return;
            }
            widgetRuntimeStore.setFocusedTarget(null);
        };
        root.addEventListener("focusin", focusIn, true);
        root.addEventListener("focusout", focusOut, true);
        return () => {
            root.removeEventListener("focusin", focusIn, true);
            root.removeEventListener("focusout", focusOut, true);
        };
    }, [containerRef, widgetRuntimeStore]);

    // Resolve DOM nodes after commit: querySelector during render cannot see widgets inserted in the same commit.
    const [selectedTargets, setSelectedTargets] = useState<HTMLElement[]>([]);
    useLayoutEffect(() => {
        if (!isUIElementSelection(selection) || selection.data.surfaceId !== surfaceId || !surfaceElement) {
            setSelectedTargets([]);
            scheduleMoveableRectUpdate();
            return;
        }
        const ids = selection.data.elementIds;
        const next = ids
            .map(id => surfaceElement.querySelector(`[data-ui-element-id="${id}"]`))
            .filter(isHTMLElement);
        setSelectedTargets(prev => {
            if (prev.length === next.length && prev.every((el, i) => el === next[i])) {
                return prev;
            }
            return next;
        });
        // Defer: Moveable reads `targets` after this commit; avoid flushSync inside useLayoutEffect (React warning).
        scheduleMoveableRectUpdate();
    }, [selection, surfaceElement, surfaceId, documentRevision, scheduleMoveableRectUpdate]);

    const selectionData = isUIElementSelection(selection) ? selection.data : null;
    const selectionIds = selectionData?.elementIds ?? [];
    const primaryId = selectionData?.primaryId ?? selectionIds[selectionIds.length - 1];
    const isGroupSelection = selectionIds.length > 1;
    const transformLocks = useRef(0);
    const [selectionEnabled, setSelectionEnabled] = useState(true);
    const [interactionOverride, setInteractionOverride] = useState(() => stateService.getInteractionOverride());

    useEffect(() => {
        const unsub = stateService.on("interactionOverrideChanged", payload => {
            setInteractionOverride(payload.next);
        });
        return unsub;
    }, [stateService]);

    const inlineTextEditElementId =
        interactionOverride?.kind === "textEdit" && interactionOverride.surfaceId === surfaceId
            ? interactionOverride.elementId
            : null;
    const isInlineTextEditing =
        Boolean(inlineTextEditElementId) &&
        !isGroupSelection &&
        selectionIds.length === 1 &&
        selectionIds[0] === inlineTextEditElementId;
    const selectedSingleElementId =
        selectionData?.surfaceId === surfaceId && selectionIds.length === 1
            ? selectionIds[0] ?? null
            : null;
    const selectedSingleElement = selectedSingleElementId
        ? documentService.getDocument().elements[selectedSingleElementId]
        : null;
    const isInlineTextEditableSelection = isInlineTextEditableElement(selectedSingleElement);
    const floatingToolbarItems = useMemo<FloatingToolbarItem[]>(() => {
        if (!selectedSingleElement) {
            return [];
        }
        const module = widgetModuleRegistry.get(selectedSingleElement.type);
        return module?.createFloatingToolbarItems?.({
            element: selectedSingleElement,
            documentService,
            surfaceId,
            openSurfaceEditor,
        }) ?? [];
    }, [documentRevision, documentService, openSurfaceEditor, selectedSingleElement, surfaceId]);
    const hasFloatingToolbar = floatingToolbarItems.length > 0;
    const [floatingToolbarPosition, setFloatingToolbarPosition] = useState<{ left: number; top: number } | null>(null);

    const beginTransform = () => {
        transformLocks.current += 1;
        if (transformLocks.current === 1) {
            setSelectionEnabled(false);
        }
    };

    const endTransform = () => {
        transformLocks.current = Math.max(0, transformLocks.current - 1);
        if (transformLocks.current === 0) {
            setSelectionEnabled(true);
        }
    };

    useEffect(() => {
        previousSelectedTargets.current.forEach(target => {
            const cached = outlineCache.current.get(target);
            if (cached) {
                target.style.outline = cached.outline ?? "";
                target.style.outlineOffset = cached.outlineOffset ?? "";
                outlineCache.current.delete(target);
            }
        });

        if (showOutlines) {
            selectedTargets.forEach(target => {
                if (!outlineCache.current.has(target)) {
                    outlineCache.current.set(target, {
                        outline: target.style.outline,
                        outlineOffset: target.style.outlineOffset,
                    });
                }
                const elementId = target.dataset.uiElementId ?? "";
                target.style.outline = elementId === primaryId
                    ? `1px solid ${PRIMARY_OUTLINE_STRONG}`
                    : `1px dashed ${PRIMARY_OUTLINE_WEAK}`;
                target.style.outlineOffset = "0px";
            });
            previousSelectedTargets.current = selectedTargets;
        } else {
            previousSelectedTargets.current = [];
        }
    }, [selectedTargets, primaryId, showOutlines]);

    const updateFloatingToolbarPosition = useCallback(() => {
        if (!hasFloatingToolbar || selectedTargets.length !== 1 || !surfaceElement) {
            setFloatingToolbarPosition(null);
            return;
        }
        const targetRect = selectedTargets[0].getBoundingClientRect();
        const surfaceRect = surfaceElement.getBoundingClientRect();
        const next = resolveFloatingToolbarPosition({ targetRect, surfaceRect });
        setFloatingToolbarPosition(prev => {
            if (
                prev &&
                Math.abs(prev.left - next.left) < 0.25 &&
                Math.abs(prev.top - next.top) < 0.25
            ) {
                return prev;
            }
            return next;
        });
    }, [hasFloatingToolbar, selectedTargets, surfaceElement]);

    useLayoutEffect(() => {
        updateFloatingToolbarPosition();
    }, [
        updateFloatingToolbarPosition,
        viewport.scale,
        viewport.offsetX,
        viewport.offsetY,
        documentRevision,
    ]);

    useEffect(() => {
        if (!hasFloatingToolbar) {
            return undefined;
        }
        window.addEventListener("resize", updateFloatingToolbarPosition);
        return () => {
            window.removeEventListener("resize", updateFloatingToolbarPosition);
        };
    }, [hasFloatingToolbar, updateFloatingToolbarPosition]);

    useEffect(() => {
        if (!hasFloatingToolbar) {
            return undefined;
        }
        let frameId = 0;
        let disposed = false;
        const tick = () => {
            updateFloatingToolbarPosition();
            if (!disposed) {
                frameId = requestAnimationFrame(tick);
            }
        };
        frameId = requestAnimationFrame(tick);
        return () => {
            disposed = true;
            cancelAnimationFrame(frameId);
        };
    }, [hasFloatingToolbar, updateFloatingToolbarPosition]);

    useLayoutEffect(() => {
        moveableRef.current?.updateRect?.();
    }, [
        interactionOverride,
        selectedTargets,
        viewport.scale,
        viewport.offsetX,
        viewport.offsetY,
        showOutlines,
    ]);

    const handleSelectEnd = useCallback(
        (e: any) => {
            if (!surfaceElement) {
                return;
            }
            const targets = e.selected as HTMLElement[];
            const targetIds = targets
                .map(target => target.dataset.uiElementId)
                .filter(Boolean) as string[];
            if (targetIds.length === 0) {
                return;
            }

            const input = e.inputEvent as MouseEvent | PointerEvent | undefined;
            const multiIntent = Boolean(input?.shiftKey || input?.metaKey || input?.ctrlKey);
            const doc = documentService.getDocument();
            const prev = stateService.getSelection();

            let elementIds = targetIds;
            let primaryId = targetIds[targetIds.length - 1];

            if (
                !multiIntent &&
                targetIds.length === 1 &&
                isUIElementSelection(prev) &&
                prev.data.surfaceId === surfaceId &&
                prev.data.elementIds.length === 1
            ) {
                const hitId = targetIds[0];
                // `useSurfaceInteractionEvents` pointerdown also updates selection; drill lock is applied there too.
                // Selecto immediate click ends on mousedown (not mouseup); marquee ends on mouseup — only block mousedown.
                const immediateClickEnd = input?.type === "mousedown";
                if (
                    immediateClickEnd &&
                    !e.isDouble &&
                    isUiContainerDrillLockHit(doc, surfaceId, prev.data, hitId)
                ) {
                    return;
                }
                if (e.isDouble && isUiContainerDrillLockHit(doc, surfaceId, prev.data, hitId)) {
                    markSuppressNextCanvasWidgetDoubleClick();
                }
            }

            if (!multiIntent && targetIds.length === 1) {
                const hitId = targetIds[0];
                const selData = isUIElementSelection(prev) && prev.data.surfaceId === surfaceId ? prev.data : null;
                if (shouldPromoteToSurfaceRootChild(doc, selData, surfaceId, hitId)) {
                    const promoted = promoteHitToDirectChildOfSurfaceRoot(doc, surfaceId, hitId);
                    elementIds = [promoted];
                    primaryId = promoted;
                }
            }

            stateService.setUIElementSelection({
                editor: "ui",
                surfaceId,
                elementIds,
                primaryId,
            });
        },
        [documentService, stateService, surfaceElement, surfaceId],
    );

    const isMoveableControlTarget = useCallback((target: Element | null | undefined) => {
        return isMoveableInteractionTarget(target);
    }, []);

    const isTargetInsideSelection = useCallback(
        (target: Element | null | undefined) => {
            if (!target) {
                return false;
            }
            return selectedTargets.some(selected => selected.contains(target));
        },
        [selectedTargets],
    );

    const handleSelectionDragStart = useCallback(
        (e: any) => {
            const eventTarget = e.inputEvent?.target as Element | null;
            if (isMoveableControlTarget(eventTarget)) {
                return false;
            }
            if (isTargetInsideSelection(eventTarget)) {
                return false;
            }
        },
        [isMoveableControlTarget, isTargetInsideSelection],
    );
    const panState = useRef<{
        active: boolean;
        startX: number;
        startY: number;
        startOffsetX: number;
        startOffsetY: number;
    }>({ active: false, startX: 0, startY: 0, startOffsetX: 0, startOffsetY: 0 });

    // Helper to convert client coords to surface coords
    const clientToSurfaceCoords = useCallback((clientX: number, clientY: number) => {
        if (!surfaceElement) return { x: 0, y: 0 };
        const rect = surfaceElement.getBoundingClientRect();
        const containerRect: Rect2D = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        return clientToSurface({ x: clientX, y: clientY }, viewport, containerRect);
    }, [surfaceElement, viewport]);

    const insertSnapEnabled = useCallback(() => stateService.getSmartSnapEnabled(), [stateService]);
    const insertSnapSuspended = useCallback(() => altKeyRef.current, []);
    const transformSnapSuspended = useCallback(() => altKeyRef.current, []);

    useSurfaceInteractionEvents({
        surfaceElement,
        surfaceId,
        surface,
        tool,
        viewport,
        selectionData,
        clientToSurfaceCoords,
        setInsertPreview,
        insertPreviewRef,
        insertStateRef: insertState,
        panStateRef: panState,
        documentService,
        stateService,
        insertSnapEnabled,
        insertSnapSuspended,
    });

    const transformController = useTransformController({
        documentService,
        selectionIds,
        selectedTargets,
        isGroupSelection,
        viewportScale: viewport.scale,
        scheduleMoveableRectUpdate,
        beginTransform,
        endTransform,
        inlineTextEditElementId,
        surfaceId,
        surfaceDesignSize: surface.designSize,
        stateService,
        snapSuspended: transformSnapSuspended,
    });
    const imageCropController = useImageCropController({
        documentService,
        stateService,
        selectedTargets,
        viewportScale: viewport.scale,
        scheduleMoveableRectUpdate,
        beginTransform,
        endTransform,
        surfaceId,
    });

    const activeController = useMemo(() => {
        const candidates = [imageCropController, transformController]
            .filter(controller => controller.match && controller.targets.length > 0)
            .sort((a, b) => b.priority - a.priority);
        return candidates[0] ?? transformController;
    }, [imageCropController, transformController]);

    const handleMoveableInlineTextClick = useCallback(
        (event: OnClick | OnClickGroup) => {
            if (!event.isDouble || activeController.id !== "transform") {
                return;
            }
            const liveSelection = stateService.getSelection();
            const liveSelectionData = isUIElementSelection(liveSelection) ? liveSelection.data : null;
            const liveSelectedSingleElementId = getSingleSelectedElementId(liveSelectionData, surfaceId);
            if (!liveSelectedSingleElementId) {
                return;
            }
            const inputTarget = event.inputTarget as Element | null | undefined;
            if (inputTarget?.closest?.("textarea, input, [contenteditable='true']")) {
                return;
            }

            const element = documentService.getDocument().elements[liveSelectedSingleElementId];
            if (isInlineTextEditableElement(element)) {
                event.inputEvent?.preventDefault?.();
                event.inputEvent?.stopPropagation?.();
                beginInlineTextEdit(stateService, surfaceId, liveSelectedSingleElementId);
                return;
            }

            if (
                beginImageCropEdit({
                    documentService,
                    stateService,
                    surfaceId,
                    elementId: liveSelectedSingleElementId,
                    source: "moveableDoubleClick",
                })
            ) {
                event.inputEvent?.preventDefault?.();
                event.inputEvent?.stopPropagation?.();
            }
        },
        [activeController.id, documentService, stateService, surfaceId],
    );

    const SELECTO_CLASS_NAME = "narraleaf-selecto";

    const moveablePointerClass = isInlineTextEditing ? "pointer-events-none" : "pointer-events-auto";
    const isInlineTextMoveableTarget =
        activeController.id === "transform" && isInlineTextEditableSelection && !isInlineTextEditing;
    const moveableModeClass = activeController.id === "imageCrop"
        ? "narraleaf-moveable--crop"
        : isInlineTextMoveableTarget
          ? "narraleaf-moveable--inline-text-target"
          : "";

    return (
        <>
            {tool.kind === "select" && surfaceElement && (
                <div className="pointer-events-none absolute inset-0 z-[9]">
                    {snapGuides && snapGuides.surfaceId === surfaceId ? (
                        <SnapGuidesOverlay guides={snapGuides} viewport={viewport} />
                    ) : null}
                    <Selecto
                        className={SELECTO_CLASS_NAME}
                        container={surfaceElement}
                        rootContainer={surfaceElement}
                        dragContainer={surfaceElement}
                        boundContainer={surfaceElement}
                        checkOverflow={true}
                        selectableTargets={selectionEnabled ? [SELECTABLE_TARGET] : []}
                        hitRate={0}
                        selectByClick={true}
                        selectFromInside={false}
                        toggleContinueSelect={["shift"]}
                        ratio={0}
                        onSelectEnd={handleSelectEnd}
                        onDragStart={handleSelectionDragStart}
                    />
                    <Moveable
                        ref={moveableRef}
                        targets={activeController.targets}
                        container={surfaceElement}
                        flushSync={flushSync}
                        className={`narraleaf-moveable ${moveableModeClass} ${moveablePointerClass}`.trim()}
                        {...activeController.moveableProps}
                        clickable={isInlineTextMoveableTarget ? true : activeController.moveableProps.clickable}
                        onClick={handleMoveableInlineTextClick}
                        onClickGroup={handleMoveableInlineTextClick}
                    />
                    {hasFloatingToolbar && floatingToolbarPosition ? (
                        <div
                            className="pointer-events-auto absolute z-[10000] flex -translate-y-full overflow-hidden rounded-md border border-white/15 bg-[#080b10]/90 text-gray-200 shadow-lg shadow-black/30"
                            style={{
                                left: floatingToolbarPosition.left,
                                top: floatingToolbarPosition.top,
                            }}
                            onPointerDown={event => {
                                event.stopPropagation();
                            }}
                            onMouseDown={event => {
                                event.stopPropagation();
                            }}
                        >
                            {floatingToolbarItems.map((item, index) => {
                                const Icon = item.icon;
                                const label = item.label ?? item.tooltip ?? item.id;
                                return (
                                    <button
                                        key={item.id}
                                        type="button"
                                        className={`flex h-7 items-center justify-center text-xs transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 ${
                                            Icon ? "w-7" : "min-w-7 px-2"
                                        } ${
                                            index < floatingToolbarItems.length - 1 ? "border-r border-white/10" : ""
                                        }`}
                                        title={item.tooltip ?? label}
                                        aria-label={item.tooltip ?? label}
                                        disabled={item.disabled}
                                        onClick={event => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            if (!item.disabled) {
                                                item.onClick();
                                            }
                                        }}
                                    >
                                        {Icon ? <Icon className="h-4 w-4" /> : label}
                                    </button>
                                );
                            })}
                        </div>
                    ) : null}
                    {activeController.overlay ? (
                        <div className="pointer-events-auto">{activeController.overlay}</div>
                    ) : null}
                </div>
            )}

            {/* Insert mode preview overlay */}
            {tool.kind === "insert" && surfaceElement && snapGuides && snapGuides.surfaceId === surfaceId ? (
                <div className="pointer-events-none absolute inset-0 z-[9]">
                    <SnapGuidesOverlay guides={snapGuides} viewport={viewport} />
                </div>
            ) : null}
            {tool.kind === "insert" && insertPreview && (
                <InsertPreviewOverlay preview={insertPreview} viewport={viewport} />
            )}
        </>
    );
}
