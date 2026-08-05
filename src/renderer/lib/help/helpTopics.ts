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

export const HELP_SECTIONS = ["start", "story", "content", "quality", "version", "ship"] as const;

export type HelpSectionId = (typeof HELP_SECTIONS)[number];

/**
 * Every topic id, in the order the browser lists them within their section.
 *
 * Ids are camelCase and match their catalog key exactly - `helpTopics.test.ts` asserts it, so a
 * typo is a failing test rather than a topic that renders its own key.
 */
export const HELP_TOPIC_IDS = [
    "workspaceLayout",
    "runModes",
    "keyboard",
    "search",
    "storyScene",
    "storyCommands",
    "storyVariables",
    "storyFlow",
    "assets",
    "characters",
    "audio",
    "localization",
    "uiSurfaces",
    "lint",
    "tests",
    "versionControl",
    "versionViewing",
    "versionRestore",
    "freeze",
    "build",
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
        related: ["keyboard", "search"],
    },
    {
        id: "runModes",
        section: "start",
        related: ["tests", "build", "freeze"],
    },
    {
        id: "keyboard",
        section: "start",
        shortcuts: ["workspace-keybinding-cheatsheet", "workspace-command-palette"],
        related: ["workspaceLayout"],
    },
    {
        id: "search",
        section: "start",
        shortcuts: ["workspace-command-palette", "workspace-quick-open", "story.find"],
        related: ["storyScene"],
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
        related: ["storyScene", "storyVariables"],
    },
    {
        id: "storyVariables",
        section: "story",
        related: ["storyCommands", "storyFlow"],
    },
    {
        id: "storyFlow",
        section: "story",
        related: ["storyScene", "lint"],
    },

    // --- Content --------------------------------------------------------------
    {
        id: "assets",
        section: "content",
        shortcuts: ["assets.rename", "assets.copy", "assets.paste"],
        related: ["characters", "audio", "lint"],
    },
    {
        id: "characters",
        section: "content",
        related: ["assets", "storyScene"],
    },
    {
        id: "audio",
        section: "content",
        related: ["assets"],
    },
    {
        id: "localization",
        section: "content",
        related: ["storyScene", "build"],
    },
    {
        id: "uiSurfaces",
        section: "content",
        related: ["assets", "plugins"],
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
        related: ["lint", "runModes"],
    },

    // --- Versions -------------------------------------------------------------
    {
        id: "versionControl",
        section: "version",
        related: ["versionViewing", "versionRestore", "freeze"],
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
        id: "freeze",
        section: "version",
        related: ["versionViewing", "runModes"],
    },

    // --- Shipping -------------------------------------------------------------
    {
        id: "build",
        section: "ship",
        related: ["lint", "localization", "runModes"],
        learnMore: DOCS_URL,
    },
    {
        id: "plugins",
        section: "ship",
        related: ["uiSurfaces", "storyCommands"],
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
