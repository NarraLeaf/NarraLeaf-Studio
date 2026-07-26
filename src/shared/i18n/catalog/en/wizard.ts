/** `wizard` - new-project creation wizard (template, details, settings, review steps). */
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
    },
    nav: {
        createProject: "Create Project",
        creating: "Creating…",
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
        },
        projectLocation: "Project Location",
        projectLocationPlaceholder: "Enter project location…",
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
