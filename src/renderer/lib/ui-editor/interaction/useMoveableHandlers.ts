import { useCallback, useRef, startTransition } from "react";
import type {
    OnDrag,
    OnDragEnd,
    OnDragGroup,
    OnDragGroupEnd,
    OnDragGroupStart,
    OnDragStart,
    OnResize,
    OnResizeEnd,
    OnResizeGroup,
    OnResizeGroupEnd,
    OnResizeGroupStart,
    OnResizeStart,
    OnRotate,
    OnRotateEnd,
    OnRotateGroup,
    OnRotateGroupEnd,
    OnRotateGroupStart,
    OnRotateStart,
} from "react-moveable";
import {
    ensureNormalizedLayout,
    computeResizeAxes,
    computeResizeAxis1D,
    computeResizeTranslate,
    buildTransform,
    applyFinalTransform,
    isHTMLElement,
} from "./utils";
import { applyLockedAspectToResizePreview } from "@/lib/ui-editor/layout/aspectRatioLock";
import { isUIElementFlowLayoutChild, type UILayout } from "@shared/types/ui-editor/document";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import {
    collectSnapGuideLines,
    splitSnapLinesToAxes,
    snapTranslateAxisAlignedRect,
    surfaceThresholdFromViewportPx,
    DEFAULT_SNAP_THRESHOLD_PX,
    unionAxisAlignedRects,
} from "@/lib/ui-editor/snapping";
import { getSurfaceAxisAlignedBoundsForLayout } from "@/lib/ui-editor/snapping/surfaceRect";
import { snapResizeLayoutInSurface } from "@/lib/ui-editor/snapping/resizeSnap";
import type { ActiveSnapGuides, SnapGuideLine, SmartSnapDetailSettings } from "@/lib/ui-editor/snapping/types";

type ResizeCacheEntry = {
    width?: number;
    height?: number;
    x?: number;
    y?: number;
};

type ResizeStartEntry = {
    clientX: number;
    clientY: number;
    layout: UILayout;
    direction: number[];
    /** Signed axis extents at delta=0; stabilizes locked aspect scale at drag start for all handles. */
    aspectInitialSx: number;
    aspectInitialSy: number;
};

function setImagePreviewFlipVars(target: HTMLElement, flipX: number, flipY: number) {
    target.style.setProperty("--nl-image-drag-flip-x", String(flipX));
    target.style.setProperty("--nl-image-drag-flip-y", String(flipY));
}

function clearImagePreviewFlipVars(target: HTMLElement) {
    target.style.removeProperty("--nl-image-drag-flip-x");
    target.style.removeProperty("--nl-image-drag-flip-y");
}

function hasResizeAxisCrossed(initialSignedSize: number | undefined, currentSignedSize: number | undefined) {
    if (initialSignedSize === undefined || currentSignedSize === undefined) {
        return false;
    }
    return initialSignedSize * currentSignedSize < 0;
}

function getResizeFlipBaseline(
    layout: UILayout | undefined,
    startData: ResizeStartEntry | undefined,
    axis: "x" | "y"
) {
    if (!layout) {
        return undefined;
    }
    if (layout.lockAspectRatio) {
        return axis === "x" ? layout.width : layout.height;
    }
    return axis === "x" ? startData?.aspectInitialSx : startData?.aspectInitialSy;
}

function isCurrentFlowLayoutChild(documentService: UIDocumentService, elementId: string): boolean {
    const document = documentService.getDocument();
    const element = document.elements[elementId];
    return element != null && isUIElementFlowLayoutChild(document, element);
}

/** Optional smart snap for UI Surface (guides + snapping during drag/resize). */
export type SmartSnapContext = {
    surfaceId: string;
    designSize: { width: number; height: number };
    isEnabled: () => boolean;
    /** When true (e.g. Alt held), snapping is skipped for this gesture. */
    isSuspended: () => boolean;
    setGuides: (guides: ActiveSnapGuides | null) => void;
    /** Elements excluded from snap targets (typically the current selection). */
    getExcludedElementIds: () => ReadonlySet<string>;
    /** Per-category snap lines when smart snap is enabled. */
    getDetailSettings: () => SmartSnapDetailSettings;
};

type MoveableHandlersConfig = {
    documentService: UIDocumentService;
    selectionIds: string[];
    selectedTargets: HTMLElement[];
    isGroupSelection: boolean;
    viewportScale: number;
    scheduleMoveableRectUpdate: () => void;
    beginTransform: () => void;
    endTransform: () => void;
    smartSnap?: SmartSnapContext;
};

export type MoveableHandlers = {
    handleDragStart: (e: OnDragStart) => void;
    handleDrag: (e: OnDrag) => void;
    handleDragEnd: (e: OnDragEnd) => void;
    handleDragGroupStart: (e: OnDragGroupStart) => void;
    handleDragGroup: (e: OnDragGroup) => void;
    handleDragGroupEnd: (e: OnDragGroupEnd) => void;
    handleResizeStart: (e: OnResizeStart) => void;
    handleResize: (e: OnResize) => void;
    handleResizeEnd: (e: OnResizeEnd) => void;
    handleResizeGroupStart: (e: OnResizeGroupStart) => void;
    handleResizeGroup: (e: OnResizeGroup) => void;
    handleResizeGroupEnd: (e: OnResizeGroupEnd) => void;
    handleRotateStart: (e: OnRotateStart) => void;
    handleRotate: (e: OnRotate) => void;
    handleRotateEnd: (e: OnRotateEnd) => void;
    handleRotateGroupStart: (e: OnRotateGroupStart) => void;
    handleRotateGroup: (e: OnRotateGroup) => void;
    handleRotateGroupEnd: (e: OnRotateGroupEnd) => void;
};

export function useMoveableHandlers({
    documentService,
    selectionIds,
    selectedTargets,
    isGroupSelection,
    viewportScale,
    scheduleMoveableRectUpdate,
    beginTransform,
    endTransform,
    smartSnap,
}: MoveableHandlersConfig): MoveableHandlers {
    const layoutCache = useRef<Map<string, UILayout>>(new Map());
    const dragDeltaCache = useRef<Map<string, [number, number]>>(new Map());
    const resizeCache = useRef<Map<string, ResizeCacheEntry>>(new Map());
    const resizeStartCache = useRef<Map<string, ResizeStartEntry>>(new Map());
    const rotateCache = useRef<Map<string, number>>(new Map());
    const snapLinesCacheRef = useRef<SnapGuideLine[]>([]);
    const performanceHintCache = useRef<
        Map<HTMLElement, { willChange: string; backfaceVisibility: string; transformOrigin: string }>
    >(new Map());

    const applyPerformanceHints = useCallback(() => {
        selectedTargets.forEach(target => {
            if (!performanceHintCache.current.has(target)) {
                performanceHintCache.current.set(target, {
                    willChange: target.style.willChange,
                    backfaceVisibility: target.style.backfaceVisibility,
                    transformOrigin: target.style.transformOrigin,
                });
            }
            target.style.willChange = "transform,left,top,width,height";
            target.style.backfaceVisibility = "hidden";
            if (!target.style.transformOrigin) {
                target.style.transformOrigin = "center center";
            }
        });
    }, [selectedTargets]);

    const clearPerformanceHints = useCallback(() => {
        performanceHintCache.current.forEach((cached, target) => {
            target.style.willChange = cached.willChange;
            target.style.backfaceVisibility = cached.backfaceVisibility;
            target.style.transformOrigin = cached.transformOrigin;
        });
        performanceHintCache.current.clear();
    }, []);

    const clearSmartSnapGuides = useCallback(() => {
        smartSnap?.setGuides(null);
    }, [smartSnap]);

    const rebuildSmartSnapCandidateLines = useCallback(() => {
        if (!smartSnap?.isEnabled() || smartSnap.isSuspended()) {
            snapLinesCacheRef.current = [];
            return;
        }
        const doc = documentService.getDocument();
        snapLinesCacheRef.current = collectSnapGuideLines(
            doc,
            smartSnap.surfaceId,
            smartSnap.getExcludedElementIds(),
            smartSnap.designSize,
            smartSnap.getDetailSettings(),
        );
    }, [documentService, smartSnap]);

    /**
     * If the gesture began while snap was suspended (e.g. Alt held), the cache was cleared and never rebuilt.
     * Re-fill when snap is active again so snapping works after releasing Alt mid-drag/resize.
     */
    const ensureSmartSnapCandidateLines = useCallback(() => {
        if (!smartSnap?.isEnabled() || smartSnap.isSuspended()) {
            return;
        }
        if (snapLinesCacheRef.current.length > 0) {
            return;
        }
        const doc = documentService.getDocument();
        snapLinesCacheRef.current = collectSnapGuideLines(
            doc,
            smartSnap.surfaceId,
            smartSnap.getExcludedElementIds(),
            smartSnap.designSize,
            smartSnap.getDetailSettings(),
        );
    }, [documentService, smartSnap]);

    const cacheLayoutForElement = useCallback(
        (elementId: string) => {
            if (layoutCache.current.has(elementId)) {
                return layoutCache.current.get(elementId) ?? null;
            }
            const document = documentService.getDocument();
            const element = document.elements[elementId];
            if (!element) {
                return null;
            }
            const normalized = ensureNormalizedLayout(elementId, element.layout, documentService);
            layoutCache.current.set(elementId, normalized);
            return normalized;
        },
        [documentService],
    );

    const ensureSelectionLayoutsCached = useCallback(() => {
        if (selectionIds.length === 0) {
            return;
        }
        selectionIds.forEach(cacheLayoutForElement);
    }, [cacheLayoutForElement, selectionIds]);

    const finalizeDrag = useCallback(() => {
        const patches: Record<string, Partial<UILayout>> = {};
        selectedTargets.forEach(target => {
            const elementId = target.dataset.uiElementId;
            if (!elementId) {
                return;
            }
            const initialLayout = layoutCache.current.get(elementId);
            if (!initialLayout) {
                return;
            }
            const [translateX, translateY] = dragDeltaCache.current.get(elementId) ?? [0, 0];
            if (translateX === 0 && translateY === 0) {
                applyFinalTransform(target, initialLayout.rotation);
                layoutCache.current.delete(elementId);
                dragDeltaCache.current.delete(elementId);
                return;
            }
            const nextX = initialLayout.x + translateX;
            const nextY = initialLayout.y + translateY;
            patches[elementId] = {
                x: nextX,
                y: nextY,
            };
            // Keep the DOM at its final absolute position before React applies
            // the updated layout, so the controller does not flash back for a frame.
            target.style.left = `${nextX}px`;
            target.style.top = `${nextY}px`;
            applyFinalTransform(target, initialLayout.rotation);
            layoutCache.current.delete(elementId);
            dragDeltaCache.current.delete(elementId);
        });
        if (Object.keys(patches).length > 0) {
            startTransition(() => {
                documentService.updateElementLayouts(patches);
            });
        }
        clearPerformanceHints();
        clearSmartSnapGuides();
        scheduleMoveableRectUpdate();
        endTransform();
    }, [clearPerformanceHints, clearSmartSnapGuides, documentService, selectedTargets, scheduleMoveableRectUpdate, endTransform]);

    const finalizeResize = useCallback(() => {
        const patches: Record<string, Partial<UILayout>> = {};
        const imageFlipPatches: Record<string, Record<string, unknown>> = {};
        const document = documentService.getDocument();
        selectedTargets.forEach(target => {
            const elementId = target.dataset.uiElementId;
            if (!elementId) {
                return;
            }
            const cached = resizeCache.current.get(elementId);
            const initialLayout = layoutCache.current.get(elementId);
            const startData = resizeStartCache.current.get(elementId);
            const element = document.elements[elementId];
            const isFlowChild = element != null && isUIElementFlowLayoutChild(document, element);
            const flipBaselineX = getResizeFlipBaseline(initialLayout, startData, "x");
            const flipBaselineY = getResizeFlipBaseline(initialLayout, startData, "y");
            const patch: Partial<UILayout> = {};
            if (cached?.width !== undefined) {
                patch.width = Math.abs(cached.width);
            }
            if (cached?.height !== undefined) {
                patch.height = Math.abs(cached.height);
            }
            if (!isFlowChild && cached?.x !== undefined) {
                patch.x = cached.x;
            } else if (!isFlowChild && initialLayout) {
                patch.x = initialLayout.x;
            }
            if (!isFlowChild && cached?.y !== undefined) {
                patch.y = cached.y;
            } else if (!isFlowChild && initialLayout) {
                patch.y = initialLayout.y;
            }
            const [translateX, translateY] = dragDeltaCache.current.get(elementId) ?? [0, 0];
            if (!isFlowChild && initialLayout && (translateX !== 0 || translateY !== 0)) {
                patch.x = initialLayout.x + translateX;
                patch.y = initialLayout.y + translateY;
            }
            if (Object.keys(patch).length > 0) {
                patches[elementId] = patch;
            }
            if (element?.type === "nl.image" && (cached?.width !== undefined || cached?.height !== undefined)) {
                const raw = (element.props ?? {}) as Record<string, unknown>;
                const nextProps: Record<string, unknown> = {};
                if (hasResizeAxisCrossed(flipBaselineX, cached?.width)) {
                    nextProps.imageFlipX = raw.imageFlipX === true ? false : true;
                }
                if (hasResizeAxisCrossed(flipBaselineY, cached?.height)) {
                    nextProps.imageFlipY = raw.imageFlipY === true ? false : true;
                }
                if (Object.keys(nextProps).length > 0) {
                    imageFlipPatches[elementId] = nextProps;
                }
            }
            layoutCache.current.delete(elementId);
            resizeCache.current.delete(elementId);
            resizeStartCache.current.delete(elementId);
            dragDeltaCache.current.delete(elementId);
            clearImagePreviewFlipVars(target);
            applyFinalTransform(target, initialLayout?.rotation);
            if (patch.width !== undefined || patch.height !== undefined) {
                const finalWidth = patch.width ?? (initialLayout ? Math.abs(initialLayout.width) : 0);
                const finalHeight = patch.height ?? (initialLayout ? Math.abs(initialLayout.height) : 0);
                target.style.width = `${finalWidth}px`;
                target.style.height = `${finalHeight}px`;
            } else {
                target.style.width = "";
                target.style.height = "";
            }
            if (!isFlowChild && patch.x !== undefined) {
                target.style.left = `${patch.x}px`;
            }
            if (!isFlowChild && patch.y !== undefined) {
                target.style.top = `${patch.y}px`;
            }
        });
        if (Object.keys(patches).length > 0 || Object.keys(imageFlipPatches).length > 0) {
            startTransition(() => {
                const applyUpdates = () => {
                    if (Object.keys(patches).length > 0) {
                        documentService.updateElementLayouts(patches);
                    }
                    Object.entries(imageFlipPatches).forEach(([elementId, propsPatch]) => {
                        documentService.updateElementProps(elementId, propsPatch);
                    });
                };
                if (smartSnap?.surfaceId) {
                    documentService.runSurfaceHistoryTransaction(smartSnap.surfaceId, applyUpdates);
                } else {
                    applyUpdates();
                }
            });
        }
        clearPerformanceHints();
        clearSmartSnapGuides();
        scheduleMoveableRectUpdate();
        endTransform();
    }, [clearPerformanceHints, clearSmartSnapGuides, documentService, selectedTargets, scheduleMoveableRectUpdate, endTransform, smartSnap]);

    const finalizeRotate = useCallback(() => {
        const patches: Record<string, Partial<UILayout>> = {};
        const document = documentService.getDocument();
        selectedTargets.forEach(target => {
            const elementId = target.dataset.uiElementId;
            if (!elementId) {
                return;
            }
            const rotation = rotateCache.current.get(elementId);
            const layout = layoutCache.current.get(elementId);
            const [translateX, translateY] = dragDeltaCache.current.get(elementId) ?? [0, 0];
            const element = document.elements[elementId];
            const isFlowChild = element != null && isUIElementFlowLayoutChild(document, element);
            const patch: Partial<UILayout> = {};
            if (rotation !== undefined) {
                patch.rotation = rotation;
            }
            if (!isFlowChild && layout) {
                patch.x = layout.x + translateX;
                patch.y = layout.y + translateY;
            }
            if (Object.keys(patch).length > 0) {
                patches[elementId] = patch;
            }
            layoutCache.current.delete(elementId);
            rotateCache.current.delete(elementId);
            dragDeltaCache.current.delete(elementId);
            applyFinalTransform(target, rotation);
        });
        if (Object.keys(patches).length > 0) {
            startTransition(() => {
                documentService.updateElementLayouts(patches);
            });
        }
        clearPerformanceHints();
        clearSmartSnapGuides();
        scheduleMoveableRectUpdate();
        endTransform();
    }, [clearPerformanceHints, clearSmartSnapGuides, documentService, selectedTargets, scheduleMoveableRectUpdate, endTransform]);

    const cancelResize = useCallback(() => {
        selectedTargets.forEach(target => {
            const elementId = target.dataset.uiElementId;
            if (!elementId) {
                return;
            }
            const layout = layoutCache.current.get(elementId);
            layoutCache.current.delete(elementId);
            resizeCache.current.delete(elementId);
            resizeStartCache.current.delete(elementId);
            dragDeltaCache.current.delete(elementId);
            clearImagePreviewFlipVars(target);
            applyFinalTransform(target, layout?.rotation);
        });
        clearPerformanceHints();
        clearSmartSnapGuides();
        scheduleMoveableRectUpdate();
        endTransform();
    }, [clearPerformanceHints, clearSmartSnapGuides, endTransform, scheduleMoveableRectUpdate, selectedTargets]);

    const cancelRotate = useCallback(() => {
        selectedTargets.forEach(target => {
            const elementId = target.dataset.uiElementId;
            if (!elementId) {
                return;
            }
            const layout = layoutCache.current.get(elementId);
            layoutCache.current.delete(elementId);
            rotateCache.current.delete(elementId);
            dragDeltaCache.current.delete(elementId);
            applyFinalTransform(target, layout?.rotation);
        });
        clearPerformanceHints();
        clearSmartSnapGuides();
        scheduleMoveableRectUpdate();
        endTransform();
    }, [clearPerformanceHints, clearSmartSnapGuides, endTransform, scheduleMoveableRectUpdate, selectedTargets]);

    const handleDragStart = useCallback(() => {
        if (isGroupSelection) {
            return;
        }
        ensureSelectionLayoutsCached();
        rebuildSmartSnapCandidateLines();
        applyPerformanceHints();
        beginTransform();
    }, [applyPerformanceHints, beginTransform, ensureSelectionLayoutsCached, isGroupSelection, rebuildSmartSnapCandidateLines]);

    const handleDrag = useCallback(
        (e: OnDrag) => {
            if (isGroupSelection) {
                return;
            }
            let [translateX, translateY] = e.beforeTranslate;
            if (smartSnap?.isEnabled() && !smartSnap.isSuspended()) {
                ensureSmartSnapCandidateLines();
                const doc = documentService.getDocument();
                const rects = selectedTargets
                    .map(target => {
                        const elementId = target.dataset.uiElementId;
                        if (!elementId) {
                            return null;
                        }
                        const layout0 = layoutCache.current.get(elementId);
                        if (!layout0) {
                            return null;
                        }
                        return getSurfaceAxisAlignedBoundsForLayout(doc, elementId, {
                            ...layout0,
                            x: layout0.x + translateX,
                            y: layout0.y + translateY,
                        });
                    })
                    .filter((r): r is NonNullable<typeof r> => r != null);
                const union = unionAxisAlignedRects(rects);
                if (union) {
                    const { vertical, horizontal } = splitSnapLinesToAxes(snapLinesCacheRef.current);
                    const th = surfaceThresholdFromViewportPx(viewportScale, DEFAULT_SNAP_THRESHOLD_PX);
                    const snapped = snapTranslateAxisAlignedRect({
                        rect: union,
                        verticalLines: vertical,
                        horizontalLines: horizontal,
                        thresholdSurface: th,
                        surfaceId: smartSnap.surfaceId,
                    });
                    translateX += snapped.dx;
                    translateY += snapped.dy;
                    smartSnap.setGuides(
                        snapped.activeGuides.vertical.length > 0 || snapped.activeGuides.horizontal.length > 0
                            ? snapped.activeGuides
                            : null,
                    );
                } else {
                    smartSnap.setGuides(null);
                }
            } else {
                smartSnap?.setGuides(null);
            }
            selectedTargets.forEach(target => {
                const elementId = target.dataset.uiElementId;
                if (!elementId) {
                    return;
                }
                const layout = layoutCache.current.get(elementId);
                const rotation = layout?.rotation;
                target.style.transform = buildTransform(translateX, translateY, rotation);
                dragDeltaCache.current.set(elementId, [translateX, translateY]);
            });
        },
        [documentService, ensureSmartSnapCandidateLines, isGroupSelection, selectedTargets, smartSnap, viewportScale],
    );

    const handleDragEnd = useCallback(
        (e: OnDragEnd) => {
            if (isGroupSelection) {
                return;
            }
            finalizeDrag();
        },
        [finalizeDrag, isGroupSelection],
    );

    const handleDragGroupStart = useCallback(
        (e: OnDragGroupStart) => {
            if (!isGroupSelection) {
                return;
            }
            ensureSelectionLayoutsCached();
            rebuildSmartSnapCandidateLines();
            applyPerformanceHints();
            beginTransform();
        },
        [applyPerformanceHints, beginTransform, ensureSelectionLayoutsCached, isGroupSelection, rebuildSmartSnapCandidateLines],
    );

    const handleDragGroup = useCallback(
        (e: OnDragGroup) => {
            if (!isGroupSelection) {
                return;
            }
            const doc = documentService.getDocument();
            const perEvent = e.events.map(event => {
                const target = event.target;
                if (!isHTMLElement(target)) {
                    return null;
                }
                const elementId = target.dataset.uiElementId;
                if (!elementId) {
                    return null;
                }
                let [tx, ty] = event.beforeTranslate;
                return { target, elementId, tx, ty };
            }).filter((row): row is NonNullable<typeof row> => row != null);

            let dx = 0;
            let dy = 0;
            if (smartSnap?.isEnabled() && !smartSnap.isSuspended() && perEvent.length > 0) {
                ensureSmartSnapCandidateLines();
                const rects = perEvent
                    .map(row => {
                        const layout0 = layoutCache.current.get(row.elementId);
                        if (!layout0) {
                            return null;
                        }
                        return getSurfaceAxisAlignedBoundsForLayout(doc, row.elementId, {
                            ...layout0,
                            x: layout0.x + row.tx,
                            y: layout0.y + row.ty,
                        });
                    })
                    .filter((r): r is NonNullable<typeof r> => r != null);
                const union = unionAxisAlignedRects(rects);
                if (union) {
                    const { vertical, horizontal } = splitSnapLinesToAxes(snapLinesCacheRef.current);
                    const th = surfaceThresholdFromViewportPx(viewportScale, DEFAULT_SNAP_THRESHOLD_PX);
                    const snapped = snapTranslateAxisAlignedRect({
                        rect: union,
                        verticalLines: vertical,
                        horizontalLines: horizontal,
                        thresholdSurface: th,
                        surfaceId: smartSnap.surfaceId,
                    });
                    dx = snapped.dx;
                    dy = snapped.dy;
                    smartSnap.setGuides(
                        snapped.activeGuides.vertical.length > 0 || snapped.activeGuides.horizontal.length > 0
                            ? snapped.activeGuides
                            : null,
                    );
                } else {
                    smartSnap.setGuides(null);
                }
            } else {
                smartSnap?.setGuides(null);
            }

            perEvent.forEach(row => {
                const layout = layoutCache.current.get(row.elementId);
                const rotation = layout?.rotation;
                const tx = row.tx + dx;
                const ty = row.ty + dy;
                row.target.style.transform = buildTransform(tx, ty, rotation);
                dragDeltaCache.current.set(row.elementId, [tx, ty]);
            });
        },
        [documentService, ensureSmartSnapCandidateLines, isGroupSelection, smartSnap, viewportScale],
    );

    const handleDragGroupEnd = useCallback(
        (e: OnDragGroupEnd) => {
            if (!isGroupSelection) {
                return;
            }
            finalizeDrag();
        },
        [finalizeDrag, isGroupSelection],
    );

    const handleResizeStart = useCallback(
        (e: OnResizeStart) => {
            if (isGroupSelection) {
                return;
            }
            ensureSelectionLayoutsCached();
            rebuildSmartSnapCandidateLines();
            selectionIds.forEach(elementId => {
                const layout = cacheLayoutForElement(elementId);
                if (!layout) {
                    return;
                }
                const [dirX = 0, dirY = 0] = e.direction ?? [0, 0];
                const ix = computeResizeAxis1D(dirX, layout.width, 0);
                const iy = computeResizeAxis1D(dirY, layout.height, 0);
                resizeStartCache.current.set(elementId, {
                    clientX: e.clientX,
                    clientY: e.clientY,
                    layout,
                    direction: e.direction ?? [0, 0],
                    aspectInitialSx: ix.signedSize,
                    aspectInitialSy: iy.signedSize,
                });
            });
            e.setMin?.([-Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER]);
            applyPerformanceHints();
            beginTransform();
        },
        [applyPerformanceHints, beginTransform, cacheLayoutForElement, ensureSelectionLayoutsCached, isGroupSelection, rebuildSmartSnapCandidateLines, selectionIds],
    );

    const handleResize = useCallback(
        (e: OnResize) => {
            if (isGroupSelection) {
                return;
            }
            const elementId = e.target.dataset.uiElementId;
            if (!elementId) {
                return;
            }
            const initialLayout = layoutCache.current.get(elementId);
            const startData = resizeStartCache.current.get(elementId);
            if (!startData || !initialLayout) {
                return;
            }
            const element = documentService.getDocument().elements[elementId];
            const isFlowChild = isCurrentFlowLayoutChild(documentService, elementId);
            const axes = computeResizeAxes(e, startData, viewportScale);
            const { translateX: tx0, translateY: ty0 } = computeResizeTranslate(
                axes.layout,
                axes.xAxis,
                axes.yAxis,
                axes.xAxis.size,
                axes.yAxis.size,
                axes.cosR,
                axes.sinR,
            );
            let preview = {
                width: axes.xAxis.size,
                height: axes.yAxis.size,
                signedWidth: axes.xAxis.signedSize,
                signedHeight: axes.yAxis.signedSize,
                translateX: tx0,
                translateY: ty0,
            };
            if (initialLayout.lockAspectRatio) {
                preview = applyLockedAspectToResizePreview(
                    true,
                    initialLayout,
                    axes.directionX,
                    axes.directionY,
                    axes.xAxis,
                    axes.yAxis,
                    axes.cosR,
                    axes.sinR,
                    preview,
                    {
                        sx0: startData.aspectInitialSx,
                        sy0: startData.aspectInitialSy,
                    },
                );
            }
            let { width, height, signedWidth, signedHeight, translateX, translateY } = preview;
            if (!isFlowChild && smartSnap?.isEnabled() && !smartSnap.isSuspended()) {
                ensureSmartSnapCandidateLines();
                const { vertical, horizontal } = splitSnapLinesToAxes(snapLinesCacheRef.current);
                const dir = startData.direction;
                const resizeDirection: readonly [number, number] = [dir[0] ?? 0, dir[1] ?? 0];
                // Snap layer interprets layout via min(0, width) for top-left, so it expects
                // unnormalized layout semantics. Our (translateX/Y) already encodes the visual
                // top-left, so feed positive width/height to keep both contributors consistent;
                // otherwise sign duplication shifts the box by ~one full extent at gesture start.
                const snapped = snapResizeLayoutInSurface(
                    documentService.getDocument(),
                    elementId,
                    {
                        x: initialLayout.x + translateX,
                        y: initialLayout.y + translateY,
                        width: width,
                        height: height,
                        rotation: initialLayout.rotation,
                    },
                    resizeDirection,
                    vertical,
                    horizontal,
                    viewportScale,
                    smartSnap.surfaceId,
                );
                const nx = snapped.layout.x;
                const ny = snapped.layout.y;
                const nAbsW = Math.abs(snapped.layout.width);
                const nAbsH = Math.abs(snapped.layout.height);
                const sgnW = Math.sign(signedWidth) || 1;
                const sgnH = Math.sign(signedHeight) || 1;
                signedWidth = nAbsW * sgnW;
                signedHeight = nAbsH * sgnH;
                width = nAbsW;
                height = nAbsH;
                translateX = nx - initialLayout.x;
                translateY = ny - initialLayout.y;
                smartSnap.setGuides(
                    snapped.activeGuides.vertical.length > 0 || snapped.activeGuides.horizontal.length > 0
                        ? snapped.activeGuides
                        : null,
                );
            } else {
                smartSnap?.setGuides(null);
            }
            if (element?.type === "nl.image" && isHTMLElement(e.target)) {
                const flipBaselineX = getResizeFlipBaseline(initialLayout, startData, "x");
                const flipBaselineY = getResizeFlipBaseline(initialLayout, startData, "y");
                const dragFlipX = hasResizeAxisCrossed(flipBaselineX, signedWidth) ? -1 : 1;
                const dragFlipY = hasResizeAxisCrossed(flipBaselineY, signedHeight) ? -1 : 1;
                // Preview vars only represent the transient drag-side flip.
                // The persisted imageFlipX/Y state is already applied in RectangleChromeRenderer.
                setImagePreviewFlipVars(e.target, dragFlipX, dragFlipY);
            } else if (isHTMLElement(e.target)) {
                clearImagePreviewFlipVars(e.target);
            }
            e.target.style.width = `${width}px`;
            e.target.style.height = `${height}px`;
            resizeCache.current.set(elementId, {
                width: signedWidth,
                height: signedHeight,
                x: isFlowChild ? undefined : initialLayout.x + translateX,
                y: isFlowChild ? undefined : initialLayout.y + translateY,
            });
            const rotation = initialLayout?.rotation;
            e.target.style.transform = buildTransform(isFlowChild ? 0 : translateX, isFlowChild ? 0 : translateY, rotation);
            if (isFlowChild) {
                dragDeltaCache.current.delete(elementId);
            } else {
                dragDeltaCache.current.set(elementId, [translateX, translateY]);
            }
        },
        [documentService, ensureSmartSnapCandidateLines, isGroupSelection, smartSnap, viewportScale],
    );

    const handleResizeEnd = useCallback(
        (e: OnResizeEnd) => {
            if (isGroupSelection) {
                return;
            }
            if (!e.isDrag) {
                cancelResize();
                return;
            }
            finalizeResize();
        },
        [cancelResize, finalizeResize, isGroupSelection],
    );

    const handleResizeGroupStart = useCallback(
        (e: OnResizeGroupStart) => {
            if (!isGroupSelection) {
                return;
            }
            ensureSelectionLayoutsCached();
            e.setMin?.([-Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER]);
            applyPerformanceHints();
            beginTransform();
        },
        [applyPerformanceHints, beginTransform, ensureSelectionLayoutsCached, isGroupSelection],
    );

    const handleResizeGroup = useCallback(
        (e: OnResizeGroup) => {
            if (!isGroupSelection) {
                return;
            }
            smartSnap?.setGuides(null);
            e.events.forEach(event => {
                const target = event.target;
                if (!isHTMLElement(target)) {
                    return;
                }
                const elementId = target.dataset.uiElementId;
                if (!elementId) {
                    return;
                }
                const initialLayout = layoutCache.current.get(elementId);
                const isFlowChild = isCurrentFlowLayoutChild(documentService, elementId);
                const translateX = event.drag?.beforeTranslate?.[0] ?? 0;
                const translateY = event.drag?.beforeTranslate?.[1] ?? 0;
                target.style.width = `${event.width}px`;
                target.style.height = `${event.height}px`;
                target.style.transform = isFlowChild
                    ? buildTransform(0, 0, initialLayout?.rotation)
                    : event.drag?.transform ?? buildTransform(translateX, translateY, initialLayout?.rotation);
                resizeCache.current.set(elementId, {
                    width: event.width,
                    height: event.height,
                    x: !isFlowChild && initialLayout ? initialLayout.x + translateX : undefined,
                    y: !isFlowChild && initialLayout ? initialLayout.y + translateY : undefined,
                });
                if (isFlowChild) {
                    dragDeltaCache.current.delete(elementId);
                } else {
                    dragDeltaCache.current.set(elementId, [translateX, translateY]);
                }
            });
        },
        [documentService, isGroupSelection, smartSnap],
    );

    const handleResizeGroupEnd = useCallback(
        (e: OnResizeGroupEnd) => {
            if (!isGroupSelection) {
                return;
            }
            if (!e.isDrag) {
                cancelResize();
                return;
            }
            finalizeResize();
        },
        [cancelResize, finalizeResize, isGroupSelection],
    );

    const handleRotateStart = useCallback(
        (_e: OnRotateStart) => {
            if (isGroupSelection) {
                return;
            }
            ensureSelectionLayoutsCached();
            applyPerformanceHints();
            beginTransform();
        },
        [applyPerformanceHints, beginTransform, ensureSelectionLayoutsCached, isGroupSelection],
    );

    const handleRotate = useCallback(
        (e: OnRotate) => {
            if (isGroupSelection) {
                return;
            }
            clearSmartSnapGuides();
            const rotation = Number.isFinite(e.beforeRotation)
                ? e.beforeRotation
                : Number.isFinite(e.beforeRotate)
                    ? e.beforeRotate
                    : e.rotate;
            const elementId = e.target.dataset.uiElementId;
            const fallbackRotation = Number.isFinite(rotation) ? rotation : 0;
            if (!elementId) {
                e.target.style.transform = e.transform;
                return;
            }
            if (Number.isFinite(rotation)) {
                rotateCache.current.set(elementId, fallbackRotation);
            }
            const translateX = e.drag?.beforeTranslate?.[0] ?? 0;
            const translateY = e.drag?.beforeTranslate?.[1] ?? 0;
            const isFlowChild = isCurrentFlowLayoutChild(documentService, elementId);
            e.target.style.transform = buildTransform(
                isFlowChild ? 0 : translateX,
                isFlowChild ? 0 : translateY,
                fallbackRotation,
            );
            if (isFlowChild) {
                dragDeltaCache.current.delete(elementId);
            } else {
                dragDeltaCache.current.set(elementId, [translateX, translateY]);
            }
        },
        [clearSmartSnapGuides, documentService, isGroupSelection],
    );

    const handleRotateEnd = useCallback(
        (e: OnRotateEnd) => {
            if (isGroupSelection) {
                return;
            }
            if (!e.isDrag) {
                cancelRotate();
                return;
            }
            finalizeRotate();
        },
        [cancelRotate, finalizeRotate, isGroupSelection],
    );

    const handleRotateGroupStart = useCallback(
        (_e: OnRotateGroupStart) => {
            if (!isGroupSelection) {
                return;
            }
            ensureSelectionLayoutsCached();
            applyPerformanceHints();
            beginTransform();
        },
        [applyPerformanceHints, beginTransform, ensureSelectionLayoutsCached, isGroupSelection],
    );

    const handleRotateGroup = useCallback(
        (e: OnRotateGroup) => {
            if (!isGroupSelection) {
                return;
            }
            clearSmartSnapGuides();
            e.events.forEach(event => {
                const target = event.target;
                if (!isHTMLElement(target)) {
                    return;
                }
                const elementId = target.dataset.uiElementId;
                if (!elementId) {
                    return;
                }
                const rotation = Number.isFinite(event.beforeRotation)
                    ? event.beforeRotation
                    : Number.isFinite(event.beforeRotate)
                        ? event.beforeRotate
                        : event.rotate;
                const translateX = event.drag?.beforeTranslate?.[0] ?? 0;
                const translateY = event.drag?.beforeTranslate?.[1] ?? 0;
                const isFlowChild = isCurrentFlowLayoutChild(documentService, elementId);
                target.style.transform = buildTransform(
                    isFlowChild ? 0 : translateX,
                    isFlowChild ? 0 : translateY,
                    rotation,
                );
                rotateCache.current.set(elementId, rotation);
                if (isFlowChild) {
                    dragDeltaCache.current.delete(elementId);
                } else {
                    dragDeltaCache.current.set(elementId, [translateX, translateY]);
                }
            });
        },
        [clearSmartSnapGuides, documentService, isGroupSelection],
    );

    const handleRotateGroupEnd = useCallback(
        (e: OnRotateGroupEnd) => {
            if (!isGroupSelection) {
                return;
            }
            if (!e.isDrag) {
                cancelRotate();
                return;
            }
            finalizeRotate();
        },
        [cancelRotate, finalizeRotate, isGroupSelection],
    );

    return {
        handleDragStart,
        handleDrag,
        handleDragEnd,
        handleDragGroupStart,
        handleDragGroup,
        handleDragGroupEnd,
        handleResizeStart,
        handleResize,
        handleResizeEnd,
        handleResizeGroupStart,
        handleResizeGroup,
        handleResizeGroupEnd,
        handleRotateStart,
        handleRotate,
        handleRotateEnd,
        handleRotateGroupStart,
        handleRotateGroup,
        handleRotateGroupEnd,
    };
}
