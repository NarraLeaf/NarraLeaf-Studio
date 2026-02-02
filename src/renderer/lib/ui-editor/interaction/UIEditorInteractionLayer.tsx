import React, { useEffect, useMemo, useState, useRef } from "react";
import Selecto from "react-selecto";
import Moveable from "react-moveable";
import type { OnDrag, OnResize, OnDragStart, OnDragEnd, OnResizeEnd } from "react-moveable";
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
    const layoutCache = useRef<Map<string, UIElement["layout"]>>(new Map());
    const dragDeltaCache = useRef<Map<string, [number, number]>>(new Map());
    const resizeCache = useRef<Map<string, { width?: number; height?: number }>>(new Map());
    const documentService = UIDocumentService.getInstance();

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

    const outlineRects = useMemo(() => {
        if (!surfaceElement) {
            return [];
        }
        const surfaceRect = surfaceElement.getBoundingClientRect();
        return selectedTargets.map(target => {
            const rect = target.getBoundingClientRect();
            return {
                id: target.dataset.uiElementId ?? "",
                left: rect.left - surfaceRect.left,
                top: rect.top - surfaceRect.top,
                width: rect.width,
                height: rect.height,
            };
        });
    }, [selectedTargets, surfaceElement, viewport]);

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
            const isElementNode = !!target?.closest?.(SELECTABLE_TARGET);

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
    }, [surfaceElement, stateService, tool, viewport, surfaceId, documentService]);

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
        e.target.style.transform = `translate(${translateX}px, ${translateY}px)`;
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
        const scale = Math.max(0.0001, viewport.scale);
        documentService.updateElementLayout(elementId, {
            x: initialLayout.x + translateX / scale,
            y: initialLayout.y + translateY / scale,
        });
        e.target.style.transform = "";
        layoutCache.current.delete(elementId);
        dragDeltaCache.current.delete(elementId);
    };

    const handleResize = (e: OnResize) => {
        const scale = Math.max(0.0001, viewport.scale);
        e.target.style.width = `${e.width / scale}px`;
        e.target.style.height = `${e.height / scale}px`;
        const elementId = e.target.dataset.uiElementId;
        if (elementId) {
            resizeCache.current.set(elementId, { width: e.width / scale, height: e.height / scale });
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
        if (Object.keys(patch).length > 0) {
            documentService.updateElementLayout(elementId, patch);
        }
        layoutCache.current.delete(elementId);
        resizeCache.current.delete(elementId);
        e.target.style.transform = "";
    };

    return (
        <>
            {showOutlines && (
                <div className="pointer-events-none absolute inset-0 z-10">
                    {outlineRects.map(rect => (
                        <div
                            key={rect.id}
                            className="absolute box-border"
                            style={{
                                left: rect.left,
                                top: rect.top,
                                width: rect.width,
                                height: rect.height,
                                border:
                                    rect.id === primaryId
                                        ? "1px solid rgba(123, 97, 255, 0.9)"
                                        : "1px dashed rgba(123, 97, 255, 0.6)",
                            }}
                        />
                    ))}
                </div>
            )}
            {tool.kind === "select" && (
                <>
                    <Selecto
                        container={surfaceElement ?? undefined}
                        dragContainer={surfaceElement ?? undefined}
                        selectableTargets={[SELECTABLE_TARGET]}
                        hitRate={0}
                        selectByClick={true}
                        selectFromInside={true}
                        toggleContinueSelect={["shift"]}
                        ratio={0}
                        onSelectEnd={handleSelectEnd}
                    />
                    <Moveable
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
                        onResize={handleResize}
                        onResizeEnd={handleResizeEnd}
                    />
                </>
            )}
        </>
    );
}
