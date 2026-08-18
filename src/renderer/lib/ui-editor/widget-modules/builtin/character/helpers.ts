import type { UIElement } from "@shared/types/ui-editor/document";
import {
    getUICharacterWidgetProps,
    normalizeUICharacterWidgetProps,
    type UICharacterWidgetProps,
} from "@shared/types/ui-editor/character";

export { getUICharacterWidgetProps };

/**
 * Merge a partial edit onto the stored props, normalising the result.
 *
 * Through the normaliser rather than a spread, so a crop dragged past an edge is clamped once, here,
 * instead of every reader having to defend against a zero-width window.
 */
export function patchCharacterProps(
    element: Pick<UIElement, "props">,
    partial: Partial<UICharacterWidgetProps>,
): Record<string, unknown> {
    const next = normalizeUICharacterWidgetProps({
        ...getUICharacterWidgetProps(element),
        ...partial,
    });
    return {
        ...((element.props ?? {}) as Record<string, unknown>),
        characterId: next.characterId,
        crop: next.crop,
        fit: next.fit,
        flipX: next.flipX,
    };
}
