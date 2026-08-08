/**
 * `storyVars` - the Variables side panel.
 *
 * The section titles carry the ownership split the panel is built on: the two project scopes are
 * defined in the project (this panel writes them), the scene scope is declared in the story and only
 * mirrored here. `persistent` keeps its key - it is the scope's name everywhere in the code - but
 * reads as "global", which is what the story's own `/global` row and its badge already call it.
 *
 * There is no empty-state string, and there was one until the panel stopped being story-scoped: the
 * two project scopes always render, and the scene section is omitted rather than explained when no
 * scene is focused. The panel's title is `placeholders.moduleTitles.variables`, with the other
 * static modules', not here.
 */
export const storyVars = {
    valueType: {
        boolean: "Boolean",
        number: "Number",
        string: "String",
        json: "JSON",
    },
    row: {
        nameAria: "Variable name",
        defaultPlaceholder: "default",
        defaultAria: "Default value",
        delete: "Delete variable",
    },
    scene: {
        title: "Scene variables",
        hint: "Declared in the story with /local. Click a row to go to it.",
    },
    saved: {
        title: "Saved variables",
        hint: "Defined in the project; the value lives in the save file.",
    },
    persistent: {
        title: "Global variables",
        hint: "Defined in the project; app-level, shared with blueprints.",
    },
} as const;
