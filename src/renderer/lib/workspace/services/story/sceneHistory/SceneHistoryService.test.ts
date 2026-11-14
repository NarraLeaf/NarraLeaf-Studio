import { describe, expect, it, vi } from "vitest";
import type { StoryBlock, StoryScene } from "@shared/types/story";
import { Services, type WorkspaceContext } from "../../services";
import { SceneHistoryService } from "./SceneHistoryService";

vi.mock("@/lib/app/writeFreeze", () => ({
    getProjectWriteFreeze: () => frozen,
    isProjectWriteReloadHeld: () => false,
    observeProjectWriteFreeze: () => () => {},
}));

let frozen: unknown = null;

function row(id: string, value: string): StoryBlock {
    return {
        id, parentId: null, childrenIds: [], kind: "nodeAction",
        payload: { action: "narration", text: { textId: `${id}-text`, role: "narration", value } },
    };
}

function scene(): StoryScene {
    return {
        id: "scene", name: "Current", runtimeName: "current", rootBlockIds: ["a", "b"],
        blocks: { a: row("a", "current a"), b: row("b", "current b") },
    } as StoryScene;
}

async function mount() {
    frozen = null;
    const files = new Map<string, string>();
    let current: StoryScene | undefined = scene();
    let revision = 1;
    let nextId = 0;
    let startWrite: () => void = () => {};
    let finishWrite: () => void = () => {};
    const writeStarted = new Promise<void>(resolve => { startWrite = resolve; });
    const writeBlocked = new Promise<void>(resolve => { finishWrite = resolve; });
    let blockNextEntry = false;
    let failEntryWrite = false;
    let failIndexWrite = false;
    let failIndexRead = false;
    let refuseWrites = false;
    const commits: Array<{ before: StoryScene; after: StoryScene }> = [];
    const story = {
        getLoadedStoryDocument: () => ({ scenes: current ? { scene: current } : {} }),
        getSceneContentRevision: () => revision,
        commitSceneReplacement: (_storyId: string, _sceneId: string, replacement: StoryScene) => {
            if (!current) return false;
            commits.push({ before: structuredClone(current), after: structuredClone(replacement) });
            current = replacement;
            revision += 1;
            return true;
        },
    };
    const fs = {
        isFileExists: async (path: string) => ({ ok: true, data: files.has(path) }),
        isDirExists: async () => ({ ok: true, data: true }),
        readJSON: async (path: string) => files.has(path) && !(failIndexRead && path.endsWith("index.json"))
            ? { ok: true, data: JSON.parse(files.get(path)!) }
            : { ok: false },
        writeFileNoFollowOrCreate: async (path: string, data: string) => {
            if (blockNextEntry && !path.endsWith("index.json")) {
                blockNextEntry = false;
                startWrite();
                await writeBlocked;
            }
            if (refuseWrites) return { ok: true, refused: true };
            if ((failIndexWrite && path.endsWith("index.json")) || (failEntryWrite && !path.endsWith("index.json"))) return { ok: false };
            files.set(path, data);
            return { ok: true };
        },
        deleteFile: async (path: string) => { files.delete(path); return { ok: true }; },
    };
    const context = {
        project: { resolve: (...parts: string[]) => parts.join("/") },
        services: { get: (id: Services) => {
            switch (id) {
                case Services.Story: return story;
                case Services.FileSystem: return fs;
                case Services.Uuid: return { generate: () => `entry-${++nextId}` };
                case Services.GlobalSettings: return { getSync: (_key: string, fallback: unknown) => fallback };
                case Services.SaveStatus: return { onPrepareForReload: () => () => {}, endBackgroundWrites: () => {} };
                default: throw new Error(`Unexpected service ${id}`);
            }
        } },
    } as unknown as WorkspaceContext;
    const service = new SceneHistoryService();
    await service.initialize(context, async () => {});
    return {
        service, files, commits, writeStarted, finishWrite,
        blockWrite: () => { blockNextEntry = true; },
        failEntryWrite: () => { failEntryWrite = true; },
        failIndexWrite: () => { failIndexWrite = true; },
        failIndexRead: () => { failIndexRead = true; },
        refuseWrites: () => { refuseWrites = true; },
        current: () => current,
        edit: (edit: (value: StoryScene) => void) => {
            current = structuredClone(current!);
            edit(current);
            revision += 1;
        },
    };
}

describe("scene history restore", () => {
    it("restores one row over the latest scene and snapshots the edits made while saving", async () => {
        const h = await mount();
        h.blockWrite();
        const restoring = h.service.restoreRowVersion("story", "scene", row("a", "older a"));
        await h.writeStarted;
        h.edit(value => { value.blocks.b = row("b", "edited during save"); });
        h.finishWrite();

        expect(await restoring).toEqual({ status: "ok", value: undefined });
        expect(h.current()?.blocks.a).toEqual(row("a", "older a"));
        expect(h.current()?.blocks.b).toEqual(row("b", "edited during save"));
        expect(h.commits[0].before.blocks.b).toEqual(row("b", "edited during save"));
        const entries = await h.service.listEntries("story", "scene");
        const saved = await Promise.all(entries.map(entry => h.service.readSnapshotScene("story", "scene", entry.id)));
        expect(saved.some(value => JSON.stringify(value?.blocks.b) === JSON.stringify(row("b", "edited during save")))).toBe(true);
    });

    it("does not recreate a row removed while the pre-restore snapshot is saving", async () => {
        const h = await mount();
        h.blockWrite();
        const restoring = h.service.restoreRowVersion("story", "scene", row("a", "older a"));
        await h.writeStarted;
        h.edit(value => { delete value.blocks.a; value.rootBlockIds = ["b"]; });
        h.finishWrite();

        expect(await restoring).toEqual({ status: "row-missing" });
        expect(h.current()?.blocks.a).toBeUndefined();
        expect(h.commits).toHaveLength(0);
    });

    it("keeps the latest scene settings when restoring a whole snapshot", async () => {
        const h = await mount();
        h.files.set(".nlstudio/scene-history/story/scene/old.json", JSON.stringify({ scene: scene() }));
        h.blockWrite();
        const restoring = h.service.restoreSceneSnapshot("story", "scene", "old");
        await h.writeStarted;
        h.edit(value => { value.name = "Renamed during save"; });
        h.finishWrite();

        expect(await restoring).toEqual({ status: "ok", value: undefined });
        expect(h.current()?.name).toBe("Renamed during save");
    });

    it("does not restore when the workspace freezes while the snapshot is saving", async () => {
        const h = await mount();
        h.blockWrite();
        const restoring = h.service.restoreRowVersion("story", "scene", row("a", "older a"));
        await h.writeStarted;
        frozen = { kind: "revision" };
        h.finishWrite();

        expect(await restoring).toEqual({ status: "failed" });
        expect(h.current()?.blocks.a).toEqual(row("a", "current a"));
        expect(h.commits).toHaveLength(0);
    });

    it("does not restore when the pre-restore snapshot cannot be indexed", async () => {
        const h = await mount();
        h.failIndexWrite();

        expect(await h.service.restoreRowVersion("story", "scene", row("a", "older a"))).toEqual({ status: "save-reported" });
        expect(h.current()?.blocks.a).toEqual(row("a", "current a"));
        expect(h.commits).toHaveLength(0);
    });

    it("distinguishes a missing scene from a missing row", async () => {
        const h = await mount();
        expect(await h.service.restoreRowVersion("story", "missing", row("a", "older a"))).toEqual({ status: "failed" });
        expect(await h.service.restoreRowVersion("story", "scene", row("missing", "older"))).toEqual({ status: "row-missing" });
    });

    it("reports an unreadable pre-restore index as a general failure", async () => {
        const h = await mount();
        h.files.set(".nlstudio/scene-history/story/scene/index.json", "{}");
        h.failIndexRead();
        const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
            expect(await h.service.restoreRowVersion("story", "scene", row("a", "older a"))).toEqual({ status: "failed" });
            expect(h.commits).toHaveLength(0);
        } finally {
            warning.mockRestore();
        }
    });
});

describe("scene history index writes", () => {
    it("distinguishes missing scenes, write failures and refused writes", async () => {
        const missing = await mount();
        expect(await missing.service.createManualSnapshot("story", "missing")).toEqual({ status: "failed" });

        const failedEntry = await mount();
        failedEntry.failEntryWrite();
        expect(await failedEntry.service.createManualSnapshot("story", "scene")).toEqual({ status: "save-reported" });

        const failedIndex = await mount();
        failedIndex.failIndexWrite();
        expect(await failedIndex.service.createManualSnapshot("story", "scene")).toEqual({ status: "save-reported" });

        const refused = await mount();
        refused.refuseWrites();
        expect(await refused.service.createManualSnapshot("story", "scene")).toEqual({ status: "failed" });
    });

    it("does not replace an existing index that could not be read", async () => {
        const h = await mount();
        const path = ".nlstudio/scene-history/story/scene/index.json";
        const original = JSON.stringify({ version: 1, entries: [{ id: "old", kind: "manual", createdAt: 1, hash: "old", blockCount: 1 }] });
        h.files.set(path, original);
        h.failIndexRead();

        await expect(h.service.createManualSnapshot("story", "scene")).rejects.toThrow("Could not read the scene history index");
        expect(h.files.get(path)).toBe(original);
    });

    it("keeps an entry and its file when the index update for deletion fails", async () => {
        const h = await mount();
        const result = await h.service.createManualSnapshot("story", "scene");
        expect(result.status).toBe("ok");
        if (result.status !== "ok") throw new Error("Expected a saved snapshot");
        const entry = result.value;
        h.failIndexWrite();

        expect(await h.service.deleteEntry("story", "scene", entry.id)).toEqual({ status: "save-reported" });

        expect((await h.service.listEntries("story", "scene")).map(item => item.id)).toEqual([entry.id]);
        expect(await h.service.readSnapshotScene("story", "scene", entry.id)).not.toBeNull();
    });

    it("does not prune older snapshots when writing the replacement index fails", async () => {
        const h = await mount();
        const dir = ".nlstudio/scene-history/story/scene";
        const entries = Array.from({ length: 40 }, (_, i) => ({
            id: `old-${i}`, kind: "auto", createdAt: Date.now() - (i + 1) * 60_000, hash: `${i}`, blockCount: 2,
        }));
        h.files.set(`${dir}/index.json`, JSON.stringify({ version: 1, entries }));
        for (const entry of entries) h.files.set(`${dir}/${entry.id}.json`, JSON.stringify({ scene: scene() }));
        h.failIndexWrite();

        await expect(h.service.runAutoSnapshotNow(["story"])).rejects.toThrow("Could not save the scene history snapshot");

        expect(await h.service.listEntries("story", "scene")).toHaveLength(40);
        expect(entries.every(entry => h.files.has(`${dir}/${entry.id}.json`))).toBe(true);
        expect(JSON.parse(h.files.get(`${dir}/index.json`)!).entries).toEqual(entries);
    });

    it("yields between scenes without depending on a timer", async () => {
        const h = await mount();
        const realSetTimeout = globalThis.setTimeout;
        vi.useFakeTimers();
        try {
            const completed = await Promise.race([
                h.service.runAutoSnapshotNow(["story"]).then(() => true),
                new Promise<boolean>(resolve => realSetTimeout(() => resolve(false), 100)),
            ]);
            expect(completed).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });
});
