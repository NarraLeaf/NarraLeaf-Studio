import msgpack from "msgpack-lite";
import { describe, expect, it } from "vitest";
import {
    PROJECT_PACKAGE_BODY_OFFSET,
    PROJECT_PACKAGE_FORMAT,
    PROJECT_PACKAGE_FORMAT_VERSION,
    PROJECT_PACKAGE_LEGACY_VERSION,
    ProjectPackageIndex,
    decodeProjectPackage,
    decodeProjectPackageIndex,
    encodeProjectPackageIndex,
    locateProjectPackageFiles,
    normalizeProjectPackagePath,
    projectPackageMagic,
    readProjectPackageVersion,
    shouldExcludeProjectPackagePath,
} from "./projectPackage";

/**
 * A version 1 package, built here because Studio no longer writes them and the reader still has to.
 * The layout is the whole point of the version that replaced it: eight bytes of magic, then one
 * msgpack object holding every file's bytes.
 */
function legacyPackage(payload: Record<string, unknown>): Uint8Array {
    const magic = new Uint8Array([0x4e, 0x4c, 0x53, 0x50, 0x4b, 0x47, 0x00, PROJECT_PACKAGE_LEGACY_VERSION]);
    const body = msgpack.encode({ format: PROJECT_PACKAGE_FORMAT, version: PROJECT_PACKAGE_LEGACY_VERSION, ...payload });
    const bytes = new Uint8Array(magic.length + body.length);
    bytes.set(magic, 0);
    bytes.set(body, magic.length);
    return bytes;
}

function index(files: { path: string; size: number }[], directories: string[] = []): ProjectPackageIndex {
    return {
        format: PROJECT_PACKAGE_FORMAT,
        version: PROJECT_PACKAGE_FORMAT_VERSION,
        createdAt: "2026-01-01T00:00:00.000Z",
        projectName: "Demo",
        directories,
        files,
    };
}

describe("project package index", () => {
    it("round-trips the names and sizes a reader seeks by", () => {
        const encoded = encodeProjectPackageIndex(index([
            { path: "Demo.nlproj", size: 3 },
            { path: "assets/content/file.bin", size: 2 },
        ], ["assets/content"]));

        const decoded = decodeProjectPackageIndex(encoded, 5);
        expect(decoded.projectName).toBe("Demo");
        expect(decoded.directories).toEqual(["assets/content"]);
        expect(decoded.files).toEqual([
            { path: "Demo.nlproj", size: 3 },
            { path: "assets/content/file.bin", size: 2 },
        ]);
    });

    it("places each file after the one before it, starting past the magic", () => {
        const located = locateProjectPackageFiles(index([
            { path: "a", size: 10 },
            { path: "b", size: 0 },
            { path: "c", size: 7 },
        ]));

        expect(located.map(entry => entry.offset)).toEqual([
            PROJECT_PACKAGE_BODY_OFFSET,
            PROJECT_PACKAGE_BODY_OFFSET + 10,
            PROJECT_PACKAGE_BODY_OFFSET + 10,
        ]);
    });

    // Every offset after a wrong size is wrong too, so an index that does not account for exactly
    // the bytes present is refused rather than followed.
    it("refuses an index whose sizes do not account for the body", () => {
        const encoded = encodeProjectPackageIndex(index([{ path: "a", size: 10 }]));
        expect(() => decodeProjectPackageIndex(encoded, 9)).toThrow("truncated");
        expect(() => decodeProjectPackageIndex(encoded, 11)).toThrow("longer than its index accounts for");
        expect(decodeProjectPackageIndex(encoded, 10).files[0].size).toBe(10);
    });

    it("refuses sizes that are not counts of bytes", () => {
        for (const size of [-1, 1.5, Number.NaN, "12" as unknown as number]) {
            const encoded = encodeProjectPackageIndex(index([{ path: "a", size }]));
            expect(() => decodeProjectPackageIndex(encoded, 0)).toThrow("unusable size");
        }
    });
});

describe("project package magic", () => {
    it("tells the two formats apart from the first eight bytes alone", () => {
        expect(readProjectPackageVersion(projectPackageMagic())).toBe(PROJECT_PACKAGE_FORMAT_VERSION);
        expect(readProjectPackageVersion(legacyPackage({ files: [] }).slice(0, 8)))
            .toBe(PROJECT_PACKAGE_LEGACY_VERSION);
        expect(readProjectPackageVersion(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
        expect(readProjectPackageVersion(new Uint8Array([0x4e, 0x4c]))).toBeNull();
    });
});

describe("legacy project package", () => {
    it("still reads a version 1 package", () => {
        const decoded = decodeProjectPackage(legacyPackage({
            createdAt: "2026-01-01T00:00:00.000Z",
            projectName: "Demo",
            projectIdentifier: "com.example.demo",
            directories: ["assets/content"],
            files: [
                { path: "Demo.nlproj", data: new Uint8Array([1, 2, 3]) },
                { path: "assets/content/file.bin", data: new Uint8Array([4, 5]) },
            ],
        }));

        expect(decoded.projectName).toBe("Demo");
        expect(decoded.directories).toEqual(["assets/content"]);
        expect(Array.from(decoded.files[0].data)).toEqual([1, 2, 3]);
        expect(Array.from(decoded.files[1].data)).toEqual([4, 5]);
    });

    it("refuses a file that is not a package at all", () => {
        expect(() => decodeProjectPackage(new Uint8Array([1, 2, 3]))).toThrow("not a NarraLeaf Studio project package");
        expect(() => decodeProjectPackage(projectPackageMagic())).toThrow("not a NarraLeaf Studio project package");
    });
});

describe("project package paths", () => {
    it("rejects absolute and traversal paths", () => {
        expect(() => normalizeProjectPackagePath("../victim.txt")).toThrow("unsafe segments");
        expect(() => normalizeProjectPackagePath("assets/../victim.txt")).toThrow("unsafe segments");
        expect(() => normalizeProjectPackagePath("/tmp/victim.txt")).toThrow("relative");
        expect(() => normalizeProjectPackagePath("C:/tmp/victim.txt")).toThrow("relative");
    });

    it("excludes editor caches and export artifacts", () => {
        expect(shouldExcludeProjectPackagePath("editor/cache/thumbnail/a.png")).toBe(true);
        expect(shouldExcludeProjectPackagePath("editor/assets/remote/hash")).toBe(true);
        expect(shouldExcludeProjectPackagePath(".nlstudio/cache/state.json")).toBe(true);
        expect(shouldExcludeProjectPackagePath("exports/demo.nlspkg")).toBe(true);
        expect(shouldExcludeProjectPackagePath("dist/win-unpacked/resources/app.asar")).toBe(true);
        expect(shouldExcludeProjectPackagePath("dist/mac-arm64/Game.app/Contents/Info.plist")).toBe(true);
        // Only the build output folder itself. A file an author named after it is theirs.
        expect(shouldExcludeProjectPackagePath("assets/dist/note.txt")).toBe(false);
        expect(shouldExcludeProjectPackagePath("editor/ui/uidoc.json")).toBe(false);
        expect(shouldExcludeProjectPackagePath("assets/content/ab/cd/file")).toBe(false);
    });

    it("never exports the claim that says who is editing the project", () => {
        // A fact about one machine and one moment. An export carrying it would arrive claiming to
        // be open in the sender's Studio, and stay that way until the claim aged out.
        expect(shouldExcludeProjectPackagePath(".nlstudio/session.lock")).toBe(true);
    });

    it("excludes the whole of Studio's working directory, whatever is named in it", () => {
        // Not a list of the subdirectories that exist today. One of those lists is how the Dev Mode
        // revision snapshots - written to `.nlstudio/devmode`, excluded as `.nlstudio/dev-mode` -
        // ended up inside every package an author ever exported. The prefix is the rule, so a
        // directory added later is excluded before anyone has to remember it.
        expect(shouldExcludeProjectPackagePath(".nlstudio/services/panel_state.json")).toBe(true);
        expect(shouldExcludeProjectPackagePath(".nlstudio/preview/main/index.js")).toBe(true);
        expect(shouldExcludeProjectPackagePath(".nlstudio/preview/userData/saves/1.save")).toBe(true);
        expect(shouldExcludeProjectPackagePath(".nlstudio/devmode/revisions/d59feba37af3fbb9/editor/ui/uidoc.json")).toBe(true);
        expect(shouldExcludeProjectPackagePath(".nlstudio/quarantine/2026-09-02T00-00-00/assets/assets.metadata.image.json")).toBe(true);
        expect(shouldExcludeProjectPackagePath(".nlstudio/test/main/index.js")).toBe(true);
        expect(shouldExcludeProjectPackagePath(".nlstudio/editor.json")).toBe(true);
        expect(shouldExcludeProjectPackagePath(".nlstudio/whatever-comes-next/file")).toBe(true);
    });

    it("excludes the repository, but not the project's own service stores", () => {
        expect(shouldExcludeProjectPackagePath(".lore/store/fragments/00/ab")).toBe(true);
        // The ignore policy travels with the project: it is small, and it is right about this
        // project wherever the project ends up.
        expect(shouldExcludeProjectPackagePath(".loreignore")).toBe(false);
        // Service stores that ARE project content stayed in the versioned tree, and an export
        // without the character table would be an export of a different project.
        expect(shouldExcludeProjectPackagePath("editor/services/character.json")).toBe(false);
        // A folder an author named after Studio's own, anywhere but the root, is theirs.
        expect(shouldExcludeProjectPackagePath("assets/.nlstudio/note.txt")).toBe(false);
    });
});
