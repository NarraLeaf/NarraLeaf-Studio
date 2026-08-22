import { GitBranch, Package, PencilLine } from "lucide-react";
import { ProjectFlow, ProjectOrigin, ProjectTemplate, VersionControlOption, WizardStep } from "./types";
import { NARRALEAF_TEAM } from "@shared/constants/servers";

/**
 * The pages each origin leads to, in order.
 *
 * **The two "bring one in" flows are short on purpose.** Everything the create flow asks on
 * Project and Stage - name, app id, stage size, author, version control - is already decided for a
 * project that exists somewhere else, and travels with it. Asking would either be ignored or would
 * overwrite what that project's own author chose.
 *
 * Import is two pages rather than three because it has nothing to collect: the package and the
 * folder are both chosen through native dialogs that the main process puts up, so there is no
 * field for a page to hold.
 *
 * In all three the last page is the only one that does anything - nothing is written, unpacked or
 * fetched until the author is standing on it and presses the button.
 */
export const WIZARD_FLOW_STEPS: Record<ProjectFlow, WizardStep[]> = {
    create: ["origin", "project", "stage", "review"],
    import: ["origin", "import"],
    clone: ["origin", "source", "clone"],
};

/**
 * The three answers to "where is this project coming from", in the order they actually happen.
 *
 * A package is the answer when somebody handed you a file - a colleague's export, a backup, a
 * template someone published - and it is a more common way to receive a project than a server is.
 * Both used to be unlabelled icons in the launcher's toolbar.
 */
export const projectOrigins: ProjectOrigin[] = [
    {
        flow: "create",
        labelKey: "wizard.origin.create.label",
        descriptionKey: "wizard.origin.create.description",
        icon: PencilLine,
    },
    {
        flow: "import",
        labelKey: "wizard.origin.import.label",
        descriptionKey: "wizard.origin.import.description",
        icon: Package,
    },
    {
        flow: "clone",
        labelKey: "wizard.origin.clone.label",
        descriptionKey: "wizard.origin.clone.description",
        icon: GitBranch,
    },
];

/** The id of the entry that scaffolds nothing beyond the generated skeleton. */
export const BLANK_TEMPLATE_ID = "empty";

/**
 * The one template that is not content: an empty project.
 *
 * It declares no stage sizes, which is what lets it be the way out of a template's constraint -
 * everything else in the list offers only the sizes its own surfaces were drawn for.
 */
export const blankTemplate: ProjectTemplate = {
    id: BLANK_TEMPLATE_ID,
    name: "Empty",
    nameKey: "wizard.template.blank.name",
    description: "Start from a blank project",
    descriptionKey: "wizard.template.blank.description",
    stageSizes: [],
};

/**
 * Version control options.
 *
 * **One backend, and the author never learns its name.** Studio has exactly one
 * version-control backend, Lore (`VcsManager`), which is what the `lore` value means and why
 * picking it actually calls `initRepository` (see `ProjectService.createProject`). What the
 * author reads is the product the feature belongs to: a project put under version control here is
 * a project that can be sent to a NarraLeaf Team server, and Team is the name they will meet
 * again in the corner of the workspace and in Settings.
 *
 * The value stays `lore` deliberately. It names the backend, which is what this field selects,
 * and renaming it would rename an identifier to match a label - the same mistake as translating a
 * key. `NARRALEAF_TEAM` is not localized: a product name is spelled the same in every language.
 */
export const versionControlOptions: VersionControlOption[] = [
    { value: "lore", label: NARRALEAF_TEAM },
    { value: "none", label: "None", labelKey: "common.none" },
];

/** What a build ships as until the author says otherwise; also what the build preflight demands. */
export const DEFAULT_PROJECT_VERSION = "1.0.0";

/**
 * Default project data
 */
export const defaultProjectData = {
    name: "",
    description: "",
    template: "",
    location: "",
    author: "",
    website: "",
    version: DEFAULT_PROJECT_VERSION,
    resolution: "1920x1080",
    appId: "",
    sourceLocale: "",
    remoteUrl: "",
    packagePath: "",
    // Pre-selected, the way "git" was: a new project is the one moment where turning version
    // control on costs nothing and turning it on later means the work before that point is
    // unrecorded. It is still a choice the author sees twice - on this step and on the review -
    // before anything is written, and the Project step falls back to `none` on a host with no
    // backend rather than offering something that cannot happen.
    versionControl: "lore",
} as const;
