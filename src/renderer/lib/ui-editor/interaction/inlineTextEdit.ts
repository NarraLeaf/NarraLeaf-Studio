import type { UIElement } from "@shared/types/ui-editor/document";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import { debugUIDoubleClick } from "./doubleClickDebug";

export type InlineTextEditHost = {
  stateService: UIEditorStateService;
  documentService: UIDocumentService;
};

export function isInlineTextEditableElement(
  element: UIElement | null | undefined
): element is UIElement {
  return element?.type === "nl.text" || element?.type === "nl.button";
}

/**
 * Resolve the services an inline text edit may write through, or null when this renderer must stay
 * read-only.
 *
 * The `textEdit` override names only a surface and an element, but a surface is rendered in more
 * places than the editor canvas: the surfaces panel previews every surface, including the one open
 * in the editor tab. Those previews used to fall back to the singleton services, so they matched the
 * override too and mounted their own textarea for the edited element - then committed their own
 * stale draft when the override cleared, overwriting whatever the canvas had just saved. Only the
 * editor tab passes its services on the adapter, so requiring them here keeps exactly one editor per
 * element.
 *
 * **A read-only surface answers null too**, which is the one place a frozen workspace reaches the
 * text and button widgets. Their double-click is attached inside their own markup rather than by the
 * canvas, so `isSurfaceGestureEnabled("inlineTextEdit", ...)` - which the interaction layer and
 * `useSurfaceDoubleClick` both consult - never saw it: measured on a frozen workspace, a
 * double-click on a text element still opened its editor, still accepted typing, and threw the
 * result away on thaw. Refusing the services here switches off the whole path at once (the
 * double-click handler returns early without them, and no textarea can mount), and it makes a frozen
 * canvas behave exactly like the previews that have always resolved to null.
 */
export function resolveInlineTextEditHost(hostAdapter: UIHostAdapter): InlineTextEditHost | null {
  const { editorStateService, editorDocumentService, blueprintRuntime, editorReadOnly } =
    hostAdapter;
  if (blueprintRuntime || editorReadOnly?.active || !editorStateService || !editorDocumentService) {
    return null;
  }
  return { stateService: editorStateService, documentService: editorDocumentService };
}

export function beginInlineTextEdit(
  stateService: UIEditorStateService,
  surfaceId: string,
  elementId: string
): void {
  const current = stateService.getInteractionOverride();
  debugUIDoubleClick("beginInlineTextEdit", {
    surfaceId,
    elementId,
    currentOverride: current
  });
  if (
    current?.kind === "textEdit" &&
    current.surfaceId === surfaceId &&
    current.elementId === elementId
  ) {
    debugUIDoubleClick("clear stale textEdit override", {
      surfaceId,
      elementId
    });
    stateService.setInteractionOverride(null);
  }
  stateService.setUIElementSelection({
    editor: "ui",
    surfaceId,
    elementIds: [elementId],
    primaryId: elementId
  });
  stateService.setInteractionOverride({
    kind: "textEdit",
    surfaceId,
    elementId
  });
  debugUIDoubleClick("textEdit override set", {
    surfaceId,
    elementId,
    nextOverride: stateService.getInteractionOverride()
  });
}
