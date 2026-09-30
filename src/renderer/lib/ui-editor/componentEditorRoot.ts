import type { UIElement } from "@shared/types/ui-editor/document";

/**
 * The id prefix of the root the component editor puts above a definition.
 *
 * The editor draws a definition as a surface of its own, and a surface needs an `nl.root`: this one
 * is made up for the view (`component-editor-root:<componentId>`) and never stored. The definition's
 * own root hangs under it, and is the only thing that does.
 */
export const COMPONENT_EDITOR_VIRTUAL_ROOT_PREFIX = "component-editor-root:";

/** Whether `id` names the component editor's made-up root rather than an element of the project. */
export function isComponentEditorVirtualRootId(id: string | null | undefined): boolean {
    return typeof id === "string" && id.startsWith(COMPONENT_EDITOR_VIRTUAL_ROOT_PREFIX);
}

/**
 * Whether `element` is a component's root, as the editor for that component shows it: the frame the
 * canvas is drawn at.
 *
 * Told by where it sits - the one child of the made-up root - and never by what it is called. It used
 * to be told by its name, and only a root named exactly "Root" counted, which is the name a new
 * component gets in English and not in Chinese or Japanese: the same component behaved differently
 * depending on the interface language it was made in. A copy of the element pasted anywhere else
 * sits somewhere else, so it never counts.
 *
 * The frame is selected and sized like any container, and shows and names itself like one. What it
 * refuses is anything that would move it, remove it, duplicate it or put something beside it: it is
 * what every placement draws, from its own top-left corner.
 */
export function isComponentEditorRootElement(element: Pick<UIElement, "parentId"> | null | undefined): boolean {
    return isComponentEditorVirtualRootId(element?.parentId);
}
