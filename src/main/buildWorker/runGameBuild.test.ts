import { describe, expect, it } from "vitest";
import { builderConfiguration, extraFilesFor } from "./runGameBuild";
import type { GameBuildWorkerConfig, GameBuildWorkerTarget } from "./protocol";

const config = {
    appId: "com.narraleaf.games.example",
    productName: "Example",
    electronVersion: "38.0.0",
    outputDir: "out",
    artifactBaseName: "Example",
    electronLanguages: ["en-US"],
    asarUnpack: [],
    targets: [],
} as unknown as GameBuildWorkerConfig;

const target = {
    platform: "windows",
    formats: ["dir"],
    arch: "x64",
    platformKey: "windows-x64",
    fuses: {},
} as unknown as GameBuildWorkerTarget;

/**
 * Whether electron-builder goes looking for a dependency tree to put in the game.
 *
 * It must not: the game has none, and the tree it finds instead is whatever JavaScript repository
 * the project happens to sit inside. electron-builder only skips the search when `beforeBuild`
 * answers false, and only asks `beforeBuild` when `npmRebuild` is not false - so both halves are
 * pinned here, since either one alone puts the search back.
 */
describe("builderConfiguration", () => {
    it("tells electron-builder that node_modules are handled outside it", async () => {
        const built = builderConfiguration(config, target, () => undefined);

        expect(built.npmRebuild).not.toBe(false);
        expect(typeof built.beforeBuild).toBe("function");
        const answer = await (built.beforeBuild as (context: unknown) => Promise<boolean>)({});
        expect(answer).toBe(false);
    });
});

/**
 * Where the game's own notices land. On macOS a top-level file in `Contents/` is nested code to
 * codesign, which signs it into extended attributes; a zip drops those, and the unpacked app then
 * fails verification. So on macOS they go into `Contents/Resources/`, and nowhere else changes.
 */
describe("extraFilesFor", () => {
    const withNotices = {
        ...config,
        copyrightFile: "/project/COPYRIGHT.txt",
        thirdPartyNoticesFile: "/build/THIRD-PARTY-NOTICES.txt",
    } as GameBuildWorkerConfig;

    it("puts the notices in the bundle's Resources on macOS", () => {
        expect(extraFilesFor(withNotices, "macos")).toEqual([
            { from: "/project/COPYRIGHT.txt", to: "Resources/COPYRIGHT.txt" },
            { from: "/build/THIRD-PARTY-NOTICES.txt", to: "Resources/THIRD-PARTY-NOTICES.txt" },
        ]);
    });

    it("puts them beside the executable on Windows and Linux", () => {
        for (const platform of ["windows", "linux"] as const) {
            expect(extraFilesFor(withNotices, platform).map(file => file.to))
                .toEqual(["COPYRIGHT.txt", "THIRD-PARTY-NOTICES.txt"]);
        }
    });

    it("ships nothing the project does not have", () => {
        expect(extraFilesFor(config, "macos")).toEqual([]);
    });
});
