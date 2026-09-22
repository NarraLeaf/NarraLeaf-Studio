import os from "os";
import path from "path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { ARCHIVE_NAMED_FILES, unsimulatedFs, writeArchiveNamedTree } from "./asarPatchSimulation";
import { Fs } from "./fs";

// Electron's asar patch, reproduced: see asarPatchSimulation.ts. Without it this file would pass
// against a `Fs` that still went through the patched module, because plain node has no patch.
vi.mock("fs", async () => (await import("./asarPatchSimulation")).simulatedFsModule());
vi.mock("fs/promises", async () => (await import("./asarPatchSimulation")).simulatedFsPromisesModule());
afterAll(async () => (await import("./asarPatchSimulation")).restoreOriginalFs());

const roots: string[] = [];

afterEach(() => {
    for (const root of roots.splice(0)) {
        unsimulatedFs.rmSync(root, { recursive: true, force: true });
    }
});

function scratch(): string {
    const root = unsimulatedFs.mkdtempSync(path.join(os.tmpdir(), "nls-fs-asar-"));
    roots.push(root);
    return root;
}

/**
 * `Fs` is what the renderer's file-system facade, the `app://fs` protocol and document storage all
 * reach the disk through, so every path here is one an author's project or an author's pick can put
 * a file named like an archive on.
 */
describe("Fs over author files named like archives", () => {
    it("reports an archive-named file as a file of its real size", async () => {
        const root = scratch();
        const bytes = writeArchiveNamedTree(root);

        const stat = await Fs.stat(path.join(root, "bundle.asar"));
        expect(stat).toEqual({ ok: true, data: { name: "bundle", ext: ".asar", type: "file" } });
        const details = await Fs.details(path.join(root, "bundle.asar"));
        expect(details.ok && details.data.size).toBe(bytes["bundle.asar"].length);
        expect(await Fs.isFile(path.join(root, "bundle.asar"))).toEqual({ ok: true, data: true });
        expect(await Fs.isDir(path.join(root, "old.asar"))).toEqual({ ok: true, data: true });
    });

    it("reads the bytes of each, and totals them into a directory's size", async () => {
        const root = scratch();
        const bytes = writeArchiveNamedTree(root);

        for (const relative of ARCHIVE_NAMED_FILES) {
            const read = await Fs.readRaw(path.join(root, ...relative.split("/")));
            expect(read.ok && read.data.equals(bytes[relative])).toBe(true);
        }
        const size = await Fs.directorySize(root);
        expect(size.bytesByRelativePath).toEqual(Object.fromEntries(
            ARCHIVE_NAMED_FILES.map(relative => [relative, bytes[relative].length]),
        ));
    });

    it("copies a file and a whole tree byte for byte", async () => {
        const root = scratch();
        const bytes = writeArchiveNamedTree(path.join(root, "source"));

        expect((await Fs.cpFile(path.join(root, "source", "bundle.asar"), path.join(root, "copied.asar"))).ok).toBe(true);
        expect(unsimulatedFs.readFileSync(path.join(root, "copied.asar")).equals(bytes["bundle.asar"])).toBe(true);

        expect((await Fs.copyDir(path.join(root, "source"), path.join(root, "tree"))).ok).toBe(true);
        for (const relative of ARCHIVE_NAMED_FILES) {
            const copied = unsimulatedFs.readFileSync(path.join(root, "tree", ...relative.split("/")));
            expect(copied.equals(bytes[relative])).toBe(true);
        }
    });

    it("makes and writes into a folder named like an archive that is not there yet", async () => {
        const root = scratch();
        const target = path.join(root, "made.asar", "deeper", "doc.json");

        expect((await Fs.createDir(path.dirname(target))).ok).toBe(true);
        expect((await Fs.write(target, "{}")).ok).toBe(true);
        expect(await Fs.read(target)).toEqual({ ok: true, data: "{}" });
    });

    it("deletes an archive-named file and a tree holding one", async () => {
        const root = scratch();
        writeArchiveNamedTree(path.join(root, "tree"));

        expect((await Fs.deleteFile(path.join(root, "tree", "bundle.asar"))).ok).toBe(true);
        writeArchiveNamedTree(path.join(root, "tree"));
        expect((await Fs.deleteDir(path.join(root, "tree"))).ok).toBe(true);
        expect(unsimulatedFs.existsSync(path.join(root, "tree"))).toBe(false);
    });
});
