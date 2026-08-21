/**
 * Asset locks are what stand between an author and deleting a background a scene still shows, so the
 * only assertion worth making about the incremental path is that it agrees with the full walk. That
 * is what `expectLocksSettled` checks, and every case below ends with it:
 *
 *  1. Force a full rebuild of the story's table. If the incremental table had missed anything - a
 *     lock never taken, a lock never released, an asset id left pointing at the old value - the
 *     rebuild diffs it away, and the live lock set moves. It must not move.
 *  2. Compare the live lock set against the rebuilt table. That catches the other half: a table that
 *     is right about the document but was never actually handed to `AssetsService`.
 *
 * Neither check can be satisfied by an incremental path that is merely self-consistent, because the
 * expectation is re-derived from the document each time rather than remembered.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryBlock, StoryDocument, StoryId, StoryScene } from "@shared/types/story";
import { HistoryService } from "../history/HistoryService";
import { projectHistoryScope } from "../history/historyScopes";
import { Services } from "../services";
import { StoryService } from "./StoryService";

vi.mock("@/lib/app/writeFreeze", () => ({ getProjectWriteFreeze: () => null }));

type LockRecord = {
    assetId: string;
    reason: string;
    metadata: Record<string, unknown> | undefined;
};

/** Mirrors `AssetLockManager`: one record per lock, and one removed per matching unlock. */
function createLockManagerMirror() {
    const records: LockRecord[] = [];
    return {
        records,
        lockAsset: (assetId: string, reason: string, metadata?: Record<string, unknown>) => {
            records.push({ assetId, reason, metadata });
        },
        unlockAsset: (assetId: string, reason: string, metadata?: Record<string, unknown>) => {
            const index = records.findIndex(record => {
                if (record.assetId !== assetId || record.reason !== reason) {
                    return false;
                }
                if (!metadata) {
                    return true;
                }
                return Object.entries(metadata).every(([key, value]) => record.metadata?.[key] === value);
            });
            if (index === -1) {
                // Never silent. An unlock with nothing to match is a lock that was taken twice, or
                // released twice - either way the count the delete guard reads is now wrong, and a
                // test that let it pass would be testing nothing.
                throw new Error(`unlock with no matching lock: ${assetId} ${JSON.stringify(metadata)}`);
            }
            records.splice(index, 1);
        },
    };
}

function createHarness() {
    const history = new HistoryService();
    const service = new StoryService();
    const assets = createLockManagerMirror();
    const files = new Map<string, string>();
    let nextId = 0;
    const uuid = () => `00000000-0000-4000-8000-${(++nextId).toString(16).padStart(12, "0")}`;

    const fs = {
        // The verb the story writers actually take; `write` (grant + protocol PUT) is not one of
        // their routes any more. See `StoryService.writeStoryFile`.
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
        readJSON: vi.fn(async (path: string) => {
            const data = files.get(path);
            return data === undefined
                ? { ok: false as const, error: { message: "missing", code: "ENOENT" } }
                : { ok: true as const, data: JSON.parse(data) };
        }),
        deleteFile: vi.fn(async (path: string) => {
            files.delete(path);
            return { ok: true as const, data: undefined };
        }),
        deleteDir: vi.fn(async (dir: string) => {
            for (const key of [...files.keys()]) {
                if (key.startsWith(dir)) {
                    files.delete(key);
                }
            }
            return { ok: true as const, data: undefined };
        }),
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
                    case Services.Assets: return assets;
                    case Services.Project: return {};
                    default: throw new Error(`Unexpected service ${id}`);
                }
            },
        } as never,
    } as never;
    history.setContext(context);
    service.setContext(context);
    return { service, history, assets, files, uuid };
}

/** The service's private lock bookkeeping, reached the way the other StoryService tests reach in. */
type LockInternals = {
    storyAssetLocks: Map<StoryId, Map<string, Map<string, { assetId: string; metadata: Record<string, unknown> }>>>;
    syncDocumentAssetLocks: (storyId: StoryId, document: StoryDocument, scope: "all" | readonly string[]) => void;
    mutateDocument: (
        storyId: StoryId,
        mutator: (document: StoryDocument) => void,
        scope: "all" | readonly string[],
    ) => void;
};

function internals(service: StoryService): LockInternals {
    return service as never as LockInternals;
}

function describeLock(assetId: string, metadata: Record<string, unknown> | undefined): string {
    return [
        assetId,
        metadata?.storyId ?? "-",
        metadata?.sceneId ?? "-",
        metadata?.blockId ?? "-",
        metadata?.field ?? "-",
    ].join("|");
}

function liveLocks(assets: ReturnType<typeof createLockManagerMirror>): string[] {
    return assets.records
        .map(record => `${record.reason}::${describeLock(record.assetId, record.metadata)}`)
        .sort();
}

/** Every lock the service *believes* it holds, in the same shape {@link liveLocks} reports. */
function tableLocks(service: StoryService): string[] {
    const out: string[] = [];
    for (const scenes of internals(service).storyAssetLocks.values()) {
        for (const sceneLocks of scenes.values()) {
            for (const entry of sceneLocks.values()) {
                out.push(`scene::${describeLock(entry.assetId, entry.metadata)}`);
            }
        }
    }
    return out.sort();
}

/**
 * A full rebuild of every loaded story must be a no-op. See the note at the top of this file.
 */
function expectLocksSettled(service: StoryService, assets: ReturnType<typeof createLockManagerMirror>): void {
    const before = liveLocks(assets);
    for (const storyId of internals(service).storyAssetLocks.keys()) {
        let document: StoryDocument;
        try {
            document = service.getStoryDocument(storyId);
        } catch {
            // Locks derived from disk for a story nobody opened; nothing in memory to re-derive from.
            continue;
        }
        internals(service).syncDocumentAssetLocks(storyId, document, "all");
    }
    expect(liveLocks(assets)).toEqual(before);
    expect(liveLocks(assets)).toEqual(tableLocks(service));
}

function backgroundBlock(id: string, assetId: string): StoryBlock {
    return {
        id,
        kind: "action",
        parentId: null,
        childrenIds: [],
        payload: { action: "setBackground", assetId },
    } as never as StoryBlock;
}

function voiceBlock(id: string, voiceAssetId: string): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        parentId: null,
        childrenIds: [],
        payload: {
            action: "dialogue",
            speakerName: "Someone",
            text: { textId: `${id}-t`, role: "dialogue", value: "Hi" },
            voiceAssetId,
        },
    } as never as StoryBlock;
}

async function seedStory(service: StoryService, history: HistoryService, name = "Tale") {
    if (!(service as never as { index: unknown }).index) {
        (service as never as { index: unknown }).index = { schemaVersion: 1, stories: [], meta: {} };
        (service as never as { animationIndex: unknown }).animationIndex = { schemaVersion: 1, animations: [], meta: {} };
    }
    const entry = service.createStory(name);
    await service.saveStory(entry.id);
    history.clearScope(projectHistoryScope());
    return entry;
}

describe("StoryService asset locks stay incremental without going stale", () => {
    let harness: ReturnType<typeof createHarness>;

    beforeEach(() => {
        harness = createHarness();
    });

    it("locks an asset a newly inserted block references, and releases it on delete", async () => {
        const { service, history, assets } = harness;
        const story = await seedStory(service, history);
        const scene = service.createScene(story.id, { name: "A" });
        expectLocksSettled(service, assets);

        service.insertBlock(story.id, scene.id, backgroundBlock("b1", "bg-asset"), { parentId: null });
        expect(liveLocks(assets)).toContain(`scene::bg-asset|${story.id}|${scene.id}|b1|background.assetId`);
        expectLocksSettled(service, assets);

        service.deleteBlock(story.id, scene.id, "b1");
        expect(liveLocks(assets)).not.toContain(`scene::bg-asset|${story.id}|${scene.id}|b1|background.assetId`);
        expectLocksSettled(service, assets);
    });

    it("follows a payload edit from one asset to another", async () => {
        const { service, history, assets } = harness;
        const story = await seedStory(service, history);
        const scene = service.createScene(story.id, { name: "A" });
        service.insertBlock(story.id, scene.id, backgroundBlock("b1", "first"), { parentId: null });

        service.updateBlock(story.id, scene.id, "b1", { action: "setBackground", assetId: "second" } as never);
        expect(liveLocks(assets)).toContain(`scene::second|${story.id}|${scene.id}|b1|background.assetId`);
        expect(liveLocks(assets)).not.toContain(`scene::first|${story.id}|${scene.id}|b1|background.assetId`);
        expectLocksSettled(service, assets);

        // Cleared, not repointed: the lock has to go, or the asset is undeletable forever.
        service.updateBlock(story.id, scene.id, "b1", { action: "setBackground", color: "#000" } as never);
        expect(liveLocks(assets).filter(lock => lock.includes("|b1|"))).toEqual([]);
        expectLocksSettled(service, assets);
    });

    it("moves a block's lock between scenes when the block moves", async () => {
        const { service, history, assets } = harness;
        const story = await seedStory(service, history);
        const from = service.createScene(story.id, { name: "From" });
        const to = service.createScene(story.id, { name: "To" });
        service.insertBlock(story.id, from.id, voiceBlock("v1", "voice-asset"), { parentId: null });
        expect(liveLocks(assets)).toContain(`scene::voice-asset|${story.id}|${from.id}|v1|voiceAssetId`);

        // A cross-scene move is a delete plus an insert; the lock has to follow the scene id, because
        // that is what the metadata an unlock matches on is made of.
        service.deleteBlock(story.id, from.id, "v1");
        service.insertBlock(story.id, to.id, voiceBlock("v1", "voice-asset"), { parentId: null });
        expect(liveLocks(assets)).toContain(`scene::voice-asset|${story.id}|${to.id}|v1|voiceAssetId`);
        expect(liveLocks(assets)).not.toContain(`scene::voice-asset|${story.id}|${from.id}|v1|voiceAssetId`);
        expectLocksSettled(service, assets);
    });

    it("keeps up with a multi-scene edit committed as one mutation", async () => {
        const { service, history, assets } = harness;
        const story = await seedStory(service, history);
        const one = service.createScene(story.id, { name: "One" });
        const two = service.createScene(story.id, { name: "Two" });
        service.insertBlock(story.id, one.id, backgroundBlock("a", "asset-a"), { parentId: null });
        service.insertBlock(story.id, two.id, backgroundBlock("b", "asset-b"), { parentId: null });

        service.updateBlocks(story.id, [
            { sceneId: one.id, blockId: "a", payload: { action: "setBackground", assetId: "asset-a2" } as never },
            { sceneId: two.id, blockId: "b", payload: { action: "setBackground", assetId: "asset-b2" } as never },
        ]);
        expect(liveLocks(assets)).toContain(`scene::asset-a2|${story.id}|${one.id}|a|background.assetId`);
        expect(liveLocks(assets)).toContain(`scene::asset-b2|${story.id}|${two.id}|b|background.assetId`);
        expectLocksSettled(service, assets);
    });

    it("tracks the scene's own default background", async () => {
        const { service, history, assets } = harness;
        const story = await seedStory(service, history);
        const scene = service.createScene(story.id, { name: "A" });

        service.updateScene(story.id, scene.id, { defaultBackgroundAssetId: "scene-bg" });
        expect(liveLocks(assets)).toContain(
            `scene::scene-bg|${story.id}|${scene.id}|__scene__|scene.defaultBackgroundAssetId`,
        );
        expectLocksSettled(service, assets);

        service.updateScene(story.id, scene.id, { defaultBackgroundAssetId: null });
        expect(liveLocks(assets)).not.toContain(
            `scene::scene-bg|${story.id}|${scene.id}|__scene__|scene.defaultBackgroundAssetId`,
        );
        expectLocksSettled(service, assets);
    });

    it("releases a whole scene's locks when the scene goes, and takes them back on undo", async () => {
        const { service, history, assets } = harness;
        const story = await seedStory(service, history);
        const chapter = service.createChapter(story.id, "One");
        const scene = service.createScene(story.id, { chapterId: chapter.id, name: "A" });
        service.insertBlock(story.id, scene.id, backgroundBlock("b1", "doomed"), { parentId: null });
        service.updateScene(story.id, scene.id, { defaultBackgroundAssetId: "doomed-bg" });
        history.clearScope(projectHistoryScope());
        const withScene = liveLocks(assets);

        service.deleteScene(story.id, scene.id);
        expect(liveLocks(assets).filter(lock => lock.includes(`|${scene.id}|`))).toEqual([]);
        expectLocksSettled(service, assets);

        expect(history.undo(projectHistoryScope())).toBe(true);
        expect(liveLocks(assets)).toEqual(withScene);
        expectLocksSettled(service, assets);
    });

    it("releases every scene a deleted chapter took with it, and takes them back on undo", async () => {
        const { service, history, assets } = harness;
        const story = await seedStory(service, history);
        const chapter = service.createChapter(story.id, "One");
        const a = service.createScene(story.id, { chapterId: chapter.id, name: "A" });
        const b = service.createScene(story.id, { chapterId: chapter.id, name: "B" });
        service.insertBlock(story.id, a.id, backgroundBlock("ba", "asset-a"), { parentId: null });
        service.insertBlock(story.id, b.id, voiceBlock("vb", "asset-b"), { parentId: null });
        history.clearScope(projectHistoryScope());
        const withChapter = liveLocks(assets);

        expect(service.deleteChapter(story.id, chapter.id)).toBe(true);
        expect(liveLocks(assets).filter(lock => lock.includes(`|${a.id}|`) || lock.includes(`|${b.id}|`))).toEqual([]);
        expectLocksSettled(service, assets);

        expect(history.undo(projectHistoryScope())).toBe(true);
        expect(liveLocks(assets)).toEqual(withChapter);
        expectLocksSettled(service, assets);
    });

    it("re-derives a scene replaced wholesale, which is how the editor undoes a row edit", async () => {
        const { service, history, assets } = harness;
        const story = await seedStory(service, history);
        const scene = service.createScene(story.id, { name: "A" });
        service.insertBlock(story.id, scene.id, backgroundBlock("b1", "before"), { parentId: null });
        const snapshot = JSON.parse(JSON.stringify(service.getStoryDocument(story.id).scenes[scene.id])) as StoryScene;

        service.updateBlock(story.id, scene.id, "b1", { action: "setBackground", assetId: "after" } as never);
        service.insertBlock(story.id, scene.id, voiceBlock("v1", "extra"), { parentId: null });
        expectLocksSettled(service, assets);

        service.replaceScene(story.id, scene.id, snapshot);
        expect(liveLocks(assets)).toContain(`scene::before|${story.id}|${scene.id}|b1|background.assetId`);
        expect(liveLocks(assets).filter(lock => lock.includes("|v1|"))).toEqual([]);
        expectLocksSettled(service, assets);
    });

    it("keeps two stories' locks apart", async () => {
        const { service, history, assets } = harness;
        const first = await seedStory(service, history, "First");
        const firstScene = service.createScene(first.id, { name: "A" });
        service.insertBlock(first.id, firstScene.id, backgroundBlock("b1", "shared-asset"), { parentId: null });

        const second = await seedStory(service, history, "Second");
        const secondScene = service.createScene(second.id, { name: "B" });
        service.insertBlock(second.id, secondScene.id, backgroundBlock("b2", "shared-asset"), { parentId: null });

        // The same asset, used by both: two locks, and losing one must not release the other.
        expect(liveLocks(assets).filter(lock => lock.startsWith("scene::shared-asset|"))).toHaveLength(2);
        expectLocksSettled(service, assets);

        service.deleteBlock(first.id, firstScene.id, "b1");
        expect(liveLocks(assets).filter(lock => lock.startsWith("scene::shared-asset|"))).toEqual([
            `scene::shared-asset|${second.id}|${secondScene.id}|b2|background.assetId`,
        ]);
        expectLocksSettled(service, assets);
    });

    it("re-derives a story read back off disk without stacking a second set of locks", async () => {
        const { service, history, assets } = harness;
        const story = await seedStory(service, history);
        const scene = service.createScene(story.id, { name: "A" });
        service.insertBlock(story.id, scene.id, backgroundBlock("b1", "persisted"), { parentId: null });
        await service.saveStory(story.id);
        const beforeReload = liveLocks(assets);

        await service.reloadStory(story.id);
        expect(liveLocks(assets)).toEqual(beforeReload);
        expectLocksSettled(service, assets);
    });

    it("derives locks from disk for a story nobody has opened, and does not stack them when it is", async () => {
        const { service, history, assets } = harness;
        const story = await seedStory(service, history);
        const scene = service.createScene(story.id, { name: "A" });
        service.insertBlock(story.id, scene.id, backgroundBlock("b1", "on-disk"), { parentId: null });
        await service.saveStory(story.id);

        // Cold start: the library sweep reads the document off disk and locks what it points at,
        // without the document ever entering `documents`.
        const cold = createHarness();
        (cold.service as never as { index: unknown }).index =
            (service as never as { index: unknown }).index;
        (cold.service as never as { animationIndex: unknown }).animationIndex =
            (service as never as { animationIndex: unknown }).animationIndex;
        for (const [path, data] of harness.files) {
            cold.files.set(path, data);
        }
        await (cold.service as never as { syncLibraryAssetLocks: () => Promise<void> }).syncLibraryAssetLocks();
        const fromDisk = liveLocks(cold.assets);
        expect(fromDisk).toContain(`scene::on-disk|${story.id}|${scene.id}|b1|background.assetId`);

        // Opening it must diff against that table, not add a second copy of every lock.
        await cold.service.loadStory(story.id);
        expect(liveLocks(cold.assets)).toEqual(fromDisk);
        expectLocksSettled(cold.service, cold.assets);
    });

    it("survives a reload from disk with exactly the locks it had", async () => {
        const { service, history, assets } = harness;
        const story = await seedStory(service, history);
        const scene = service.createScene(story.id, { name: "A" });
        service.insertBlock(story.id, scene.id, backgroundBlock("b1", "kept"), { parentId: null });
        service.updateScene(story.id, scene.id, { defaultBackgroundAssetId: "kept-bg" });
        await service.saveStory(story.id);
        const before = liveLocks(assets);

        await service.reloadFromDisk();
        expect(liveLocks(assets)).toEqual(before);
        expectLocksSettled(service, assets);
    });

    it("releases a deleted story's locks and takes them back on undo", async () => {
        const { service, history, assets } = harness;
        const story = await seedStory(service, history);
        const scene = service.createScene(story.id, { name: "A" });
        service.insertBlock(story.id, scene.id, backgroundBlock("b1", "owned"), { parentId: null });
        await service.saveStory(story.id);
        history.clearScope(projectHistoryScope());
        const withStory = liveLocks(assets);

        expect(await service.deleteStory(story.id)).toBe(true);
        expect(liveLocks(assets)).toEqual([]);

        // This undo is asynchronous - it writes the document back before it restores the entry.
        expect(history.undo(projectHistoryScope())).toBe(true);
        await history.settled();
        expect(liveLocks(assets)).toEqual(withStory);
        expectLocksSettled(service, assets);
    });

    it("leaves locks alone for the mutations that cannot touch a scene", async () => {
        const { service, history, assets } = harness;
        const story = await seedStory(service, history);
        const chapter = service.createChapter(story.id, "One");
        const scene = service.createScene(story.id, { chapterId: chapter.id, name: "A" });
        service.insertBlock(story.id, scene.id, backgroundBlock("b1", "kept"), { parentId: null });
        const before = liveLocks(assets);

        service.renameStory(story.id, "Renamed");
        service.renameChapter(story.id, chapter.id, "Chapter Two");
        service.renameScene(story.id, scene.id, "Scene Two");
        const other = service.createChapter(story.id, "Two");
        service.moveChapter(story.id, other.id, chapter.id);
        service.moveScene(story.id, scene.id, { chapterId: other.id });
        service.setEntryScene(story.id, scene.id);
        service.setBlockDisabled(story.id, scene.id, "b1", true);

        expect(liveLocks(assets)).toEqual(before);
        expectLocksSettled(service, assets);
    });

    it("keeps up with scene snapshots and variable declarations", async () => {
        const { service, history, assets } = harness;
        const story = await seedStory(service, history);
        const scene = service.createScene(story.id, { name: "A" });
        service.insertBlock(story.id, scene.id, backgroundBlock("b1", "kept"), { parentId: null });
        const before = liveLocks(assets);

        const snapshotId = service.createSceneSnapshot(story.id, scene.id, "Snap");
        expect(snapshotId).toBeTruthy();
        service.renameSceneSnapshot(story.id, scene.id, snapshotId!, "Snap 2");
        service.setSceneSnapshotValue(story.id, scene.id, snapshotId!, "ref", true as never);
        service.clearSceneSnapshotValue(story.id, scene.id, snapshotId!, "ref");
        service.deleteSceneSnapshot(story.id, scene.id, snapshotId!);

        expect(liveLocks(assets)).toEqual(before);
        expectLocksSettled(service, assets);
    });

    it("rebuilds when a scope names too few scenes", async () => {
        const { service, history, assets } = harness;
        const story = await seedStory(service, history);
        const scene = service.createScene(story.id, { name: "A" });
        service.insertBlock(story.id, scene.id, backgroundBlock("b1", "kept"), { parentId: null });
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

        // A mutation that adds a scene full of assets and then lies about having touched anything.
        // The scene-set check is what makes this recoverable rather than a permanently wrong table.
        internals(service).mutateDocument(story.id, document => {
            document.scenes["smuggled"] = {
                id: "smuggled",
                name: "Smuggled",
                runtimeName: "smuggled",
                blocks: { sb: backgroundBlock("sb", "smuggled-asset") },
                rootBlockIds: ["sb"],
                defaultBackgroundAssetId: "smuggled-bg",
                meta: { createdAt: "", updatedAt: "" },
            } as never as StoryScene;
            document.chapters[0]?.sceneIds.push("smuggled");
        }, []);

        expect(warn).toHaveBeenCalled();
        expect(liveLocks(assets)).toContain(`scene::smuggled-asset|${story.id}|smuggled|sb|background.assetId`);
        expectLocksSettled(service, assets);
        warn.mockRestore();
    });
});
