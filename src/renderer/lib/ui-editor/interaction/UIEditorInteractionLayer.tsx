import React, { useCallback, useEffect, useMemo, useState, useRef } from "react";
import Selecto from "react-selecto";
import Moveable from "react-moveable";
import type {
    OnDrag,
    OnResize,
    OnDragStart,
    OnDragEnd,
    OnResizeEnd,
    OnResizeStart,
    OnRotate,
    OnRotateStart,
    OnRotateEnd,
} from "react-moveable";
import { ViewportTransform, clientToSurface, Rect2D } from "../geometry";
import { UIEditorStateService } from "@services/ui-editor/UIEditorStateService";
import { isUIElementSelection } from "@services/ui/UIStore";
import { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UIElement, UILayout, UISurface } from "@shared/types/ui-editor/document";
import type { UITool } from "@/lib/ui-editor/editor/types";

const SELECTABLE_TARGET = ".ui-editor-node:not(.ui-editor-node-root)";

// ─── Drag-to-Create Preview ─────────────────────────────────────────────────

type InsertPreview = {
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
};

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
            className="absolute pointer-events-none border-2 border-dashed border-primary bg-primary/10 rounded"
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
    showOutlines?: boolean;
};

function isHTMLElement(node: Element | null): node is HTMLElement {
    return node instanceof HTMLElement;
}

function buildTransform(
    translateX: number,
    translateY: number,
    rotation?: number,
) {
    const hasTranslate = translateX !== 0 || translateY !== 0;
    const hasRotation = Boolean(rotation);
    if (!hasTranslate && !hasRotation) {
        return "";
    }
    const transformParts = [];
    if (hasTranslate) {
        transformParts.push(`translate(${translateX}px, ${translateY}px)`);
    }
    if (rotation) {
        transformParts.push(`rotate(${rotation}deg)`);
    }
    return transformParts.join(" ");
}

function applyFinalTransform(
    target: HTMLElement | SVGElement,
    rotation?: number,
) {
    target.style.transform = buildTransform(0, 0, rotation);
}

function normalizeLayout(layout: UILayout) {
    let nextX = layout.x;
    let nextY = layout.y;
    let nextWidth = layout.width;
    let nextHeight = layout.height;
    if (nextWidth < 0) {
        nextX += nextWidth;
        nextWidth = Math.abs(nextWidth);
    }
    if (nextHeight < 0) {
        nextY += nextHeight;
        nextHeight = Math.abs(nextHeight);
    }
    return {
        ...layout,
        x: nextX,
        y: nextY,
        width: nextWidth,
        height: nextHeight,
    };
}

function ensureNormalizedLayout(elementId: string, layout: UILayout, documentService: UIDocumentService) {
    if (layout.width >= 0 && layout.height >= 0) {
        return layout;
    }
    const normalized = normalizeLayout(layout);
    documentService.updateElementLayout(elementId, {
        x: normalized.x,
        y: normalized.y,
        width: normalized.width,
        height: normalized.height,
    });
    return normalized;
}

function computeResizePreview(
    e: OnResize,
    start: { clientX: number; clientY: number; layout: UILayout; direction: number[] },
    viewportScale: number,
) {
    const safeScale = Math.max(viewportScale, 0.0001);
    const rawDx = (e.clientX - start.clientX) / safeScale;
    const rawDy = (e.clientY - start.clientY) / safeScale;
    const [directionX, directionY] = start.direction ?? [0, 0];

    // Rotate the screen-space mouse delta into the element's local
    // coordinate system so each resize axis tracks the correct component.
    const rotDeg = start.layout.rotation ?? 0;
    const rad = (rotDeg * Math.PI) / 180;
    const cosR = Math.cos(rad);
    const sinR = Math.sin(rad);
    const dx = rawDx * cosR + rawDy * sinR;
    const dy = -rawDx * sinR + rawDy * cosR;

    const computeAxis = (direction: number, startSize: number, delta: number) => {
        if (direction === 0) {
            return {
                size: startSize,
                signedSize: startSize,
                localTranslate: 0,
            };
        }
        const anchor = direction === 1 ? 0 : startSize;
        const pointer = direction === 1 ? startSize + delta : delta;
        const size = Math.abs(pointer - anchor);
        const localTranslate = Math.min(pointer, anchor);
        const signedSize = pointer - anchor;
        return {
            size,
            signedSize,
            localTranslate,
        };
    };

    const xAxis = computeAxis(directionX, start.layout.width, dx);
    const yAxis = computeAxis(directionY, start.layout.height, dy);

    // Compute the CSS translate that keeps the anchor edge/corner fixed
    // under rotation.  With `transform: translate(tx,ty) rotate(θ)` and
    // `transform-origin: center center`, changing the size shifts the
    // center, so we must compensate.
    //
    // Derivation: require the anchor point's parent-space position to be
    // identical before and after the resize.  This yields:
    //   (tx,ty) = (-ΔW/2, -ΔH/2) + R(θ) · (lt_x + ΔW/2, lt_y + ΔH/2)
    // where ΔW/ΔH are the size deltas and lt_x/lt_y are the local-space
    // translates from computeAxis.
    const deltaW = xAxis.size - start.layout.width;
    const deltaH = yAxis.size - start.layout.height;
    const px = xAxis.localTranslate + deltaW / 2;
    const py = yAxis.localTranslate + deltaH / 2;
    const translateX = -deltaW / 2 + px * cosR - py * sinR;
    const translateY = -deltaH / 2 + px * sinR + py * cosR;

    return {
        width: xAxis.size,
        height: yAxis.size,
        signedWidth: xAxis.signedSize,
        signedHeight: yAxis.signedSize,
        translateX,
        translateY,
    };
}

export function UIEditorInteractionLayer({ surfaceId, surface, containerRef, showOutlines = true }: Props) {
    const stateService = UIEditorStateService.getInstance();
    const [selection, setSelection] = useState(stateService.getSelection());
    const previousSelectedTargets = useRef<HTMLElement[]>([]);
    const outlineCache = useRef<WeakMap<HTMLElement, { outline?: string; outlineOffset?: string }>>(new WeakMap());
    const layoutCache = useRef<Map<string, UIElement["layout"]>>(new Map());
    const dragDeltaCache = useRef<Map<string, [number, number]>>(new Map());
    const resizeCache = useRef<Map<string, { width?: number; height?: number }>>(new Map());
    const resizeStartCache = useRef<Map<string, { clientX: number; clientY: number; layout: UILayout; direction: number[] }>>(new Map());
    const rotateCache = useRef<Map<string, number>>(new Map());
    const documentService = UIDocumentService.getInstance();
    type MoveableInstance = React.ElementRef<typeof Moveable>;
    const moveableRef = useRef<MoveableInstance | null>(null);

    // Insert mode drag-to-create state
    const [insertPreview, setInsertPreview] = useState<InsertPreview | null>(null);
    const insertPreviewRef = useRef<InsertPreview | null>(null);
    const insertState = useRef<{
        active: boolean;
        nodeType: string;
        startClientX: number;
        startClientY: number;
        startSurfaceX: number;
        startSurfaceY: number;
    } | null>(null);

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

    const surfaceElement = containerRef.current ?? null;

    const selectedTargets = useMemo<HTMLElement[]>(() => {
        if (!isUIElementSelection(selection) || selection.data.surfaceId !== surfaceId) {
            return [];
        }
        if (!surfaceElement) {
            return [];
        }
        return selection.data.elementIds
            .map(id => surfaceElement.querySelector(`[data-ui-element-id="${id}"]`))
            .filter(isHTMLElement);
    }, [selection, surfaceElement, surfaceId]);

    const selectionData = isUIElementSelection(selection) ? selection.data : null;
    const primaryId = selectionData?.primaryId ?? selectionData?.elementIds?.[selectionData.elementIds.length - 1];

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
                    ? "1px solid rgba(123, 97, 255, 0.9)"
                    : "1px dashed rgba(123, 97, 255, 0.6)";
                target.style.outlineOffset = "0px";
            });
            previousSelectedTargets.current = selectedTargets;
        } else {
            previousSelectedTargets.current = [];
        }
    }, [selectedTargets, primaryId, showOutlines]);

    useEffect(() => {
        // Selection, viewport zoom/pan, or showOutlines can change the target rect in container space.
        scheduleMoveableRectUpdate();
    }, [
        scheduleMoveableRectUpdate,
        selectedTargets,
        viewport.scale,
        viewport.offsetX,
        viewport.offsetY,
        showOutlines,
    ]);

    useEffect(() => {
        // When element layout changes, the DOM updates but this layer might not re-render.
        const unsubscribe = documentService.onDocumentChanged?.(() => {
            scheduleMoveableRectUpdate();
        });
        return () => unsubscribe?.();
    }, [documentService, scheduleMoveableRectUpdate]);

    const handleSelectEnd = (e: any) => {
        const targets = e.selected as HTMLElement[];
        const targetIds = targets
            .map(target => target.dataset.uiElementId)
            .filter(Boolean) as string[];
        if (!surfaceElement) {
            return;
        }
        stateService.setUIElementSelection({
            editor: "ui",
            surfaceId,
            elementIds: targetIds,
            primaryId: targetIds[targetIds.length - 1],
        });
    };
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

    useEffect(() => {
        if (!surfaceElement) {
            return;
        }

        const updateInsertPreview = (next: InsertPreview | null) => {
            insertPreviewRef.current = next;
            setInsertPreview(next);
        };

        const handlePointerMove = (event: PointerEvent) => {
            // Handle insert mode drag
            if (insertState.current?.active) {
                event.preventDefault();
                const surfacePoint = clientToSurfaceCoords(event.clientX, event.clientY);
                updateInsertPreview({
                    startX: insertState.current.startSurfaceX,
                    startY: insertState.current.startSurfaceY,
                    currentX: surfacePoint.x,
                    currentY: surfacePoint.y,
                });
                return;
            }

            // Handle pan
            if (!panState.current.active) {
                return;
            }
            event.preventDefault();
            const dx = event.clientX - panState.current.startX;
            const dy = event.clientY - panState.current.startY;
            stateService.updateViewport({
                offsetX: panState.current.startOffsetX + dx,
                offsetY: panState.current.startOffsetY + dy,
            });
        };

        const stopPan = () => {
            panState.current.active = false;
        };

        const finishInsert = () => {
            if (!insertState.current?.active) return;

            const state = insertState.current;
            insertState.current = null;

            // Get the final bounds BEFORE clearing preview state
            const preview = insertPreviewRef.current;
            if (!preview) return;

            const x = Math.min(preview.startX, preview.currentX);
            const y = Math.min(preview.startY, preview.currentY);
            const width = Math.abs(preview.currentX - preview.startX);
            const height = Math.abs(preview.currentY - preview.startY);

            // Minimum size threshold
            const MIN_SIZE = 10;
            if (width < MIN_SIZE && height < MIN_SIZE) {
                // Too small, cancel the insert
                updateInsertPreview(null);
                return;
            }

            // Clear preview
            updateInsertPreview(null);

            // Create the element
            const element = documentService.createElement(surface.rootElementId, state.nodeType, {
                x: Math.max(0, x),
                y: Math.max(0, y),
                width: Math.max(MIN_SIZE, width),
                height: Math.max(MIN_SIZE, height),
            });

            // Select the new element and switch to select mode
            stateService.setUIElementSelection({
                editor: "ui",
                surfaceId,
                elementIds: [element.id],
                primaryId: element.id,
            });
            stateService.setTool({ kind: "select" });
        };

        const handlePointerUp = () => {
            if (insertState.current?.active) {
                finishInsert();
            }
            stopPan();
        };

        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target as HTMLElement | null;
            const isInsideSurface = !!(target && surfaceElement.contains(target));
            const elementNode = target?.closest?.(SELECTABLE_TARGET) as HTMLElement | null;
            const isElementNode = !!elementNode;

            const isPanTool = tool.kind === "pan" && event.button === 0;
            const isMiddleMouse = event.button === 1;
            if ((isPanTool || isMiddleMouse) && isInsideSurface) {
                event.preventDefault();
                event.stopPropagation();
                panState.current.active = true;
                panState.current.startX = event.clientX;
                panState.current.startY = event.clientY;
                panState.current.startOffsetX = viewport.offsetX;
                panState.current.startOffsetY = viewport.offsetY;
                return;
            }

            // Handle insert mode: start drag-to-create
            if (tool.kind === "insert" && event.button === 0 && isInsideSurface) {
                event.preventDefault();
                event.stopPropagation();
                const surfacePoint = clientToSurfaceCoords(event.clientX, event.clientY);
                insertState.current = {
                    active: true,
                    nodeType: tool.nodeType,
                    startClientX: event.clientX,
                    startClientY: event.clientY,
                    startSurfaceX: surfacePoint.x,
                    startSurfaceY: surfacePoint.y,
                };
                updateInsertPreview({
                    startX: surfacePoint.x,
                    startY: surfacePoint.y,
                    currentX: surfacePoint.x,
                    currentY: surfacePoint.y,
                });
                // Clear current selection when starting insert
                stateService.setSelection({ type: null, data: null });
                return;
            }

            if (tool.kind === "select" && event.button === 0 && isElementNode) {
                const elementId = elementNode?.dataset.uiElementId;
                if (elementId) {
                    if (event.shiftKey && selectionData && selectionData.surfaceId === surfaceId) {
                        const nextIds = selectionData.elementIds.includes(elementId)
                            ? selectionData.elementIds
                            : [...selectionData.elementIds, elementId];
                        stateService.setUIElementSelection({
                            editor: "ui",
                            surfaceId,
                            elementIds: nextIds,
                            primaryId: elementId,
                        });
                    } else {
                        stateService.setUIElementSelection({
                            editor: "ui",
                            surfaceId,
                            elementIds: [elementId],
                            primaryId: elementId,
                        });
                    }
                }
                return;
            }

            if (isInsideSurface && !isElementNode) {
                stateService.setSelection({ type: null, data: null });
            }
        };

        surfaceElement.addEventListener("pointerdown", handlePointerDown);
        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", handlePointerUp);

        return () => {
            surfaceElement.removeEventListener("pointerdown", handlePointerDown);
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handlePointerUp);
            window.removeEventListener("pointercancel", handlePointerUp);
        };
    }, [surfaceElement, stateService, tool, viewport, surfaceId, documentService, selectionData, surface, clientToSurfaceCoords]);

    useEffect(() => {
        if (!surfaceElement || !stateService) {
            return;
        }

        const handleWheel = (event: WheelEvent) => {
            const isZoomInteraction = event.ctrlKey || (tool.kind === "pan" && event.deltaY !== 0);
            event.preventDefault();

            if (isZoomInteraction) {
                const rect = surfaceElement.getBoundingClientRect();
                const pointerX = event.clientX - rect.left;
                const pointerY = event.clientY - rect.top;
                const currentScale = Math.max(0.0001, viewport.scale);
                const zoomSpeed = 0.0015;
                const scaleDelta = Math.exp(-event.deltaY * zoomSpeed);
                const nextScale = Math.max(0.1, Math.min(10, currentScale * scaleDelta));
                if (nextScale === currentScale) {
                    return;
                }
                const surfacePoint = clientToSurfaceCoords(event.clientX, event.clientY);
                const nextOffsetX = pointerX - surfacePoint.x * nextScale;
                const nextOffsetY = pointerY - surfacePoint.y * nextScale;
                stateService.updateViewport({
                    scale: nextScale,
                    offsetX: nextOffsetX,
                    offsetY: nextOffsetY,
                });
                return;
            }

            const panX = -event.deltaX + (event.shiftKey ? -event.deltaY : 0);
            const panY = event.shiftKey ? 0 : -event.deltaY;
            if (panX === 0 && panY === 0) {
                return;
            }
            stateService.updateViewport({
                offsetX: viewport.offsetX + panX,
                offsetY: viewport.offsetY + panY,
            });
        };

        surfaceElement.addEventListener("wheel", handleWheel, { passive: false });
        return () => {
            surfaceElement.removeEventListener("wheel", handleWheel);
        };
    }, [
        surfaceElement,
        stateService,
        tool.kind,
        viewport.scale,
        viewport.offsetX,
        viewport.offsetY,
    ]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Delete" && event.key !== "Backspace") {
                return;
            }
            const target = event.target as HTMLElement | null;
            if (target?.closest?.("input, textarea, [contenteditable='true']")) {
                return;
            }
            if (!selectionData || selectionData.surfaceId !== surfaceId) {
                return;
            }
            event.preventDefault();
            documentService.deleteElements(selectionData.elementIds);
            stateService.setSelection({ type: null, data: null });
        };

        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [selectionData, surfaceId, documentService, stateService]);

    const handleDragStart = (e: OnDragStart) => {
        const elementId = e.target.dataset.uiElementId;
        if (!elementId) {
            return;
        }
        const element = stateService.getDocument().elements[elementId];
        if (element) {
            const normalized = ensureNormalizedLayout(elementId, element.layout, documentService);
            layoutCache.current.set(elementId, normalized);
        }
    };

    const handleDrag = (e: OnDrag) => {
        const [translateX, translateY] = e.beforeTranslate;
        const elementId = e.target.dataset.uiElementId;
        if (elementId) {
            const layout = layoutCache.current.get(elementId);
            const rotation = layout?.rotation;
            e.target.style.transform = buildTransform(translateX, translateY, rotation);
            dragDeltaCache.current.set(elementId, [translateX, translateY]);
        }
    };

    const handleDragEnd = (e: OnDragEnd) => {
        const elementId = e.target.dataset.uiElementId;
        if (!elementId) {
            return;
        }
        const initialLayout = layoutCache.current.get(elementId);
        if (!initialLayout) {
            return;
        }
        const [translateX, translateY] = dragDeltaCache.current.get(elementId) ?? [0, 0];
        documentService.updateElementLayout(elementId, {
            x: initialLayout.x + translateX,
            y: initialLayout.y + translateY,
        });
        applyFinalTransform(e.target, initialLayout.rotation);
        layoutCache.current.delete(elementId);
        dragDeltaCache.current.delete(elementId);
        scheduleMoveableRectUpdate();
    };

    const handleResizeStart = (e: OnResizeStart) => {
        const elementId = e.target.dataset.uiElementId;
        if (!elementId) {
            return;
        }
        const element = stateService.getDocument().elements[elementId];
        if (element) {
            const normalized = ensureNormalizedLayout(elementId, element.layout, documentService);
            layoutCache.current.set(elementId, normalized);
            resizeStartCache.current.set(elementId, {
                clientX: e.clientX,
                clientY: e.clientY,
                layout: normalized,
                direction: e.direction ?? [0, 0],
            });
        }
        e.setMin?.([-Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER]);
    };

    const handleResize = (e: OnResize) => {
        const elementId = e.target.dataset.uiElementId;
        if (!elementId) {
            return;
        }
        const initialLayout = layoutCache.current.get(elementId);
        const startData = resizeStartCache.current.get(elementId);
        if (!startData || !initialLayout) {
            return;
        }
        const {
            width,
            height,
            signedWidth,
            signedHeight,
            translateX,
            translateY,
        } = computeResizePreview(e, startData, viewport.scale);
        e.target.style.width = `${width}px`;
        e.target.style.height = `${height}px`;
        resizeCache.current.set(elementId, { width: signedWidth, height: signedHeight });
        const rotation = initialLayout?.rotation;
        e.target.style.transform = buildTransform(translateX, translateY, rotation);
        dragDeltaCache.current.set(elementId, [translateX, translateY]);
    };

    const handleResizeEnd = (e: OnResizeEnd) => {
        const elementId = e.target.dataset.uiElementId;
        if (!elementId) {
            return;
        }
        const patch: Partial<UILayout> = {};
        const cached = resizeCache.current.get(elementId);
        if (cached?.width !== undefined) {
            patch.width = Math.abs(cached.width);
        }
        if (cached?.height !== undefined) {
            patch.height = Math.abs(cached.height);
        }
        const initialLayout = layoutCache.current.get(elementId);
        const [translateX, translateY] = dragDeltaCache.current.get(elementId) ?? [0, 0];
        if (initialLayout) {
            patch.x = initialLayout.x + translateX;
            patch.y = initialLayout.y + translateY;
        }
        if (Object.keys(patch).length > 0) {
            documentService.updateElementLayout(elementId, patch);
        }
        layoutCache.current.delete(elementId);
        resizeCache.current.delete(elementId);
        resizeStartCache.current.delete(elementId);
        dragDeltaCache.current.delete(elementId);
        applyFinalTransform(e.target, initialLayout?.rotation);
        if (cached) {
            // Set final dimensions explicitly instead of clearing to "".
            // React skips DOM updates for style properties whose vdom value
            // hasn't changed between renders, so clearing an axis that didn't
            // change during the resize would leave it without a value and
            // cause the element to visually collapse on that axis.
            const finalWidth = patch.width ?? (initialLayout ? Math.abs(initialLayout.width) : 0);
            const finalHeight = patch.height ?? (initialLayout ? Math.abs(initialLayout.height) : 0);
            e.target.style.width = `${finalWidth}px`;
            e.target.style.height = `${finalHeight}px`;
        } else {
            e.target.style.width = "";
            e.target.style.height = "";
        }
        // Set final position explicitly to prevent a flash when the CSS
        // translate is cleared but React hasn't re-rendered with the new
        // layout yet.  This is especially important for rotated elements
        // where even a single-axis resize changes both x and y.
        if (patch.x !== undefined) {
            e.target.style.left = `${patch.x}px`;
        }
        if (patch.y !== undefined) {
            e.target.style.top = `${patch.y}px`;
        }
        scheduleMoveableRectUpdate();
    };

    const handleRotateStart = (e: OnRotateStart) => {
        const elementId = e.target.dataset.uiElementId;
        if (!elementId) {
            return;
        }
        const element = stateService.getDocument().elements[elementId];
        if (element) {
            const normalized = ensureNormalizedLayout(elementId, element.layout, documentService);
            layoutCache.current.set(elementId, normalized);
        }
    };

    const handleRotate = (e: OnRotate) => {
        const elementId = e.target.dataset.uiElementId;
        const rotation = Number.isFinite(e.beforeRotate) ? e.beforeRotate : e.rotate;
        if (!elementId) {
            e.target.style.transform = e.transform;
            return;
        }
        if (Number.isFinite(rotation)) {
            rotateCache.current.set(elementId, rotation);
        }
        const layout = layoutCache.current.get(elementId);
        const translateX = e.drag?.beforeTranslate?.[0] ?? 0;
        const translateY = e.drag?.beforeTranslate?.[1] ?? 0;
        e.target.style.transform = buildTransform(translateX, translateY, rotation);
    };

    const handleRotateEnd = (e: OnRotateEnd) => {
        const elementId = e.target.dataset.uiElementId;
        if (!elementId) {
            return;
        }
        const rotation = rotateCache.current.get(elementId);
        if (rotation !== undefined) {
            documentService.updateElementLayout(elementId, { rotation });
        }
        const currentLayout = layoutCache.current.get(elementId);
        layoutCache.current.delete(elementId);
        rotateCache.current.delete(elementId);
        applyFinalTransform(e.target, rotation);
        scheduleMoveableRectUpdate();
    };

    return (
        <>
            {tool.kind === "select" && (
                <>
                    <Selecto
                        container={surfaceElement ?? undefined}
                        dragContainer={surfaceElement ?? undefined}
                        selectableTargets={[SELECTABLE_TARGET]}
                        hitRate={0}
                        selectByClick={true}
                        selectFromInside={false}
                        toggleContinueSelect={["shift"]}
                        ratio={0}
                        onSelectEnd={handleSelectEnd}
                    />
                    <Moveable
                        ref={moveableRef}
                        target={selectedTargets}
                        container={surfaceElement ?? undefined}
                        draggable={true}
                        resizable={true}
                        rotatable={true}
                        keepRatio={false}
                        origin={true}
                        zoom={viewport.scale}
                        throttleDrag={0}
                        throttleResize={0}
                        onDragStart={handleDragStart}
                        onDrag={handleDrag}
                        onDragEnd={handleDragEnd}
                        onResizeStart={handleResizeStart}
                        onResize={handleResize}
                        onResizeEnd={handleResizeEnd}
                        onRotateStart={handleRotateStart}
                        onRotate={handleRotate}
                        onRotateEnd={handleRotateEnd}
                    />
                </>
            )}

            {/* Insert mode preview overlay */}
            {tool.kind === "insert" && insertPreview && (
                <InsertPreviewOverlay preview={insertPreview} viewport={viewport} />
            )}
        </>
    );
}
