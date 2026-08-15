import type { UIElement, UILayout } from "@shared/types/ui-editor/document";
import { createInitialTextAppearance } from "@/lib/ui-editor/widget-modules/shared/appearance/initialAppearanceModel";
import { defaultTextWidgetProps, type TextWidgetProps } from "@/lib/ui-editor/widget-modules/builtin/text/types";

/**
 * Patches the default element a text specialisation inherited from `nl.text`.
 *
 * The appearance model is rebuilt rather than merged: it is a snapshot of the flat props at insert
 * time, so a specialisation that changes the font size while keeping the inherited appearance would
 * insert an element whose default variant paints the parent's size over the one it just chose.
 */
export function patchTextWidgetDefaultElement(
    inherited: Partial<UIElement>,
    patch: { props?: Partial<TextWidgetProps>; layout?: Partial<UILayout> },
): Partial<UIElement> {
    const inheritedProps = (inherited.props ?? {}) as Partial<TextWidgetProps>;
    const props: TextWidgetProps = {
        ...defaultTextWidgetProps,
        ...inheritedProps,
        ...patch.props,
    };
    return {
        ...inherited,
        layout: {
            ...(inherited.layout as UILayout),
            ...patch.layout,
        },
        props: {
            ...props,
            appearance: createInitialTextAppearance(props),
        },
    };
}
