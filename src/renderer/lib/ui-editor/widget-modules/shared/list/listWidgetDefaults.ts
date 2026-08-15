import type { UIElement, UILayout } from "@shared/types/ui-editor/document";
import type { UIListScrollbarProps } from "@shared/types/ui-editor/list";
import { defaultListWidgetProps, type ListWidgetProps } from "@/lib/ui-editor/widget-modules/builtin/list/types";

/**
 * Patches the default element a list specialisation inherited from `nl.list`.
 *
 * The inherited props are deep-copied first: the slot wrappers used to build theirs from
 * `JSON.parse(JSON.stringify(defaultListWidgetProps))` for exactly this reason - the defaults hold
 * nested objects (`scrollbar`, its two part styles) and a shallow copy would hand every inserted
 * list the same scrollbar object to mutate.
 */
export function patchListWidgetDefaultElement(
    inherited: Partial<UIElement>,
    patch: {
        props?: Partial<Omit<ListWidgetProps, "scrollbar">> & { scrollbar?: Partial<UIListScrollbarProps> };
        layout?: Partial<UILayout>;
    },
): Partial<UIElement> {
    const inheritedProps = JSON.parse(
        JSON.stringify({ ...defaultListWidgetProps, ...(inherited.props ?? {}) }),
    ) as ListWidgetProps;
    const { scrollbar, ...flatPatch } = patch.props ?? {};
    const props: ListWidgetProps = {
        ...inheritedProps,
        ...flatPatch,
        scrollbar: { ...inheritedProps.scrollbar, ...scrollbar },
    };
    return {
        ...inherited,
        layout: {
            ...(inherited.layout as UILayout),
            ...patch.layout,
        },
        props,
    };
}
