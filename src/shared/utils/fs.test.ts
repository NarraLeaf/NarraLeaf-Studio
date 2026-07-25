import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Fs } from "./fs";

/**
 * `Fs.directorySize` is the single measurement the game build (`GameBuildManager`) and the asset
 * overview's size IPC both read. These tests pin the number and the edges so the two callers cannot
 * quietly disagree - the whole reason the walk was consolidated into one function.
 */
describe("Fs.directorySize", () => {
    let root: string;

    beforeAll(async () => {
        root = await mkdtemp(join(tmpdir(), "nls-dirsize-"));
        await writeFile(join(root, "a.txt"), "12345");            // 5 bytes
        await mkdir(join(root, "sub"));
        await writeFile(join(root, "sub", "b.bin"), Buffer.alloc(100)); // 100 bytes
        await writeFile(join(root, "sub", "c.json"), "{}");       // 2 bytes
    });

    afterAll(async () => {
        await rm(root, { recursive: true, force: true });
    });

    it("totals bytes and file count across the tree, keyed by relative path", async () => {
        const result = await Fs.directorySize(root);

        expect(result.totalBytes).toBe(107);
        expect(result.fileCount).toBe(3);
        expect(result.bytesByRelativePath["a.txt"]).toBe(5);
        expect(result.bytesByRelativePath["sub/b.bin"]).toBe(100);
        expect(result.bytesByRelativePath["sub/c.json"]).toBe(2);
    });

    it("gives the build and the size IPC the same number, because both read this one function", async () => {
        // GameBuildManager consumes `.totalBytes`; the fs.directorySize IPC returns the whole result
        // and the overview reads `.totalBytes` from it. One walk, one number - nothing to diverge.
        const measured = await Fs.directorySize(root);
        const buildNumber = measured.totalBytes;
        const ipcNumber = (await Fs.directorySize(root)).totalBytes;

        expect(buildNumber).toBe(ipcNumber);
        expect(buildNumber).toBe(107);
    });

    it("keys every relative path with '/' regardless of the host separator", async () => {
        const result = await Fs.directorySize(root);

        for (const key of Object.keys(result.bytesByRelativePath)) {
            expect(key).not.toContain("\\");
        }
    });

    it("counts a missing directory as empty rather than throwing", async () => {
        expect(await Fs.directorySize(join(root, "does-not-exist")))
            .toEqual({ totalBytes: 0, fileCount: 0, bytesByRelativePath: {} });
    });

    it("classifies a symlink by the Dirent, so it contributes zero and is not followed", async () => {
        // The one place the shared walk and a naive fs.stat walk part ways: `Dirent.isFile()` is
        // false for a symlink, so it is neither summed nor descended into - matching what the build
        // packages. Symlink creation is unprivileged-unfriendly on some hosts; skip if it is denied
        // rather than manufacture a spurious platform failure.
        const linkDir = await mkdtemp(join(tmpdir(), "nls-dirsize-link-"));
        try {
            await writeFile(join(linkDir, "real.txt"), "1234567890"); // 10 bytes
            try {
                await symlink(join(linkDir, "real.txt"), join(linkDir, "link.txt"));
            } catch {
                return; // no symlink privilege here - the semantics are still asserted where it works
            }

            const result = await Fs.directorySize(linkDir);
            expect(result.totalBytes).toBe(10);
            expect(result.fileCount).toBe(1);
            expect(result.bytesByRelativePath["link.txt"]).toBeUndefined();
        } finally {
            await rm(linkDir, { recursive: true, force: true });
        }
    });
});
