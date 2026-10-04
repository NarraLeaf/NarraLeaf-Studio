/**
 * The keybinding catalog id of the command each canvas and outline menu row runs, by row id - the
 * table `withMenuShortcuts` reads to print a chord beside the row. The builders in this folder stay
 * unaware of keys; a row missing here simply shows none.
 *
 * Only rows that run exactly what the key runs belong here. The outline's "Paste into container" is
 * not Ctrl+V (which pastes beside the selection), so it is left out.
 */
export const UI_EDITOR_MENU_SHORTCUTS: Readonly<Record<string, string>> = {
    paste: "ui-editor.paste",
    "select-all": "ui-editor.selall",
    copy: "ui-editor.copy",
    cut: "ui-editor.cut",
    duplicate: "ui-editor.dup",
    delete: "ui-editor.delete",
    rename: "ui-editor.f2",
    group: "ui-editor.group",
    ungroup: "ui-editor.ungroup",
    "align-left": "ui-editor.align-left",
    "align-horizontal-center": "ui-editor.align-horizontal-center",
    "align-right": "ui-editor.align-right",
    "align-top": "ui-editor.align-top",
    "align-vertical-center": "ui-editor.align-vertical-center",
    "align-bottom": "ui-editor.align-bottom",
    "distribute-horizontal": "ui-editor.distribute-horizontal",
    "distribute-vertical": "ui-editor.distribute-vertical",
};
