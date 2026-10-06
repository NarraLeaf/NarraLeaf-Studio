import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { blockmapModulePath, withoutUpdateBlockmaps, type BlockmapModule } from "./updateBlockmaps";

/**
 * Leaving out the update block maps rests on how electron-builder calls the step, which is an
 * internal of a dependency rather than an interface. These read that internal directly, so the
 * upgrade that changes it fails here - rather than quietly bringing back a minute of single-core
 * hashing on every installer, which nothing else would notice.
 */

const targetsDir = path.dirname(blockmapModulePath());

describe("the block map step in electron-builder", () => {
    it.each([
        ["nsis/NsisTarget.js", "../differentialUpdateInfoBuilder"],
        ["ArchiveTarget.js", "./differentialUpdateInfoBuilder"],
    ])("is looked up on the module at the moment %s calls it", (file, specifier) => {
        const callerPath = path.join(targetsDir, file);
        const source = fs.readFileSync(callerPath, "utf-8");
        expect(source).toContain(`const differentialUpdateInfoBuilder_1 = require("${specifier}");`);
        expect(source).toContain("(0, differentialUpdateInfoBuilder_1.createBlockmap)(");
        // And the module it requires is the very file whose export is replaced.
        expect(path.normalize(path.resolve(path.dirname(callerPath), `${specifier}.js`)))
            .toBe(path.normalize(blockmapModulePath()));
    });

    it("is an export that can be replaced", () => {
        const module = require(blockmapModulePath()) as Record<string, unknown>;
        expect(typeof module.createBlockmap).toBe("function");
        expect(Object.getOwnPropertyDescriptor(module, "createBlockmap")?.writable).toBe(true);
    });
});

describe("withoutUpdateBlockmaps", () => {
    it("answers that there is no update information while packaging runs, and restores the step after", async () => {
        const original = async () => ({ sha512: "computed" });
        const target: BlockmapModule = { createBlockmap: original };
        const during = await withoutUpdateBlockmaps(() => target.createBlockmap(), target);
        expect(during).toBeNull();
        expect(target.createBlockmap).toBe(original);
    });

    it("restores the step when packaging fails", async () => {
        const original = async () => ({ sha512: "computed" });
        const target: BlockmapModule = { createBlockmap: original };
        await expect(withoutUpdateBlockmaps(async () => {
            throw new Error("makensis failed");
        }, target)).rejects.toThrow("makensis failed");
        expect(target.createBlockmap).toBe(original);
    });

    it("reaches the module electron-builder itself calls", async () => {
        const module = require(blockmapModulePath()) as BlockmapModule;
        const original = module.createBlockmap;
        await withoutUpdateBlockmaps(async () => {
            // A path that does not exist: the real step would fail reading it.
            expect(await (module.createBlockmap as (file: string) => Promise<unknown>)("no-such-installer.exe")).toBeNull();
        });
        expect(module.createBlockmap).toBe(original);
    });
});
