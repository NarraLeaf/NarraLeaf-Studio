import type { UIElement } from "@shared/types/ui-editor/document";
import type { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";

export function isInlineTextEditableElement(element: UIElement | null | undefined): element is UIElement {
    return element?.type === "nl.text" || element?.type === "nl.button";
}

export function beginInlineTextEdit(
    stateService: UIEditorStateService,
    surfaceId: string,
    elementId: string,
): void {
    stateService.setUIElementSelection({
        editor: "ui",
        surfaceId,
        elementIds: [elementId],
        primaryId: elementId,
    });
    stateService.setInteractionOverride({
        kind: "textEdit",
        surfaceId,
        elementId,
    });
}
