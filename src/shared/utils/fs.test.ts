import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ATOMIC_WRITE_TEMP_PATTERN, Fs } from "./fs";
import { FsRejectErrorCode } from "../types/os";

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

/**
 * The atomic writer. These pin the two things that are easy to break while "just" swapping the
 * implementation body: that the target is *replaced* rather than truncated in place (the whole
 * point), and that `writeFileNoFollow` keeps refusing the paths it used to refuse (its `lstat` gate
 * is a rejection contract, and a rename would happily satisfy any of them).
 */
describe("Fs atomic writes", () => {
    const isWindows = process.platform === "win32";
    let root: string;

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), "nls-atomic-"));
    });

    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    it("replaces the file instead of truncating it in place", async () => {
        // The load-bearing assertion: `fs.writeFile` reuses the inode, a rename does not. If this
        // one passes against a truncating implementation, the atomicity is not there.
        const target = join(root, "doc.json");
        await writeFile(target, "old contents");
        const before = await stat(target);

        const result = await Fs.write(target, "new contents");

        expect(result.ok).toBe(true);
        expect(await readFile(target, "utf-8")).toBe("new contents");
        if (!isWindows) {
            expect((await stat(target)).ino).not.toBe(before.ino);
        }
    });

    it("leaves no scratch file behind, and anything transient carries the watcher-filtered suffix", async () => {
        const target = join(root, "big.json");
        // Big enough that the scratch sibling is usually observable mid-write. The assertion is
        // conditional on catching it, so a fast disk skips it rather than failing.
        const payload = "x".repeat(24 * 1024 * 1024);

        const writing = Fs.write(target, payload);
        const seen = new Set<string>();
        for (let poll = 0; poll < 40; poll++) {
            for (const entry of await readdir(root)) seen.add(entry);
            await new Promise(resolve => setTimeout(resolve, 1));
        }
        expect((await writing).ok).toBe(true);

        for (const entry of seen) {
            if (entry === "big.json") continue;
            expect(entry).toMatch(ATOMIC_WRITE_TEMP_PATTERN);
        }
        expect(await readdir(root)).toEqual(["big.json"]);
        expect((await readFile(target, "utf-8")).length).toBe(payload.length);
    });

    it("keeps the permissions of the file it replaced", async () => {
        if (isWindows) return; // POSIX modes are not meaningful here
        const target = join(root, "restricted.json");
        await writeFile(target, "{}");
        await chmod(target, 0o640);

        expect((await Fs.write(target, "{\"a\":1}")).ok).toBe(true);

        expect((await stat(target)).mode & 0o777).toBe(0o640);
    });

    it("gives a brand new file the same mode fs.writeFile would have", async () => {
        if (isWindows) return;
        // Compared against a real `fs.writeFile` rather than a hard-coded 0o644, so the test tracks
        // the umask of whatever host it runs on instead of asserting this machine's.
        const control = join(root, "control.json");
        await writeFile(control, "{}");
        const subject = join(root, "subject.json");

        expect((await Fs.write(subject, "{}")).ok).toBe(true);

        expect((await stat(subject)).mode & 0o777).toBe((await stat(control)).mode & 0o777);
    });

    it("writes through a symlink rather than replacing it, as the truncating write did", async () => {
        if (isWindows) return;
        const real = join(root, "real.json");
        const link_ = join(root, "link.json");
        await writeFile(real, "old");
        try {
            await symlink(real, link_);
        } catch {
            return; // no symlink privilege on this host
        }

        expect((await Fs.write(link_, "new")).ok).toBe(true);

        expect((await lstat(link_)).isSymbolicLink()).toBe(true);
        expect(await readFile(real, "utf-8")).toBe("new");
    });

    it("round-trips a payload larger than a single write syscall", async () => {
        const target = join(root, "large.bin");
        const payload = Buffer.alloc(8 * 1024 * 1024, 7);

        expect((await Fs.writeRaw(target, payload)).ok).toBe(true);

        expect(Buffer.compare(await readFile(target), payload)).toBe(0);
    });

    it("refuses to write over a directory", async () => {
        const target = join(root, "adirectory");
        await mkdir(target);

        const result = await Fs.write(target, "nope");

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe(FsRejectErrorCode.NOT_A_FILE);
        expect((await stat(target)).isDirectory()).toBe(true);
    });

    describe("writeFileNoFollow keeps its rejection contract", () => {
        it("still refuses a symlink", async () => {
            if (isWindows) return;
            const real = join(root, "real.json");
            const link_ = join(root, "link.json");
            await writeFile(real, "original");
            try {
                await symlink(real, link_);
            } catch {
                return;
            }

            const result = await Fs.writeFileNoFollow(link_, "attacker");

            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.error.code).toBe(FsRejectErrorCode.INVALID_PATH);
            // Neither written through nor replaced.
            expect(await readFile(real, "utf-8")).toBe("original");
            expect((await lstat(link_)).isSymbolicLink()).toBe(true);
        });

        it("still refuses a hard-linked file", async () => {
            if (isWindows) return;
            const target = join(root, "shared.json");
            await writeFile(target, "original");
            try {
                await link(target, join(root, "other-name.json"));
            } catch {
                return;
            }

            const result = await Fs.writeFileNoFollow(target, "changed");

            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.error.code).toBe(FsRejectErrorCode.INVALID_PATH);
            expect(await readFile(target, "utf-8")).toBe("original");
        });

        it("still refuses a file that does not exist", async () => {
            const result = await Fs.writeFileNoFollow(join(root, "absent.json"), "{}");

            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.error.code).toBe(FsRejectErrorCode.NOT_FOUND);
        });

        it("writes an ordinary file atomically", async () => {
            const target = join(root, "shard.json");
            await writeFile(target, "{}");
            const before = await stat(target);

            expect((await Fs.writeFileNoFollow(target, "{\"a\":1}")).ok).toBe(true);

            expect(await readFile(target, "utf-8")).toBe("{\"a\":1}");
            if (!isWindows) expect((await stat(target)).ino).not.toBe(before.ino);
            expect(await readdir(root)).toEqual(["shard.json"]);
        });
    });

    /**
     * The create-capable sibling, which is what a document service needs: the same rejection
     * contract for a path that exists, plus the one case `writeFileNoFollow` cannot serve - the file
     * is not there yet, on the first open of a project that predates it.
     *
     * The pair of "refuses" tests below is the whole cost of taking the story writers off the write
     * grant: `Fs.write` would have followed the symlink and written through it, and would not have
     * looked at the link count at all. Both refusals are asserted on **every** platform this runs
     * on, not just POSIX - a hard link needs no privilege on NTFS, and the whole question "is the
     * contract acceptable on Windows" is answered by whether these hold there.
     */
    describe("writeFileNoFollowOrCreate", () => {
        it("creates the file when it is absent, leaving no scratch behind", async () => {
            const target = join(root, "fresh.json");

            const result = await Fs.writeFileNoFollowOrCreate(target, "{\"new\":true}");

            expect(result.ok).toBe(true);
            expect(await readFile(target, "utf-8")).toBe("{\"new\":true}");
            expect(await readdir(root)).toEqual(["fresh.json"]);
        });

        it("replaces an existing file rather than truncating it", async () => {
            const target = join(root, "doc.json");
            await writeFile(target, "old");
            const before = await stat(target);

            expect((await Fs.writeFileNoFollowOrCreate(target, "new")).ok).toBe(true);

            expect(await readFile(target, "utf-8")).toBe("new");
            if (!isWindows) expect((await stat(target)).ino).not.toBe(before.ino);
        });

        it("refuses a symlink instead of writing through it", async () => {
            const real = join(root, "real.json");
            const link_ = join(root, "link.json");
            await writeFile(real, "original");
            try {
                await symlink(real, link_);
            } catch {
                // Unprivileged Windows cannot create one (EPERM without Developer Mode), which is
                // also why nothing puts one in a project tree there.
                return;
            }

            const result = await Fs.writeFileNoFollowOrCreate(link_, "attacker");

            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.error.code).toBe(FsRejectErrorCode.INVALID_PATH);
            expect(await readFile(real, "utf-8")).toBe("original");
            expect((await lstat(link_)).isSymbolicLink()).toBe(true);
        });

        it("refuses a hard-linked file, on Windows too", async () => {
            const target = join(root, "shared.json");
            await writeFile(target, "original");
            try {
                await link(target, join(root, "other-name.json"));
            } catch {
                return; // filesystem without hard links (FAT, some network shares)
            }
            // The gate is the link count, and it has to be readable here or the refusal is vacuous.
            expect((await lstat(target)).nlink).toBe(2);

            const result = await Fs.writeFileNoFollowOrCreate(target, "changed");

            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.error.code).toBe(FsRejectErrorCode.INVALID_PATH);
            expect(await readFile(target, "utf-8")).toBe("original");
        });

        it("refuses a directory", async () => {
            const target = join(root, "adir");
            await mkdir(target);

            const result = await Fs.writeFileNoFollowOrCreate(target, "nope");

            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.error.code).toBe(FsRejectErrorCode.INVALID_PATH);
            expect((await stat(target)).isDirectory()).toBe(true);
        });

        /**
         * The answer the write-grant route used to give from `allocateWrite`, which stat'd the
         * parent before minting a URL. `StoryService.ensureDir` accepts a stale "this directory
         * exists" on the strength of the write failing loudly if it does not.
         */
        it("reports NOT_FOUND when the parent directory is gone", async () => {
            const result = await Fs.writeFileNoFollowOrCreate(join(root, "missing-dir", "doc.json"), "{}");

            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.error.code).toBe(FsRejectErrorCode.NOT_FOUND);
        });
    });

    /**
     * The verb a lock file is built on: only one caller may come away believing it wrote the file.
     *
     * The neighbours cannot answer that question. `ensureRegularFile` performs the same `wx` create
     * and reports nothing about which branch it took, so two callers both read success; the atomic
     * writers replace whatever is there, which for a claim is the failure itself.
     */
    describe("createFileExclusive", () => {
        it("creates the file and says it was the one that did", async () => {
            const target = join(root, "session.lock");

            const result = await Fs.createFileExclusive(target, "mine");

            expect(result).toEqual({ ok: true, data: true });
            expect(await readFile(target, "utf-8")).toBe("mine");
        });

        it("writes nothing over a file that is already there, and says so", async () => {
            const target = join(root, "session.lock");
            await writeFile(target, "theirs");

            const result = await Fs.createFileExclusive(target, "mine");

            expect(result).toEqual({ ok: true, data: false });
            expect(await readFile(target, "utf-8")).toBe("theirs");
        });

        it("hands the file to exactly one of many callers racing for it", async () => {
            const target = join(root, "session.lock");

            const results = await Promise.all(
                Array.from({ length: 8 }, (_, index) => Fs.createFileExclusive(target, `writer-${index}`)),
            );

            expect(results.filter(result => result.ok && result.data)).toHaveLength(1);
            expect(results.every(result => result.ok)).toBe(true);
        });

        it("reports a path it could not write rather than claiming it", async () => {
            const result = await Fs.createFileExclusive(join(root, "missing-dir", "session.lock"), "mine");

            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.error.code).toBe(FsRejectErrorCode.NOT_FOUND);
        });
    });
});
