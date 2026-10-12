/**
 * The story (`.story`) half of the agent core: the `story` command line's catalogue, print, check
 * and apply, over documents the caller holds.
 *
 * # What the caller supplies ({@link StoryAgentContext})
 *
 * - `data` - the lists a line resolves its names against, from
 *   `buildStoryProjectContext({ assets, characters, variableRegistry, blueprintDocument, audioTracks,
 *   appTags, uiDocument, assetSets })`. In Studio: `AssetsService`'s asset map, `CharacterService`'s
 *   characters, `VariableRegistryService`'s entries, `UIGraphService`'s blueprint document, the audio
 *   track and app tag lists, and `UIDocumentService`'s document (its pages and input actions). Every
 *   field is optional and a missing one is an empty list, never a guess.
 * - `stories` - every story the library lists, in library order, each its summary (`id`, `name`,
 *   `dlcId`) plus its live, migrated document. The document layer (the project linter) reads all of
 *   them for a project check and for the baseline an apply is judged against; a file check reads
 *   only its own story.
 * - `unreadable` - stories whose document would not open, reported as `story/unreadable`. Optional.
 *
 * Printing uses the command vocabulary `commandI18nStore` resolves to. The command line pins it to
 * the canonical English tokens; inside Studio it follows the author's setting unless the caller pins
 * it around the call.
 *
 * Comments in English per project convention.
 */

import type { StoryScene } from "@shared/types/story";
import type { StoredStories, StoryLintStory } from "../story-cli/check";
import {
    storyApplyCommand,
    storyCheckProjectCommand,
    storyCheckSourceCommand,
    storyShowCommand,
    type StoryApplyOptions,
    type StoryApplyResult,
    type StoryCheckResult,
    type StoryShowResult,
} from "../story-cli/core";
import { findStory, type ProjectData, type StorySummary } from "../story-cli/model";

export type StoryAgentContext = {
    data: ProjectData;
    stories: readonly StoryLintStory[];
    unreadable?: readonly { summary: StorySummary; error: unknown }[];
};

/** The context as the document layer's "project as stored". */
export function storedStoriesOf(context: StoryAgentContext): StoredStories {
    return { data: context.data, stories: context.stories, unreadable: context.unreadable };
}

/**
 * The story a call names, by id, whole name or part of one; with no name, the only story. The
 * refusal is the command line's wording, minus its flag.
 */
export function resolveStory(
    context: StoryAgentContext,
    query: string | undefined,
): { story: StoryLintStory } | { error: string } {
    const found = findStory(context.stories, query);
    if (found) {
        return { story: context.stories.find(story => story.id === found.id) as StoryLintStory };
    }
    if (context.stories.length === 0) {
        return { error: "This project holds no stories." };
    }
    const names = context.stories.map(item => item.name).join(", ");
    return {
        error: query
            ? `No story matches "${query}". This project has: ${names}.`
            : `This project has ${context.stories.length} stories, so name one: ${names}.`,
    };
}

/** `story show`: one scene of `story` in the `.story` format (the first scene when none is named). */
export function showStoryScene(context: StoryAgentContext, story: StoryLintStory, scene?: string): StoryShowResult {
    return storyShowCommand(context.data, story, { scene });
}

/** `story check <file>`: the file layer, then the project linter with the file's scene substituted in. */
export function checkStorySourceText(
    source: string,
    context: StoryAgentContext,
    story: StoryLintStory,
    options: { fileName?: string; scene?: StoryScene | null } = {},
): Promise<StoryCheckResult> {
    return storyCheckSourceCommand(source, { data: context.data, story, scene: options.scene ?? null }, options);
}

/** `story check` with no file: the project linter over every story. */
export function checkStoryProjectText(context: StoryAgentContext): Promise<StoryCheckResult> {
    return storyCheckProjectCommand(storedStoriesOf(context));
}

/**
 * `story apply <file>`: check, judge only the findings this file introduces, and hand back the story
 * document with the scene replaced (`document`, a new object - nothing is mutated). Commit it through
 * `options.commit` or from the result; a rename in the file is reported, never applied.
 */
export function applyStorySource(
    source: string,
    context: StoryAgentContext,
    story: StoryLintStory,
    options: StoryApplyOptions & { storedSchemaVersion?: number | null } = {},
): Promise<StoryApplyResult> {
    const { storedSchemaVersion, ...applyOptions } = options;
    return storyApplyCommand(
        source,
        { data: context.data, story, stored: () => storedStoriesOf(context), storedSchemaVersion },
        applyOptions,
    );
}
