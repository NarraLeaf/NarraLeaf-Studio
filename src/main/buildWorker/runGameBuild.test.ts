import { describe, expect, it } from "vitest";
import { builderConfiguration } from "./runGameBuild";
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
