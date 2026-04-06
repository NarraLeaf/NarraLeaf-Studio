import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";

export function collectSubtreeElements(document: UIDocument, rootElementId: string | null): UIElement[] {
    if (!rootElementId || !document.elements[rootElementId]) {
        return [];
    }
    const out: UIElement[] = [];
    const visit = (id: string): void => {
        const el = document.elements[id];
        if (!el) {
            return;
        }
        out.push(el);
        for (const childId of el.childrenIds) {
            visit(childId);
        }
    };
    visit(rootElementId);
    return out;
}
