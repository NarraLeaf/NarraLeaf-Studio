/**
 * The story outline: `story_list`, `story_rename`, `scene_create`, `scene_rename`,
 * `scene_set_entry`, `scene_delete`, and the revision-checked scene write the `.story` tools build on.
 *
 * Writing a scene's rows (`story_apply`) is the text-format tool's; what it needs from here is
 * {@link writeSceneForAgent}: the revision check against the scene the agent read, and the write
 * as one step of undo on the scene's own stack.
 *
 * Comments in English per project convention.
 */

import type { TranslationKey } from "@shared/i18n";
import type { StoryChapter, StoryDocument, StoryScene } from "@shared/types/story";
import { answer, answerJson, readOptionalString, readString, refuse, type AgentToolHandler, type AgentToolContext } from "../agentCall";
import { AGENT_HISTORY_LABEL, resolveScene, resolveStory, storyService } from "../agentLookups";
import { assertAgentMayStillWrite } from "../agentCommitGate";
import { blueprintReferencesTo, formatReferrers, storyReferencesTo, uiReferencesTo } from "../agentReferences";
import { Services } from "../../services";
import type { HistoryService } from "../../history/HistoryService";
import { projectHistoryScope } from "../../history/historyScopes";
import { liveBlueprintDocument, loadAllStories, uiDocumentService } from "./textFormat";

function rowCount(scene: StoryScene): number {
    return Object.keys(scene.blocks ?? {}).length;
}

export const storyList: AgentToolHandler = async (_args, { ctx }) => {
    const story = storyService(ctx);
    const defaultId = story.getDefaultStoryId();
    const stories = [];
    for (const entry of story.listStories()) {
        const document = await story.loadStory(entry.id).catch(() => null);
        if (!document) {
            stories.push({ id: entry.id, name: entry.name, unreadable: true });
            continue;
        }
        const describe = (scene: StoryScene) => ({
            id: scene.id,
            name: scene.name,
            rows: rowCount(scene),
            entry: document.entrySceneId === scene.id,
            revision: story.getSceneContentRevision(entry.id, scene.id),
        });
        stories.push({
            id: entry.id,
            name: entry.name,
            default: entry.id === defaultId,
            chapters: document.chapters.map(chapter => ({
                id: chapter.id,
                name: chapter.name,
                scenes: chapter.sceneIds.map(id => document.scenes[id]).filter(Boolean).map(describe),
            })),
            unfiledScenes: (document.unassignedSceneIds ?? []).map(id => document.scenes[id]).filter(Boolean).map(describe),
        });
    }
    return answerJson({ stories });
};

/**
 * Rename a story. Nothing refers to a story by name - jumps, launches and the build all hold its id -
 * so this is the library entry's name and the document's, and nothing else. Studio's own rename
 * takes no undo step; an agent's does, on the project's stack, like every other agent write.
 */
export const storyRename: AgentToolHandler = async (args, { ctx, request, follow }) => {
    const name = readString(args, "name").trim();
    if (!name) {
        throw refuse("invalid_args", "`name` must not be empty.");
    }
    const { entry } = await resolveStory(ctx, readOptionalString(args, "story"));
    follow.describeCall(request.callId, entry.name);
    const before = entry.name;
    if (before === name) {
        return answerJson({ story: { id: entry.id, name } }, `Story "${name}" already has that name.`);
    }
    const service = storyService(ctx);
    if (!service.renameStory(entry.id, name)) {
        throw refuse("unavailable", `Story "${before}" could not be renamed.`);
    }
    ctx.services.get<HistoryService>(Services.History).pushCommand(projectHistoryScope(), {
        label: AGENT_HISTORY_LABEL,
        undo: () => {
            service.renameStory(entry.id, before);
        },
        redo: () => {
            service.renameStory(entry.id, name);
        },
    });
    return answerJson(
        { story: { id: entry.id, name }, previousName: before },
        `Renamed story "${before}" to "${name}". One step of undo in Studio.`,
    );
};

/** Where `after` sits, as the `beforeSceneId` a move or create takes: the scene following it in its chapter. */
function placementAfter(document: StoryDocument, afterSceneId: string): { chapterId: string; beforeSceneId: string | null } | null {
    for (const chapter of document.chapters) {
        const index = chapter.sceneIds.indexOf(afterSceneId);
        if (index >= 0) {
            return { chapterId: chapter.id, beforeSceneId: chapter.sceneIds[index + 1] ?? null };
        }
    }
    return null;
}

export const sceneCreate: AgentToolHandler = async (args, tool) => {
    const { ctx, request, follow } = tool;
    const name = readString(args, "name");
    const storyRef = readOptionalString(args, "story");
    const chapterName = readOptionalString(args, "chapter");
    const afterRef = readOptionalString(args, "after");
    const story = storyService(ctx);
    follow.describeCall(request.callId, name);

    // A story `story` names that does not exist yet is made, so that "write a scene in story X" is
    // one call on an empty project.
    let target: Awaited<ReturnType<typeof resolveStory>>;
    let madeStory = false;
    try {
        target = await resolveStory(ctx, storyRef);
    } catch (error) {
        if (!(error instanceof Error && error.name === "AgentRefusal" && (error as { code?: string }).code === "not_found")) {
            throw error;
        }
        assertAgentMayStillWrite(tool);
        const entry = story.createStory(storyRef ?? "Main");
        target = { entry, document: await story.loadStory(entry.id) };
        madeStory = true;
    }
    const { entry, document } = target;

    // A story made by this call starts with a default chapter holding one empty scene. That chapter
    // and scene become the ones asked for, renamed, rather than being left beside them: an agent that
    // asked for "Opening" in "Prologue" gets exactly that, not a stray "Chapter 1 / Scene 1" too.
    if (madeStory && !afterRef) {
        const defaultChapter = document.chapters[0];
        const defaultSceneId = defaultChapter?.sceneIds.length === 1 ? defaultChapter.sceneIds[0] : undefined;
        const defaultScene = defaultSceneId ? document.scenes[defaultSceneId] : undefined;
        if (defaultChapter && defaultSceneId && defaultScene?.rootBlockIds.length === 0) {
            const madeWith = chapterName ? `"${defaultChapter.name}" and "${defaultScene.name}"` : `"${defaultScene.name}"`;
            // Loading the new story awaited; the author may have paused meanwhile.
            assertAgentMayStillWrite(tool, `Story "${entry.name}" was created (it stays, with its first chapter and scene); nothing else was written.`);
            // The renames are this call's write, so they are one step of undo like any other: it gives
            // the chapter and scene back the names the new story made them with. The story stays, as it
            // does when a scene made inside it is taken back.
            story.runAgentOutlineStep(entry.id, AGENT_HISTORY_LABEL, () => {
                if (chapterName) {
                    story.renameChapter(entry.id, defaultChapter.id, chapterName);
                }
                story.renameScene(entry.id, defaultSceneId, name);
            });
            const created = story.getStoryDocument(entry.id).scenes[defaultSceneId];
            follow.noteWrite({ kind: "scene", storyId: entry.id, sceneId: defaultSceneId, name: created?.name ?? name });
            return answerJson(
                {
                    story: { id: entry.id, name: entry.name },
                    scene: { id: defaultSceneId, name: created?.name ?? name },
                    entry: story.getStoryDocument(entry.id).entrySceneId === defaultSceneId,
                    revision: story.getSceneContentRevision(entry.id, defaultSceneId),
                },
                `Created story "${entry.name}" with scene "${created?.name ?? name}"${chapterName ? ` in chapter "${chapterName}"` : ""}; `
                    + `one step of undo in Studio gives back the names the new story made them with (${madeWith}) - the story itself, made for it, stays. `
                    + "Write its rows with story_apply.",
            );
        }
    }

    // Where the scene goes is settled before anything is written, so a refusal leaves no chapter
    // behind, and the scene is made in place: a create followed by a move was two edits, and undoing
    // the second moved the new scene instead of removing it.
    const existingChapter = chapterName
        ? document.chapters.find(chapter => chapter.name === chapterName || chapter.id === chapterName)
        : undefined;
    let placement: { chapterId: string; beforeSceneId: string | null } | null = null;
    // A chapter this call makes goes right after `after`'s chapter, rather than last, when the two differ.
    let newChapterBefore: string | null = null;
    if (afterRef) {
        const after = resolveScene(document, afterRef);
        const current = story.getStoryDocument(entry.id);
        placement = placementAfter(current, after.id);
        if (placement && chapterName && placement.chapterId !== existingChapter?.id) {
            // `after` in another chapter: the new scene opens `chapter`, which has to be (or become)
            // the chapter that follows `after`'s - "the first scene of chapter 2, after the last of
            // chapter 1". An existing chapter elsewhere in the outline is not moved to make that true.
            const afterChapterIndex = current.chapters.findIndex(chapter => chapter.id === placement!.chapterId);
            const afterChapter = current.chapters[afterChapterIndex];
            const following = current.chapters[afterChapterIndex + 1];
            if (!existingChapter) {
                newChapterBefore = following?.id ?? null;
                placement = null;
            } else if (following?.id === existingChapter.id) {
                placement = { chapterId: existingChapter.id, beforeSceneId: existingChapter.sceneIds[0] ?? null };
            } else {
                throw refuse(
                    "invalid_args",
                    `Scene "${after.name}" is in chapter "${afterChapter?.name ?? "?"}", and chapter "${existingChapter.name}" does not come right after it, `
                        + `so a scene cannot open "${existingChapter.name}" and follow "${after.name}" at once.`,
                    `To add the scene to "${existingChapter.name}", name an \`after\` scene inside it, or drop \`after\` to put the scene last there. `
                        + `To start a new chapter after "${afterChapter?.name ?? "?"}", give a \`chapter\` name no chapter has yet - it is made right after that chapter, holding this scene first.`,
                );
            }
        }
    }

    assertAgentMayStillWrite(tool);
    const scene = story.runAgentOutlineStep(entry.id, AGENT_HISTORY_LABEL, () => {
        const chapterId = existingChapter?.id
            ?? (chapterName ? story.createChapter(entry.id, chapterName, newChapterBefore).id : placement?.chapterId);
        return story.createScene(entry.id, { chapterId, name, beforeSceneId: placement?.beforeSceneId ?? null });
    });
    const created = story.getStoryDocument(entry.id).scenes[scene.id] ?? scene;
    follow.noteWrite({ kind: "scene", storyId: entry.id, sceneId: created.id, name: created.name });
    return answerJson(
        {
            story: { id: entry.id, name: entry.name },
            scene: { id: created.id, name: created.name },
            entry: story.getStoryDocument(entry.id).entrySceneId === created.id,
            revision: story.getSceneContentRevision(entry.id, created.id),
        },
        `Created scene "${created.name}" in story "${entry.name}"; one step of undo in Studio takes it back`
            + `${madeStory ? ` (the story itself, made for it, stays)` : ""}. Write its rows with story_apply.`,
    );
};

export const sceneRename: AgentToolHandler = async (args, { ctx, request, follow }) => {
    const sceneRef = readString(args, "scene");
    const name = readString(args, "name");
    const { entry, document } = await resolveStory(ctx, readOptionalString(args, "story"));
    const scene = resolveScene(document, sceneRef);
    follow.describeCall(request.callId, scene.name);
    const before = scene.name;
    if (!storyService(ctx).renameScene(entry.id, scene.id, name)) {
        throw refuse("internal", `Scene "${before}" could not be renamed.`);
    }
    follow.noteWrite({ kind: "scene", storyId: entry.id, sceneId: scene.id, name });
    // The name is part of the scene's text (its `#scene` header), so a rename moves the revision a
    // story_show taken before it returned; handing back the new one saves a stale_revision on the
    // story_apply that usually follows.
    const revision = storyService(ctx).getSceneContentRevision(entry.id, scene.id);
    return answerJson(
        { scene: { id: scene.id, name }, revision },
        `Renamed scene "${before}" to "${name}" (now revision ${revision}: pass it as baseRevision, or call story_show again). Jumps to it follow by id.`,
    );
};

export const sceneSetEntry: AgentToolHandler = async (args, { ctx, request, follow }) => {
    const sceneRef = readString(args, "scene");
    const story = storyService(ctx);
    const { entry, document } = await resolveStory(ctx, readOptionalString(args, "story"));
    const scene = resolveScene(document, sceneRef);
    follow.describeCall(request.callId, scene.name);
    story.setEntryScene(entry.id, scene.id);
    // The game starts on the default story's entry scene, so a project with several stories is told
    // which one it now starts in.
    if (story.getDefaultStoryId() !== entry.id) {
        story.setDefaultStory(entry.id);
    }
    return answerJson(
        { story: { id: entry.id, name: entry.name }, scene: { id: scene.id, name: scene.name }, revision: story.getSceneContentRevision(entry.id, scene.id) },
        `The game now starts on scene "${scene.name}".`,
    );
};

/**
 * Delete a scene, refusing while anything still leads to it.
 *
 * The game starts on the entry scene, and a jump, a menu option, a call or a `Start Game` node names
 * its target by id, so deleting a scene any of those reach would leave a game that breaks when the
 * player gets there - with nothing on screen saying so until then. The refusal lists every referrer
 * so the agent can rewrite or delete those first. The deletion itself is the outline's own, one step
 * of undo on the project's stack.
 */
export const sceneDelete: AgentToolHandler = async (args, { ctx, request, follow }) => {
    const { entry, document } = await resolveStory(ctx, readOptionalString(args, "story"));
    const scene = resolveScene(document, readString(args, "scene"));
    follow.describeCall(request.callId, scene.name);
    if (document.entrySceneId === scene.id) {
        throw refuse(
            "unavailable",
            `Scene "${scene.name}" is the entry scene of story "${entry.name}": the game starts there.`,
            "Make another scene the entry with scene_set_entry first (scene_create makes one).",
        );
    }
    const { stories } = await loadAllStories(ctx);
    const referrers = [
        ...storyReferencesTo(stories, scene.id, { storyId: entry.id, sceneId: scene.id }),
        ...blueprintReferencesTo(liveBlueprintDocument(ctx), scene.id),
        ...uiReferencesTo(uiDocumentService(ctx).getDocument(), scene.id),
    ];
    if (referrers.length > 0) {
        throw refuse(
            "unavailable",
            `Scene "${scene.name}" is still the target of ${referrers.length} reference(s):\n${formatReferrers(referrers)}`,
            "Point those somewhere else (story_apply for rows, blueprint_apply for blueprints) or delete the scenes holding them, then delete this one.",
        );
    }
    assertAgentMayStillWrite({ ctx, request, follow }, "Nothing was deleted.");
    if (!storyService(ctx).deleteScene(entry.id, scene.id)) {
        throw refuse("unavailable", `Scene "${scene.name}" could not be deleted (a live session may own the story).`);
    }
    return answerJson(
        { story: { id: entry.id, name: entry.name }, deleted: { id: scene.id, name: scene.name } },
        `Deleted scene "${scene.name}" from story "${entry.name}". One step of undo in Studio.`,
    );
};

/**
 * Replace a scene for an agent, refusing a stale read: the `.story` tools call this with the scene
 * their compiler produced. Returns the scene's new revision.
 *
 * `baseRevision` is the revision `story_show` returned; omitted, the write goes ahead regardless,
 * which the tool descriptions steer agents away from.
 */
export function writeSceneForAgent(
    tool: Pick<AgentToolContext, "ctx" | "follow">,
    input: { storyId: string; sceneId: string; scene: StoryScene; baseRevision?: number; changedBlockIds?: readonly string[] },
): number {
    const story = storyService(tool.ctx);
    const current = story.getSceneContentRevision(input.storyId, input.sceneId);
    if (input.baseRevision !== undefined && input.baseRevision !== current) {
        throw refuse(
            "stale_revision",
            `The scene changed since you read it (revision ${input.baseRevision}, now ${current}).`,
            "Call story_show again, redo the edit on what it prints, and pass the new revision.",
        );
    }
    if (!story.applyAgentSceneReplacement(input.storyId, input.sceneId, input.scene, AGENT_HISTORY_LABEL)) {
        throw refuse("unavailable", "The scene could not be written (a live session may own the story).");
    }
    const document = story.getStoryDocument(input.storyId);
    tool.follow.noteWrite({
        kind: "scene",
        storyId: input.storyId,
        sceneId: input.sceneId,
        name: document.scenes[input.sceneId]?.name ?? input.scene.name,
        blockIds: input.changedBlockIds,
    });
    return story.getSceneContentRevision(input.storyId, input.sceneId);
}

/** A chapter of `document` by name or id, or a refusal listing the chapters there are. */
function resolveChapter(document: StoryDocument, ref: string): StoryChapter {
    const chapter = document.chapters.find(item => item.id === ref) ?? document.chapters.find(item => item.name === ref);
    if (!chapter) {
        throw refuse(
            "not_found",
            `No chapter "${ref}" in story "${document.name}".`,
            `Chapters: ${document.chapters.map(item => `"${item.name}"`).join(", ") || "none"}.`,
        );
    }
    return chapter;
}

export const chapterRename: AgentToolHandler = async (args, { ctx, request, follow }) => {
    const chapterRef = readString(args, "chapter");
    const name = readString(args, "name");
    const { entry, document } = await resolveStory(ctx, readOptionalString(args, "story"));
    const chapter = resolveChapter(document, chapterRef);
    follow.describeCall(request.callId, chapter.name);
    const before = chapter.name;
    // Loading the story awaited; the author may have paused meanwhile.
    assertAgentMayStillWrite({ ctx, request, follow });
    const story = storyService(ctx);
    // An outline step holding the two names, never a snapshot of the story: taking the rename back
    // after rows were written into a scene must leave those rows where they are.
    const renamed = story.runAgentOutlineStep(
        entry.id,
        { key: "story.history.renameChapter" as TranslationKey, params: { name: before } },
        () => story.renameChapter(entry.id, chapter.id, name),
    );
    if (!renamed) {
        throw refuse("internal", `Chapter "${before}" could not be renamed.`);
    }
    return answer(`Renamed chapter "${before}" to "${name}" in story "${entry.name}". One step of undo in Studio.`, { chapter: { id: chapter.id, name } });
};

export const chapterDelete: AgentToolHandler = async (args, { ctx, request, follow }) => {
    const chapterRef = readString(args, "chapter");
    const { entry, document } = await resolveStory(ctx, readOptionalString(args, "story"));
    const chapter = resolveChapter(document, chapterRef);
    follow.describeCall(request.callId, chapter.name);
    if (chapter.sceneIds.length > 0) {
        const names = chapter.sceneIds.map(id => `"${document.scenes[id]?.name ?? id}"`).join(", ");
        throw refuse(
            "unavailable",
            `Chapter "${chapter.name}" still holds ${chapter.sceneIds.length} scene(s): ${names}.`,
            "Delete them with scene_delete, or recreate them in another chapter, then delete the chapter.",
        );
    }
    assertAgentMayStillWrite({ ctx, request, follow }, "Nothing was deleted.");
    const story = storyService(ctx);
    // An outline step that puts back this chapter and nothing else. The outline's own deletion
    // records a snapshot of the whole story, and taking that back would also return every other
    // scene's rows to how they stood when the chapter went.
    const deleted = story.runAgentOutlineStep(
        entry.id,
        { key: "story.history.deleteChapter" as TranslationKey, params: { name: chapter.name } },
        () => story.deleteChapter(entry.id, chapter.id),
    );
    if (!deleted) {
        throw refuse("internal", `Chapter "${chapter.name}" could not be deleted.`);
    }
    return answer(`Deleted the empty chapter "${chapter.name}" from story "${entry.name}". One step of undo in Studio.`, { chapter: { id: chapter.id, name: chapter.name } });
};
