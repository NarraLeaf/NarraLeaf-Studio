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
        pose: "pose",
        axis: "axis",
        tag: "tag",
        character: "character",
        group: "group",
        story: "story",
        scene: "scene",
        chapter: "chapter",
        component: "component",
        inputAction: "input action",
        asset: "asset",
        // Capitalised to match the menu item that opens the dialog ("Rename Page"), and because
        // Game UI is the interface's own name for the thing rather than a common noun.
        page: "Page",
        gameUi: "Game UI",
        image: "Image",
        audio: "Audio",
        video: "Video",
        json: "JSON",
        blueprint: "Blueprint",
        font: "Font",
        model: "Model",
        other: "Other",
        // Merged sidebar sections; `image` / `font` / `model` / `other` above double as their
        // category nouns because those sections hold exactly one type.
        media: "Media",
        data: "Data",
    },
    /**
     * The system file and folder pickers, opened by the main process.
     *
     * Every one of them used to carry a hardcoded English title into a translated interface. The
     * title says what is being chosen, the button says what happens when it is - "Select" alone
     * leaves both questions to the folder tree behind the dialog.
     */
    file: {
        button: {
            select: "Select",
            open: "Open",
            save: "Save",
            export: "Export",
            exportHere: "Export here",
            import: "Import",
            install: "Install",
        },
        title: {
            selectFile: "Select a file",
            selectFolder: "Select a folder",
            saveFile: "Save the file",
            selectIcon: "Select an icon",
            chooseBackgroundImage: "Select a background image",
            exportLogs: "Save the Studio logs",
            exportSettings: "Save the Studio settings",
            importSettings: "Select a settings file",
            exportAssets: "Select a folder for the exported files",
            exportAsset: "Save the file",
            selectProjectFolder: "Select the project folder",
            selectProjectLocation: "Select where the project is created",
            exportProjectPackage: "Select a folder for the project package",
            selectProjectPackage: "Select a project package",
            importPsd: "Select a PSD file",
            installPlugin: "Select a plugin package",
            selectBuildOutput: "Select the build output folder",
            savePatch: "Save the patch",
            selectPatchBaseline: "Select the build this patch updates",
        },
        filter: {
            all: "All files",
            supported: "Supported files",
            images: "Images",
            log: "Log",
            text: "Text",
            json: "JSON",
            patch: "Patch",
            projectPackage: "NarraLeaf Studio project package",
            photoshop: "Photoshop document",
        },
    },
} as const;
