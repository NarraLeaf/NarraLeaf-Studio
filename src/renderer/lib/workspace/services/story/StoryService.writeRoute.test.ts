import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FsRejectErrorCode } from "@shared/types/os";
import {
    freezeProjectWrites,
    holdProjectWritesForReload,
    thawProjectWrites,
} from "@/lib/app/writeFreeze";
import { BaseFileSystemService, FileSystemService } from "../core/FileSystem";
import { HistoryService } from "../history/HistoryService";
import { Services } from "../services";
import { StoryService } from "./StoryService";

/**
 * The route the story writers take, asserted end to end rather than against a stub.
 *
 * `StoryService` no longer writes through `fs.write` - no write grant, no protocol `PUT`, just the
 * one IPC call `Fs.writeFileNoFollowOrCreate` sits behind. That swap is only safe if **a refused
 * write is still distinguishable from a successful one**, all the way from the freeze latch to the
 * `dirtyDocuments` set: a refusal answers `ok`, and a writer that clears its debt on `ok` alone
 * drops the author's edit outright instead of writing it late. Nothing else would ever rewrite that
 * document.
 *
 * `StoryService.dirty.test.ts` proves the service reads the flag, but it hands the service a stub
 * that *hard-codes* the refusal shape - so it would keep passing if the real route stopped
 * producing one. These tests use the real `FileSystemService`, the real `BaseFileSystemService`, the
 * real privileged facade and the real latch, and stub only the host at the far end of the IPC. If
 * any layer in between dropped `refused`, the service would report itself clean below and the test
 * would fail.
 */

const PROJECT = "D:/projects/my-game";

const privilegedFs = vi.hoisted(() => ({
    writeFileNoFollowOrCreate: vi.fn(),
    requestWrite: vi.fn(),
    isDirExists: vi.fn(),
    createDir: vi.fn(),
    isFileExists: vi.fn(),
}));

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({}),
    getPrivilegedInterface: () => ({ fs: privilegedFs }),
}));

/** The bytes the host accepted, by path. */
const disk = new Map<string, string>();

function createHarness() {
    const history = new HistoryService();
    const service = new StoryService();
    const filesystem = new FileSystemService();
    let nextId = 0;
    const uuid = () => `00000000-0000-4000-8000-${(++nextId).toString(16).padStart(12, "0")}`;

    const context = {
        project: {
            resolve: (...parts: (string | string[])[]) =>
                [PROJECT, ...parts.flatMap(part => (Array.isArray(part) ? part : [part]))]
                    .join("/")
                    .replace(/\/+/g, "/")
                    .replace(/\/$/, ""),
        },
        services: {
            get(id: Services) {
                switch (id) {
                    case Services.History: return history;
                    case Services.FileSystem: return filesystem;
                    case Services.Uuid: return { generate: uuid };
                    case Services.Project: return {};
                    default: throw new Error(`Unexpected service ${id}`);
                }
            },
        } as never,
    } as never;
    history.setContext(context);
    service.setContext(context);
    (service as never as { index: unknown }).index = { schemaVersion: 1, stories: [], meta: {} };
    (service as never as { animationIndex: unknown }).animationIndex = { schemaVersion: 1, animations: [], meta: {} };

    return { service, filesystem };
}

/** A story with one chapter and one scene, already written and clean. */
async function seedStory(service: StoryService, name: string) {
    const entry = service.createStory(name);
    const chapter = service.getStoryDocument(entry.id).chapters[0];
    await service.saveStory(entry.id);
    return { entry, sceneId: chapter.sceneIds[0] };
}

/** Paths the host was actually asked to write, in order. */
function hostWrites(): string[] {
    return privilegedFs.writeFileNoFollowOrCreate.mock.calls.map(call => call[1] as string);
}

describe("StoryService takes the no-grant write route", () => {
    beforeEach(() => {
        disk.clear();
        privilegedFs.writeFileNoFollowOrCreate.mockReset();
        privilegedFs.writeFileNoFollowOrCreate.mockImplementation(
            async (_actor: unknown, path: string, data: string) => {
                disk.set(path, data);
                return { success: true, data: { ok: true, data: undefined } };
            },
        );
        privilegedFs.requestWrite.mockReset();
        privilegedFs.isDirExists.mockResolvedValue({ success: true, data: { ok: true, data: true } });
        privilegedFs.createDir.mockResolvedValue({ success: true, data: { ok: true, data: undefined } });
        privilegedFs.isFileExists.mockResolvedValue({ success: true, data: { ok: true, data: false } });
    });

    afterEach(() => {
        thawProjectWrites();
    });

    it("never asks for a write grant", async () => {
        const { service } = createHarness();
        const story = await seedStory(service, "Direct");
        service.renameScene(story.entry.id, story.sceneId, "Edited");
        await service.flushPendingChanges();

        expect(hostWrites().some(path => path.includes(story.entry.id))).toBe(true);
        // The whole point of the change: the grant round trip and the protocol PUT are gone.
        expect(privilegedFs.requestWrite).not.toHaveBeenCalled();
    });

    /**
     * The load-bearing one. Freeze, edit, flush: the host must not be called, and the service must
     * still owe the edit. It only can if `refused` survives every layer between the latch and
     * `StoryService.wrote`.
     */
    it("keeps owing an edit the freeze latch refused, and writes it after the thaw", async () => {
        const { service } = createHarness();
        const story = await seedStory(service, "Frozen");
        const beforeFreeze = hostWrites().length;

        freezeProjectWrites({ projectPath: PROJECT, reason: { kind: "manual" } });
        service.renameScene(story.entry.id, story.sceneId, "Written while frozen");
        await service.flushPendingChanges();

        // Nothing reached the host, and the service knows it.
        expect(hostWrites().length).toBe(beforeFreeze);
        expect(service.isDirty()).toBe(true);

        thawProjectWrites();
        await (service as never as { flush: () => Promise<void> }).flush();

        expect(hostWrites().filter(path => path.includes(story.entry.id)).length).toBeGreaterThan(0);
        expect(service.isDirty()).toBe(false);
        expect(disk.get(`${PROJECT}/editor/story/stories/${story.entry.id}/storydoc.json`))
            .toContain("Written while frozen");
    });

    /** The second latch, which the grant route also honoured: a working tree being re-read. */
    it("keeps owing an edit refused because the working tree is being re-read", async () => {
        const { service } = createHarness();
        const story = await seedStory(service, "Reloading");
        const beforeHold = hostWrites().length;

        const release = holdProjectWritesForReload(PROJECT);
        service.renameScene(story.entry.id, story.sceneId, "Written mid-reload");
        await service.flushPendingChanges();

        expect(hostWrites().length).toBe(beforeHold);
        expect(service.isDirty()).toBe(true);

        release();
        await (service as never as { flush: () => Promise<void> }).flush();
        expect(service.isDirty()).toBe(false);
    });

    /**
     * A failure is not a refusal. Both leave the debt owed, but only one is reported to the author,
     * and `settleWrite` throws on the failure so the auto-saver keeps retrying with backoff.
     */
    it("reports a failed write as a failure, not as a refusal", async () => {
        const { service, filesystem } = createHarness();
        const story = await seedStory(service, "Failing");

        const outcomes: { path: string; ok: boolean; code?: FsRejectErrorCode }[] = [];
        const stop = filesystem.observeWrites(outcome =>
            outcomes.push({ path: outcome.path, ok: outcome.ok, code: outcome.error?.code }));

        privilegedFs.writeFileNoFollowOrCreate.mockResolvedValue({
            success: true,
            data: { ok: false, error: { code: FsRejectErrorCode.INVALID_PATH, message: "symlink" } },
        });
        service.renameScene(story.entry.id, story.sceneId, "Doomed");
        await expect(service.flushPendingChanges()).rejects.toThrow();
        stop();

        expect(service.isDirty()).toBe(true);
        // The save-status surface still learns which path failed, and with which code.
        const failure = outcomes.find(outcome => !outcome.ok);
        expect(failure).toBeDefined();
        expect(failure?.path).toContain(story.entry.id);
        expect(failure?.code).toBe(FsRejectErrorCode.INVALID_PATH);
    });
});

/**
 * The discriminator itself, at the layer that produces it.
 *
 * `wrote` below is `StoryService.wrote` verbatim; it is private, so it is restated rather than
 * imported. These two assertions are the ones that break if a refusal ever starts answering like a
 * success on this route - `refused` absent, or present on a real write.
 */
describe("BaseFileSystemService.writeFileNoFollowOrCreate marks a refusal", () => {
    const wrote = (result: Awaited<ReturnType<typeof BaseFileSystemService.writeFileNoFollowOrCreate>>) =>
        result.ok && result.refused !== true;

    beforeEach(() => {
        privilegedFs.writeFileNoFollowOrCreate.mockReset();
        privilegedFs.writeFileNoFollowOrCreate.mockResolvedValue({
            success: true,
            data: { ok: true, data: undefined },
        });
    });

    afterEach(() => {
        thawProjectWrites();
    });

    it("answers ok with refused, and does not call the host, while frozen", async () => {
        freezeProjectWrites({ projectPath: PROJECT, reason: { kind: "manual" } });

        const result = await BaseFileSystemService.writeFileNoFollowOrCreate(
            `${PROJECT}/editor/story/index.json`, "{}", "utf-8");

        expect(result.ok).toBe(true);
        expect(result.ok && result.refused).toBe(true);
        expect(wrote(result)).toBe(false);
        expect(privilegedFs.writeFileNoFollowOrCreate).not.toHaveBeenCalled();
    });

    it("answers ok WITHOUT refused when the bytes actually went out", async () => {
        const result = await BaseFileSystemService.writeFileNoFollowOrCreate(
            `${PROJECT}/editor/story/index.json`, "{}", "utf-8");

        expect(result.ok).toBe(true);
        expect(result.ok && result.refused).toBeUndefined();
        expect(wrote(result)).toBe(true);
        expect(privilegedFs.writeFileNoFollowOrCreate).toHaveBeenCalledTimes(1);
    });

    it("leaves a write outside the frozen project alone", async () => {
        freezeProjectWrites({ projectPath: PROJECT, reason: { kind: "manual" } });

        const result = await BaseFileSystemService.writeFileNoFollowOrCreate(
            "D:/projects/other-game/editor/story/index.json", "{}", "utf-8");

        expect(wrote(result)).toBe(true);
        expect(privilegedFs.writeFileNoFollowOrCreate).toHaveBeenCalledTimes(1);
    });
});
