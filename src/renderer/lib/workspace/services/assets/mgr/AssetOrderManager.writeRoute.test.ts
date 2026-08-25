import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FsRejectErrorCode } from "@shared/types/os";
import { freezeProjectWrites, thawProjectWrites } from "@/lib/app/writeFreeze";
import { FileSystemService } from "../../core/FileSystem";
import { Services } from "../../services";
import { AssetCategory } from "../assetTypes";
import { AssetOrderManager } from "./AssetOrderManager";

/**
 * The row-order shard's write route, and the one place in this change where a *service* reads the
 * refusal flag rather than only passing it on.
 *
 * `AssetOrderManager.write` used to take `fs.write` - a write grant over IPC, then a protocol `PUT`
 * - because the only no-grant writer that carried the rejection contract could not create a file,
 * and this shard does not exist on the first open of any project that predates it. That reason went
 * away with `Fs.writeFileNoFollowOrCreate`, and the write moved.
 *
 * The move is only safe if `refused` survives it, because `missingCategories` means exactly "this
 * file is not on the disk yet". A frozen or reloading workspace answers `ok` having written nothing;
 * clearing the entry on `ok` alone tells the next open the shard is there when it is not, and the
 * author's row order - recoverable from shard key order only until some later open rewrites a shard
 * sorted - is what gets lost.
 *
 * The real `FileSystemService`, privileged facade and freeze latch are all in the path; only the
 * host at the far end of the IPC is stubbed. A test that hard-coded the refusal shape would keep
 * passing if a layer in between dropped it.
 */

const PROJECT = "D:/projects/my-game";
const IMAGE_ORDER = `${PROJECT}/assets/assets.order.image.json`;

const privilegedFs = vi.hoisted(() => ({
    writeFileNoFollowOrCreate: vi.fn(),
    requestWrite: vi.fn(),
    requestRead: vi.fn(),
}));

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({}),
    getPrivilegedInterface: () => ({ fs: privilegedFs }),
}));

const disk = new Map<string, string>();

function createContext() {
    const filesystem = new FileSystemService();
    return {
        project: {
            resolve: (...parts: (string | string[])[]) =>
                [PROJECT, ...parts.flatMap(part => (Array.isArray(part) ? part : [part]))].join("/"),
        },
        services: {
            get(serviceId: Services) {
                if (serviceId === Services.FileSystem) {
                    return filesystem;
                }
                throw new Error(`Unexpected service ${serviceId}`);
            },
        },
    } as never;
}

/** Paths the host was actually asked to write, in order. */
function hostWrites(): string[] {
    return privilegedFs.writeFileNoFollowOrCreate.mock.calls.map(call => call[1] as string);
}

describe("AssetOrderManager takes the no-grant write route", () => {
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
        // Every order file absent, which is what the first open of a project that predates the
        // shard sees - and the only state in which `missingCategories` has anything in it.
        privilegedFs.requestRead.mockResolvedValue({
            success: true,
            data: { ok: false, error: { code: FsRejectErrorCode.NOT_FOUND, message: "missing" } },
        });
    });

    afterEach(() => {
        thawProjectWrites();
    });

    it("creates the shard without asking for a write grant", async () => {
        const manager = await new AssetOrderManager(createContext()).init();
        expect(manager.listMissingCategories()).toContain(AssetCategory.Image);

        const result = await manager.write(AssetCategory.Image, ["a", "b"], []);

        expect(result.ok).toBe(true);
        expect(hostWrites()).toEqual([IMAGE_ORDER]);
        expect(JSON.parse(disk.get(IMAGE_ORDER)!)).toEqual({ assetIds: ["a", "b"], groupIds: [] });
        // The whole point of the change: the grant round trip and the protocol PUT are gone.
        expect(privilegedFs.requestWrite).not.toHaveBeenCalled();
        // The file is on the disk now, so the category is no longer owed.
        expect(manager.listMissingCategories()).not.toContain(AssetCategory.Image);
    });

    /**
     * The load-bearing one. If `refused` stopped reaching this service, the assertion below flips:
     * the category would be struck off having never been written. Replacing `FROZEN_NO_OP` with a
     * bare `{ok: true}` fails exactly this test.
     */
    it("still owes a category whose shard the freeze latch refused, and settles it after the thaw", async () => {
        const manager = await new AssetOrderManager(createContext()).init();
        freezeProjectWrites({ projectPath: PROJECT, reason: { kind: "manual" } });

        const refusedResult = await manager.write(AssetCategory.Image, ["a"], []);

        // A refusal is `ok` - it is not reported to the author as a failure - but nothing was
        // written, and the service must not believe otherwise.
        expect(refusedResult.ok).toBe(true);
        expect(refusedResult.ok && refusedResult.refused).toBe(true);
        expect(hostWrites()).toEqual([]);
        expect(manager.listMissingCategories()).toContain(AssetCategory.Image);

        thawProjectWrites();
        await manager.write(AssetCategory.Image, ["a"], []);

        expect(hostWrites()).toEqual([IMAGE_ORDER]);
        expect(manager.listMissingCategories()).not.toContain(AssetCategory.Image);
    });

    /**
     * The second load-bearing one, and it is what makes the asset library shareable at all.
     *
     * `AssetsService.markDirty` queues this shard beside the metadata shard on every record edit -
     * because adding or removing an asset moves the order too - but renaming one does not, and
     * neither does filing it in a folder. A live session leaves the metadata shard writable and this
     * one refused, and a refusal is announced to the author as work that was not saved. Without the
     * skip, every rename inside a session raises "could not save" about a file that did not change.
     */
    it("writes nothing when the order it is handed is the order it already holds", async () => {
        const manager = await new AssetOrderManager(createContext()).init();
        await manager.write(AssetCategory.Image, ["a", "b"], ["g1"]);
        expect(hostWrites()).toEqual([IMAGE_ORDER]);

        await manager.write(AssetCategory.Image, ["a", "b"], ["g1"]);
        await manager.write(AssetCategory.Image, ["a", "b"], ["g1"]);

        // Still one: the two later calls are what a rename inside a session produces.
        expect(hostWrites()).toEqual([IMAGE_ORDER]);

        // And a real move still writes, which is the half a skip must not swallow.
        await manager.write(AssetCategory.Image, ["b", "a"], ["g1"]);
        expect(hostWrites()).toEqual([IMAGE_ORDER, IMAGE_ORDER]);
    });

    it("never skips a category whose shard is not on the disk yet", async () => {
        // "The same as what I hold" is not "the same as what is there" when there is nothing there:
        // this manager starts holding an empty order for every category, and a project whose file is
        // absent would otherwise never get one written.
        const manager = await new AssetOrderManager(createContext()).init();
        expect(manager.listMissingCategories()).toContain(AssetCategory.Image);

        await manager.write(AssetCategory.Image, [], []);

        expect(hostWrites()).toEqual([IMAGE_ORDER]);
        expect(manager.listMissingCategories()).not.toContain(AssetCategory.Image);
    });

    it("still owes a category whose shard failed for real, and reports the failure", async () => {
        const manager = await new AssetOrderManager(createContext()).init();
        privilegedFs.writeFileNoFollowOrCreate.mockResolvedValue({
            success: true,
            // What a symlinked or hard-linked shard now answers, where the grant route wrote through.
            data: { ok: false, error: { code: FsRejectErrorCode.INVALID_PATH, message: "unsafe file path" } },
        });

        const result = await manager.write(AssetCategory.Image, ["a"], []);

        expect(result.ok).toBe(false);
        expect(!result.ok && result.error.code).toBe(FsRejectErrorCode.INVALID_PATH);
        expect(manager.listMissingCategories()).toContain(AssetCategory.Image);
    });
});
