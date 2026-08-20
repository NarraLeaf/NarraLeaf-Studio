import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HistoryService } from "../history/HistoryService";
import { projectHistoryScope } from "../history/historyScopes";
import { Services } from "../services";
import { CharacterService } from "./CharacterService";

vi.mock("@/lib/app/writeFreeze", () => ({ getProjectWriteFreeze: () => null }));

/** A story row, as loosely as these tests need one. */
type StoryRowStub = { id: string; kind: string; parentId: null; childrenIds: never[]; payload: Record<string, unknown> };

/** A dialogue row spoken by a character. */
function dialogueRow(id: string, characterId: string): StoryRowStub {
    return {
        id,
        kind: "nodeAction",
        parentId: null,
        childrenIds: [],
        payload: { action: "dialogue", characterId, text: { textId: `t-${id}`, role: "dialogue", value: "Hi" } },
    };
}

/** A character's stage row. It has no bare-name arm, so a deletion must leave it holding the id. */
function stageRow(id: string, characterId: string): StoryRowStub {
    return {
        id,
        kind: "action",
        parentId: null,
        childrenIds: [],
        payload: { action: "character", operation: "enter", characterId },
    };
}

/**
 * A cast plus the two stores a deletion touches, with no filesystem behind either.
 *
 * `flush` is left to fire and fail into the storage stub on purpose - the point of these tests is
 * what is in memory and what came back, and a service that only behaves when its save succeeds
 * would be the more interesting defect.
 */
function createHarness() {
    const history = new HistoryService();
    const service = new CharacterService();

    const files = new Map<string, Uint8Array>();
    const locks: string[] = [];
    let nextId = 0;

    const serviceAssets = {
        deleteFile: vi.fn(async (fileId: string) => {
            files.delete(fileId);
            return { ok: true as const, data: undefined };
        }),
        readRaw: vi.fn(async (fileId: string) => {
            const bytes = files.get(fileId);
            return bytes
                ? { ok: true as const, data: bytes }
                : { ok: false as const, error: "missing" };
        }),
        restoreFile: vi.fn(async (fileId: string, bytes: Uint8Array) => {
            files.set(fileId, bytes);
            return { ok: true as const, data: undefined };
        }),
    };
    const assets = {
        lockAsset: vi.fn((assetId: string) => void locks.push(`lock:${assetId}`)),
        unlockAsset: vi.fn((assetId: string) => void locks.push(`unlock:${assetId}`)),
    };

    /**
     * The story library, as far as a deletion is concerned: documents in memory, and a write that
     * lands payloads on them the way `StoryService.updateBlocks` does.
     */
    const documents = new Map<string, { id: string; scenes: Record<string, { id: string; blocks: Record<string, StoryRowStub> }> }>();
    const stories = {
        listStories: () => [...documents.keys()].map(id => ({ id })),
        loadStory: async (storyId: string) => documents.get(storyId),
        getStoryDocument: (storyId: string) => documents.get(storyId),
        updateBlocks: vi.fn((storyId: string, edits: { sceneId: string; blockId: string; payload: unknown }[]) => {
            const document = documents.get(storyId);
            for (const edit of edits) {
                document!.scenes[edit.sceneId].blocks[edit.blockId].payload = edit.payload as Record<string, unknown>;
            }
        }),
    };
    const addStory = (storyId: string, sceneId: string, blocks: StoryRowStub[]) => {
        documents.set(storyId, {
            id: storyId,
            scenes: { [sceneId]: { id: sceneId, blocks: Object.fromEntries(blocks.map(block => [block.id, block])) } },
        });
    };
    const payloadOf = (storyId: string, sceneId: string, blockId: string): Record<string, unknown> =>
        documents.get(storyId)!.scenes[sceneId].blocks[blockId].payload;

    const context = {
        project: {} as never,
        services: {
            get(id: Services) {
                switch (id) {
                    case Services.History: return history;
                    case Services.Story: return stories;
                    case Services.ServiceAssets: return serviceAssets;
                    case Services.Assets: return assets;
                    case Services.Uuid: return { generate: () => `id-${++nextId}` };
                    case Services.UI: return { showError: vi.fn() };
                    case Services.FileSystem: return {};
                    default: throw new Error(`Unexpected service ${id}`);
                }
            },
        } as never,
    };
    history.setContext(context);
    service.setContext(context);
    return { service, history, files, locks, serviceAssets, assets, stories, addStory, payloadOf };
}

describe("CharacterService deletion", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("puts the character back where it was in the cast order", async () => {
        const { service, history } = createHarness();
        service.createCharacter("Ada");
        const bea = service.createCharacter("Bea");
        service.createCharacter("Cy");

        await service.deleteCharacter(bea.profile.getId());
        expect(service.listCharacter().map(c => c.profile.getName())).toEqual(["Ada", "Cy"]);

        expect(history.undo(projectHistoryScope())).toBe(true);
        await history.settled();
        // Appending would restore the cast and silently reorder the panel - a second edit the
        // author did not ask for.
        expect(service.listCharacter().map(c => c.profile.getName())).toEqual(["Ada", "Bea", "Cy"]);
    });

    it("restores the baked avatar at its original file id", async () => {
        const { service, history, files } = createHarness();
        const character = service.createCharacter("Ada");
        const id = character.profile.getId();
        character.profile.setThumbnail("avatar-1");
        files.set("avatar-1", new Uint8Array([1, 2, 3]));

        await service.deleteCharacter(id);
        expect(files.has("avatar-1")).toBe(false);

        history.undo(projectHistoryScope());
        await history.settled();
        // The same id, not a fresh one: the restored record still names "avatar-1", so a new id
        // would leave the avatar dangling and rewrite the document undo was meant to restore.
        expect(files.get("avatar-1")).toEqual(new Uint8Array([1, 2, 3]));
        expect(service.getCharacter(id)?.profile.getThumbnail()).toBe("avatar-1");
    });

    it("survives a character whose avatar file has already gone", async () => {
        const { service, history } = createHarness();
        const character = service.createCharacter("Ada");
        character.profile.setThumbnail("avatar-missing");

        await service.deleteCharacter(character.profile.getId());
        expect(history.undo(projectHistoryScope())).toBe(true);
        await history.settled();
        expect(service.listCharacter().map(c => c.profile.getName())).toEqual(["Ada"]);
    });

    it("redoes the deletion", async () => {
        const { service, history } = createHarness();
        const character = service.createCharacter("Ada");

        await service.deleteCharacter(character.profile.getId());
        history.undo(projectHistoryScope());
        await history.settled();
        expect(service.listCharacter()).toHaveLength(1);

        expect(history.redo(projectHistoryScope())).toBe(true);
        await history.settled();
        expect(service.listCharacter()).toHaveLength(0);
    });

    it("puts a group's members back in it, not just the group", async () => {
        const { service, history } = createHarness();
        const group = service.createGroup("Cast");
        const ada = service.createCharacter("Ada");
        const bea = service.createCharacter("Bea");
        service.assignCharacterToGroup(ada.profile.getId(), group.id);
        service.assignCharacterToGroup(bea.profile.getId(), group.id);

        await service.deleteGroup(group.id);
        expect(service.getGroup(group.id)).toBeUndefined();
        expect(ada.profile.getGroupId()).toBeUndefined();

        expect(history.undo(projectHistoryScope())).toBe(true);
        await history.settled();
        expect(service.getGroup(group.id)?.name).toBe("Cast");
        expect(service.listCharactersByGroup(group.id).map(c => c.profile.getName()))
            .toEqual(["Ada", "Bea"]);
    });

    it("leaves every line it spoke speaking, under its name, in every story", async () => {
        const { service, addStory, payloadOf } = createHarness();
        const character = service.createCharacter("Ada");
        const id = character.profile.getId();
        addStory("story-1", "scene-1", [dialogueRow("a", id), dialogueRow("b", "someone-else"), stageRow("enter", id)]);
        addStory("story-2", "scene-2", [dialogueRow("c", id)]);

        await service.deleteCharacter(id);

        // The name the character carried, on every line it spoke, in the story the author had open and
        // in the one they did not: the player reads the line exactly as before.
        for (const [storyId, sceneId, blockId] of [["story-1", "scene-1", "a"], ["story-2", "scene-2", "c"]]) {
            expect(payloadOf(storyId, sceneId, blockId)).toMatchObject({ speakerName: "Ada" });
            expect(payloadOf(storyId, sceneId, blockId)).not.toHaveProperty("characterId");
        }
        // Another character's line is not this deletion's business.
        expect(payloadOf("story-1", "scene-1", "b")).toMatchObject({ characterId: "someone-else" });
        // A stage row has no bare-name arm, so it keeps the id and the project lint reports it.
        expect(payloadOf("story-1", "scene-1", "enter")).toMatchObject({ characterId: id });
    });

    it("takes the cast and the lines back in one undo", async () => {
        const { service, history, addStory, payloadOf } = createHarness();
        const character = service.createCharacter("Ada");
        const id = character.profile.getId();
        addStory("story-1", "scene-1", [dialogueRow("a", id)]);
        addStory("story-2", "scene-2", [dialogueRow("c", id)]);

        await service.deleteCharacter(id);
        expect(history.undo(projectHistoryScope())).toBe(true);
        await history.settled();

        expect(service.getCharacter(id)?.profile.getName()).toBe("Ada");
        expect(payloadOf("story-1", "scene-1", "a")).toMatchObject({ characterId: id });
        expect(payloadOf("story-2", "scene-2", "c")).toMatchObject({ characterId: id });
        expect(payloadOf("story-1", "scene-1", "a")).not.toHaveProperty("speakerName");
        // One gesture, one entry: a second press must not be needed to finish putting it back.
        expect(history.canUndo(projectHistoryScope())).toBe(false);
    });

    it("leaves a line the author has since given a speaker of its own", async () => {
        const { service, history, addStory, payloadOf, stories } = createHarness();
        const character = service.createCharacter("Ada");
        const id = character.profile.getId();
        addStory("story-1", "scene-1", [dialogueRow("a", id), dialogueRow("b", id)]);

        await service.deleteCharacter(id);
        // The author repairs one of the degraded lines against a different character before undoing.
        stories.updateBlocks("story-1", [{ sceneId: "scene-1", blockId: "b", payload: { action: "dialogue", characterId: "char-other", text: { textId: "t-b", role: "dialogue", value: "Hi" } } }]);

        history.undo(projectHistoryScope());
        await history.settled();

        expect(payloadOf("story-1", "scene-1", "a")).toMatchObject({ characterId: id });
        expect(payloadOf("story-1", "scene-1", "b")).toMatchObject({ characterId: "char-other" });
    });

    it("records nothing for a character that was not there", async () => {
        const { service, history } = createHarness();
        expect(await service.deleteCharacter("nobody")).toBe(false);
        expect(history.canUndo(projectHistoryScope())).toBe(false);
    });

    it("re-locks the restored character's assets", async () => {
        const { service, history, locks } = createHarness();
        const character = service.createCharacter("Ada");
        character.profile.appearance.createPose("Idle");
        const poses = character.profile.appearance.getPoses();
        character.profile.appearance.setPoseAsset(poses[0].id, "asset-7");
        locks.length = 0;

        await service.deleteCharacter(character.profile.getId());
        expect(locks).toContain("unlock:asset-7");

        history.undo(projectHistoryScope());
        await history.settled();
        // Without this the restored character would render but the asset would look unused, and
        // deleting it afterwards would not even warn.
        expect(locks).toContain("lock:asset-7");
    });
});
