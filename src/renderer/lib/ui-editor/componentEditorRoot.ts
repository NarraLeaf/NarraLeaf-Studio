import type { UIElement } from "@shared/types/ui-editor/document";

export const COMPONENT_EDITOR_ROOT_EXTRA_KEY = "__componentEditorRoot";

export function isComponentEditorRootElement(element: Pick<UIElement, "extra"> | null | undefined): boolean {
    return element?.extra?.[COMPONENT_EDITOR_ROOT_EXTRA_KEY] === true;
}
