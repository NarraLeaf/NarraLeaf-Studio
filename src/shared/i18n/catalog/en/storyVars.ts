/**
 * `storyVars` - the Variables side panel.
 *
 * The section titles carry the ownership split the panel is built on: the two project scopes are
 * defined in the project (this panel writes them), the scene scope is declared in the story and only
 * mirrored here. `persistent` is the scope's name in the code and in the interface alike: the
 * blueprint editor, the help and Dev Mode all say "persistent", and "global" names the App logic
 * blueprint's own variables, so the two scopes cannot share it.
 *
 * There is no empty-state string, and there was one until the panel stopped being story-scoped: the
 * two project scopes always render, and the scene section is omitted rather than explained when no
 * scene is focused. The panel's title is `placeholders.moduleTitles.variables`, with the other
 * static modules', not here.
 */
export const storyVars = {
    // A boolean default reads as a value, in the words the snapshot panel uses for the same values.
    value: {
        true: "True",
        false: "False",
    },
    row: {
        nameAria: "Variable name",
        defaultName: "Variable",
        defaultPlaceholder: "default",
        defaultAria: "Default value",
        delete: "Delete variable",
        // Off in the sessions that cannot carry a removal - the ordinary one can. States what is
        // the case and what to do about it, and nothing about which documents are involved.
        deleteInSession: "Unavailable in this live session. Leave the session to remove this variable.",
    },
    live: {
        // On the mark an entry wears while somebody else has it open. A person is named: there is
        // no width for a name beside the monogram, and a truncated one names nobody.
        entryClaimed: "{name} is editing this variable",
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
        title: "Persistent variables",
        hint: "Defined in the project; app-level, shared with blueprints.",
    },
} as const;
