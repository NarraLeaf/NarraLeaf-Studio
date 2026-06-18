import { useCallback } from "react";
import { SELECTABLE_TARGET } from "@/lib/ui-editor/interaction/constants";
import {
    consumeSuppressNextCanvasWidgetDoubleClick,
    hasSuppressNextCanvasWidgetDoubleClick,
} from "@/lib/ui-editor/interaction/containerDrillSelection";
import { beginInlineTextEdit, isInlineTextEditableElement } from "@/lib/ui-editor/interaction/inlineTextEdit";
import { isUIElementSelection } from "@/lib/workspace/services/ui/UIStore";
import type { UITool } from "@/lib/ui-editor/editor/types";
import type { EditorDocumentService, EditorStateService } from "@/apps/workspace/modules/ui-editor/editors/useSurfaceEditorTabModel";
import {
    getSingleSelectedElementId,
    MOVEABLE_DOUBLE_CLICK_TARGET_SELECTOR,
} from "@/lib/ui-editor/interaction/surfaceInlineTextEditActivation";
import { beginImageCropEdit } from "@/lib/ui-editor/interaction/imageCropEdit";
import {
    debugUIDoubleClick,
    describeDoubleClickTarget,
} from "@/lib/ui-editor/interaction/doubleClickDebug";

type SurfaceDoubleClickEvent = {
    target: EventTarget | null;
    type?: string;
    clientX?: number;
    clientY?: number;
    preventDefault: () => void;
    stopPropagation: () => void;
};

function uniquePush(target: string[], value: string | null | undefined): void {
    if (!value || target.includes(value)) {
        return;
    }
    target.push(value);
}

function getElementIdFromNode(node: Element | null): string | null {
    const elementNode = node?.closest(SELECTABLE_TARGET) as HTMLElement | null;
    return elementNode?.dataset.uiElementId ?? null;
}

function getPointElementId(event: SurfaceDoubleClickEvent, target: Element): string | null {
    if (typeof event.clientX !== "number" || typeof event.clientY !== "number") {
        return null;
    }
    const doc = target.ownerDocument;
    const hitStack = doc.elementsFromPoint(event.clientX, event.clientY);
    for (const hit of hitStack) {
        if (hit.closest(MOVEABLE_DOUBLE_CLICK_TARGET_SELECTOR)) {
            continue;
        }
        const id = getElementIdFromNode(hit);
        if (id) {
            return id;
        }
    }
    return null;
}

export function useSurfaceDoubleClick(params: {
    surfaceId: string;
    tool: UITool;
    stateService: EditorStateService;
    documentService: EditorDocumentService;
}) {
    const { surfaceId, tool, stateService, documentService } = params;

    return useCallback(
        (event: SurfaceDoubleClickEvent) => {
            if (!stateService || !documentService || !surfaceId) {
                return;
            }
            if (tool.kind !== "select") {
                return;
            }
            const target = event.target instanceof Element ? event.target : null;
            if (!target) {
                return;
            }
            if (target.closest("textarea, input, [contenteditable='true']")) {
                debugUIDoubleClick("ignored editable target", {
                    target: describeDoubleClickTarget(target),
                });
                return;
            }
            const editorDocument = documentService.getDocument();
            const selection = stateService.getSelection();
            const selectionData = isUIElementSelection(selection) ? selection.data : null;
            const selectedSingleElementId = getSingleSelectedElementId(selectionData, surfaceId);
            const suppressWidgetDoubleClick =
                event.type === "mousedown"
                    ? hasSuppressNextCanvasWidgetDoubleClick()
                    : consumeSuppressNextCanvasWidgetDoubleClick();
            const beginTextEdit = (elementId: string) => {
                const element = editorDocument.elements[elementId];
                const editable = isInlineTextEditableElement(element);
                const isSelectedSingle = elementId === selectedSingleElementId;
                debugUIDoubleClick("text candidate", {
                    elementId,
                    type: element?.type,
                    editable,
                    isSelectedSingle,
                    selectedSingleElementId,
                });
                if (!editable || !isSelectedSingle) {
                    return false;
                }
                event.preventDefault();
                event.stopPropagation();
                beginInlineTextEdit(stateService, surfaceId, elementId);
                return true;
            };

            const isMoveableTarget = Boolean(target.closest(MOVEABLE_DOUBLE_CLICK_TARGET_SELECTOR));
            const candidateElementIds: string[] = [];
            uniquePush(candidateElementIds, isMoveableTarget ? null : getElementIdFromNode(target));
            uniquePush(candidateElementIds, getPointElementId(event, target));
            uniquePush(candidateElementIds, isMoveableTarget ? selectedSingleElementId : null);

            debugUIDoubleClick("surface dblclick", {
                surfaceId,
                tool: tool.kind,
                eventType: event.type,
                target: describeDoubleClickTarget(target),
                clientX: event.clientX,
                clientY: event.clientY,
                isMoveableTarget,
                selectedSingleElementId,
                suppressWidgetDoubleClick,
                candidateElementIds,
                candidateTypes: candidateElementIds.map(id => editorDocument.elements[id]?.type ?? null),
            });

            if (suppressWidgetDoubleClick) {
                debugUIDoubleClick("suppressed widget doubleclick after hierarchy drill", {
                    surfaceId,
                    selectedSingleElementId,
                    candidateElementIds,
                });
                return;
            }

            if (candidateElementIds.some(beginTextEdit)) {
                debugUIDoubleClick("handled text edit", {
                    candidateElementIds,
                });
                return;
            }
            for (const elementId of candidateElementIds) {
                if (
                    beginImageCropEdit({
                        documentService,
                        stateService,
                        surfaceId,
                        elementId,
                        source: "surfaceDoubleClick",
                    })
                ) {
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }
            }
        },
        [documentService, stateService, surfaceId, tool.kind]
    );
}
