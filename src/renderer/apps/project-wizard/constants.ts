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
        description: "Start with a blank project and build from scratch",
        icon: FileText,
        category: "Custom"
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
    { value: "Other", label: "Other" },
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
 * Version control options
 */
export const versionControlOptions: VersionControlOption[] = [
    { value: "git", label: "Git" },
    { value: "none", label: "None" },
];

/**
 * Backup options (currently unused but prepared for future use)
 */
export const backupOptions: BackupOption[] = [
    { value: "none", label: "No backups" },
    { value: "hourly", label: "Hourly" },
    { value: "daily", label: "Daily" },
    { value: "weekly", label: "Weekly" },
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
    versionControl: "git"
} as const;
