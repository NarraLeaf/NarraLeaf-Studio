import React, { useCallback, useEffect, useMemo, useState, useRef } from "react";
import Selecto from "react-selecto";
import Moveable from "react-moveable";
import type { OnDrag, OnResize, OnDragStart, OnDragEnd, OnResizeEnd, OnResizeStart } from "react-moveable";
import { ViewportTransform } from "../geometry";
import { UIEditorStateService } from "@services/ui-editor/UIEditorStateService";
import { isUIElementSelection } from "@services/ui/UIStore";
import { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UIElement, UILayout } from "@shared/types/ui-editor/document";
import type { UITool } from "@/lib/ui-editor/editor/types";

const SELECTABLE_TARGET = ".ui-editor-node:not(.ui-editor-node-root)";

type Props = {
    surfaceId: string;
    containerRef: React.RefObject<HTMLElement | null>;
    showOutlines?: boolean;
};

function isHTMLElement(node: Element | null): node is HTMLElement {
    return node instanceof HTMLElement;
}

export function UIEditorInteractionLayer({ surfaceId, containerRef, showOutlines = true }: Props) {
    const stateService = UIEditorStateService.getInstance();
    const [selection, setSelection] = useState(stateService.getSelection());
    const previousSelectedTargets = useRef<HTMLElement[]>([]);
    const outlineCache = useRef<WeakMap<HTMLElement, { outline?: string; outlineOffset?: string }>>(new WeakMap());
    const layoutCache = useRef<Map<string, UIElement["layout"]>>(new Map());
    const dragDeltaCache = useRef<Map<string, [number, number]>>(new Map());
    const resizeCache = useRef<Map<string, { width?: number; height?: number }>>(new Map());
    const documentService = UIDocumentService.getInstance();
    type MoveableInstance = React.ElementRef<typeof Moveable>;
    const moveableRef = useRef<MoveableInstance | null>(null);

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

    useEffect(() => {
        if (!surfaceElement) {
            return;
        }

        const handlePointerMove = (event: PointerEvent) => {
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
        window.addEventListener("pointerup", stopPan);
        window.addEventListener("pointercancel", stopPan);

        return () => {
            surfaceElement.removeEventListener("pointerdown", handlePointerDown);
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", stopPan);
            window.removeEventListener("pointercancel", stopPan);
        };
    }, [surfaceElement, stateService, tool, viewport, surfaceId, documentService, selectionData]);

    useEffect(() => {
        if (!surfaceElement || !stateService) {
            return;
        }
        const handleWheel = (event: WheelEvent) => {
            const shouldZoom = event.ctrlKey || tool.kind === "pan";
            if (!shouldZoom) {
                return;
            }
            event.preventDefault();
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
            const nextOffsetX = viewport.offsetX + pointerX * (1 / nextScale - 1 / currentScale);
            const nextOffsetY = viewport.offsetY + pointerY * (1 / nextScale - 1 / currentScale);
            stateService.updateViewport({
                scale: nextScale,
                offsetX: nextOffsetX,
                offsetY: nextOffsetY,
            });
        };

        surfaceElement.addEventListener("wheel", handleWheel, { passive: false });
        return () => {
            surfaceElement.removeEventListener("wheel", handleWheel);
        };
    }, [surfaceElement, stateService, tool.kind, viewport]);

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
            layoutCache.current.set(elementId, element.layout);
        }
    };

    const handleDrag = (e: OnDrag) => {
        const [translateX, translateY] = e.beforeTranslate;
        e.target.style.transform = e.transform;
        const elementId = e.target.dataset.uiElementId;
        if (elementId) {
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
        e.target.style.transform = "";
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
            layoutCache.current.set(elementId, element.layout);
        }
    };

    const handleResize = (e: OnResize) => {
        e.target.style.width = `${e.width}px`;
        e.target.style.height = `${e.height}px`;
        const elementId = e.target.dataset.uiElementId;
        if (elementId) {
            resizeCache.current.set(elementId, { width: e.width, height: e.height });
            if (e.drag) {
                e.target.style.transform = e.drag.transform;
                const translate = e.drag.beforeTranslate;
                dragDeltaCache.current.set(elementId, [translate[0] ?? 0, translate[1] ?? 0]);
            }
        }
    };

    const handleResizeEnd = (e: OnResizeEnd) => {
        const elementId = e.target.dataset.uiElementId;
        if (!elementId) {
            return;
        }
        const patch: Partial<UILayout> = {};
        const cached = resizeCache.current.get(elementId);
        if (cached?.width !== undefined) {
            patch.width = cached.width;
        }
        if (cached?.height !== undefined) {
            patch.height = cached.height;
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
        dragDeltaCache.current.delete(elementId);
        e.target.style.transform = "";
        e.target.style.width = "";
        e.target.style.height = "";
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
                    />
                </>
            )}
        </>
    );
}
