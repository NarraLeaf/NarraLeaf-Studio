import { describe, expect, it, vi } from "vitest";
import type { StoryNoteBlock, StoryScene } from "@shared/types/story";
import type { TranslationKey } from "@shared/i18n";
import { HistoryService } from "../history/HistoryService";
import { storySceneHistoryScope } from "../history/historyScopes";
import { Services } from "../services";
import { StoryService } from "../story/StoryService";
import { AgentFollowService, type AgentWriteTarget } from "./AgentFollowService";
import { writeSceneForAgent } from "./tools/storyTools";

vi.mock("@/lib/app/writeFreeze", () => ({ getProjectWriteFreeze: () => null }));

/**
 * An agent's whole-scene write: one step of undo on the scene's own stack (which needs no open
 * editor), a per-scene revision that only that scene's edits move, and a refused write when the
 * author changed the scene after the agent read it.
 */

const LABEL = { key: "workspace.history.entry.agentEdit" as TranslationKey };

function note(id: string, value: string = id): StoryNoteBlock {
    return { id, kind: "note", parentId: null, childrenIds: [], payload: { text: { textId: `text-${id}`, value, role: "note" } } };
}

function createHarness() {
    const history = new HistoryService();
    const service = new StoryService();
    let nextId = 0;
    const uuid = () => `00000000-0000-4000-8000-${(++nextId).toString(16).padStart(12, "0")}`;
    const ok = async () => ({ ok: true as const, data: undefined });
    const fs = {
        writeFileNoFollowOrCreate: vi.fn(ok),
        read: vi.fn(async () => ({ ok: false as const, error: { message: "missing", code: "ENOENT" } })),
        deleteFile: vi.fn(ok),
        deleteDir: vi.fn(ok),
        isFileExists: vi.fn(async () => ({ ok: true as const, data: false })),
        isDirExists: vi.fn(async () => ({ ok: true as const, data: true })),
        createDir: vi.fn(ok),
        mkdir: vi.fn(ok),
    };
    const context = {
        project: { resolve: (...parts: (string | string[])[]) => parts.flatMap(part => (Array.isArray(part) ? part : [part])).join("/") },
        services: {
            get(id: Services) {
                switch (id) {
                    case Services.History: return history;
                    case Services.FileSystem: return fs;
                    case Services.Uuid: return { generate: uuid };
                    case Services.Project: return {};
                    case Services.Story: return service;
                    default: throw new Error(`Unexpected service ${id}`);
                }
            },
        } as never,
    } as never;
    history.setContext(context);
    service.setContext(context);
    (service as never as { index: unknown }).index = { schemaVersion: 1, stories: [], meta: {} };
    (service as never as { animationIndex: unknown }).animationIndex = { schemaVersion: 1, animations: [], meta: {} };

    const entry = service.createStory("Tale");
    const sceneId = service.getStoryDocument(entry.id).chapters[0].sceneIds[0];
    const other = service.createScene(entry.id, { name: "Elsewhere" });
    service.insertBlock(entry.id, sceneId, note("a", "first"), { parentId: null });

    const follow = new AgentFollowService();
    const writes: AgentWriteTarget[] = [];
    follow.onWrote(target => writes.push(target));
    return { service, history, context, storyId: entry.id, sceneId, otherSceneId: other.id, follow, writes };
}

function withRows(scene: StoryScene, rows: StoryNoteBlock[]): StoryScene {
    return { ...JSON.parse(JSON.stringify(scene)), rootBlockIds: rows.map(row => row.id), blocks: Object.fromEntries(rows.map(row => [row.id, row])) };
}

describe("StoryService.getSceneContentRevision", () => {
    it("moves only when that scene's own content changes", () => {
        const { service, storyId, sceneId, otherSceneId } = createHarness();
        const first = service.getSceneContentRevision(storyId, sceneId);
        expect(service.getSceneContentRevision(storyId, sceneId)).toBe(first);
        service.insertBlock(storyId, otherSceneId, note("x"), { parentId: null });
        expect(service.getSceneContentRevision(storyId, sceneId)).toBe(first);
        service.updateBlock(storyId, sceneId, "a", note("a", "changed").payload);
        expect(service.getSceneContentRevision(storyId, sceneId)).toBe(first + 1);
    });
});

describe("writeSceneForAgent", () => {
    it("replaces the scene as one undo step on the scene's stack, and redo puts it back", () => {
        const { service, history, context, storyId, sceneId, follow, writes } = createHarness();
        const read = service.getSceneContentRevision(storyId, sceneId);
        const scene = service.getStoryDocument(storyId).scenes[sceneId];
        const next = withRows(scene, [note("b", "second"), note("c", "third")]);

        const revision = writeSceneForAgent({ ctx: context, follow }, { storyId, sceneId, scene: next, baseRevision: read });
        expect(revision).toBeGreaterThan(read);
        expect(service.getStoryDocument(storyId).scenes[sceneId].rootBlockIds).toEqual(["b", "c"]);
        expect(writes).toEqual([expect.objectContaining({ kind: "scene", storyId, sceneId })]);

        const scope = storySceneHistoryScope(storyId, sceneId);
        expect(history.describe().find(stack => stack.scopeId === scope)?.undo).toBe(1);
        expect(history.peekUndo(scope)).toEqual(LABEL);
        expect(history.undo(scope)).toBe(true);
        expect(service.getStoryDocument(storyId).scenes[sceneId].rootBlockIds).toEqual(["a"]);
        expect(history.redo(scope)).toBe(true);
        expect(service.getStoryDocument(storyId).scenes[sceneId].rootBlockIds).toEqual(["b", "c"]);
    });

    it("refuses a write against a scene the author changed since the agent read it", () => {
        const { service, context, storyId, sceneId, follow } = createHarness();
        const read = service.getSceneContentRevision(storyId, sceneId);
        const scene = service.getStoryDocument(storyId).scenes[sceneId];
        service.updateBlock(storyId, sceneId, "a", note("a", "typed by the author").payload);
        expect(() => writeSceneForAgent({ ctx: context, follow }, {
            storyId,
            sceneId,
            scene: withRows(scene, [note("z")]),
            baseRevision: read,
        })).toThrow(expect.objectContaining({ code: "stale_revision" }));
        expect(service.getStoryDocument(storyId).scenes[sceneId].blocks.a).toBeDefined();
    });
});
