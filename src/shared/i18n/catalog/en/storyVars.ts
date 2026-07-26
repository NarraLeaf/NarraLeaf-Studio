/** `storyVars` - the Story Variables side panel (scene / saved / persistent variables). */
export const storyVars = {
    empty: "Open a story scene to manage its variables.",
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
        hint: "Per scene; kept in the save file.",
        empty: "No scene variables yet.",
    },
    saved: {
        title: "Saved variables",
        hint: "Per save file; must be serializable.",
        empty: "No saved variables yet.",
    },
    persistent: {
        title: "Persistent variables",
        hint: "App-level; shared with blueprints.",
        empty: "No persistent variables. Add them in the blueprint editor.",
    },
} as const;
