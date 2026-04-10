/**
 * Maps widget UI behavior slots to blueprint event graph layers.
 * Comments in English per project convention.
 */

import type { UIElement } from "@shared/types/ui-editor/document";

/**
 * UI event slot names (e.g. init, click) that reference the given blueprint event graph id.
 */
export function listUiSlotsWiredToBlueprintLayer(
    element: UIElement,
    blueprintId: string,
    eventGraphId: string,
): string[] {
    const events = element.behavior?.events ?? {};
    const out: string[] = [];
    for (const [slotName, b] of Object.entries(events)) {
        if (b?.kind === "blueprintEvent" && b.blueprintId === blueprintId && b.eventId === eventGraphId) {
            out.push(slotName);
        }
    }
    return out;
}
