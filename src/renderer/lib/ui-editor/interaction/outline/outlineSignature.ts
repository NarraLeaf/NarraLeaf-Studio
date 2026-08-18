import type { UIDocument } from "@shared/types/ui-editor/document";
import { resolveSurfaceRootElementId } from "@/lib/ui-editor/runtime/resolveSurfaceRoot";
import { isComponentEditorRootElement } from "@/lib/ui-editor/componentEditorRoot";

/**
 * Everything the layer outline draws, and nothing else.
 *
 * The outline shows the tree, each layer's name and type, and whether it is hidden. It does not show
 * position, size, colour, text, bindings or any other property - yet it used to rebuild all of its
 * rows on every document change, and each row carries a `useDraggable` and each gap a `useDroppable`.
 * On a 60-layer page that is ~120 dnd-kit registrations re-run for a drag that moved one button two
 * pixels, or for one keystroke in a property field.
 *
 * Comparing this projection is what tells those edits apart from the ones the outline has to redraw.
 * It must list every field the rows read: a missing one is a layer that renames or hides itself in
 * the document and not on screen.
 */
export function computeOutlineSignature(document: UIDocument, surfaceId: string): string {
  const rootElementId = resolveSurfaceRootElementId(document, surfaceId);
  if (!rootElementId) {
    return "";
  }

  const parts: string[] = [];
  const visited = new Set<string>();
  const walk = (elementId: string) => {
    if (visited.has(elementId)) {
      return;
    }
    visited.add(elementId);
    const element = document.elements[elementId];
    if (!element) {
      parts.push(`${elementId}|missing`);
      return;
    }
    parts.push(
      [
        elementId,
        element.type,
        element.name ?? "",
        element.layout.visible === false ? "0" : "1",
        isComponentEditorRootElement(element) ? "c" : "",
        element.childrenIds.join(",")
      ].join("|")
    );
    element.childrenIds.forEach(walk);
  };
  walk(rootElementId);

  return parts.join("\n");
}
