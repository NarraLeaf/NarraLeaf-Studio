/**
 * `wizard` - the add-project wizard.
 *
 * Three flows behind one entry point, chosen on the first page:
 * `template -> details -> settings -> review` writes a new project here,
 * `template -> import` unpacks one from a `.nlspkg`, and
 * `template -> source -> clone` copies one down from a version-control server.
 * The `steps.*` entries cover every page of all three.
 *
 * Titled "Add" rather than "Create": two of the three flows create nothing, they bring in a
 * project somebody else already made.
 */
export const wizard = {
    appTitle: "Add Project",
    header: {
        title: "Add a Project",
        stepIndicator: "Step {current} of {total}",
    },
    steps: {
        template: {
            label: "Template",
            description: "Choose a project template",
        },
        details: {
            label: "Details",
            description: "Project information",
        },
        settings: {
            label: "Settings",
            description: "Project configuration",
        },
        review: {
            label: "Review",
            description: "Review and create",
        },
        source: {
            label: "Source",
            description: "Server and destination",
        },
        clone: {
            label: "Get Project",
            description: "Copy it onto this machine",
        },
        import: {
            label: "Import",
            description: "Unpack it onto this machine",
        },
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
        createFailedTitle: "Failed to Create Project",
        closeError: "Close error",
    },
    fields: {
        author: "Author",
        license: "License",
        location: "Location",
        versionControl: "Version Control",
        resolution: "Stage Size",
        appId: "App ID",
    },
    template: {
        title: "Where Is This Project Coming From?",
        subtitle: "Start something new, or bring in a project that already exists.",
        // Option labels - keyed by the card `id` in constants.ts.
        options: {
            empty: {
                name: "Empty",
                description: "Start with a blank project and build from scratch",
                category: "Custom",
            },
            import: {
                name: "From a package",
                description: "Unpack a project someone exported as a .nlspkg file",
                category: "Existing project",
            },
            clone: {
                name: "From a server",
                description: "Copy a project that already exists on a version-control server",
                category: "Existing project",
            },
        },
    },
    details: {
        title: "Project Details",
        subtitle: "Provide basic information about your project.",
        basicInfo: {
            title: "Basic Information",
            description: "Essential project details and metadata",
        },
        application: {
            title: "Application",
            description: "Most of these cannot be changed once the project is created.",
        },
        projectName: "Project Name",
        projectNamePlaceholder: "Enter project name…",
        appIdPlaceholder: "Enter app identifier…",
        appIdHelper: "Only lowercase letters, numbers, and hyphens allowed.",
        appIdRequired: "App ID is required",
        appIdInvalid: "App ID can only contain lowercase letters, numbers, and hyphens",
        authorPlaceholder: "Author Email / Organization / Project",
        licensePlaceholder: "Select license…",
        customLicense: "Custom License",
        customLicensePlaceholder: "Enter custom license…",
        licenseOther: "Other",
        descriptionPlaceholder: "Describe your project…",
        resolutionPlaceholder: "Select stage size…",
        requiredFieldsTitle: "Required Fields",
        requiredFieldsMessage: "Please fill in the required fields: Project Name, App ID, and Stage Size.",
    },
    settings: {
        title: "Project Settings",
        subtitle: "Configure project location, backup, and version control settings.",
        location: {
            description: "Choose where to save your project.",
        },
        versionControl: {
            description: "Set up version control for your project.",
            // Under the field only while Lore is selected: it describes what pressing Create will
            // additionally do, which is the one thing this choice is not otherwise visible as.
            loreHint: "A version history is created inside the project folder, recording it as the first version.",
            unavailablePlatform: "Version control is not available on this machine, so the project is created without it.",
            unavailableInstallation: "Version control is not available in this Studio build, so the project is created without it.",
        },
        projectLocation: "Project Location",
        projectLocationPlaceholder: "Enter project location…",
        // Accessible name for the folder button inside the location field.
        browseLocation: "Choose folder…",
        validatingDirectory: "Validating directory…",
        directoryWillBeCreated: "This directory will be created automatically when you create the project",
        versionControlSystem: "Version Control System",
        versionControlPlaceholder: "Select version control…",
        // Backup cadence option labels - keyed by the backup option `value` in constants.ts.
        backup: {
            none: "No backups",
            hourly: "Hourly",
            daily: "Daily",
            weekly: "Weekly",
        },
    },
    // The import flow's only page. It collects nothing - both choices are made in native dialogs
    // once the button is pressed - so its job is to say what is about to appear.
    import: {
        title: "Import a Project Package",
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
        working: "Waiting for you to choose a package and a folder. Unpacking starts once both are picked.",
        error: {
            failedTitle: "Could not import the project",
            generic: "Could not import the project package.",
            notAProjectTitle: "This is not a NarraLeaf Studio project",
            notAProject: "The package unpacked, but there is no Studio project file in it. What was unpacked is in {path}. Check you were given the right file, then try again.",
        },
    },
    // The clone flow's first page. Deliberately short: everything else about the project is
    // already recorded on the server.
    source: {
        title: "Where the Project Lives",
        subtitle: "Point Studio at the server that holds the project, and choose where to keep your copy.",
        server: {
            title: "Server",
            description: "The address of the project on its version-control server.",
        },
        addressLabel: "Project address",
        addressHint: "Ask whoever set up the project for this address.",
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
        destinationWillBeCreated: "This folder will be created when the project is copied down",
    },
    // The clone flow's last page - the one that touches the network.
    clone: {
        title: "Get the Project",
        subtitle: "Nothing has been downloaded yet. This copies the whole project onto this machine.",
        summary: {
            title: "What Will Be Copied",
            description: "Check this before starting; the whole project comes over the network.",
        },
        // No percentage: the backend reports a clone's progress only once it has finished, so a
        // bar here would sit at zero and then disappear.
        working: "Copying the project from the server. This can take a while.",
        error: {
            failedTitle: "Could not get the project",
            generic: "Could not get the project from the server.",
            // A Lore server holds repositories, and a repository is not necessarily a Studio
            // project. The files are named because they are real, they are why this folder cannot
            // be reused, and nothing else on screen says where they went.
            notAProjectTitle: "This is not a NarraLeaf Studio project",
            notAProject: "The copy finished, but there is no Studio project file in it. What was copied is in {path}. Check the address with whoever set up the project, then try again with a different empty folder.",
        },
    },
    review: {
        title: "Review Project",
        subtitle: "Review your project settings before creating it.",
        summary: {
            title: "Project Summary",
            description: "Overview of your project configuration.",
        },
        selectedTemplate: {
            title: "Selected Template",
            description: "Project template that will be used.",
        },
        settings: {
            description: "Configuration that will be applied to your project.",
        },
        notSpecified: "Not specified",
        custom: "Custom",
    },
    // User-facing errors surfaced by the wizard validation/creation services.
    validation: {
        templateFailed: "The template's content could not be copied into the project.",
        nameRequired: "Project name is required",
        locationRequired: "Project location is required",
        templateRequired: "Project template is required",
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
