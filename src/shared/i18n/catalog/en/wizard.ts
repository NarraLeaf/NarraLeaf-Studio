/**
 * `wizard` - the add-project wizard.
 *
 * Three flows behind one entry point, chosen on the first page:
 * `origin -> project -> stage -> review` writes a new project here,
 * `origin -> import` unpacks one from a `.nlspkg`, and
 * `origin -> source -> clone` copies one down from a version-control server.
 * The `steps.*` entries cover every page of all three, and they are rail labels rather than
 * headings - no page repeats its own name at the top any more.
 *
 * Titled "Add" rather than "Create": two of the three flows create nothing, they bring in a
 * project somebody else already made.
 */
export const wizard = {
    appTitle: "Add Project",
    steps: {
        origin: "Source",
        project: "Project",
        stage: "Stage",
        review: "Review",
        source: "Address",
        clone: "Get Project",
        import: "Import",
    },
    nav: {
        createProject: "Create Project",
        creating: "Creating…",
        cloneProject: "Get Project",
        cloning: "Getting…",
        // Names the next thing that happens - a file dialog - rather than the whole operation,
        // because that dialog opening unannounced is the confusing part.
        importProject: "Choose Package…",
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
            description: "Made here, from a template",
        },
        import: {
            label: "From a package",
            description: "A .nlspkg somebody exported",
            next: "Two dialogs open in turn once you press Choose Package: the file to unpack, then the folder to unpack it into.",
        },
        clone: {
            label: "From a server",
            description: "A project on a version-control server",
            next: "The next page asks for the project's address and where to keep the local copy.",
        },
    },
    template: {
        blank: {
            name: "Empty",
            description: "Nothing but the project structure",
        },
    },
    project: {
        name: "Project Name",
        namePlaceholder: "Enter project name…",
        appIdPlaceholder: "Enter app identifier…",
        // Says the part that matters more than the character rule: this one is frozen once the
        // project exists, and the project panel shows it under a padlock.
        appIdHelper: "Lowercase letters, numbers and hyphens. Cannot be changed later.",
        appIdRequired: "App ID is required",
        appIdInvalid: "App ID can only contain lowercase letters, numbers, and hyphens",
        locationPlaceholder: "Enter project location…",
        // Accessible name for the folder button inside the location field.
        browseLocation: "Choose folder…",
        validatingDirectory: "Checking the folder…",
        directoryWillBeCreated: "This folder is created together with the project",
        // Under the field only while Lore is selected: it describes what pressing Create will
        // additionally do, which is the one thing this choice is not otherwise visible as.
        versionControlLoreHint: "A version history is created inside the project folder, recording it as the first version.",
        versionControlUnavailablePlatform: "Version control is not available on this machine, so the project is created without it.",
        versionControlUnavailableInstallation: "Version control is not available in this Studio build, so the project is created without it.",
        moreDetails: "More details",
        // Why a field the project panel can edit is worth filling in now.
        versionHelper: "A build refuses to start without one.",
        authorPlaceholder: "Author Email / Organization / Project",
        descriptionPlaceholder: "Describe your project…",
    },
    stage: {
        sizePlaceholder: "Select stage size…",
        custom: "Custom…",
        customInvalid: "Width and height must be whole numbers between {min} and {max}.",
        width: "Width",
        height: "Height",
        // The one consequence of this choice that is not visible in the numbers.
        orientationLandscape: "Mobile builds lock to landscape.",
        orientationPortrait: "Mobile builds lock to portrait.",
        // Says where the rest of the answer lives, because this field offers a short list and the
        // panel takes any language at all.
        scriptLocaleHelper: "The language the story is written in. Translations are added in the localization panel.",
    },
    // The import flow's only page. It collects nothing - both choices are made in native dialogs
    // once the button is pressed - so its job is to say what is about to appear.
    import: {
        subtitle: "Unpack a .nlspkg file into a folder on this machine.",
        steps: {
            title: "What Happens Next",
            description: "Two dialogs open in turn, then the project is unpacked.",
            pickPackage: "First: choose the .nlspkg file to unpack.",
            pickFolder: "Then: choose the folder to unpack it into.",
        },
        // NOT "unpacking". For almost all of the time this is on screen the author is standing in
        // front of a file dialog and nothing is being unpacked - saying otherwise is a spinner
        // that lies about what it is waiting for, and it reads as a hang if they alt-tab away
        // from the dialog and come back.
        working: "Waiting for a package and a folder. Unpacking starts once both are chosen.",
        error: {
            failedTitle: "Could not import the project",
            generic: "Could not import the project package.",
            notAProjectTitle: "This is not a NarraLeaf Studio project",
            notAProject: "The package unpacked, but it holds no Studio project file. The unpacked contents are in {path}. Check that the file is the right one, then try again.",
        },
    },
    // The clone flow's first page. Deliberately short: everything else about the project is
    // already recorded on the server.
    source: {
        subtitle: "Enter the server that holds the project, and choose where to keep the local copy.",
        server: {
            title: "Server",
            description: "The address of the project on its version-control server.",
        },
        addressLabel: "Project address",
        addressHint: "This address comes from whoever set up the project.",
        // Names what is missing rather than saying "invalid": the mistake this catches is almost
        // always an address with the server but not the project name on the end.
        addressInvalid: "A project address needs the project's name on the end, like lore://studio.example.lan:41337/my-game",
        parsedServer: "Server",
        parsedName: "Project on the server",
        destination: {
            title: "Destination",
            description: "Where the copy is kept on this machine.",
        },
        destinationLabel: "Where to put it",
        // Said before they choose, not after: the emptiness check runs in the main process and a
        // refusal there is a refusal after the author has already committed to the folder.
        destinationHint: "Must be a new or empty folder.",
        destinationWillBeCreated: "This folder is created when the project is copied",
    },
    // The clone flow's last page - the one that touches the network.
    clone: {
        subtitle: "Nothing has been downloaded. This copies the whole project onto this machine.",
        summary: {
            title: "What Will Be Copied",
            description: "Check this before starting. The whole project is transferred over the network.",
        },
        // No percentage: the backend reports a clone's progress only once it has finished, so a
        // bar here would sit at zero and then disappear.
        working: "Copying the project from the server. This can take several minutes.",
        error: {
            failedTitle: "Could not get the project",
            generic: "Could not get the project from the server.",
            // A Lore server holds repositories, and a repository is not necessarily a Studio
            // project. The files are named because they are real, they are why this folder cannot
            // be reused, and nothing else on screen says where they went.
            notAProjectTitle: "This is not a NarraLeaf Studio project",
            notAProject: "The copy finished, but it holds no Studio project file. The copied contents are in {path}. Check the address with whoever set up the project, then try again with a different empty folder.",
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
