/**
 * `wizard` - the add-project wizard.
 *
 * Three flows behind one entry point, chosen on the first page:
 * `origin -> project -> stage -> review` writes a new project here,
 * `origin -> import` unpacks one from a `.nlspkg`, and
 * `origin -> source -> clone` copies one down from a version-control server.
 * The `steps.*` entries cover every page of all three, and they are rail labels rather than
 * headings - no page repeats its own name at the top.
 *
 * Titled "Add" rather than "Create": two of the three flows create nothing, they bring in a
 * project somebody else already made.
 *
 * Wording follows `docs/help-system.md` §3a: state what a control does or what a field holds, in
 * as few words as it takes. No page narrates what is about to happen - each one now has the fields
 * that answer for it.
 */
export const wizard = {
    appTitle: "Add Project",
    steps: {
        origin: "Source",
        project: "Project",
        stage: "Stage",
        review: "Review",
        source: "Address",
        clone: "Clone",
        import: "Import",
    },
    nav: {
        createProject: "Create Project",
        creating: "Creating…",
        cloneProject: "Start Clone",
        cloning: "Cloning…",
        importProject: "Start Import",
        importing: "Importing…",
    },
    error: {
        closeError: "Close error",
    },
    fields: {
        appId: "App ID",
        author: "Author",
        location: "Location",
        scriptLocale: "Script Language",
        stageSize: "Stage Size",
        version: "Version",
        versionControl: "Version Control",
        website: "Website",
    },
    // The first page's left column: where the project comes from. `next` is what the right column
    // says for the two origins that have no template list, so the page is never blank.
    origin: {
        create: {
            label: "New project",
            description: "Create from a template",
        },
        import: {
            label: "Import .nlspkg",
            description: "Unpack an exported project file",
            next: "The next page asks for the .nlspkg file and where to unpack it.",
        },
        clone: {
            label: "Clone from a server",
            description: "Copy a project on a version-control server",
            next: "The next page asks for the project address and where to keep the local copy.",
        },
    },
    template: {
        blank: {
            name: "Empty",
            description: "Project structure only",
        },
    },
    project: {
        name: "Project Name",
        namePlaceholder: "Project name",
        appIdPlaceholder: "App identifier",
        appIdHelper: "Lowercase letters, digits and hyphens only. Cannot be changed after creation.",
        appIdRequired: "App ID is required",
        appIdInvalid: "App ID can only contain lowercase letters, numbers, and hyphens",
        locationPlaceholder: "Project location",
        browseLocation: "Choose folder",
        validatingDirectory: "Checking the folder…",
        directoryWillBeCreated: "This folder is created together with the project",
        versionControlLoreHint: "A version history is created inside the project folder, recording the project as its first version.",
        versionControlUnavailablePlatform: "Version control is not available on this machine. The project is created without it.",
        versionControlUnavailableInstallation: "Version control is not available in this Studio build. The project is created without it.",
        moreDetails: "More details",
        versionHelper: "A build cannot start without one.",
        authorPlaceholder: "Author email / organization / project",
        descriptionPlaceholder: "Project description",
    },
    stage: {
        sizePlaceholder: "Select stage size",
        custom: "Custom…",
        customInvalid: "Width and height must be whole numbers between {min} and {max}.",
        width: "Width",
        height: "Height",
        // The one consequence of this choice that is not visible in the numbers.
        orientationLandscape: "Mobile builds lock to landscape.",
        orientationPortrait: "Mobile builds lock to portrait.",
        scriptLocaleHelper: "The language the story is written in. Translations are added in the localization panel.",
    },
    // The import flow's only page: two pickers and the button that unpacks.
    import: {
        packageLabel: ".nlspkg file",
        packagePlaceholder: "No file selected",
        choosePackage: "Choose File",
        locationPlaceholder: "No folder selected",
        chooseFolder: "Choose Folder",
        working: "Unpacking…",
        error: {
            failedTitle: "Import failed",
            generic: "The file could not be unpacked.",
            notAProjectTitle: "This is not a NarraLeaf Studio project",
            notAProject: "Unpacking finished, but the result holds no Studio project file. The unpacked contents are in {path}",
        },
    },
    // The clone flow's first page. Deliberately short: everything else about the project is
    // already recorded on the server.
    source: {
        addressLabel: "Project address",
        addressHint: "This address comes from whoever set up the project.",
        // Names what is missing rather than saying "invalid": the mistake this catches is almost
        // always an address with the server but not the project name on the end.
        addressInvalid: "A project address needs the project's name on the end, like lore://studio.example.lan:41337/my-game",
        parsedServer: "Server",
        parsedName: "Project on the server",
        // Said before they choose, not after: the emptiness check runs in the main process and a
        // refusal there is a refusal after the author has already committed to the folder.
        destinationHint: "Must be a new or empty folder.",
    },
    // The clone flow's last page - the one that touches the network.
    clone: {
        subtitle: "This copies the whole project onto this machine.",
        // No percentage: the backend reports a clone's progress only once it has finished, so a
        // bar here would sit at zero and then disappear.
        working: "Copying the project from the server…",
        error: {
            failedTitle: "Clone failed",
            generic: "The project could not be fetched from the server.",
            // A Lore server holds repositories, and a repository is not necessarily a Studio
            // project. The files are named because they are real, and they are why this folder
            // cannot be reused.
            notAProjectTitle: "This is not a NarraLeaf Studio project",
            notAProject: "The copy finished, but it holds no Studio project file. The copied contents are in {path}",
        },
    },
    review: {
        template: "Template",
        notSpecified: "Not specified",
    },
    // User-facing errors surfaced by the wizard validation/creation services.
    validation: {
        templateFailed: "The template's content could not be copied into the project.",
        nameRequired: "Project name is required",
        locationRequired: "Project location is required",
        templateRequired: "Project template is required",
        stageSizeRequired: "Stage size is required",
        invalidPath: "Invalid path",
        notADirectory: "That path exists but is not a directory. Choose a directory, or create a new one.",
        cannotWrite: "Cannot write to that directory. Check its permissions, or choose another.",
        notEmpty: "That directory is not empty. Choose an empty one, or create a new one.",
        validationFailed: "Directory validation failed",
        failedToValidate: "Failed to validate directory",
        checkExistenceFailed: "Failed to check directory existence",
        checkIsDirFailed: "Failed to check if path is directory",
        listContentsFailed: "Failed to list directory contents",
        selectDirectoryFailed: "Failed to select directory",
        createFailed: "Failed to create project",
    },
} as const;
