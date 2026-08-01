import { CheckCircle, CloudDownload, FileText, Package, Zap } from "lucide-react";
import { ProjectFlow, ProjectTemplate, LicenseOption, ResolutionOption, VersionControlOption, BackupOption, WizardStep } from "./types";

/**
 * The pages each first-page choice leads to, in order.
 *
 * **The clone flow is short on purpose.** Everything the create flow asks on Details and Settings
 * - name, app id, stage size, licence, author, version control - is already decided for a project
 * that exists on a server, and is in the bytes the clone brings down. Asking would either be
 * ignored or would overwrite what the project's own author chose.
 *
 * The last page is where the network is touched, in both flows: nothing is written or fetched
 * until the author is on it and presses the button.
 */
export const WIZARD_FLOW_STEPS: Record<ProjectFlow, WizardStep[]> = {
    create: ["template", "details", "settings", "review"],
    clone: ["template", "source", "clone"],
};

/**
 * Project templates configuration
 */
export const projectTemplates: ProjectTemplate[] = [
    // {
    //     id: "starter",
    //     name: "Starter",
    //     description: "Pre-configured project with basic structure and templates",
    //     icon: Zap,
    //     category: "Quick Start"
    // },
    // {
    //     id: "skeleton",
    //     name: "Skeleton",
    //     description: "Minimal project structure with essential files and folders",
    //     icon: Package,
    //     category: "Framework"
    // },
    {
        id: "empty",
        flow: "create",
        name: "Empty",
        nameKey: "wizard.template.options.empty.name",
        description: "Start with a blank project and build from scratch",
        descriptionKey: "wizard.template.options.empty.description",
        icon: FileText,
        category: "Custom",
        categoryKey: "wizard.template.options.empty.category"
    },
    /**
     * Not a template, and it sits here anyway.
     *
     * This card creates no files of its own - it copies a project that someone else already made.
     * But the question the first page really asks is "where is this project coming from", and a
     * project from a server is one of the answers. Putting it anywhere else means an author who
     * came here to join a colleague's project has to first learn that this is not the place.
     */
    {
        id: "clone",
        flow: "clone",
        name: "From a server",
        nameKey: "wizard.template.options.clone.name",
        description: "Copy a project that already exists on a version-control server",
        descriptionKey: "wizard.template.options.clone.description",
        icon: CloudDownload,
        category: "Existing project",
        categoryKey: "wizard.template.options.clone.category"
    }
];

/**
 * License options
 */
export const licenseOptions: LicenseOption[] = [
    { value: "MIT", label: "MIT License" },
    { value: "Apache-2.0", label: "Apache License 2.0" },
    { value: "GPL-3.0", label: "GNU General Public License v3.0" },
    { value: "BSD-2-Clause", label: "BSD 2-Clause License" },
    { value: "BSD-3-Clause", label: "BSD 3-Clause License" },
    { value: "ISC", label: "ISC License" },
    { value: "Unlicense", label: "The Unlicense" },
    { value: "Other", label: "Other", labelKey: "wizard.details.licenseOther" },
];

/**
 * Resolution options
 */
export const resolutionOptions: ResolutionOption[] = [
    { value: "1280x720", label: "HD (1280x720)" },
    { value: "1920x1080", label: "Full HD (1920x1080)" },
    { value: "2560x1440", label: "QHD (2560x1440)" },
    { value: "3840x2160", label: "4K (3840x2160)" },
    { value: "7680x4320", label: "8K (7680x4320)" },
];

/**
 * Version control options.
 *
 * **Lore, not Git.** Studio has exactly one version-control backend and it is Lore
 * (`VcsManager`); the "Git" this used to offer was never wired to anything - the field was read
 * by nothing at all, so both options created the same unversioned project. An option that does
 * not do what it says is worse than no option, which is why picking Lore now actually calls
 * `initRepository` (see `ProjectService.createProject`).
 *
 * Not localized: "Lore" is the backend's name, not a word. `none` keeps `common.none`.
 */
export const versionControlOptions: VersionControlOption[] = [
    { value: "lore", label: "Lore" },
    { value: "none", label: "None", labelKey: "common.none" },
];

/**
 * Backup options (currently unused but prepared for future use)
 */
export const backupOptions: BackupOption[] = [
    { value: "none", label: "No backups", labelKey: "wizard.settings.backup.none" },
    { value: "hourly", label: "Hourly", labelKey: "wizard.settings.backup.hourly" },
    { value: "daily", label: "Daily", labelKey: "wizard.settings.backup.daily" },
    { value: "weekly", label: "Weekly", labelKey: "wizard.settings.backup.weekly" },
];

/**
 * Default project data
 */
export const defaultProjectData = {
    name: "",
    description: "",
    template: "",
    location: "",
    author: "",
    license: "",
    licenseCustom: "",
    resolution: "1920x1080",
    appId: "",
    remoteUrl: "",
    // Pre-selected, the way "git" was: a new project is the one moment where turning version
    // control on costs nothing and turning it on later means the work before that point is
    // unrecorded. It is still a choice the author sees twice - on this step and on the review -
    // before anything is written, and the Settings step falls back to `none` on a host with no
    // Lore build rather than offering something that cannot happen.
    versionControl: "lore"
} as const;
