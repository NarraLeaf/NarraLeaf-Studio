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
import { koffiPrebuildDirectories } from "./gameRuntimeArtifactCompiler";

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
