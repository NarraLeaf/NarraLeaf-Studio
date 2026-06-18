import type { UIElement } from "@shared/types/ui-editor/document";
import type { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import { debugUIDoubleClick } from "./doubleClickDebug";

export function isInlineTextEditableElement(element: UIElement | null | undefined): element is UIElement {
    return element?.type === "nl.text" || element?.type === "nl.button";
}

export function beginInlineTextEdit(
    stateService: UIEditorStateService,
    surfaceId: string,
    elementId: string,
): void {
    const current = stateService.getInteractionOverride();
    debugUIDoubleClick("beginInlineTextEdit", {
        surfaceId,
        elementId,
        currentOverride: current,
    });
    if (
        current?.kind === "textEdit" &&
        current.surfaceId === surfaceId &&
        current.elementId === elementId
    ) {
        debugUIDoubleClick("clear stale textEdit override", {
            surfaceId,
            elementId,
        });
        stateService.setInteractionOverride(null);
    }
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
    debugUIDoubleClick("textEdit override set", {
        surfaceId,
        elementId,
        nextOverride: stateService.getInteractionOverride(),
    });
}
