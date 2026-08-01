import { LucideIcon } from "lucide-react";
import { TranslationKey } from "@shared/i18n";

/**
 * Which path through the wizard a first-page card starts.
 *
 * **The first page is no longer only about templates.** `create` scaffolds a project here from
 * answers the author types; `clone` copies one that already exists on a version-control server,
 * where every one of those answers is already decided and stored. They are two different wizards
 * behind one entry point, so the flow is a property of the card rather than something read off
 * its id - a card that only *looked* like a template while silently taking the other path is the
 * kind of thing that is invisible until it is wrong.
 */
export type ProjectFlow = "create" | "clone";

/**
 * Project template configuration
 */
export interface ProjectTemplate {
    id: string;
    /** Which wizard this card starts. See {@link ProjectFlow}. */
    flow: ProjectFlow;
    name: string;
    /** i18n key; when set, overrides `name` at render time (falls back to `name`). */
    nameKey?: TranslationKey;
    description: string;
    /** i18n key; when set, overrides `description` at render time (falls back to `description`). */
    descriptionKey?: TranslationKey;
    icon: LucideIcon;
    category: string;
    /** i18n key; when set, overrides `category` at render time (falls back to `category`). */
    categoryKey?: TranslationKey;
}

/**
 * Which version-control backend to put the new project under.
 *
 * A closed union rather than a string, because this field is now ACTED ON: `lore` calls
 * `initRepository` at creation time. While it was inert a typo was invisible; now a third
 * spelling would silently mean "none" and the author would get an unversioned project after
 * asking for a versioned one.
 */
export type VersionControlChoice = "lore" | "none";

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
    versionControl: VersionControlChoice;
    /**
     * The server address a cloned project comes from, e.g. `lore://studio.example.lan:41337/my-game`.
     *
     * Only the `clone` flow reads it, and it is the ONLY thing that flow asks about the project
     * itself: name, app id, stage size, licence and author are all already recorded in what the
     * server sends, and asking again would let the author give answers that the clone then
     * overwrites.
     */
    remoteUrl: string;
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
 * Wizard step types.
 *
 * Not a sequence: which of these the author walks through, and in what order, depends on the
 * {@link ProjectFlow} they picked on the first page. See `WIZARD_FLOW_STEPS`.
 */
export type WizardStep = "template" | "details" | "settings" | "review" | "source" | "clone";

/**
 * How a clone is going, for the last page to draw.
 *
 * Two states and no more, because there is no third thing to say: the backend delivers a clone's
 * progress events only once the call has finished, and the check that follows it is a single
 * directory listing. A phase the author sees for ten milliseconds is not information.
 */
export type CloneStatus = "idle" | "cloning";

/**
 * A clone that did not end with an openable project, and what the author can do about it.
 *
 * `notAProject` carries the destination because those files are still on disk - the clone
 * succeeded, it simply brought down something Studio cannot open - and the folder the author
 * picked is no longer empty, so the next attempt needs a different one.
 */
export type CloneFailure =
    | { kind: "failed"; message: string }
    | { kind: "notAProject"; destination: string };

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
    /** i18n key; when set, overrides `label` at render time (falls back to `label`). */
    labelKey?: TranslationKey;
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
    value: VersionControlChoice;
    label: string;
    /** i18n key; when set, overrides `label` at render time (falls back to `label`). */
    labelKey?: TranslationKey;
}

/**
 * Backup option
 */
export interface BackupOption {
    value: string;
    label: string;
    /** i18n key; when set, overrides `label` at render time (falls back to `label`). */
    labelKey?: TranslationKey;
}
