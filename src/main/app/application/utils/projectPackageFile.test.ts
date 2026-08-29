import fs from "fs/promises";
import os from "os";
import path from "path";
import msgpack from "msgpack-lite";
import { afterEach, describe, expect, it } from "vitest";
import {
    PROJECT_PACKAGE_BODY_OFFSET,
    PROJECT_PACKAGE_FORMAT,
    PROJECT_PACKAGE_FORMAT_VERSION,
    PROJECT_PACKAGE_LEGACY_VERSION,
    decodeProjectPackageIndex,
    readProjectPackageVersion,
} from "@shared/utils/projectPackage";
import { readProjectPackageInto, writeProjectPackage } from "./projectPackageFile";

const roots: string[] = [];

async function scratch(name: string): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), `nlspkg-${name}-`));
    roots.push(root);
    return root;
}

afterEach(async () => {
    await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

async function write(root: string, relativePath: string, data: string | Uint8Array): Promise<void> {
    const target = path.join(root, ...relativePath.split("/"));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data);
}

/** A project with one of everything the writer has to get right. */
async function sampleProject(): Promise<string> {
    const root = await scratch("project");
    await write(root, "Demo.nlproj", "config");
    await write(root, "editor/ui/uidoc.json", "{}");
    await write(root, "assets/content/big.bin", new Uint8Array(512 * 1024).fill(0xa7));
    await write(root, "assets/content/empty.bin", new Uint8Array(0));
    await fs.mkdir(path.join(root, "assets", "unused"), { recursive: true });
    // Left out by the walk, and the counts have to say so.
    await write(root, "dist/win-unpacked/resources/app.asar", "a build");
    await write(root, ".nlstudio/cache/state.json", "{}");
    return root;
}

async function exportSample(): Promise<{ projectRoot: string; packagePath: string; result: Awaited<ReturnType<typeof writeProjectPackage>> }> {
    const projectRoot = await sampleProject();
    const packagePath = path.join(await scratch("out"), "Demo.nlspkg");
    const result = await writeProjectPackage({
        projectRoot,
        packagePath,
        projectName: "Demo",
        projectIdentifier: "com.example.demo",
        createdAt: "2026-01-01T00:00:00.000Z",
    });
    return { projectRoot, packagePath, result };
}

async function listFiles(root: string): Promise<string[]> {
    const found: string[] = [];
    async function walk(dir: string): Promise<void> {
        for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
            const absolute = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(absolute);
                continue;
            }
            found.push(path.relative(root, absolute).split(path.sep).join("/"));
        }
    }
    await walk(root);
    return found.sort();
}

describe("writing a project package", () => {
    it("carries the project's files and leaves out its caches and builds", async () => {
        const { result, packagePath } = await exportSample();

        expect(result.fileCount).toBe(4);
        expect(result.skippedCount).toBe(2);
        expect((await fs.stat(packagePath)).size).toBe(result.byteLength);
        expect(readProjectPackageVersion(await fs.readFile(packagePath))).toBe(PROJECT_PACKAGE_FORMAT_VERSION);
    });

    /**
     * The property the whole format exists for: a file's bytes sit in the package verbatim, at an
     * offset the index gives, so neither writing nor reading one has to hold the project in memory.
     */
    it("stores each file verbatim at the offset its index gives", async () => {
        const { projectRoot, packagePath } = await exportSample();
        const bytes = await fs.readFile(packagePath);

        const indexLength = bytes.readUInt32LE(bytes.length - 4);
        const indexAt = bytes.length - 4 - indexLength;
        const index = decodeProjectPackageIndex(
            bytes.subarray(indexAt, bytes.length - 4),
            indexAt - PROJECT_PACKAGE_BODY_OFFSET,
        );

        expect(index.projectIdentifier).toBe("com.example.demo");
        expect(index.directories).toContain("assets/unused");
        // The order the walk settled on, which is the order the offsets follow.
        expect(index.files.map(entry => entry.path)).toEqual([
            "assets/content/big.bin",
            "assets/content/empty.bin",
            "Demo.nlproj",
            "editor/ui/uidoc.json",
        ]);

        let offset = PROJECT_PACKAGE_BODY_OFFSET;
        for (const entry of index.files) {
            const onDisk = await fs.readFile(path.join(projectRoot, ...entry.path.split("/")));
            expect(entry.size).toBe(onDisk.length);
            expect(bytes.subarray(offset, offset + entry.size).equals(onDisk)).toBe(true);
            offset += entry.size;
        }
        expect(offset).toBe(indexAt);
    });

    it("never overwrites a package that is already there", async () => {
        const { packagePath } = await exportSample();
        const before = await fs.readFile(packagePath);
        const projectRoot = await sampleProject();

        await expect(writeProjectPackage({
            projectRoot,
            packagePath,
            projectName: "Demo",
            createdAt: "2026-01-01T00:00:00.000Z",
        })).rejects.toThrow();

        // The refusal must not take the earlier export with it - the cleanup only removes a file
        // this call created.
        expect((await fs.readFile(packagePath)).equals(before)).toBe(true);
    });

    // A file the walk found and the copy cannot open. POSIX only: Windows has no mode bit that
    // stops the owning process from reading its own file.
    it.skipIf(process.platform === "win32")("leaves nothing behind when a file cannot be read", async () => {
        const projectRoot = await sampleProject();
        const packagePath = path.join(await scratch("out"), "Demo.nlspkg");
        await fs.chmod(path.join(projectRoot, "editor", "ui", "uidoc.json"), 0o000);

        await expect(writeProjectPackage({
            projectRoot,
            packagePath,
            projectName: "Demo",
            createdAt: "2026-01-01T00:00:00.000Z",
        })).rejects.toThrow("editor/ui/uidoc.json");

        await expect(fs.stat(packagePath)).rejects.toThrow();
    });
});

describe("reading a project package", () => {
    it("puts the project back the way it was", async () => {
        const { projectRoot, packagePath } = await exportSample();
        const target = await scratch("import");

        const result = await readProjectPackageInto(packagePath, target);

        expect(result.projectName).toBe("Demo");
        expect(result.fileCount).toBe(4);
        expect(await listFiles(target)).toEqual([
            "Demo.nlproj",
            "assets/content/big.bin",
            "assets/content/empty.bin",
            "editor/ui/uidoc.json",
        ]);
        for (const relativePath of await listFiles(target)) {
            const expected = await fs.readFile(path.join(projectRoot, ...relativePath.split("/")));
            const actual = await fs.readFile(path.join(target, ...relativePath.split("/")));
            expect(actual.equals(expected)).toBe(true);
        }
        // An empty folder is part of a project's shape, so it comes back empty rather than missing.
        expect((await fs.stat(path.join(target, "assets", "unused"))).isDirectory()).toBe(true);
    });

    it("refuses a folder that already holds something", async () => {
        const { packagePath } = await exportSample();
        const target = await scratch("import");
        await fs.writeFile(path.join(target, "in-the-way.txt"), "x");

        await expect(readProjectPackageInto(packagePath, target)).rejects.toThrow("must be empty");
    });

    it("refuses a truncated package instead of reading past its end", async () => {
        const { packagePath } = await exportSample();
        const bytes = await fs.readFile(packagePath);
        const cut = path.join(await scratch("cut"), "Demo.nlspkg");
        await fs.writeFile(cut, bytes.subarray(0, bytes.length - 64));

        await expect(readProjectPackageInto(cut, await scratch("import"))).rejects.toThrow();
    });

    it("refuses a file that is not a package", async () => {
        const notAPackage = path.join(await scratch("junk"), "notes.txt");
        await fs.writeFile(notAPackage, "hello");

        await expect(readProjectPackageInto(notAPackage, await scratch("import")))
            .rejects.toThrow("not a NarraLeaf Studio project package");
    });

    /**
     * A package is an archive, and an archive can carry a path that points outside the folder it is
     * being unpacked into. Studio never writes one, so this is written by hand.
     */
    it("refuses an entry whose path escapes the import folder", async () => {
        const hostile = path.join(await scratch("hostile"), "Demo.nlspkg");
        const body = Buffer.from("owned");
        const index = msgpack.encode({
            format: PROJECT_PACKAGE_FORMAT,
            version: PROJECT_PACKAGE_FORMAT_VERSION,
            createdAt: "",
            projectName: "Hostile",
            directories: [],
            files: [{ path: "../escaped.txt", size: body.length }],
        });
        const trailer = Buffer.alloc(4);
        trailer.writeUInt32LE(index.length, 0);
        await fs.writeFile(hostile, Buffer.concat([
            Buffer.from([0x4e, 0x4c, 0x53, 0x50, 0x4b, 0x47, 0x00, PROJECT_PACKAGE_FORMAT_VERSION]),
            body,
            Buffer.from(index),
            trailer,
        ]));

        await expect(readProjectPackageInto(hostile, await scratch("import"))).rejects.toThrow("unsafe segments");
    });

    it("still unpacks a version 1 package", async () => {
        const legacy = path.join(await scratch("legacy"), "Old.nlspkg");
        const body = msgpack.encode({
            format: PROJECT_PACKAGE_FORMAT,
            version: PROJECT_PACKAGE_LEGACY_VERSION,
            createdAt: "2026-01-01T00:00:00.000Z",
            projectName: "Old",
            directories: ["assets"],
            files: [
                { path: "Old.nlproj", data: Buffer.from("config") },
                { path: "assets/one.bin", data: Buffer.from([1, 2, 3]) },
            ],
        });
        await fs.writeFile(legacy, Buffer.concat([
            Buffer.from([0x4e, 0x4c, 0x53, 0x50, 0x4b, 0x47, 0x00, PROJECT_PACKAGE_LEGACY_VERSION]),
            Buffer.from(body),
        ]));

        const target = await scratch("import");
        const result = await readProjectPackageInto(legacy, target);

        expect(result.projectName).toBe("Old");
        expect(result.fileCount).toBe(2);
        expect(await listFiles(target)).toEqual(["Old.nlproj", "assets/one.bin"]);
        expect(await fs.readFile(path.join(target, "Old.nlproj"), "utf-8")).toBe("config");
    });
});
