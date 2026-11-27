import { useEffect, useLayoutEffect, useState } from "react";
import type { UIDocument } from "@shared/types/ui-editor/document";
import type { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";

/** Whether `elementId` or any element above it carries the flag. */
export function hasFlagOnChain(document: UIDocument, elementId: string, flagged: (id: string) => boolean): boolean {
    let cur: string | null = elementId;
    for (let guard = 0; cur && guard < 256; guard++) {
        if (flagged(cur)) {
            return true;
        }
        cur = document.elements[cur]?.parentId ?? null;
    }
    return false;
}

const LOCKED_ATTR = "data-ui-editor-locked";
const HIDDEN_ATTR = "data-ui-editor-hidden";
/** What a node's own inline value was before a flag replaced it, so clearing the flag puts it back. */
const SAVED_POINTER_EVENTS = "data-ui-editor-saved-pe";

/**
 * The outline's editor-only flags, drawn onto the canvas.
 *
 * - Locked: the layer and everything inside it take no pointer, so a press goes to what is behind
 *   (a locked full-screen background stops swallowing every click and marquee), and it drops out of
 *   what a press can pick (`SELECTABLE_TARGET`).
 * - Hidden on the canvas: the layer is not drawn. The game is not touched: its visibility is
 *   `layout.visible`, which the properties panel sets.
 *
 * Written onto the drawn nodes rather than into the render: neither is part of the document, and the
 * canvas tree renders from the document alone. Re-applied whenever the document or the flags change.
 * Returns the flags' revision, for what else has to follow them.
 */
export function useEditorLayerFlags(
    surfaceElement: HTMLElement | null,
    stateService: UIEditorStateService,
    documentService: UIDocumentService,
    documentRevision: number,
): number {
    const [flagsRevision, setFlagsRevision] = useState(0);
    useEffect(() => stateService.on("editorLayerFlagsChanged", () => setFlagsRevision(v => v + 1)), [stateService]);

    useLayoutEffect(() => {
        if (!surfaceElement) {
            return;
        }
        const document = documentService.getDocument();
        for (const node of Array.from(surfaceElement.querySelectorAll<HTMLElement>(`[${LOCKED_ATTR}], [${HIDDEN_ATTR}]`))) {
            if (node.hasAttribute(LOCKED_ATTR)) {
                node.removeAttribute(LOCKED_ATTR);
                node.style.pointerEvents = node.getAttribute(SAVED_POINTER_EVENTS) ?? "";
                node.removeAttribute(SAVED_POINTER_EVENTS);
            }
            if (node.hasAttribute(HIDDEN_ATTR)) {
                node.removeAttribute(HIDDEN_ATTR);
                node.style.visibility = "";
            }
        }
        const locked = (id: string) => stateService.isElementLocked(id);
        for (const node of Array.from(surfaceElement.querySelectorAll<HTMLElement>("[data-ui-element-id]"))) {
            const elementId = node.dataset.uiElementId;
            if (!elementId || !document.elements[elementId]) {
                continue;
            }
            if (hasFlagOnChain(document, elementId, locked)) {
                node.setAttribute(SAVED_POINTER_EVENTS, node.style.pointerEvents);
                node.setAttribute(LOCKED_ATTR, "");
                node.style.pointerEvents = "none";
            }
            if (stateService.isElementHiddenInEditor(elementId)) {
                node.setAttribute(HIDDEN_ATTR, "");
                node.style.visibility = "hidden";
            }
        }
    }, [documentRevision, documentService, flagsRevision, stateService, surfaceElement]);

    return flagsRevision;
}
