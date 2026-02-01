import React, { useEffect, useMemo, useState, useRef } from "react";
import Selecto from "react-selecto";
import Moveable from "react-moveable";
import type { OnDrag, OnResize, OnDragStart, OnDragEnd, OnResizeEnd } from "react-moveable";
import { UIEditorStateService } from "@services/ui-editor/UIEditorStateService";
import { isUIElementSelection } from "@services/ui/UIStore";
import { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UIElement, UILayout } from "@shared/types/ui-editor/document";

const SELECTABLE_TARGET = ".ui-editor-node:not(.ui-editor-node-root)";

type Props = {
    surfaceId: string;
    containerRef: React.RefObject<HTMLElement | null>;
};

function isHTMLElement(node: Element | null): node is HTMLElement {
    return node instanceof HTMLElement;
}

export function UIEditorInteractionLayer({ surfaceId, containerRef }: Props) {
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
    useEffect(() => {
        if (!surfaceElement) {
            return;
        }
        const handlePointerDown = (event: PointerEvent) => {
            if (event.target === surfaceElement) {
                stateService.setSelection({ type: null, data: null });
            }
        };
        surfaceElement.addEventListener("pointerdown", handlePointerDown);
        return () => surfaceElement.removeEventListener("pointerdown", handlePointerDown);
    }, [surfaceElement, stateService]);

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
        documentService.updateElementLayout(elementId, {
            x: initialLayout.x + translateX,
            y: initialLayout.y + translateY,
        });
        e.target.style.transform = "";
        layoutCache.current.delete(elementId);
        dragDeltaCache.current.delete(elementId);
    };

    const handleResize = (e: OnResize) => {
        e.target.style.width = `${e.width}px`;
        e.target.style.height = `${e.height}px`;
        const elementId = e.target.dataset.uiElementId;
        if (elementId) {
            resizeCache.current.set(elementId, { width: e.width, height: e.height });
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
                throttleDrag={0}
                throttleResize={0}
                onDragStart={handleDragStart}
                onDrag={handleDrag}
                onDragEnd={handleDragEnd}
                onResize={handleResize}
                onResizeEnd={handleResizeEnd}
            />
        </>
    );
}
