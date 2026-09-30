import fs from "fs";
import fsPromises from "fs/promises";
import os from "os";
import path from "path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { unsimulatedFs } from "./asarPatchSimulation";
import { unpatchedFs, unpatchedFsPromises } from "./unpatchedFs";

vi.mock("fs", async () => (await import("./asarPatchSimulation")).simulatedFsModule());
vi.mock("fs/promises", async () => (await import("./asarPatchSimulation")).simulatedFsPromisesModule());
afterAll(async () => (await import("./asarPatchSimulation")).restoreOriginalFs());

const roots: string[] = [];

afterEach(() => {
    for (const root of roots.splice(0)) {
        unsimulatedFs.rmSync(root, { recursive: true, force: true });
    }
});

/** A folder holding a file named like an archive and a folder named like one. */
function scratch(): { root: string; archive: string; folder: string } {
    const root = unsimulatedFs.mkdtempSync(path.join(os.tmpdir(), "nls-asar-sim-"));
    roots.push(root);
    const archive = path.join(root, "bundle.asar");
    unsimulatedFs.writeFileSync(archive, "archive bytes");
    const folder = path.join(root, "old.asar");
    unsimulatedFs.mkdirSync(folder);
    unsimulatedFs.writeFileSync(path.join(folder, "note.txt"), "a note");
    return { root, archive, folder };
}

/**
 * The simulation has to fail where Electron fails, or the tests built on it prove nothing: each case
 * here is one of the behaviours measured against Electron 38 (listed in `unpatchedFs.ts`).
 */
describe("the simulated asar patch", () => {
    it("reads an archive-named file as a directory it cannot open", async () => {
        const { archive } = scratch();

        const stats = await fsPromises.stat(archive);
        expect(stats.isDirectory()).toBe(true);
        expect(stats.size).toBe(0);
        await expect(fsPromises.readFile(archive)).rejects.toThrow(`ENOENT,  not found in ${archive}`);
        await expect(fsPromises.copyFile(archive, `${archive}.copy`)).rejects.toThrow("not found in");
        expect(() => fs.readFileSync(archive)).toThrow("not found in");
        expect(await fsPromises.readdir(archive)).toEqual([]);
    });

    it("leaves a folder named like an archive alone while it exists", async () => {
        const { folder } = scratch();

        expect((await fsPromises.stat(folder)).isDirectory()).toBe(true);
        await expect(fsPromises.readFile(path.join(folder, "note.txt"), "utf8")).resolves.toBe("a note");
    });

    it("cannot make a folder below one named like an archive that is not there yet", async () => {
        const { root } = scratch();

        await expect(fsPromises.mkdir(path.join(root, "new.asar", "sub"), { recursive: true })).rejects.toMatchObject({ code: "ENOTDIR" });
    });

    it("remembers a folder it first saw missing as a broken archive", async () => {
        const { root } = scratch();
        const later = path.join(root, "later.asar");

        await expect(fsPromises.stat(later)).rejects.toThrow("Invalid package");
        unsimulatedFs.mkdirSync(later);
        unsimulatedFs.writeFileSync(path.join(later, "f.txt"), "f");
        await expect(fsPromises.readFile(path.join(later, "f.txt"), "utf8")).rejects.toThrow("Invalid package");
    });

    it("will not delete or copy a tree holding an archive", async () => {
        const { root, archive } = scratch();

        await expect(fsPromises.rm(archive, { force: true })).rejects.toMatchObject({ code: "ERR_FS_EISDIR" });
        await expect(fsPromises.cp(root, `${root}-copy`, { recursive: true })).rejects.toThrow("Invalid package");
        roots.push(`${root}-copy`);
        await expect(fsPromises.rm(root, { recursive: true, force: true })).rejects.toMatchObject({ code: "EBUSY" });
    });
});

/**
 * The seam every other asar test relies on: with the patch in place, `unpatchedFs` is node's own
 * `fs` rather than the patched one, exactly as `original-fs` is inside Electron.
 */
describe("unpatchedFs under the simulated patch", () => {
    it("resolves to original-fs, not to the patched module", () => {
        expect(unpatchedFs).toBe(unsimulatedFs);
        expect(unpatchedFs).not.toBe(fs);
        expect(unpatchedFsPromises).not.toBe(fsPromises);
    });

    it("reads the archive-named file and the folder named like one as what they are", async () => {
        const { root, archive, folder } = scratch();

        const stats = await unpatchedFsPromises.stat(archive);
        expect(stats.isFile()).toBe(true);
        await expect(unpatchedFsPromises.readFile(archive, "utf8")).resolves.toBe("archive bytes");
        await unpatchedFsPromises.cp(root, `${root}-copy`, { recursive: true });
        roots.push(`${root}-copy`);
        expect(unsimulatedFs.readFileSync(path.join(`${root}-copy`, "bundle.asar"), "utf8")).toBe("archive bytes");
        expect(unsimulatedFs.readFileSync(path.join(`${root}-copy`, "old.asar", "note.txt"), "utf8")).toBe("a note");
        expect(unsimulatedFs.existsSync(folder)).toBe(true);
    });
});
