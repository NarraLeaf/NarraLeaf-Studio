/**
 * The `.story` text-format tools: the command catalogue, the names a line resolves, a scene printed
 * as text, and a scene written back from it.
 *
 * Each is the `story` command line's body (`@/lib/agent-core`) over the live documents, answering
 * with the text the command line prints. A write goes through {@link writeSceneForAgent}: checked
 * against the revision the agent read, one step of undo on the scene's own stack, and the changed
 * rows outlined when the author follows along.
 *
 * Comments in English per project convention.
 */

import type { StoryScene } from "@shared/types/story";
import {
    applyStorySource,
    commandText,
    formatOpaqueRowNotice,
    showStoryScene,
    STORY_COMMAND_CATEGORIES,
    storyCommandCommand,
    storyCommandsCommand,
    storyTargetsCommand,
    type StoryAgentContext,
    type StoryLintStory,
} from "@/lib/agent-core";
import { parseStoryFile } from "@/lib/story-cli/dsl/parse";
import { ANCHOR_CLOSE, ANCHOR_OPEN, DIRECTIVE_SCENE } from "@/lib/story-cli/dsl/shapes";
import {
    answer,
    readOptionalBoolean,
    readOptionalInteger,
    readOptionalString,
    readString,
    refuse,
    type AgentToolHandler,
} from "../agentCall";
import { resolveScene, resolveStory, storyService } from "../agentLookups";
import { writeSceneForAgent } from "./storyTools";
import {
    capText,
    checkFailed,
    forAgent,
    revisionComment,
    storyAgentContextOf,
    storyProjectDataOf,
    withCanonicalCommandVocabulary,
} from "./textFormat";

/** The `source` argument as written: not trimmed, since a `.story` file's indentation is its structure. */
export function readSource(args: Record<string, unknown>): string {
    const value = args.source;
    if (typeof value !== "string" || value.trim() === "") {
        throw refuse("invalid_args", "`source` must be a non-empty string.");
    }
    return value;
}

// ── Catalogue ────────────────────────────────────────────────────────────────────────────────────

export const storyCommands: AgentToolHandler = async args => {
    const query = readOptionalString(args, "query");
    const category = readOptionalString(args, "category");
    if (category && !STORY_COMMAND_CATEGORIES.includes(category)) {
        throw refuse("invalid_args", `"${category}" is not a command category. The categories are: ${STORY_COMMAND_CATEGORIES.join(", ")}.`);
    }
    // The catalogue lists command tokens, which the canonical vocabulary spells.
    const result = withCanonicalCommandVocabulary(() => storyCommandsCommand({ search: query, category }));
    return answer(capText(commandText(result), "Pass `query` or `category`."), { query: query ?? null, category: category ?? null });
};

export const storyCommand: AgentToolHandler = async args => {
    const token = readString(args, "token");
    const result = withCanonicalCommandVocabulary(() => storyCommandCommand(token));
    if (result.exitCode !== 0) {
        throw refuse("not_found", result.err.join(" "), "Call story_commands for the catalogue.");
    }
    return answer(commandText(result), { token });
};

export const storyTargets: AgentToolHandler = async (args, { ctx }) => {
    const query = readOptionalString(args, "query");
    const { entry, document } = await resolveStory(ctx, undefined);
    const result = storyTargetsCommand(storyProjectDataOf(ctx), document, { search: query });
    return answer(capText(commandText(result), "Pass `query` to narrow it."), { story: { id: entry.id, name: entry.name } });
};

// ── story_show ───────────────────────────────────────────────────────────────────────────────────

export const storyShow: AgentToolHandler = async (args, { ctx, request, follow }) => {
    const { entry, document } = await resolveStory(ctx, readOptionalString(args, "story"));
    const scene = resolveScene(document, readString(args, "scene"));
    follow.describeCall(request.callId, scene.name);
    const story: StoryLintStory = { id: entry.id, name: entry.name, document };
    const context: StoryAgentContext = { data: storyProjectDataOf(ctx), stories: [story] };
    const shown = withCanonicalCommandVocabulary(() => showStoryScene(context, story, scene.id));
    if (shown.exitCode !== 0 || shown.text === undefined) {
        throw refuse("not_found", shown.err.join(" ") || `Scene "${scene.name}" could not be printed.`);
    }
    const revision = storyService(ctx).getSceneContentRevision(entry.id, scene.id);
    const notice = shown.stats && shown.opaqueRows ? formatOpaqueRowNotice({ stats: shown.stats, opaqueRows: shown.opaqueRows }) : [];
    return {
        ok: true,
        content: [
            { type: "text", text: `${revisionComment(revision, "story_apply")}\n${shown.text.trimEnd()}` },
            ...(notice.length > 0 ? [{ type: "text" as const, text: `${shown.stats?.rows ?? 0} rows. ${notice.join("\n")}` }] : []),
        ],
        structured: {
            story: { id: entry.id, name: entry.name },
            scene: { id: scene.id, name: scene.name },
            revision,
            rows: shown.stats?.rows ?? 0,
            opaqueRows: shown.opaqueRows ?? [],
        },
    };
};

// ── story_apply ──────────────────────────────────────────────────────────────────────────────────

/**
 * The story and scene a source's header names, and the source as it will be applied.
 *
 * The header carries the scene's id when it came from `story_show`. A header that names the scene
 * only by name - an agent writing a fresh scene after `scene_create` - is resolved here and given
 * the id, so the core (which matches by id) sees the header it expects; nothing else in the source
 * changes, so the line numbers in its diagnostics still match what the agent sent.
 */
export function locateSourceScene(
    context: StoryAgentContext,
    source: string,
    defaultStoryId: string | null | undefined,
): { story: StoryLintStory; scene: StoryScene; source: string } {
    const header = parseStoryFile(source).ast;
    if (!header.sceneId && !header.sceneName) {
        throw refuse(
            "invalid_args",
            `The source has no \`${DIRECTIVE_SCENE}\` line, so it names no scene to write.`,
            "Start from the text story_show prints, which carries the header.",
        );
    }
    const named = header.storyName ? context.stories.filter(story => story.id === header.storyName || story.name === header.storyName) : [];
    const createFirst = "Create the scene with scene_create, then write its rows with story_apply.";

    if (header.sceneId) {
        const id = header.sceneId;
        const story = named.find(item => item.document.scenes?.[id]) ?? context.stories.find(item => item.document.scenes?.[id]);
        if (!story) {
            throw refuse("not_found", `No scene in this project has the id ${id}${header.sceneName ? ` ("${header.sceneName}")` : ""}. It may have been deleted.`, createFirst);
        }
        return { story, scene: story.document.scenes[id], source };
    }

    if (header.storyName && named.length === 0) {
        throw refuse("not_found", `No story "${header.storyName}".`, `${createFirst} scene_create makes the story too.`);
    }
    if (named.length > 1) {
        throw refuse("invalid_args", `${named.length} stories are called "${header.storyName}".`, "Copy the header story_show prints, which names the scene by id.");
    }
    const story = named[0]
        ?? context.stories.find(item => item.id === defaultStoryId)
        ?? context.stories[0];
    if (!story) {
        throw refuse("not_found", "This project has no story yet.", createFirst);
    }
    const wanted = header.sceneName as string;
    const scenes = Object.values(story.document.scenes ?? {}).filter(scene => scene.name === wanted);
    if (scenes.length === 0) {
        throw refuse("not_found", `No scene "${wanted}" in story "${story.name}".`, createFirst);
    }
    if (scenes.length > 1) {
        throw refuse("invalid_args", `${scenes.length} scenes are called "${wanted}" in story "${story.name}".`, "Copy the header story_show prints, which names the scene by id.");
    }
    const scene = scenes[0];
    const lines = source.split("\n");
    const at = lines.findIndex(line => line.trim().startsWith(`${DIRECTIVE_SCENE} `) || line.trim() === DIRECTIVE_SCENE);
    lines[at] = `${DIRECTIVE_SCENE} ${scene.name} ${ANCHOR_OPEN}${scene.id}${ANCHOR_CLOSE}`;
    return { story, scene, source: lines.join("\n") };
}

/** The rows a write adds or changes, for follow mode to outline. */
export function changedRowIds(before: StoryScene, after: StoryScene): string[] {
    const previous = before.blocks ?? {};
    return Object.entries(after.blocks ?? {})
        .filter(([id, block]) => !previous[id] || JSON.stringify(previous[id]) !== JSON.stringify(block))
        .map(([id]) => id);
}

function staleScene(read: number, now: number) {
    return refuse(
        "stale_revision",
        `The scene changed since you read it (revision ${read}, now ${now}).`,
        "Call story_show again, redo the edit on what it prints, and pass the new revision.",
    );
}

export const storyApply: AgentToolHandler = async (args, { ctx, request, follow }) => {
    const raw = readSource(args);
    const baseRevision = readOptionalInteger(args, "baseRevision");
    const dryRun = readOptionalBoolean(args, "dryRun") ?? false;
    const service = storyService(ctx);
    const context = await storyAgentContextOf(ctx);
    const { story, scene, source } = locateSourceScene(context, raw, service.getDefaultStoryId());
    follow.describeCall(request.callId, scene.name);

    // Said before the check runs, so an agent working from an old read is told that first rather
    // than after a report about text that may no longer apply.
    if (baseRevision !== undefined) {
        const now = service.getSceneContentRevision(story.id, scene.id);
        if (now !== baseRevision) {
            throw staleScene(baseRevision, now);
        }
    }

    // The vocabulary is not pinned here: see `withCanonicalCommandVocabulary`. Both spellings parse.
    let revision = null as number | null;
    const result = await applyStorySource(source, context, story, {
        write: !dryRun,
        commit: dryRun
            ? undefined
            : next => {
                const written = next.scenes[scene.id];
                revision = writeSceneForAgent({ ctx, follow }, {
                    storyId: story.id,
                    sceneId: scene.id,
                    scene: written,
                    baseRevision,
                    changedBlockIds: changedRowIds(scene, written),
                });
                return null;
            },
    });
    if (result.exitCode === 1) {
        throw checkFailed(commandText(result), "Fix the errors and apply again; story_command explains a command's parameters.");
    }
    if (result.exitCode !== 0 || !result.summary) {
        throw refuse("not_found", result.err.join(" ") || "The scene could not be written.", "Call story_list, then story_show the scene again.");
    }

    const summary = result.summary;
    const lines = [forAgent(commandText(result))];
    if (revision !== null) {
        lines.push(`Revision ${revision}: pass it as baseRevision to the next story_apply of this scene.`);
    }
    return answer(lines.join("\n"), {
        story: { id: story.id, name: story.name },
        scene: { id: scene.id, name: scene.name },
        dryRun,
        written: !dryRun,
        revision: revision ?? service.getSceneContentRevision(story.id, scene.id),
        rows: { added: summary.added, changed: summary.changed, removed: summary.removed },
        renamedTo: summary.renamedTo,
    });
};
