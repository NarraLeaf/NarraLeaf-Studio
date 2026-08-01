/**
 * `wizard` - the new-project wizard.
 *
 * Two flows behind one entry point: `template -> details -> settings -> review` writes a project
 * here, and `template -> source -> clone` copies one down from a version-control server. The
 * `steps.*` entries cover every page of both.
 */
export const wizard = {
    appTitle: "New Project",
    header: {
        title: "Create New Project",
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
    },
    nav: {
        createProject: "Create Project",
        creating: "Creating…",
        cloneProject: "Get Project",
        cloning: "Getting…",
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
        title: "Choose a Project Template",
        subtitle: "Select a project template to get started quickly with pre-configured structure and settings.",
        // Template option labels - keyed by the template `id` in constants.ts.
        options: {
            empty: {
                name: "Empty",
                description: "Start with a blank project and build from scratch",
                category: "Custom",
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
            description: "Common application settings. Most of these settings cannot be changed after project initialization.",
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
            unavailableInstallation: "Version control is not available in this installation of Studio, so the project is created without it.",
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
            notAProject: "The copy finished, but it contains no Studio project file, so Studio cannot open it. What was copied is in {path}. Check the address with whoever set up the project, then choose a different empty folder and try again.",
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
        nameRequired: "Project name is required",
        locationRequired: "Project location is required",
        templateRequired: "Project template is required",
        invalidPath: "Invalid path",
        notADirectory: "Selected path exists but is not a directory. Please choose a directory or create a new one.",
        cannotWrite: "Cannot write to the selected directory. Please check permissions or choose a different location.",
        notEmpty: "Directory is not empty. Please choose an empty directory or create a new one.",
        validationFailed: "Directory validation failed",
        failedToValidate: "Failed to validate directory",
        checkExistenceFailed: "Failed to check directory existence",
        checkIsDirFailed: "Failed to check if path is directory",
        listContentsFailed: "Failed to list directory contents",
        selectDirectoryFailed: "Failed to select directory",
        createFailed: "Failed to create project",
    },
} as const;
