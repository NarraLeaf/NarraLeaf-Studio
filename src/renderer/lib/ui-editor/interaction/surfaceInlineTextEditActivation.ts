import type { UIElementSelection } from "@shared/types/ui-editor/selection";

export const MOVEABLE_DOUBLE_CLICK_TARGET_SELECTOR =
    ".moveable, .narraleaf-moveable, .moveable-control, .moveable-control-box, .moveable-line, .moveable-rotation, .moveable-rotation-handle, .moveable-area, [class*='moveable-']";

export function getSingleSelectedElementId(
    selectionData: UIElementSelection | null | undefined,
    surfaceId: string,
): string | null {
    if (!selectionData || selectionData.surfaceId !== surfaceId || selectionData.elementIds.length !== 1) {
        return null;
    }
    return selectionData.elementIds[0] ?? null;
}

export function isMoveableInteractionTarget(target: EventTarget | null | undefined): boolean {
    if (!(target instanceof Element)) {
        return false;
    }
    return Boolean(target.closest(MOVEABLE_DOUBLE_CLICK_TARGET_SELECTOR));
}
