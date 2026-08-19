import type { TranslationKey } from "@shared/i18n";

/**
 * The help topic registry - the one list both windows read.
 *
 * A topic is an id plus the section it files under; its words live in the `help` i18n namespace
 * under `help.topics.<id>`, so a topic cannot exist half-translated (the parity test catches the
 * other half). Everything else here is a cross-reference: `shortcuts` are keybinding *catalog* ids
 * resolved against the user's current bindings at render time, and `related` are other topic ids.
 *
 * Adding one is three steps, listed in `docs/help-system.md` §7. Nothing here is generated: a
 * surface with no topic simply has no help, which is the honest state and not a placeholder.
 */

export const HELP_SECTIONS = [
    "start",
    "story",
    "content",
    "interface",
    "quality",
    "version",
    "ship",
] as const;

export type HelpSectionId = (typeof HELP_SECTIONS)[number];

/**
 * Every topic id, in the order the browser lists them within their section.
 *
 * Ids are camelCase and match their catalog key exactly - `helpTopics.test.ts` asserts it, so a
 * typo is a failing test rather than a topic that renders its own key.
 */
export const HELP_TOPIC_IDS = [
    "workspaceLayout",
    "newProject",
    "runModes",
    "keyboard",
    "search",
    "undo",
    "studioSettings",
    "storyScene",
    "storyCommands",
    "storyVariables",
    "storyExpressions",
    "storyFlow",
    "storyScript",
    "sceneSnapshot",
    "storyMotion",
    "assets",
    "assetSets",
    "assetSetAxes",
    "mediaConversion",
    "characters",
    "appearances",
    "puppetRuntimes",
    "audio",
    "audioClips",
    "voice",
    "localization",
    "brand",
    "uiSurfaces",
    "uiComponents",
    "blueprints",
    "uiBindings",
    "networkNodes",
    "lint",
    "tests",
    "dashboard",
    "recovery",
    "versionControl",
    "versionChanges",
    "versionViewing",
    "versionRestore",
    "versionConflicts",
    "versionServer",
    "freeze",
    "build",
    "olderSaves",
    "saveSameStory",
    "saveStoryChanged",
    "patches",
    "buildVariant",
    "appTags",
    "variantContent",
    "icons",
    "signing",
    "assetProtection",
    "networkAllowlist",
    "webOptimization",
    "plugins",
] as const;

export type HelpTopicId = (typeof HELP_TOPIC_IDS)[number];

export interface HelpTopic {
    id: HelpTopicId;
    section: HelpSectionId;
    /**
     * Keybinding catalog ids to show as chord rows under the body. Rendered through the keybinding
     * service, so a rebound chord shows rebound here too; an id with no catalog entry is a test
     * failure rather than a blank row.
     */
    shortcuts?: readonly string[];
    related?: readonly HelpTopicId[];
    /** An http(s) page carrying the version that would not fit the eight-line budget. */
    learnMore?: string;
}

const DOCS_URL = "https://www.narraleaf.com/docs/studio";

export const HELP_TOPICS: readonly HelpTopic[] = [
    // --- Getting around -------------------------------------------------------
    {
        id: "workspaceLayout",
        section: "start",
        shortcuts: ["editor-split-right", "editor-split-down", "workspace-editor-quick-switch-next"],
        related: ["keyboard", "search", "undo"],
    },
    {
        id: "newProject",
        section: "start",
        related: ["workspaceLayout", "versionServer"],
    },
    {
        id: "runModes",
        section: "start",
        related: ["tests", "build", "freeze", "sceneSnapshot"],
    },
    {
        id: "keyboard",
        section: "start",
        shortcuts: ["workspace-keybinding-cheatsheet", "workspace-command-palette"],
        related: ["workspaceLayout", "studioSettings"],
    },
    {
        id: "search",
        section: "start",
        shortcuts: ["workspace-command-palette", "workspace-quick-open", "story.find"],
        related: ["storyScene"],
    },
    {
        id: "undo",
        section: "start",
        shortcuts: ["workspace.undo", "workspace.redo", "workspace-reopen-closed-tab"],
        related: ["workspaceLayout", "versionControl"],
    },
    {
        id: "studioSettings",
        section: "start",
        related: ["keyboard", "plugins"],
    },

    // --- Story ----------------------------------------------------------------
    {
        id: "storyScene",
        section: "story",
        shortcuts: ["story.edit-active", "story.insert-blank-after-selection", "story.duplicate", "story.move-row-down"],
        related: ["storyCommands", "storyVariables", "storyFlow"],
    },
    {
        id: "storyCommands",
        section: "story",
        related: ["storyScene", "storyVariables", "storyExpressions"],
    },
    {
        id: "storyVariables",
        section: "story",
        related: ["storyCommands", "storyExpressions", "sceneSnapshot"],
    },
    {
        id: "storyExpressions",
        section: "story",
        related: ["storyVariables", "storyCommands"],
    },
    {
        id: "storyFlow",
        section: "story",
        related: ["storyScene", "lint"],
    },
    {
        id: "storyScript",
        section: "story",
        related: ["storyScene", "localization"],
    },
    {
        id: "sceneSnapshot",
        section: "story",
        related: ["storyVariables", "runModes"],
    },
    {
        id: "storyMotion",
        section: "story",
        shortcuts: ["story-motion.prev-frame", "story-motion.next-frame", "story-motion.delete"],
        related: ["storyCommands", "characters"],
    },

    // --- Content --------------------------------------------------------------
    {
        id: "assets",
        section: "content",
        shortcuts: ["assets.rename", "assets.copy", "assets.paste"],
        related: ["assetSets", "characters", "audio", "lint"],
    },
    {
        id: "assetSets",
        section: "content",
        related: ["assetSetAxes", "assets", "localization"],
    },
    {
        id: "assetSetAxes",
        section: "content",
        related: ["assetSets", "appTags", "variantContent"],
    },
    {
        id: "mediaConversion",
        section: "content",
        related: ["assets", "webOptimization"],
    },
    {
        id: "characters",
        section: "content",
        related: ["appearances", "assets", "storyScene"],
    },
    {
        id: "appearances",
        section: "content",
        related: ["characters", "puppetRuntimes", "assets"],
    },
    {
        id: "puppetRuntimes",
        section: "content",
        related: ["appearances", "assets"],
    },
    {
        id: "audio",
        section: "content",
        related: ["assets", "audioClips"],
    },
    {
        id: "audioClips",
        section: "content",
        shortcuts: [
            "assets.audio.play-pause",
            "assets.audio.mark-in",
            "assets.audio.mark-loop",
            "assets.audio.mark-out",
        ],
        related: ["audio", "assets"],
    },
    {
        id: "voice",
        section: "content",
        related: ["localization", "audio", "characters"],
    },
    {
        id: "localization",
        section: "content",
        related: ["storyScene", "voice", "build"],
    },

    // --- Game interface -------------------------------------------------------
    // Brand leads the section: the palette is what every surface below it is painted from, and a
    // reader who meets "point this at a project color" on a widget arrives here for the answer.
    {
        id: "brand",
        section: "interface",
        related: ["uiSurfaces", "uiComponents", "lint"],
    },
    {
        id: "uiSurfaces",
        section: "interface",
        related: ["uiComponents", "blueprints", "uiBindings"],
    },
    {
        id: "uiComponents",
        section: "interface",
        shortcuts: ["ui-editor.group", "ui-editor.dup"],
        related: ["uiSurfaces", "uiBindings"],
    },
    {
        id: "blueprints",
        section: "interface",
        shortcuts: ["blueprint.copy", "blueprint.paste", "blueprint.undo"],
        related: ["uiBindings", "uiSurfaces", "storyVariables"],
    },
    {
        id: "uiBindings",
        section: "interface",
        related: ["blueprints", "uiSurfaces", "storyVariables"],
    },
    {
        id: "networkNodes",
        section: "interface",
        related: ["blueprints", "networkAllowlist", "assetProtection", "lint"],
    },

    // --- Checks ---------------------------------------------------------------
    {
        id: "lint",
        section: "quality",
        related: ["tests", "build"],
    },
    {
        id: "tests",
        section: "quality",
        related: ["lint", "runModes", "build"],
    },
    {
        id: "dashboard",
        section: "quality",
        related: ["storyScene", "localization"],
    },
    {
        id: "recovery",
        section: "quality",
        related: ["versionRestore", "freeze", "lint"],
    },

    // --- Versions -------------------------------------------------------------
    {
        id: "versionControl",
        section: "version",
        related: ["versionChanges", "versionViewing", "versionRestore", "versionServer"],
    },
    {
        id: "versionChanges",
        section: "version",
        related: ["versionControl", "versionConflicts"],
    },
    {
        id: "versionViewing",
        section: "version",
        related: ["versionControl", "versionRestore", "freeze"],
    },
    {
        id: "versionRestore",
        section: "version",
        related: ["versionControl", "versionViewing"],
    },
    {
        id: "versionConflicts",
        section: "version",
        related: ["versionServer", "versionChanges", "freeze"],
    },
    {
        id: "versionServer",
        section: "version",
        related: ["versionControl", "versionConflicts", "newProject"],
    },
    {
        id: "freeze",
        section: "version",
        related: ["versionViewing", "runModes"],
    },

    // --- Shipping -------------------------------------------------------------
    {
        id: "build",
        section: "ship",
        related: ["patches", "icons", "signing", "assetProtection"],
        learnMore: DOCS_URL,
    },
    // What a build does with the saves players already have. Three topics rather than one, because
    // the parent answers which of the three cases an author is looking at and the two children
    // answer what each setting produces - a single topic would need a heading between them.
    {
        id: "olderSaves",
        section: "ship",
        related: ["saveSameStory", "saveStoryChanged", "patches"],
    },
    {
        id: "saveSameStory",
        section: "ship",
        related: ["olderSaves", "saveStoryChanged"],
    },
    {
        id: "saveStoryChanged",
        section: "ship",
        related: ["olderSaves", "saveSameStory", "patches"],
    },
    // The other thing an author ships, and the reason it is a topic of its own rather than a note
    // under `build`: a patch reaches a game that is already installed, so what it can carry and
    // what it cannot is a different question from how a build is made.
    {
        id: "patches",
        section: "ship",
        related: ["build", "appTags", "assetProtection", "lint"],
        learnMore: DOCS_URL,
    },
    // The build dialog's first page. Separate from `appTags`, which answers what a variant is and
    // how one is edited: this one answers what picking it here does to the build.
    {
        id: "buildVariant",
        section: "ship",
        related: ["appTags", "variantContent", "build"],
    },
    {
        id: "appTags",
        section: "ship",
        related: ["build", "buildVariant", "variantContent", "lint"],
    },
    // The content half of a variant: which rows and scenes a build of it carries. Separate from
    // `appTags`, which answers what a variant states about the application itself.
    {
        id: "variantContent",
        section: "ship",
        related: ["appTags", "buildVariant", "storyExpressions", "lint"],
    },
    {
        id: "icons",
        section: "ship",
        related: ["build", "assets"],
    },
    {
        id: "signing",
        section: "ship",
        related: ["build", "assetProtection"],
        learnMore: DOCS_URL,
    },
    {
        id: "assetProtection",
        section: "ship",
        related: ["build", "webOptimization", "plugins", "networkNodes"],
    },
    {
        id: "networkAllowlist",
        section: "ship",
        related: ["networkNodes", "assetProtection", "plugins", "lint"],
    },
    {
        id: "webOptimization",
        section: "ship",
        related: ["build", "assets"],
    },
    {
        id: "plugins",
        section: "ship",
        related: ["uiSurfaces", "storyCommands", "studioSettings"],
        learnMore: DOCS_URL,
    },
];

const TOPICS_BY_ID = new Map<string, HelpTopic>(HELP_TOPICS.map(topic => [topic.id, topic]));

export function getHelpTopic(id: string | null | undefined): HelpTopic | undefined {
    return id ? TOPICS_BY_ID.get(id) : undefined;
}

export function isHelpTopicId(id: string): id is HelpTopicId {
    return TOPICS_BY_ID.has(id);
}

export function helpTitleKey(id: HelpTopicId): TranslationKey {
    return `help.topics.${id}.title` as TranslationKey;
}

export function helpBodyKey(id: HelpTopicId): TranslationKey {
    return `help.topics.${id}.body` as TranslationKey;
}

export function helpSectionKey(section: HelpSectionId): TranslationKey {
    return `help.sections.${section}` as TranslationKey;
}

/** The registry grouped for the browser's left column; sections with no topics are dropped. */
export function helpTopicsBySection(): Array<{ section: HelpSectionId; topics: HelpTopic[] }> {
    return HELP_SECTIONS.map(section => ({
        section,
        topics: HELP_TOPICS.filter(topic => topic.section === section),
    })).filter(group => group.topics.length > 0);
}

/**
 * Free-text filter over title and body.
 *
 * Body is searched as well as title because an author looks for the word they met in the interface
 * ("checkpoint", "CSV"), which is rarely the word a topic is titled with. Matching is plain
 * substring on the resolved strings, so it works in whichever language the interface is in.
 */
export function filterHelpTopics(
    topics: readonly HelpTopic[],
    rawQuery: string,
    translate: (key: TranslationKey) => string,
): HelpTopic[] {
    const query = rawQuery.trim().toLowerCase();
    if (!query) {
        return [...topics];
    }
    return topics.filter(topic => {
        const haystack = `${translate(helpTitleKey(topic.id))}\n${translate(helpBodyKey(topic.id))}`;
        return haystack.toLowerCase().includes(query);
    });
}
