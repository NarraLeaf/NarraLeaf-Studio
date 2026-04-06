import { useCallback, useRef } from "react";
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
import { ensureNormalizedLayout, computeResizePreview, buildTransform, applyFinalTransform, isHTMLElement } from "./utils";
import type { UILayout } from "@shared/types/ui-editor/document";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";

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
}: MoveableHandlersConfig): MoveableHandlers {
    const layoutCache = useRef<Map<string, UILayout>>(new Map());
    const dragDeltaCache = useRef<Map<string, [number, number]>>(new Map());
    const resizeCache = useRef<Map<string, ResizeCacheEntry>>(new Map());
    const resizeStartCache = useRef<Map<string, ResizeStartEntry>>(new Map());
    const rotateCache = useRef<Map<string, number>>(new Map());
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
            documentService.updateElementLayouts(patches);
        }
        clearPerformanceHints();
        scheduleMoveableRectUpdate();
        endTransform();
    }, [clearPerformanceHints, documentService, selectedTargets, scheduleMoveableRectUpdate, endTransform]);

    const finalizeResize = useCallback(() => {
        const patches: Record<string, Partial<UILayout>> = {};
        selectedTargets.forEach(target => {
            const elementId = target.dataset.uiElementId;
            if (!elementId) {
                return;
            }
            const cached = resizeCache.current.get(elementId);
            const initialLayout = layoutCache.current.get(elementId);
            const patch: Partial<UILayout> = {};
            if (cached?.width !== undefined) {
                patch.width = Math.abs(cached.width);
            }
            if (cached?.height !== undefined) {
                patch.height = Math.abs(cached.height);
            }
            if (cached?.x !== undefined) {
                patch.x = cached.x;
            } else if (initialLayout) {
                patch.x = initialLayout.x;
            }
            if (cached?.y !== undefined) {
                patch.y = cached.y;
            } else if (initialLayout) {
                patch.y = initialLayout.y;
            }
            const [translateX, translateY] = dragDeltaCache.current.get(elementId) ?? [0, 0];
            if (initialLayout && (translateX !== 0 || translateY !== 0)) {
                patch.x = initialLayout.x + translateX;
                patch.y = initialLayout.y + translateY;
            }
            if (Object.keys(patch).length > 0) {
                patches[elementId] = patch;
            }
            layoutCache.current.delete(elementId);
            resizeCache.current.delete(elementId);
            resizeStartCache.current.delete(elementId);
            dragDeltaCache.current.delete(elementId);
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
            if (patch.x !== undefined) {
                target.style.left = `${patch.x}px`;
            }
            if (patch.y !== undefined) {
                target.style.top = `${patch.y}px`;
            }
        });
        if (Object.keys(patches).length > 0) {
            documentService.updateElementLayouts(patches);
        }
        clearPerformanceHints();
        scheduleMoveableRectUpdate();
        endTransform();
    }, [clearPerformanceHints, documentService, selectedTargets, scheduleMoveableRectUpdate, endTransform]);

    const finalizeRotate = useCallback(() => {
        const patches: Record<string, Partial<UILayout>> = {};
        selectedTargets.forEach(target => {
            const elementId = target.dataset.uiElementId;
            if (!elementId) {
                return;
            }
            const rotation = rotateCache.current.get(elementId);
            const layout = layoutCache.current.get(elementId);
            const [translateX, translateY] = dragDeltaCache.current.get(elementId) ?? [0, 0];
            const patch: Partial<UILayout> = {};
            if (rotation !== undefined) {
                patch.rotation = rotation;
            }
            if (layout) {
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
            documentService.updateElementLayouts(patches);
        }
        clearPerformanceHints();
        scheduleMoveableRectUpdate();
        endTransform();
    }, [clearPerformanceHints, documentService, selectedTargets, scheduleMoveableRectUpdate, endTransform]);

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
            applyFinalTransform(target, layout?.rotation);
        });
        clearPerformanceHints();
        scheduleMoveableRectUpdate();
        endTransform();
    }, [clearPerformanceHints, endTransform, scheduleMoveableRectUpdate, selectedTargets]);

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
        scheduleMoveableRectUpdate();
        endTransform();
    }, [clearPerformanceHints, endTransform, scheduleMoveableRectUpdate, selectedTargets]);

    const handleDragStart = useCallback(() => {
        if (isGroupSelection) {
            return;
        }
        ensureSelectionLayoutsCached();
        applyPerformanceHints();
        beginTransform();
    }, [applyPerformanceHints, beginTransform, ensureSelectionLayoutsCached, isGroupSelection]);

    const handleDrag = useCallback(
        (e: OnDrag) => {
            if (isGroupSelection) {
                return;
            }
            const [translateX, translateY] = e.beforeTranslate;
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
        [isGroupSelection, selectedTargets],
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
            applyPerformanceHints();
            beginTransform();
        },
        [applyPerformanceHints, beginTransform, ensureSelectionLayoutsCached, isGroupSelection],
    );

    const handleDragGroup = useCallback(
        (e: OnDragGroup) => {
            if (!isGroupSelection) {
                return;
            }
            e.events.forEach(event => {
                const target = event.target;
                if (!isHTMLElement(target)) {
                    return;
                }
                const elementId = target.dataset.uiElementId;
                if (!elementId) {
                    return;
                }
                const [translateX, translateY] = event.beforeTranslate;
                const layout = layoutCache.current.get(elementId);
                const rotation = layout?.rotation;
                target.style.transform = buildTransform(translateX, translateY, rotation);
                dragDeltaCache.current.set(elementId, [translateX, translateY]);
            });
        },
        [isGroupSelection],
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
            selectionIds.forEach(elementId => {
                const layout = cacheLayoutForElement(elementId);
                if (!layout) {
                    return;
                }
                resizeStartCache.current.set(elementId, {
                    clientX: e.clientX,
                    clientY: e.clientY,
                    layout,
                    direction: e.direction ?? [0, 0],
                });
            });
            e.setMin?.([-Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER]);
            applyPerformanceHints();
            beginTransform();
        },
        [applyPerformanceHints, beginTransform, cacheLayoutForElement, ensureSelectionLayoutsCached, isGroupSelection, selectionIds],
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
            const { width, height, signedWidth, signedHeight, translateX, translateY } = computeResizePreview(
                e,
                startData,
                viewportScale,
            );
            e.target.style.width = `${width}px`;
            e.target.style.height = `${height}px`;
            resizeCache.current.set(elementId, {
                width: signedWidth,
                height: signedHeight,
                x: initialLayout.x + translateX,
                y: initialLayout.y + translateY,
            });
            const rotation = initialLayout?.rotation;
            e.target.style.transform = buildTransform(translateX, translateY, rotation);
            dragDeltaCache.current.set(elementId, [translateX, translateY]);
        },
        [isGroupSelection, viewportScale],
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
                const translateX = event.drag?.beforeTranslate?.[0] ?? 0;
                const translateY = event.drag?.beforeTranslate?.[1] ?? 0;
                target.style.width = `${event.width}px`;
                target.style.height = `${event.height}px`;
                target.style.transform = event.drag?.transform ?? buildTransform(translateX, translateY, initialLayout?.rotation);
                resizeCache.current.set(elementId, {
                    width: event.width,
                    height: event.height,
                    x: initialLayout ? initialLayout.x + translateX : undefined,
                    y: initialLayout ? initialLayout.y + translateY : undefined,
                });
                dragDeltaCache.current.set(elementId, [translateX, translateY]);
            });
        },
        [isGroupSelection],
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
        e.target.style.transform = buildTransform(translateX, translateY, fallbackRotation);
        },
        [isGroupSelection],
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
                target.style.transform = buildTransform(translateX, translateY, rotation);
                rotateCache.current.set(elementId, rotation);
                dragDeltaCache.current.set(elementId, [translateX, translateY]);
            });
        },
        [isGroupSelection],
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
