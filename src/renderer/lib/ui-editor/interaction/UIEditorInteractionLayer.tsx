import React, { useCallback, useEffect, useMemo, useState, useRef } from "react";
import Selecto from "react-selecto";
import Moveable from "react-moveable";
import { ViewportTransform, clientToSurface, Rect2D } from "../geometry";
import { isHTMLElement } from "./utils";
import { useSurfaceInteractionEvents } from "./useSurfaceInteractionEvents";
import { UIEditorStateService } from "@services/ui-editor/UIEditorStateService";
import { isUIElementSelection } from "@services/ui/UIStore";
import { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UISurface } from "@shared/types/ui-editor/document";
import type { UITool } from "@/lib/ui-editor/editor/types";
import { PRIMARY_OUTLINE_STRONG, PRIMARY_OUTLINE_WEAK, SELECTABLE_TARGET } from "./constants";
import type { InsertPreview } from "./useSurfaceInteractionEvents";
import { useTransformController } from "./controllers/TransformController";
import { useImageCropController } from "./controllers/ImageCropController";

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
    showOutlines?: boolean;
};
export function UIEditorInteractionLayer({ surfaceId, surface, containerRef, showOutlines = true }: Props) {
    const stateService = UIEditorStateService.getInstance();
    const [selection, setSelection] = useState(stateService.getSelection());
    const previousSelectedTargets = useRef<HTMLElement[]>([]);
    const outlineCache = useRef<WeakMap<HTMLElement, { outline?: string; outlineOffset?: string }>>(new WeakMap());
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
    const selectionIds = selectionData?.elementIds ?? [];
    const primaryId = selectionData?.primaryId ?? selectionIds[selectionIds.length - 1];
    const isGroupSelection = selectionIds.length > 1;
    const transformLocks = useRef(0);
    const [selectionEnabled, setSelectionEnabled] = useState(true);

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
        stateService.setUIElementSelection({
            editor: "ui",
            surfaceId,
            elementIds: targetIds,
            primaryId: targetIds[targetIds.length - 1],
        });
    };

    const isMoveableControlTarget = useCallback((target: Element | null | undefined) => {
        return Boolean(
            target?.closest(
                ".moveable, .moveable-control, .moveable-line, .moveable-rotation, .moveable-rotation-handle, .moveable-area",
            ),
        );
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

    const SELECTO_CLASS_NAME = "narraleaf-selecto";

    return (
        <>
            {tool.kind === "select" && (
                <>
                    <Selecto
                        className={SELECTO_CLASS_NAME}
                        container={surfaceElement ?? undefined}
                        rootContainer={surfaceElement ?? undefined}
                        dragContainer={surfaceElement ?? undefined}
                        boundContainer={surfaceElement ?? undefined}
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
                        container={surfaceElement ?? undefined}
                        {...activeController.moveableProps}
                    />
                    {activeController.overlay}
                </>
            )}

            {/* Insert mode preview overlay */}
            {tool.kind === "insert" && insertPreview && (
                <InsertPreviewOverlay preview={insertPreview} viewport={viewport} />
            )}
        </>
    );
}
