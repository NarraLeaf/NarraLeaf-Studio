import { describe, expect, it } from "vitest";
import { PER_TARGET_DIR_NAME, perTargetFileSets, perTargetUnpackPattern } from "./perTargetPayload";

describe("perTargetFileSets", () => {
    it("copies the app but not the staging area", () => {
        const sets = perTargetFileSets("windows-x64");
        expect(sets).toContain("**/*");
        expect(sets).toContain(`!${PER_TARGET_DIR_NAME}/**`);
    });

    /*
     * The half that does the work: a second matcher rooted at this target's
     * directory and writing to the app root, which is how a copy staged under
     * `platform/windows-x64/` arrives as `bindings.node` beside `main.js`.
     */
    it("maps this target's directory onto the app root", () => {
        const mapped = perTargetFileSets("macos-arm64").find(entry => typeof entry !== "string");
        expect(mapped).toEqual({
            from: `${PER_TARGET_DIR_NAME}/macos-arm64`,
            to: ".",
            filter: ["**/*"],
        });
    });

    // Two targets differ only in which directory is mapped; everything else about
    // the package is the same, which is what makes one compiled app dir enough.
    it("differs between targets only in the directory it maps", () => {
        const windows = perTargetFileSets("windows-x64");
        const linux = perTargetFileSets("linux-x64");
        expect(windows.filter(entry => typeof entry === "string"))
            .toEqual(linux.filter(entry => typeof entry === "string"));
        expect(windows.find(entry => typeof entry !== "string"))
            .not.toEqual(linux.find(entry => typeof entry !== "string"));
    });
});

describe("perTargetUnpackPattern", () => {
    /*
     * Unpack patterns are matched against the path a file is read FROM, so the
     * app-root spelling of a staged file does not cover it and this has to name
     * the staging area itself. Without it the codec addon ends up inside the
     * asar, where the OS loader cannot open it, and the game fails at start.
     */
    it("covers the staging area, which is read from a different path than it is written to", () => {
        expect(perTargetUnpackPattern()).toBe(`${PER_TARGET_DIR_NAME}/**`);
    });
});
