import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { inspectLive2DSdkArchive, readArchiveEntry } from "./live2dSdkArchive";
import {
    CRC32_INITIAL,
    CENTRAL_HEADER_SIZE,
    EOCD_SIZE,
    LOCAL_HEADER_SIZE,
    ZIP_METHOD_STORE,
    crc32,
} from "../../../../buildWorker/mobile/zipModel";

/**
 * A minimal stored-only zip, built here rather than fixtured.
 *
 * The archive this reads in anger is 20 MB of someone else's licensed software, so it cannot live in
 * the repository — which means the interesting cases (wrong file, missing Core, nested root) have to be
 * synthesised. `zipModel` is the same reader the installer uses, so a zip it accepts is a fair stand-in
 * for the layout question, which is all these tests are about.
 */
function zip(files: Record<string, string>): Buffer {
    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let offset = 0;
    for (const [name, content] of Object.entries(files)) {
        const nameBytes = Buffer.from(name, "utf-8");
        const data = Buffer.from(content, "utf-8");
        const sum = crc32(data);

        const local = Buffer.alloc(LOCAL_HEADER_SIZE + nameBytes.length);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(ZIP_METHOD_STORE, 8);
        local.writeUInt32LE(sum, 14);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(nameBytes.length, 26);
        nameBytes.copy(local, LOCAL_HEADER_SIZE);
        locals.push(local, data);

        const central = Buffer.alloc(CENTRAL_HEADER_SIZE + nameBytes.length);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(ZIP_METHOD_STORE, 10);
        central.writeUInt32LE(sum, 16);
        central.writeUInt32LE(data.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(nameBytes.length, 28);
        central.writeUInt32LE(offset, 42);
        nameBytes.copy(central, CENTRAL_HEADER_SIZE);
        centrals.push(central);

        offset += local.length + data.length;
    }
    const centralDirectory = Buffer.concat(centrals);
    const eocd = Buffer.alloc(EOCD_SIZE);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(centrals.length, 8);
    eocd.writeUInt16LE(centrals.length, 10);
    eocd.writeUInt32LE(centralDirectory.length, 12);
    eocd.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, centralDirectory, eocd]);
}

/** The shape of a real archive, reduced to the entries the inspector looks for. */
function sdkFiles(root = "CubismSdkForWeb-5-r.5/"): Record<string, string> {
    return {
        [`${root}cubism-info.yml`]: "id: 10\nversion: 5-r.5\ncreated: 20260401T182224+0900\n",
        [`${root}LICENSE.md`]: "Live2D licence text",
        [`${root}Core/live2dcubismcore.min.js`]: "var Live2DCubismCore={};",
        [`${root}Core/LICENSE.md`]: "Core licence text",
        [`${root}Framework/src/live2dcubismframework.ts`]: "export const CubismFramework = {};",
        [`${root}Framework/src/math/cubismmatrix44.ts`]: "export class CubismMatrix44 {}",
        [`${root}Framework/Shaders/WebGL/vertshadersrc.vert`]: "void main() {}",
        [`${root}Framework/Shaders/WebGL/fragshadersrccopy.frag`]: "void main() {}",
    };
}

describe("inspectLive2DSdkArchive", () => {
    it("finds the parts under a version-named root", () => {
        const found = inspectLive2DSdkArchive(zip(sdkFiles()));
        expect(found.root).toBe("CubismSdkForWeb-5-r.5/");
        expect(found.version).toBe("5-r.5");
        // Keyed relative to their own directories, which is what the build layout needs.
        expect([...found.framework.keys()].sort()).toEqual([
            "live2dcubismframework.ts",
            "math/cubismmatrix44.ts",
        ]);
        expect([...found.shaders.keys()].sort()).toEqual(["fragshadersrccopy.frag", "vertshadersrc.vert"]);
        expect([...found.licenses.keys()].sort()).toEqual(["Core/LICENSE.md", "LICENSE.md"]);
    });

    it("does not depend on the root being named anything in particular", () => {
        // The prefix carries the SDK version, so hard-coding it would break on the next release and
        // blame the author's file for it.
        expect(inspectLive2DSdkArchive(zip(sdkFiles("CubismSdkForWeb-9-r.1/"))).version).toBe("5-r.5");
        expect(inspectLive2DSdkArchive(zip(sdkFiles(""))).root).toBe("");
    });

    it("takes the shallowest info file, so a nested copy cannot outrank the root", () => {
        const files = {
            ...sdkFiles(),
            "CubismSdkForWeb-5-r.5/Samples/vendored/cubism-info.yml": "version: 1-r.0\n",
        };
        expect(inspectLive2DSdkArchive(zip(files)).root).toBe("CubismSdkForWeb-5-r.5/");
    });

    it("reads a version-less info file without failing the install", () => {
        const files = sdkFiles();
        files["CubismSdkForWeb-5-r.5/cubism-info.yml"] = "id: 10\n";
        expect(inspectLive2DSdkArchive(zip(files)).version).toBeNull();
    });

    it("hands back the bytes of what it located", () => {
        const found = inspectLive2DSdkArchive(zip(sdkFiles()));
        expect(readArchiveEntry(zip(sdkFiles()), found.core).toString("utf-8"))
            .toBe("var Live2DCubismCore={};");
    });

    describe("rejects the wrong file with something the author can act on", () => {
        it("when it is not a zip at all", () => {
            expect(() => inspectLive2DSdkArchive(Buffer.from("not a zip")))
                .toThrow(/not a readable \.zip archive/);
        });

        it("when it is some other archive, naming what it actually holds", () => {
            const other = zip({ "my-game/assets/hiyori.model3.json": "{}", "my-game/readme.txt": "hi" });
            // The listing is the recovery path: it is how the author sees they picked their own project.
            expect(() => inspectLive2DSdkArchive(other)).toThrow(/top-level entries are: my-game\//);
        });

        it("when Core is absent, saying which download does have it", () => {
            const files = sdkFiles();
            delete files["CubismSdkForWeb-5-r.5/Core/live2dcubismcore.min.js"];
            expect(() => inspectLive2DSdkArchive(zip(files))).toThrow(/Cubism Editor download does not/);
        });

        it("when the Framework sources are absent", () => {
            const files = sdkFiles();
            delete files["CubismSdkForWeb-5-r.5/Framework/src/live2dcubismframework.ts"];
            delete files["CubismSdkForWeb-5-r.5/Framework/src/math/cubismmatrix44.ts"];
            expect(() => inspectLive2DSdkArchive(zip(files))).toThrow(/no Framework\/src\/ sources/);
        });

        it("when the shaders are absent, rather than building something that draws nothing", () => {
            const files = sdkFiles();
            delete files["CubismSdkForWeb-5-r.5/Framework/Shaders/WebGL/vertshadersrc.vert"];
            delete files["CubismSdkForWeb-5-r.5/Framework/Shaders/WebGL/fragshadersrccopy.frag"];
            expect(() => inspectLive2DSdkArchive(zip(files))).toThrow(/compiles empty programs/);
        });
    });
});

/**
 * The same reading, against a real archive.
 *
 * Skipped wherever that file is not present, which is everywhere except a machine an author (or this
 * repository's maintainer) has downloaded the SDK on. Its value is the part the synthetic archive
 * cannot check: that a genuine 342-entry, deflated, 20 MB package resolves to the counts the installer
 * then depends on.
 */
const REAL_SDK = process.env.NLS_LIVE2D_SDK_ZIP ?? "D:\\Temp\\CubismSdkForWeb-5-r.5.zip";
const hasRealSdk = (() => {
    try {
        return fs.statSync(REAL_SDK).isFile();
    } catch {
        return false;
    }
})();

describe.skipIf(!hasRealSdk)(`against the real SDK at ${path.basename(REAL_SDK)}`, () => {
    it("resolves a genuine archive to a complete part list", () => {
        const found = inspectLive2DSdkArchive(fs.readFileSync(REAL_SDK));
        expect(found.root).toMatch(/^CubismSdkForWeb-[^/]+\/$/);
        expect(found.version).toBeTruthy();
        // 13 shaders and ~59 framework sources in 5-r.5. Asserted as floors: a later SDK may add.
        expect(found.shaders.size).toBe(13);
        expect(found.framework.size).toBeGreaterThanOrEqual(50);
        expect(found.licenses.size).toBeGreaterThanOrEqual(3);
        // Deflated, unlike the synthetic archive, so this is also the inflate path.
        const core = readArchiveEntry(fs.readFileSync(REAL_SDK), found.core).toString("utf-8");
        expect(core).toContain("Live2DCubismCore");
        expect(core.length).toBeGreaterThan(100_000);
    });
});
