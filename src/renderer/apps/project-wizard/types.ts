import { LucideIcon } from "lucide-react";

/**
 * Project template configuration
 */
export interface ProjectTemplate {
    id: string;
    name: string;
    description: string;
    icon: LucideIcon;
    category: string;
}

/**
 * Project data structure
 */
export interface ProjectData {
    name: string;
    description: string;
    template: string;
    location: string;
    author: string;
    license: string;
    licenseCustom?: string;
    resolution: string;
    appId: string;
    versionControl: string;
}

/**
 * Directory validation result
 */
export interface DirectoryValidationResult {
    isEmpty: boolean;
    exists: boolean;
    isDirectory: boolean;
    canWrite: boolean;
}

/**
 * Validation errors
 */
export interface ValidationErrors {
    location?: string;
    directory?: string;
}

/**
 * Wizard step types
 */
export type WizardStep = "template" | "details" | "settings" | "review";

/**
 * Step configuration
 */
export interface StepConfig {
    key: WizardStep;
    label: string;
    description: string;
}

/**
 * License option
 */
export interface LicenseOption {
    value: string;
    label: string;
}

/**
 * Resolution option
 */
export interface ResolutionOption {
    value: string;
    label: string;
}

/**
 * Version control option
 */
export interface VersionControlOption {
    value: string;
    label: string;
}

/**
 * Backup option
 */
export interface BackupOption {
    value: string;
    label: string;
}
