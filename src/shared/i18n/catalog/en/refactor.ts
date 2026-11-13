/**
 * `refactor` - the rename refactor's preview dialog, and the reference lists that share its words
 * (the Variables panel's reads and writes).
 *
 * `slot.*` names where in a row a reference sits; it is the second half of a list line
 * ("Line 3 · Condition"), so each is a short noun phrase.
 */
export const refactor = {
    command: {
        renameScene: "Rename scene and update references",
    },
    menu: {
        rename: "Rename…",
        findReferences: "Find all references",
        renameVariable: "Rename variable \"{name}\"…",
        findVariableReferences: "Find references to \"{name}\"",
        renameLabel: "Rename label…",
        renameScene: "Rename and update references…",
    },
    dialog: {
        titleVariable: "Rename variable",
        titleLabel: "Rename label",
        titleScene: "Rename scene",
        titleCharacter: "Rename character",
        newName: "New name",
        confirm: "Rename",
        summary: {
            one: "{count} change",
            other: "{count} changes",
        },
        followers: {
            one: "{count} reference by id updates automatically",
            other: "{count} references by id update automatically",
        },
        followersTitle: "References by id",
        failures: "These expressions cannot be rewritten. Edit them by hand, then rename again.",
        reformatted: "spacing normalised",
        required: "Always changed",
    },
    problem: {
        empty: "Enter a name",
        reserved: "This name is reserved by the expression language",
        taken: "This name is already in use",
    },
    slot: {
        declaration: "Declaration",
        registry: "Variables panel",
        assignTarget: "Assignment target",
        assignValue: "Assigned value",
        inputTarget: "Input result",
        pageTarget: "Page result",
        condition: "Condition",
        loopCondition: "Loop condition",
        hiddenWhen: "Hidden when",
        disabledWhen: "Disabled when",
        text: "Inline value",
        label: "Label",
        goto: "Goto",
        sceneName: "Scene name",
        characterName: "Character name",
        speaker: "Speaker",
        blueprintNode: "Blueprint node",
    },
    site: {
        line: "Line {line}",
        blueprint: "Blueprint {name}",
        unnamedBlueprint: "Unnamed",
    },
    refs: {
        toggle: "References",
        reads: "Reads",
        writes: "Writes",
        none: "No references",
    },
    history: {
        rename: "rename {from} to {to}",
    },
} as const;
