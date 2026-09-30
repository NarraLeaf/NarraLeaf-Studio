import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryBlock, StoryId, StorySceneId } from "@shared/types/story";
import { HistoryService } from "../history/HistoryService";
import { projectHistoryScope } from "../history/historyScopes";
import { Services } from "../services";
import { StoryService } from "./StoryService";

vi.mock("@/lib/app/writeFreeze", () => ({ getProjectWriteFreeze: () => null }));

/**
 * The internal name every way of making a scene gives it.
 *
 * That name is what the engine stores a scene's variables under, in the game and in every save, so
 * two scenes answering to one name share one set of variables. It is chosen once, when the scene is
 * made, and a rename never touches it - which is why it has to be unique from the start: a collision
 * found later can only be undone by moving one scene's variables out from under its saves.
 */
function createHarness() {
    const history = new HistoryService();
    const service = new StoryService();
    const files = new Map<string, string>();
    let nextId = 0;
    const uuid = (compact = false) => {
        const n = (++nextId).toString(16).padStart(12, "0");
        const id = `00000000-0000-4000-8000-${n}`;
        return compact ? id.replace(/-/g, "") : id;
    };

    const fs = {
        writeFileNoFollowOrCreate: vi.fn(async (path: string, data: string) => {
            files.set(path, data);
            return { ok: true as const, data: undefined };
        }),
        read: vi.fn(async (path: string) => {
            const data = files.get(path);
            return data === undefined
                ? { ok: false as const, error: { message: "missing", code: "ENOENT" } }
                : { ok: true as const, data };
        }),
        deleteFile: vi.fn(async () => ({ ok: true as const, data: undefined })),
        deleteDir: vi.fn(async () => ({ ok: true as const, data: undefined })),
        isFileExists: vi.fn(async (path: string) => ({ ok: true as const, data: files.has(path) })),
        isDirExists: vi.fn(async () => ({ ok: true as const, data: true })),
        createDir: vi.fn(async () => ({ ok: true as const, data: undefined })),
        mkdir: vi.fn(async () => ({ ok: true as const, data: undefined })),
    };

    const context = {
        project: {
            resolve: (...parts: (string | string[])[]) =>
                parts.flatMap(part => (Array.isArray(part) ? part : [part])).join("/").replace(/\/+/g, "/"),
        },
        services: {
            get(id: Services) {
                switch (id) {
                    case Services.History: return history;
                    case Services.FileSystem: return fs;
                    case Services.Uuid: return { generate: uuid };
                    case Services.Project: return {};
                    default: throw new Error(`Unexpected service ${id}`);
                }
            },
        } as never,
    } as never;
    history.setContext(context);
    service.setContext(context);
    return { service, history };
}

async function seedStory(service: StoryService, history: HistoryService) {
    if (!(service as never as { index: unknown }).index) {
        (service as never as { index: unknown }).index = { schemaVersion: 1, stories: [], meta: {} };
        (service as never as { animationIndex: unknown }).animationIndex = { schemaVersion: 1, animations: [], meta: {} };
    }
    const entry = service.createStory("Tale");
    const seeded = service.getStoryDocument(entry.id).chapters[0];
    if (seeded) {
        service.deleteChapter(entry.id, seeded.id);
    }
    await service.saveStory(entry.id);
    history.clearScope(projectHistoryScope());
    return entry;
}

function narration(id: string): StoryBlock {
    return {
        id,
        parentId: null,
        childrenIds: [],
        kind: "nodeAction",
        payload: { action: "narration", text: { textId: `${id}-text`, role: "narration", value: id } },
    };
}

function runtimeNameOf(service: StoryService, storyId: StoryId, sceneId: StorySceneId): string {
    return service.getStoryDocument(storyId).scenes[sceneId].runtimeName;
}

describe("StoryService scene internal names", () => {
    let harness: ReturnType<typeof createHarness>;

    beforeEach(() => {
        harness = createHarness();
    });

    it("gives two scenes made with the same English name different internal names", async () => {
        const { service, history } = harness;
        const story = await seedStory(service, history);
        const chapter = service.createChapter(story.id, "One");

        const first = service.createScene(story.id, { chapterId: chapter.id, name: "Chapter 1" });
        const second = service.createScene(story.id, { chapterId: chapter.id, name: "Chapter 1" });
        const third = service.createScene(story.id, { chapterId: chapter.id, name: "chapter 1" });

        expect(runtimeNameOf(service, story.id, first.id)).toBe("chapter_1");
        expect(runtimeNameOf(service, story.id, second.id)).toBe("chapter_1_2");
        expect(runtimeNameOf(service, story.id, third.id)).toBe("chapter_1_3");
        // What the author sees is what they typed; only the name nobody sees was told apart.
        expect(service.getStoryDocument(story.id).scenes[second.id].name).toBe("Chapter 1");
    });

    it("keeps a scene's internal name through a rename, and does not hand the old one out again", async () => {
        const { service, history } = harness;
        const story = await seedStory(service, history);
        const chapter = service.createChapter(story.id, "One");
        const scene = service.createScene(story.id, { chapterId: chapter.id, name: "Chapter 1" });

        expect(service.renameScene(story.id, scene.id, "Prologue")).toBe(true);
        expect(runtimeNameOf(service, story.id, scene.id)).toBe("chapter_1");
        // The inspector's path, which states the scene's fields whole.
        expect(service.updateScene(story.id, scene.id, { name: "The prologue" })).toBe(true);
        expect(runtimeNameOf(service, story.id, scene.id)).toBe("chapter_1");

        // The case that used to collide: a rename, then a new scene under the old name.
        const again = service.createScene(story.id, { chapterId: chapter.id, name: "Chapter 1" });
        expect(runtimeNameOf(service, story.id, again.id)).toBe("chapter_1_2");
    });

    it("pins a scene stored without an internal name to the one it compiled under before a rename", async () => {
        // A document written before `runtimeName` was always filled in compiles such a scene under
        // its display name. Deriving a new one from the new name would move its variables away from
        // every save that holds them, which is exactly what a rename must never do.
        const { service, history } = harness;
        const story = await seedStory(service, history);
        const chapter = service.createChapter(story.id, "One");
        const viaRename = service.createScene(story.id, { chapterId: chapter.id, name: "Intro" });
        const viaInspector = service.createScene(story.id, { chapterId: chapter.id, name: "Outro" });
        const document = service.getStoryDocument(story.id);
        document.scenes[viaRename.id].runtimeName = "";
        document.scenes[viaInspector.id].runtimeName = "";

        service.renameScene(story.id, viaRename.id, "Opening");
        service.updateScene(story.id, viaInspector.id, { name: "Closing" });

        expect(runtimeNameOf(service, story.id, viaRename.id)).toBe("Intro");
        expect(runtimeNameOf(service, story.id, viaInspector.id)).toBe("Outro");
    });

    it("counts the name a scene stored without one compiles under as taken", async () => {
        const { service, history } = harness;
        const story = await seedStory(service, history);
        const chapter = service.createChapter(story.id, "One");
        const legacy = service.createScene(story.id, { chapterId: chapter.id, name: "x" });
        const document = service.getStoryDocument(story.id);
        document.scenes[legacy.id].runtimeName = "";
        document.scenes[legacy.id].name = "chapter_1";

        const scene = service.createScene(story.id, { chapterId: chapter.id, name: "Chapter 1" });

        expect(runtimeNameOf(service, story.id, scene.id)).toBe("chapter_1_2");
    });

    it("gives scenes whose names have no ASCII in them generated internal names", async () => {
        const { service, history } = harness;
        const story = await seedStory(service, history);
        const chapter = service.createChapter(story.id, "One");

        const first = service.createScene(story.id, { chapterId: chapter.id, name: "第一章" });
        const second = service.createScene(story.id, { chapterId: chapter.id, name: "第一章" });

        expect(runtimeNameOf(service, story.id, first.id)).toMatch(/^scene_[0-9a-f]{32}$/);
        expect(runtimeNameOf(service, story.id, second.id)).toMatch(/^scene_[0-9a-f]{32}$/);
        expect(runtimeNameOf(service, story.id, first.id)).not.toBe(runtimeNameOf(service, story.id, second.id));
    });

    it("gives the second half of a split an internal name no scene of the story has", async () => {
        const { service, history } = harness;
        const story = await seedStory(service, history);
        const chapter = service.createChapter(story.id, "One");
        const scene = service.createScene(story.id, { chapterId: chapter.id, name: "Chapter 1" });
        for (const id of ["r1", "r2"]) {
            service.insertBlock(story.id, scene.id, narration(id), { parentId: null, beforeBlockId: null });
        }

        // Named after the scene it came out of, which is the name most authors reach for.
        const result = service.splitScene(story.id, scene.id, "r2", "Chapter 1")!;

        expect(result).not.toBeNull();
        expect(runtimeNameOf(service, story.id, scene.id)).toBe("chapter_1");
        expect(runtimeNameOf(service, story.id, result.sceneId)).toBe("chapter_1_2");
    });
});
