/**
 * Turning a runtime failure into a place in the author's story.
 *
 * The runtime reports a block id and nothing more, because a block id is all it has (see
 * `GameAppRuntimeIssue`). Everything an author actually reads — which scene, which line number, what
 * that line says — needs the story document, so it is derived here, in the one window that has it.
 *
 * React- and engine-free so the locating, the line numbering and the ring can be unit-tested against
 * plain objects. The line number and the sentence come from `projectSceneTimeline`, which is the same
 * projection the Dev Mode timeline and the story editor's rows read: an error that says "line 37"
 * names the row the editor also calls 37, and quotes it word for word.
 */

// The same readability band the story editor's nametag uses. Imported rather than restated so an
// accent that the editor refuses to draw cannot quietly reappear here (both are Studio chrome, both
// render on the light and the dark surface).
import { isReadableAccentColor } from "@/apps/workspace/modules/story/scene-editor/storySceneBlockUtils";
import type { StoryRowLookups } from "@/lib/story/storyRowProjection";
import { getStorySceneName } from "@/lib/story/storyRowProjection";
import { projectSceneTimeline } from "./storyRuntimeDebugModel";
import type { GameAppRuntimeIssue } from "@/lib/ui-editor/runtime/app/GameAppHost";
import type { DevModeBundle } from "@shared/types/devMode";
import type { StoryBlockId, StoryDocument, StoryId, StoryScene, StorySceneId } from "@shared/types/story";

/**
 * Row lookups built straight off the Dev Mode bundle: characters as the compiler sees them (a name,
 * no service) and asset names from the bundle's table, so a row reads here exactly as the editor
 * writes it without ever reaching for a workspace service.
 *
 * The accent colour is banded at the lookup rather than where it is painted: the projection's
 * `StoryRowCharacter.color` is documented as "when the surface has one and *it is readable*", and
 * this is the one place that knows the surface is Studio chrome.
 */
/**
 * The slice of a Dev Mode bundle a row's words come out of: the story library (character names,
 * asset names) and the project variable registry tables.
 *
 * `ui` is optional so a fixture can still hand over a library alone; a real caller always has the
 * whole bundle, and omitting `ui` costs exactly the names of the registry-declared variables.
 */
export type StoryRowBundle = Pick<DevModeBundle, "storyLibrary"> & {
    ui?: Pick<DevModeBundle["ui"], "savedVariables" | "persistentVariables">;
};

export function buildStoryRowLookups(
    bundle: StoryRowBundle,
    document: StoryDocument,
    scene: StoryScene | undefined,
): StoryRowLookups {
    const charactersById = new Map((bundle.storyLibrary?.characters ?? []).map(character => [character.id, character]));
    const assetNames = bundle.storyLibrary?.assetNames;
    // Keyed the way each scope's ref addresses its entry: `saved` by entry id, `persistent` by
    // storage key. Both tables are baked into the bundle precisely because Dev Mode is its own window
    // with no workspace services to read `editor/variables.json` through.
    const savedNames = new Map(Object.values(bundle.ui?.savedVariables ?? {}).map(entry => [entry.id, entry.name]));
    const persistentNames = new Map(
        Object.values(bundle.ui?.persistentVariables ?? {}).map(entry => [entry.storageKey, entry.name]),
    );
    return {
        projectVariableName: (scope, variableId) =>
            (scope === "saved" ? savedNames.get(variableId) : persistentNames.get(variableId)) ?? null,
        character: characterId => {
            const character = charactersById.get(characterId);
            if (!character) {
                return null;
            }
            const color = character.color;
            return {
                name: character.name,
                ...(color && isReadableAccentColor(color) ? { color } : {}),
            };
        },
        assetName: assetId => assetNames?.[assetId] ?? null,
        scene,
        scenes: document.scenes,
        document,
    };
}

/** Where a block sits, in the terms an author navigates by. */
export type StoryBlockLocation = {
    storyId: StoryId;
    storyName: string;
    sceneId: StorySceneId;
    sceneName: string;
    blockId: StoryBlockId;
    /** 1-based, matching the row numbering the story editor shows. */
    lineNumber: number;
    /** The row's own sentence, word for word what the editor shows on that line. */
    sentence: string;
    /** The dialogue speaker's name, or null on a row that has none. */
    speaker: string | null;
};

/**
 * Find the block, wherever it lives.
 *
 * Every scene of every story is searched rather than only the launched one, and that is the point: a
 * compile walks the whole reachable graph and the play head follows jumps, so the row that failed is
 * routinely not in the scene the session started in. Returns null for a block that no longer exists
 * — a stale session against an edited document — rather than inventing a line number for it.
 */
export function locateStoryBlock(
    bundle: StoryRowBundle,
    blockId: string | undefined,
): StoryBlockLocation | null {
    if (!blockId) {
        return null;
    }
    const library = bundle.storyLibrary;
    if (!library) {
        return null;
    }
    for (const [storyId, document] of Object.entries(library.documents)) {
        for (const [sceneId, scene] of Object.entries(document.scenes)) {
            if (!(blockId in scene.blocks)) {
                continue;
            }
            const lookups = buildStoryRowLookups(bundle, document, scene);
            const row = projectSceneTimeline(scene, lookups).find(entry => entry.blockId === blockId);
            if (!row) {
                // In `scene.blocks` but not reachable from `rootBlockIds` — an orphan. It has no line
                // number because it occupies no line; naming the scene is still better than nothing.
                return {
                    storyId,
                    storyName: document.name,
                    sceneId,
                    sceneName: getStorySceneName(document.scenes, sceneId),
                    blockId,
                    lineNumber: 0,
                    sentence: "",
                    speaker: null,
                };
            }
            return {
                storyId,
                storyName: document.name,
                sceneId,
                sceneName: getStorySceneName(document.scenes, sceneId),
                blockId,
                lineNumber: row.lineNumber,
                sentence: row.summary,
                speaker: row.speaker,
            };
        }
    }
    return null;
}

/** A reported failure, with wherever it turned out to be. */
export type LocatedRuntimeIssue = {
    /** Stable per-entry key for React, and what dismissal addresses. */
    id: string;
    level: GameAppRuntimeIssue["level"];
    message: string;
    origin: GameAppRuntimeIssue["origin"];
    stack?: string;
    /** Null when the failure could not be pinned to a row — a boot failure, or a deleted block. */
    location: StoryBlockLocation | null;
};

/**
 * How many issues the window keeps.
 *
 * Still bounded now that the list lives in a scrolling panel rather than in a strip that grew down
 * over the stage: a session left running reports for as long as it runs, and the failures being
 * debugged are the recent ones. Repeats collapse (see `appendRuntimeIssue`), so reaching this many
 * means that many DISTINCT problems, which is already far past the point of reading them one by one.
 */
export const RUNTIME_ISSUE_LIMIT = 20;

/** Errors and warnings in the list, for the one-line count the strip and the panel heading show. */
export function countRuntimeIssues(issues: readonly LocatedRuntimeIssue[]): {
    errors: number;
    warnings: number;
} {
    const errors = issues.reduce((total, issue) => (issue.level === "error" ? total + 1 : total), 0);
    return { errors, warnings: issues.length - errors };
}

/**
 * The identity two reports have to share to count as the same problem: same text, same place.
 *
 * Not the message alone — the same message from two different rows is two problems, and collapsing
 * them would hide the second row entirely.
 */
function issueKey(issue: Pick<LocatedRuntimeIssue, "level" | "message"> & { blockId?: string }): string {
    return `${issue.level}\u0000${issue.blockId ?? ""}\u0000${issue.message}`;
}

/**
 * Add an issue to the list, newest first, collapsing repeats.
 *
 * A row inside a loop reports the same failure every pass; without this the banner would be a
 * hundred copies of one sentence. A repeat is moved back to the front rather than merely counted, so
 * "what is failing right now" stays at the top.
 */
export function appendRuntimeIssue(
    current: readonly LocatedRuntimeIssue[],
    issue: LocatedRuntimeIssue,
): LocatedRuntimeIssue[] {
    const key = issueKey({ ...issue, ...(issue.location ? { blockId: issue.location.blockId } : {}) });
    const withoutRepeat = current.filter(
        entry => issueKey({ ...entry, ...(entry.location ? { blockId: entry.location.blockId } : {}) }) !== key,
    );
    return [issue, ...withoutRepeat].slice(0, RUNTIME_ISSUE_LIMIT);
}

/**
 * Locate a reported issue against the bundle.
 *
 * `id` is supplied rather than generated so the caller owns the counter — a pure function that
 * reaches for a clock or a random number is a function that cannot be tested twice.
 */
export function locateRuntimeIssue(
    bundle: StoryRowBundle,
    issue: GameAppRuntimeIssue,
    id: string,
): LocatedRuntimeIssue {
    return {
        id,
        level: issue.level,
        message: issue.message,
        origin: issue.origin,
        ...(issue.stack ? { stack: issue.stack } : {}),
        location: locateStoryBlock(bundle, issue.blockId),
    };
}
