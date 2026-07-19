/** `dialogs` - reusable UI primitives: window controls, modals, selects, and input dialogs. */
export const dialogs = {
    window: {
        minimize: "Minimize",
        maximize: "Maximize",
        restore: "Restore",
        appIcon: "App Icon",
    },
    modal: {
        close: "Close modal",
        confirmTitle: "Confirm action",
        alertTitle: "Notice",
    },
    select: {
        placeholder: "Please select…",
        searchPlaceholder: "Search or select…",
    },
    input: {
        required: "This field is required",
        maxLength: "Maximum {max} characters allowed",
        editValue: "Edit value",
    },
    // Imperative InputDialog service (non-hook; uses translate()).
    createGroup: {
        title: "Create Group",
        prompt: "Please enter a name for the {type} group",
        placeholder: "Enter group name…",
        empty: "Group name cannot be empty",
    },
    rename: {
        title: "Rename {type}",
        prompt: "Please enter a new {type} name",
        placeholder: "Enter new name…",
        empty: "{type} name cannot be empty",
        sameName: "New name cannot be the same as current name",
    },
    password: {
        placeholder: "Enter password…",
    },
    email: {
        placeholder: "Enter email address…",
        invalid: "Please enter a valid email address",
    },
    // Imperative DialogService fallbacks (confirm/alert/quick-pick/input via translate()).
    service: {
        alertTitle: "Alert",
        selectTitle: "Select an item",
        inputTitle: "Input",
    },
    // Nouns interpolated into rename/create titles. Unknown item types fall back
    // to the raw string the caller passed.
    noun: {
        item: "item",
        layer: "layer",
        character: "character",
        group: "group",
        story: "story",
        scene: "scene",
        component: "component",
        asset: "asset",
        image: "Image",
        audio: "Audio",
        video: "Video",
        json: "JSON",
        blueprint: "Blueprint",
        font: "Font",
        other: "Other",
    },
} as const;
