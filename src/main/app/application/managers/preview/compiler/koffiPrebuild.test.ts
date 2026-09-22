/**
 * The guard for the mapping that shipped wrong.
 *
 * A build target is `<GameBuildDesktopPlatform>-<GameBuildArch>`; koffi names its prebuild
 * directories after Node's `process.platform`. The first version swapped the separator and called
 * it a translation, which turned every desktop target into a directory that does not exist - so the
 * copy found nothing, said nothing, and every packaged game reported the cursor as unmovable. A
 * real Windows preview found it. These cases are the ones that were wrong.
 */

import { describe, expect, it } from "vitest";
import fs from "fs";
import { createRequire } from "module";
import path from "path";
import { GAME_BUILD_ARCHS_BY_PLATFORM } from "@shared/types/gameBuild";
import { koffiPrebuildDirectories } from "./gameRuntimeArtifactCompiler";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..", "..", "..");

/** Every prebuild directory some desktop game build asks for. */
function directoriesGameBuildsNeed(): string[] {
    const needed = new Set<string>();
    for (const [platform, archs] of Object.entries(GAME_BUILD_ARCHS_BY_PLATFORM)) {
        for (const arch of archs) {
            for (const directory of koffiPrebuildDirectories(`${platform}-${arch}`)) {
                needed.add(directory);
            }
        }
    }
    return [...needed];
}

describe("koffiPrebuildDirectories", () => {
    it("translates every desktop build target koffi ships a prebuild for", () => {
        expect(koffiPrebuildDirectories("windows-x64")).toEqual(["win32_x64"]);
        expect(koffiPrebuildDirectories("windows-arm64")).toEqual(["win32_arm64"]);
        expect(koffiPrebuildDirectories("macos-arm64")).toEqual(["darwin_arm64"]);
        expect(koffiPrebuildDirectories("macos-x64")).toEqual(["darwin_x64"]);
        expect(koffiPrebuildDirectories("linux-x64")).toEqual(["linux_x64"]);
        expect(koffiPrebuildDirectories("linux-arm64")).toEqual(["linux_arm64"]);
    });

    it("asks for both slices of a universal macOS build", () => {
        // One app bundle, two architectures, and koffi has no universal directory to hand.
        expect(koffiPrebuildDirectories("macos-universal")).toEqual(["darwin_x64", "darwin_arm64"]);
    });

    it("falls back to this host when no build target is named", () => {
        // Dev Mode and the preview compile for the machine they run on, and `process` already
        // speaks koffi's vocabulary.
        expect(koffiPrebuildDirectories(undefined)).toEqual([`${process.platform}_${process.arch}`]);
    });

    it("answers nothing for a key it does not recognise", () => {
        // Nothing to copy is a legitimate outcome; guessing a directory name is not.
        expect(koffiPrebuildDirectories("android-arm64")).toEqual([]);
        expect(koffiPrebuildDirectories("web")).toEqual([]);
        expect(koffiPrebuildDirectories("")).toEqual([`${process.platform}_${process.arch}`]);
    });
});

/*
 * The game build copies koffi out of Studio's own installation, so a prebuild the packaged Studio
 * leaves out is one no game it builds can have. electron-builder.yml trims koffi to a keep-list, and
 * that list once named only the machines Studio itself is released for: an Apple Silicon Studio had
 * no Intel prebuild to give an Intel or universal Mac game. Packaging Studio never notices - it
 * looks at a prebuild for another machine only when a game build asks for one.
 */
describe("the koffi prebuilds a game build copies", () => {
    it("are all in the package koffi publishes", () => {
        const koffiRoot = path.dirname(createRequire(__filename).resolve("koffi/package.json"));
        for (const directory of directoriesGameBuildsNeed()) {
            const prebuild = path.join(koffiRoot, "build", "koffi", directory, "koffi.node");
            expect(fs.existsSync(prebuild), prebuild).toBe(true);
        }
    });

    it("are all kept by the packaged Studio", () => {
        const config = fs.readFileSync(path.join(REPO_ROOT, "electron-builder.yml"), "utf8");
        const trim = /node_modules\/koffi\/build\/koffi\/!\(([^)]*)\)/.exec(config);
        expect(trim, "electron-builder.yml no longer trims koffi's prebuilds the way this reads").not.toBeNull();
        const kept = trim![1].split("|");
        for (const directory of directoriesGameBuildsNeed()) {
            expect(kept, directory).toContain(directory);
        }
    });
});
