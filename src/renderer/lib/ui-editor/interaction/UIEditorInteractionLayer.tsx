import React, { useEffect, useMemo, useState } from "react";
import Selecto from "react-selecto";
import Moveable from "react-moveable";
import type { OnDrag, OnResize } from "react-moveable";
import { UIEditorStateService } from "@services/ui-editor/UIEditorStateService";
import { isUIElementSelection } from "@services/ui/UIStore";

const SELECTABLE_TARGET = ".ui-editor-node:not(.ui-editor-node-root)";

type Props = {
    surfaceId: string;
    containerRef: React.RefObject<HTMLElement>;
};

function isHTMLElement(node: Element | null): node is HTMLElement {
    return node instanceof HTMLElement;
}

export function UIEditorInteractionLayer({ surfaceId, containerRef }: Props) {
    const stateService = UIEditorStateService.getInstance();
    const [selection, setSelection] = useState(stateService.getSelection());

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

    const handleDrag = (e: OnDrag) => {
        const [translateX, translateY] = e.beforeTranslate;
        e.target.style.transform = `translate(${translateX}px, ${translateY}px)`;
    };

    const handleResize = (e: OnResize) => {
        e.target.style.width = `${e.width}px`;
        e.target.style.height = `${e.height}px`;
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
                onDrag={handleDrag}
                onResize={handleResize}
            />
        </>
    );
}
