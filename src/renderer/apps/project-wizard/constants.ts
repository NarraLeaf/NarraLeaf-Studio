import { CheckCircle, FileText, Package, Zap } from "lucide-react";
import { ProjectTemplate, LicenseOption, ResolutionOption, VersionControlOption, BackupOption } from "./types";

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
        name: "Empty",
        nameKey: "wizard.template.options.empty.name",
        description: "Start with a blank project and build from scratch",
        descriptionKey: "wizard.template.options.empty.description",
        icon: FileText,
        category: "Custom",
        categoryKey: "wizard.template.options.empty.category"
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
    // Pre-selected, the way "git" was: a new project is the one moment where turning version
    // control on costs nothing and turning it on later means the work before that point is
    // unrecorded. It is still a choice the author sees twice - on this step and on the review -
    // before anything is written, and the Settings step falls back to `none` on a host with no
    // Lore build rather than offering something that cannot happen.
    versionControl: "lore"
} as const;
