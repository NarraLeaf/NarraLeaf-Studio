/** `wizard` — new-project creation wizard (template, details, settings, review steps). */
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
        resolution: "Resolution",
        appId: "App ID",
    },
    template: {
        title: "Choose a Project Template",
        subtitle: "Select a project template to get started quickly with pre-configured structure and settings.",
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
        descriptionPlaceholder: "Describe your project…",
        resolutionPlaceholder: "Select resolution…",
        requiredFieldsTitle: "Required Fields",
        requiredFieldsMessage: "Please fill in the required fields: Project Name, App ID, and Resolution.",
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
} as const;
