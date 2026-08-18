/**
 * Which widget types the Displayable node family covers.
 *
 * Every widget an author can place occupies a rectangle on its surface, so every one of them can be
 * asked where it is and how big it is. The list existed as two hand-kept copies that had drifted to
 * eight types while the insert palette grew to sixteen, which is why a Video, a Puppet or a Text
 * Input could be selected as the target of `Get Element Bounds` in the editor and then throw at run
 * time. One list, checked against the palette by `displayableWidgets.test.ts`.
 *
 * `nl.root` is deliberately absent: it is the surface itself rather than something placed on it, it
 * carries no layout of its own, and no author can select it.
 *
 * Comments in English per project convention.
 */

export const UI_DISPLAYABLE_WIDGET_TYPES = [
    "nl.container",
    "nl.text",
    "nl.dialog.sentence",
    "nl.notification.list",
    "nl.choice.list",
    "nl.nvl.list",
    "nl.nvl.texts",
    "nl.image",
    "nl.character",
    "nl.button",
    "nl.textInput",
    "nl.switch",
    "nl.video",
    "nl.puppet",
    "nl.slider",
    "nl.list",
    "nl.frame",
] as const;

export type UIDisplayableWidgetType = (typeof UI_DISPLAYABLE_WIDGET_TYPES)[number];

export function isDisplayableWidgetType(type: string): type is UIDisplayableWidgetType {
    return (UI_DISPLAYABLE_WIDGET_TYPES as readonly string[]).includes(type);
}
