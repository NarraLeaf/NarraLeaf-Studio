import { LucideIcon } from "lucide-react";
import { TranslationKey } from "@shared/i18n";
import type { StageSize } from "@shared/types/stageSize";

/**
 * Which path through the wizard a first-page choice starts.
 *
 * **The first page is not about templates; it is about where the project comes from.** `create`
 * scaffolds one here from answers the author types. `import` unpacks one somebody handed them as
 * a file. `clone` copies one that already exists on a version-control server. Only the first has
 * anything left to ask - for the other two every answer is already recorded in what is being
 * brought in.
 *
 * They are three different wizards behind one entry point, so the flow is a property of the choice
 * rather than something read off an id: a card that only *looked* like a template while silently
 * taking another path is the kind of thing that stays invisible until it is wrong.
 */
export type ProjectFlow = "create" | "import" | "clone";

/**
 * One of the three answers to "where is this project coming from", as the first page's left column
 * lists them.
 *
 * Separate from {@link ProjectTemplate} since the two were pulled apart: an origin is a fixed set
 * of three, a template is content this build happens to ship. Mixing them into one card list meant
 * every template shipped made the origins harder to find.
 */
export interface ProjectOrigin {
    flow: ProjectFlow;
    labelKey: TranslationKey;
    descriptionKey: TranslationKey;
    icon: LucideIcon;
}

/**
 * A project template: content copied over the freshly written skeleton.
 *
 * `blank` is one of these too - the entry with no `contentTemplateId`, which writes nothing beyond
 * the skeleton. It is a template in the only sense that matters here, that the author picks it
 * from the same list.
 */
export interface ProjectTemplate {
    id: string;
    name: string;
    /** i18n key; when set, overrides `name` at render time (falls back to `name`). */
    nameKey?: TranslationKey;
    description: string;
    /** i18n key; when set, overrides `description` at render time (falls back to `description`). */
    descriptionKey?: TranslationKey;
    /**
     * The bundled template whose content this entry scaffolds from, when it has one.
     *
     * Absent on `blank`, which writes only the generated skeleton.
     */
    contentTemplateId?: string;
    /**
     * The stage sizes this template's content is laid out for, in offer order.
     *
     * Empty means the template constrains nothing and the author picks from the full preset list -
     * which is what `blank` means, and what a template that declares no size means.
     */
    stageSizes: StageSize[];
}

/**
 * Which version-control backend to put the new project under.
 *
 * A closed union rather than a string, because this field is ACTED ON: `lore` calls
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
    /** The template entry the author picked, by id. `blank` when they picked none of the content ones. */
    template: string;
    location: string;
    author: string;
    /** Project homepage; written to `metadata.website`. */
    website: string;
    /**
     * The version the first build ships as, `1.0.0` unless the author changes it.
     *
     * Asked here because leaving it unset is not neutral: the build refuses outright on a missing
     * version (`version-missing` in the build preflight), so every project created before this
     * field existed had to be sent back to the project panel before it could be packaged once.
     */
    version: string;
    /** Stage size as `WxH`; see @shared/types/stageSize. */
    resolution: string;
    appId: string;
    /**
     * The language the story is written in, written to `app.localization.sourceLocale`.
     *
     * A prefill, not a commitment: the localization panel is where languages are added, removed
     * and re-sourced. What it buys is that the panel has something to work from on first open,
     * rather than refusing everything until a source language is named.
     */
    sourceLocale: string;
    versionControl: VersionControlChoice;
    /**
     * The bundled template to copy content from after the skeleton is written.
     *
     * Kept separate from `template` - which is the *entry* the author picked - because only some
     * entries bring content. Deriving one from the other would mean `createProject` matching ids
     * against the entry list, and an entry renamed later would silently stop scaffolding.
     */
    contentTemplateId?: string;
    /**
     * The server address a cloned project comes from, e.g. `lore://studio.example.lan:41337/my-game`.
     *
     * Only the `clone` flow reads it, and it is the ONLY thing that flow asks about the project
     * itself: name, app id, stage size and author are all already recorded in what the server
     * sends, and asking again would let the author give answers that the clone then overwrites.
     */
    remoteUrl: string;
    /**
     * The `.nlspkg` an import unpacks, as the file picker returned it.
     *
     * Only the `import` flow reads it. Held here rather than in the page so it survives stepping
     * back to the first page and returning, the same way the clone flow's address does.
     */
    packagePath: string;
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
export type WizardStep = "origin" | "project" | "stage" | "review" | "source" | "clone" | "import";

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
 * How an import is going.
 *
 * `unpacking` says what it says, which it could not before: the whole of an import used to happen
 * inside one call that put two native dialogs on screen, so for most of its life the page was
 * waiting on the author rather than on work, and a spinner there was a lie. Both answers are now
 * collected before the button, so everything after it is real work.
 */
export type ImportStatus = "idle" | "unpacking";

/**
 * An import that did not end with an openable project.
 *
 * Shares `notAProject` with {@link CloneFailure} and for the same reason: a package that unpacked
 * cleanly can still contain something Studio cannot open, and the files are on disk either way.
 */
export type ImportFailure =
    | { kind: "failed"; message: string }
    | { kind: "notAProject"; destination: string };

/**
 * Step configuration
 */
export interface StepConfig {
    key: WizardStep;
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
