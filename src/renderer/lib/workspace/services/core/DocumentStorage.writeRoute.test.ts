import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveDocument } from "@shared/documents/documentIo";
import { localizationDocumentSpec, localizationKeysSpec } from "@shared/documents/specs";
import { LOCALIZATION_DOCUMENT_SCHEMA_VERSION } from "@shared/types/localization";
import { FsRejectErrorCode } from "@shared/types/os";
import {
    freezeProjectWrites,
    holdProjectWritesForReload,
    thawProjectWrites,
} from "@/lib/app/writeFreeze";
import { BaseFileSystemService, FileSystemService } from "./FileSystem";
import { RendererDocumentStorage } from "./DocumentStorage";

/**
 * The route every document on the shared `DocumentStorage` port takes, asserted end to end rather
 * than against a stub.
 *
 * `RendererDocumentStorage` no longer writes through `fs.write` - no write grant, no protocol `PUT`,
 * just the one IPC call `Fs.writeFileNoFollowOrCreate` sits behind. Eleven services ride on it, the
 * translation libraries among them, so the swap is only safe if **a refused write is still
 * distinguishable from a successful one** all the way from the freeze latch back out: a refusal
 * answers `ok`, and a writer that treats `ok` alone as "on disk" clears a debt that was never paid.
 *
 * These tests use the real `FileSystemService`, the real `BaseFileSystemService`, the real
 * privileged facade and the real latch, and stub only the host at the far end of the IPC. A test
 * that hard-coded the refusal shape would keep passing if a layer in between dropped it.
 *
 * The paths are the localization catalogues' own, built by the same specs `LocalizationService`
 * saves through, so what is exercised here is the bytes and the path a real save produces.
 */

const PROJECT = "D:/projects/my-game";
const JA_PATH = localizationDocumentSpec.pathFor({ locale: "ja" });
const KEYS_PATH = localizationKeysSpec.pathFor();

const privilegedFs = vi.hoisted(() => ({
    writeFileNoFollowOrCreate: vi.fn(),
    requestWrite: vi.fn(),
    createDir: vi.fn(),
}));

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({}),
    getPrivilegedInterface: () => ({ fs: privilegedFs }),
}));

/** The bytes the host accepted, by absolute path. */
const disk = new Map<string, string>();

function createStorage() {
    return new RendererDocumentStorage(new FileSystemService(), PROJECT);
}

function catalogue(units: Record<string, string>) {
    return {
        schemaVersion: LOCALIZATION_DOCUMENT_SCHEMA_VERSION,
        locale: "ja",
        units: Object.fromEntries(Object.entries(units).map(([key, text]) => [key, { text }])),
        meta: {},
    };
}

/** Absolute paths the host was actually asked to write, in order. */
function hostWrites(): string[] {
    return privilegedFs.writeFileNoFollowOrCreate.mock.calls.map(call => call[1] as string);
}

describe("RendererDocumentStorage takes the no-grant write route", () => {
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
        privilegedFs.createDir.mockResolvedValue({ success: true, data: { ok: true, data: undefined } });
    });

    afterEach(() => {
        thawProjectWrites();
    });

    it("never asks for a write grant, and lands the catalogue's bytes", async () => {
        await saveDocument(localizationDocumentSpec, createStorage(), JA_PATH, catalogue({ greeting: "こんにちは" }) as never);

        expect(hostWrites()).toEqual([`${PROJECT}/editor/localization/ja.json`]);
        expect(disk.get(`${PROJECT}/editor/localization/ja.json`)).toContain("こんにちは");
        // The whole point of the change: the grant round trip and the protocol PUT are gone.
        expect(privilegedFs.requestWrite).not.toHaveBeenCalled();
    });

    it("writes the keys document by the same route", async () => {
        await saveDocument(localizationKeysSpec, createStorage(), KEYS_PATH, {
            schemaVersion: 1, keys: {}, meta: {},
        } as never);

        expect(hostWrites()).toEqual([`${PROJECT}/editor/localization/keys.json`]);
        expect(privilegedFs.requestWrite).not.toHaveBeenCalled();
    });

    /**
     * The load-bearing pair. The port's own signature is `Promise<void>`, so a refusal cannot be
     * *reported* through it - but it must still be a refusal underneath, and it must still keep the
     * bytes off the disk. Both halves are asserted: the host is never called, and the same write
     * asked of `FileSystemService` directly answers `refused`.
     */
    it("keeps a frozen catalogue off the disk, and says so on the result", async () => {
        freezeProjectWrites({ projectPath: PROJECT, reason: { kind: "manual" } });

        await saveDocument(localizationDocumentSpec, createStorage(), JA_PATH, catalogue({ greeting: "frozen" }) as never);

        expect(hostWrites()).toEqual([]);
        const direct = await new FileSystemService().writeFileNoFollowOrCreate(
            `${PROJECT}/${JA_PATH}`, "{}", "utf-8");
        expect(direct.ok && direct.refused).toBe(true);
    });

    it("keeps a catalogue off the disk while the working tree is being re-read", async () => {
        const release = holdProjectWritesForReload(PROJECT);

        await saveDocument(localizationDocumentSpec, createStorage(), JA_PATH, catalogue({ greeting: "reloading" }) as never);
        expect(hostWrites()).toEqual([]);

        release();
        await saveDocument(localizationDocumentSpec, createStorage(), JA_PATH, catalogue({ greeting: "after" }) as never);
        expect(disk.get(`${PROJECT}/editor/localization/ja.json`)).toContain("after");
    });

    /**
     * A failure is not a refusal. Both leave the bytes off the disk, but only one is reported to the
     * author - and this one still throws out of the port, so a service's auto-saver keeps its debt.
     */
    it("reports a failed write as a failure, on the save-status channel", async () => {
        const filesystem = new FileSystemService();
        const outcomes: { path: string; ok: boolean; code?: FsRejectErrorCode }[] = [];
        const stop = filesystem.observeWrites(outcome =>
            outcomes.push({ path: outcome.path, ok: outcome.ok, code: outcome.error?.code }));

        privilegedFs.writeFileNoFollowOrCreate.mockResolvedValue({
            success: true,
            data: { ok: false, error: { code: FsRejectErrorCode.INVALID_PATH, message: "symlink" } },
        });

        await expect(
            saveDocument(localizationDocumentSpec, createStorage(), JA_PATH, catalogue({ greeting: "doomed" }) as never),
        ).rejects.toThrow(/Failed to write/);
        stop();

        const failure = outcomes.find(outcome => !outcome.ok);
        expect(failure?.path).toBe(`${PROJECT}/editor/localization/ja.json`);
        expect(failure?.code).toBe(FsRejectErrorCode.INVALID_PATH);
    });
});

/**
 * The discriminator itself, at the layer that produces it, for the paths this change moved.
 *
 * `wrote` is the predicate a debt-tracking writer applies (`StoryService.wrote`, and now
 * `AssetOrderManager.write`). These assertions are the ones that break if a refusal ever starts
 * answering like a success on this route - `refused` absent, or present on a real write.
 */
describe("writeFileNoFollowOrCreate marks a refusal on the document paths", () => {
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

    it.each([
        ["a translation library", `${PROJECT}/editor/localization/ja.json`],
        ["the interface document", `${PROJECT}/editor/ui/uidoc.json`],
        ["the interface graphs", `${PROJECT}/editor/ui/uigraphs.json`],
        ["an asset order shard", `${PROJECT}/assets/assets.order.image.json`],
        ["an asset groups shard", `${PROJECT}/assets/assets.groups.image.json`],
    ])("answers ok with refused for %s while frozen, and never calls the host", async (_label, path) => {
        freezeProjectWrites({ projectPath: PROJECT, reason: { kind: "manual" } });

        const result = await BaseFileSystemService.writeFileNoFollowOrCreate(path, "{}", "utf-8");

        expect(result.ok).toBe(true);
        expect(result.ok && result.refused).toBe(true);
        expect(wrote(result)).toBe(false);
        expect(privilegedFs.writeFileNoFollowOrCreate).not.toHaveBeenCalled();
    });

    it("answers ok WITHOUT refused when the bytes actually went out", async () => {
        const result = await BaseFileSystemService.writeFileNoFollowOrCreate(
            `${PROJECT}/editor/localization/ja.json`, "{}", "utf-8");

        expect(result.ok).toBe(true);
        expect(result.ok && result.refused).toBeUndefined();
        expect(wrote(result)).toBe(true);
        expect(privilegedFs.writeFileNoFollowOrCreate).toHaveBeenCalledTimes(1);
    });

    it("leaves a write outside the frozen project alone", async () => {
        freezeProjectWrites({ projectPath: PROJECT, reason: { kind: "manual" } });

        const result = await BaseFileSystemService.writeFileNoFollowOrCreate(
            "D:/projects/other-game/editor/localization/ja.json", "{}", "utf-8");

        expect(wrote(result)).toBe(true);
        expect(privilegedFs.writeFileNoFollowOrCreate).toHaveBeenCalledTimes(1);
    });
});
