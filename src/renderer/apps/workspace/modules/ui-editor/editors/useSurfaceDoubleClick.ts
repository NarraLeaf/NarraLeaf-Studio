import { useCallback } from "react";
import { SELECTABLE_TARGET } from "@/lib/ui-editor/interaction/constants";
import { consumeSuppressNextCanvasWidgetDoubleClick } from "@/lib/ui-editor/interaction/containerDrillSelection";
import { beginInlineTextEdit, isInlineTextEditableElement } from "@/lib/ui-editor/interaction/inlineTextEdit";
import { getImageWidgetRectangleProps } from "@/lib/ui-editor/widget-modules/builtin/image/helpers";
import { getRectangleLikeProps, normalizeImageFill } from "@/lib/ui-editor/widget-modules/shared/chrome/rectangleHelpers";
import type { ImageFill } from "@shared/types/ui-editor/imageFill";
import type { UITool } from "@/lib/ui-editor/editor/types";
import type { EditorDocumentService, EditorStateService } from "@/apps/workspace/modules/ui-editor/editors/useSurfaceEditorTabModel";

const MOVEABLE_DOUBLE_CLICK_TARGET =
    ".moveable, .moveable-control, .moveable-line, .moveable-rotation, .moveable-rotation-handle, .moveable-area";

export function useSurfaceDoubleClick(params: {
    surfaceId: string;
    tool: UITool;
    stateService: EditorStateService;
    documentService: EditorDocumentService;
}) {
    const { surfaceId, tool, stateService, documentService } = params;

    return useCallback(
        (event: React.MouseEvent<HTMLDivElement>) => {
            if (!stateService || !documentService || !surfaceId) {
                return;
            }
            if (tool.kind !== "select") {
                return;
            }
            const suppressWidgetDoubleClick = consumeSuppressNextCanvasWidgetDoubleClick();
            const target = event.target as HTMLElement | null;
            if (!target) {
                return;
            }
            if (target.closest("textarea, input, [contenteditable='true']")) {
                return;
            }
            const editorDocument = documentService.getDocument();
            const beginTextEdit = (elementId: string) => {
                const element = editorDocument.elements[elementId];
                if (!isInlineTextEditableElement(element)) {
                    return false;
                }
                event.preventDefault();
                event.stopPropagation();
                beginInlineTextEdit(stateService, surfaceId, elementId);
                return true;
            };
            const selection = stateService.getSelection();
            const selectionData = selection.type === "element" ? selection.data : null;
            const selectedSingleElementId =
                selectionData != null && selectionData.surfaceId === surfaceId && selectionData.elementIds.length === 1
                    ? selectionData.elementIds[0]
                    : null;
            if (target.closest(MOVEABLE_DOUBLE_CLICK_TARGET)) {
                if (selectedSingleElementId && beginTextEdit(selectedSingleElementId)) {
                    return;
                }
                return;
            }
            const elementNode = target.closest(SELECTABLE_TARGET) as HTMLElement | null;
            if (!elementNode) {
                return;
            }
            const elementId = elementNode.dataset.uiElementId;
            if (!elementId) {
                return;
            }
            const isSelectedElement =
                selectionData != null &&
                selectionData.surfaceId === surfaceId &&
                selectionData.elementIds.length === 1 &&
                selectionData.elementIds[0] === elementId;
            const element = editorDocument.elements[elementId];
            if (!element) {
                return;
            }
            if (beginTextEdit(elementId)) {
                return;
            }
            if (!isSelectedElement) {
                return;
            }
            if (suppressWidgetDoubleClick) {
                return;
            }
            const isContainer = element.type === "nl.container";
            const isImageWidget = element.type === "nl.image";
            if (!isContainer && !isImageWidget) {
                return;
            }
            const props = isImageWidget ? getImageWidgetRectangleProps(element) : getRectangleLikeProps(element);
            if (props.fillType !== "image") {
                return;
            }
            const fill = normalizeImageFill(props);
            const hasImageSource = Boolean(fill?.assetId) || Boolean(props.backgroundImage?.trim());
            if (!hasImageSource) {
                return;
            }
            if (fill?.mode !== "crop") {
                const nextFill: ImageFill = {
                    ...(fill ?? { mode: "cover", assetId: null }),
                    mode: "crop",
                };
                documentService.updateElementProps(elementId, {
                    ...(element.props ?? {}),
                    fillType: "image",
                    imageFill: nextFill,
                });
            }
            stateService.setInteractionOverride({
                kind: "imageCrop",
                surfaceId,
                elementId,
                source: "surfaceDoubleClick",
            });
        },
        [documentService, stateService, surfaceId, tool.kind]
    );
}
