import { isAppearanceModel } from "@shared/types/ui-editor/appearance";
import type { UIElement } from "@shared/types/ui-editor/document";
import type { ImageFill } from "@shared/types/ui-editor/imageFill";
import { syncImageAppearanceImageFillFromProps } from "@/lib/ui-editor/widget-modules/shared/appearance/initialAppearanceModel";

/**
 * The props an image fill change touches, and only those: the fill itself, the fill type that makes
 * it the one painted, and the appearance rows that would otherwise paint the old fill over it.
 *
 * `element` is whatever the change is laid over - the saved record in the editor, the drawing's
 * current state in a running game - and its appearance is the one the rows are synced from.
 */
export function buildImageFillPropsChange(element: UIElement, nextFill: ImageFill): Record<string, unknown> {
    const rawAppearance = (element.props as { appearance?: unknown } | undefined)?.appearance;
    const nextAppearance = isAppearanceModel(rawAppearance)
        ? syncImageAppearanceImageFillFromProps(rawAppearance, nextFill)
        : rawAppearance;

    return {
        fillType: "image",
        imageFill: nextFill,
        ...(nextAppearance !== rawAppearance ? { appearance: nextAppearance } : {}),
    };
}

/** The element's whole prop bag with an image fill change laid over it, for a document write. */
export function buildImageFillPropsUpdate(element: UIElement, nextFill: ImageFill): Record<string, unknown> {
    return {
        ...(element.props ?? {}),
        ...buildImageFillPropsChange(element, nextFill),
    };
}
