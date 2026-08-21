/**
 * `brand` - the project's own colour palette.
 *
 * `presetName` keys are the seeded ids from `@shared/types/brand` with their dots turned into
 * hyphens, because a message key is itself a dotted path (see `framework/fields/brandPalette.ts`).
 * The seeded entries carry no name in the document, so these are their only names.
 *
 * Each name says what the colour dresses, not what its id spells: `button.primary` is the fill a
 * button is painted with and `button.secondary` the fill it takes under the pointer, and calling
 * them "Button primary" and "Button secondary" would repeat the id at an author instead of telling
 * them which one to change.
 */
export const brand = {
    presetName: {
        primary: "Primary",
        secondary: "Secondary",
        background: "Background",
        foreground: "Foreground",

        "button-primary": "Button fill",
        "button-secondary": "Button hover fill",
        "button-border": "Button border",
        "button-text": "Button text",
        "button-shadow": "Button shadow",

        "container-background": "Container background",
        "container-border": "Container border",
        "container-shadow": "Container shadow",

        "text-primary": "Text",
        "text-muted": "Muted text",

        "textInput-background": "Text input background",
        "textInput-border": "Text input border",
        "textInput-text": "Text input text",
    },

    picker: {
        section: "Project colors",
    },

    /**
     * One heading per control group in the Brand panel, keyed by the prefix its slot ids share
     * (`button.primary` -> `button`). Named after the thing on screen, not after the id: an author
     * looking for the colour of a text field is looking for the field, not for `textInput`.
     */
    group: {
        button: "Button",
        container: "Container",
        text: "Text",
        textInput: "Text input",
    },

    /**
     * The project's default font stack, on the same sub-page under `project.group.typography`.
     *
     * `description` states the mechanism rather than describing the control, because the priority
     * order is the one thing about a font stack that cannot be read off the rows: a list of fonts
     * looks like alternatives until it is said that the first one carrying the character wins.
     */
    fonts: {
        description: "Text is set in the first of these that has the character.",
        add: "Add font",
        remove: "Remove {name}",
        moveUp: "Move {name} up",
        moveDown: "Move {name} down",
        // The row keeps its place when the asset behind it is gone: the id may come back, and
        // dropping the row would lose an order the author set.
        missing: "Missing font",
    },

    /** The Brand sub-page itself. Its two headings are `project.group.brand*`. */
    panel: {
        add: "Add color",
        // Written into the document, so it is the author's word for the row from the moment it
        // exists. The seeded slots take their names from `presetName` instead and store none.
        newColorName: "New Color",
        nameLabel: "Name",
        editColor: "Edit {name}",
        deleteColor: "Delete {name}",
        delete: "Delete",
        deleteConfirm: "Delete \"{name}\"?",
        deleteUnused: "Nothing uses this color.",
        // What actually happens: links pointing at a deleted colour are left alone, resolve to
        // nothing, and each field paints its own fallback. Project check reports them.
        deleteDetail: {
            one: "{count} place using it falls back to its own default color.",
            other: "{count} places using it fall back to their own default color.",
        },
    },
} as const;
