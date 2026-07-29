import { afterEach, describe, expect, it, vi } from "vitest";
import {
    freezeProjectWrites,
    getProjectWriteFreeze,
    isFrozenProjectData,
    observeProjectWriteFreeze,
    observeRefusedWrites,
    refuseFrozenWrite,
    thawProjectWrites,
    type RefusedWrite,
} from "./writeFreeze";

/**
 * The latch on its own: which paths it claims, and that it says so out loud.
 *
 * The half worth guarding hardest is the one that ALLOWS. "Frozen" has to mean *project data* is
 * frozen and nothing else - the panel layout, the thumbnail cache and the build output all live
 * inside the project directory and all have to keep working, or the author's first impression of
 * viewing history is an editor that has stopped responding.
 */

const PROJECT = "D:/projects/my-game";

afterEach(() => {
    thawProjectWrites();
});

describe("writeFreeze scope", () => {
    it("claims files the repository stores", () => {
        for (const relative of [
            "project.json",
            "assets/content/ab/cd/sprite.png",
            "assets/assets.metadata.image.json",
            "editor/story/stories/s1/storydoc.json",
            "resources/icons/derived/icon-256.png",
        ]) {
            expect(isFrozenProjectData(PROJECT, `${PROJECT}/${relative}`)).toBe(true);
        }
    });

    it("leaves everything the repository excludes alone", () => {
        for (const relative of [
            // Editor state. The decision "project data freezes, editor state does not" is exactly
            // the `.loreignore` boundary, so there is no second list to keep in step.
            ".nlstudio/editor.json",
            ".nlstudio/plugins/my-plugin/manifest.json",
            ".nlstudio/preview/app/main.js",
            "editor/cache/thumbnail/ab/cd/asset-1.png",
            "editor/assets/remote/ab/cd/remote.png",
            "dist/game.exe",
            "node_modules/pkg/index.js",
        ]) {
            expect(isFrozenProjectData(PROJECT, `${PROJECT}/${relative}`)).toBe(false);
        }
    });

    it("ignores paths outside the project entirely", () => {
        expect(isFrozenProjectData(PROJECT, "D:/projects/other-game/project.json")).toBe(false);
        expect(isFrozenProjectData(PROJECT, "C:/Users/a/AppData/Roaming/Studio/plugins/x.json")).toBe(false);
        // A sibling directory whose name merely starts with the project's own.
        expect(isFrozenProjectData(PROJECT, "D:/projects/my-game-backup/project.json")).toBe(false);
        // The project root is a directory, not a file anyone writes.
        expect(isFrozenProjectData(PROJECT, PROJECT)).toBe(false);
    });

    it("reads either separator, because callers on Windows hold both spellings", () => {
        expect(isFrozenProjectData("D:\\projects\\my-game", "D:\\projects\\my-game\\project.json")).toBe(true);
        expect(isFrozenProjectData("D:\\projects\\my-game", "D:/projects/my-game/.nlstudio/editor.json")).toBe(false);
    });

    it("judges the path inside the project with the author's own casing", () => {
        // A folder the author named `Dist` is content, not build output: the main process does not
        // fold case, so it versions this file. Folding here would answer "derived" and let a frozen
        // workspace write to it - one predicate, two answers, which is the failure the working-set
        // policy exists to prevent.
        expect(isFrozenProjectData(PROJECT, `${PROJECT}/Dist/scene.json`)).toBe(true);
        expect(isFrozenProjectData(PROJECT, `${PROJECT}/dist/bundle.js`)).toBe(false);

        // Locating the root is the one place case may be folded: Windows hands the same directory
        // out under several spellings, and a project opened as `d:\projects\...` must still be
        // recognised when a caller holds the drive letter capitalised.
        expect(isFrozenProjectData("d:/projects/My-Game", `${PROJECT}/project.json`)).toBe(true);
    });
});

describe("writeFreeze latch", () => {
    it("refuses nothing until it is armed", () => {
        expect(getProjectWriteFreeze()).toBeNull();
        expect(refuseFrozenWrite(`${PROJECT}/project.json`)).toBeNull();
    });

    it("refuses project data and announces the path and the reason", () => {
        const refusals: RefusedWrite[] = [];
        const stop = observeRefusedWrites(refusal => refusals.push(refusal));

        freezeProjectWrites({ projectPath: PROJECT, reason: { kind: "revision", revision: "aa", label: "#12" } });
        const refused = refuseFrozenWrite(`${PROJECT}/editor/story/index.json`);

        expect(refused?.reason).toEqual({ kind: "revision", revision: "aa", label: "#12" });
        // Announced, not silent: a dropped write nobody mentions is worse than the write prevented.
        expect(refusals).toEqual([{
            path: `${PROJECT}/editor/story/index.json`,
            reason: { kind: "revision", revision: "aa", label: "#12" },
        }]);
        stop();
    });

    it("lets an excluded path through while frozen, and says nothing about it", () => {
        const refusals: RefusedWrite[] = [];
        const stop = observeRefusedWrites(refusal => refusals.push(refusal));

        freezeProjectWrites({ projectPath: PROJECT, reason: { kind: "manual" } });

        expect(refuseFrozenWrite(`${PROJECT}/.nlstudio/editor.json`)).toBeNull();
        expect(refuseFrozenWrite(`${PROJECT}/editor/cache/thumbnail/ab/cd/asset-1.png`)).toBeNull();
        expect(refusals).toEqual([]);
        stop();
    });

    it("checks both ends of a move, because the source is unlinked too", () => {
        freezeProjectWrites({ projectPath: PROJECT, reason: { kind: "manual" } });

        // Out of the working set and into it, and the other way round: either direction changes
        // what the repository stores.
        expect(refuseFrozenWrite(`${PROJECT}/assets/a.png`, `${PROJECT}/.nlstudio/a.png`)).not.toBeNull();
        expect(refuseFrozenWrite(`${PROJECT}/.nlstudio/a.png`, `${PROJECT}/assets/a.png`)).not.toBeNull();
        expect(refuseFrozenWrite(`${PROJECT}/.nlstudio/a.png`, `${PROJECT}/dist/a.png`)).toBeNull();
    });

    it("thaws back to writable and tells its subscribers both times", () => {
        const seen: (string | null)[] = [];
        const stop = observeProjectWriteFreeze(freeze => seen.push(freeze?.reason.kind ?? null));

        freezeProjectWrites({ projectPath: PROJECT, reason: { kind: "manual" } });
        expect(refuseFrozenWrite(`${PROJECT}/project.json`)).not.toBeNull();

        thawProjectWrites();
        expect(getProjectWriteFreeze()).toBeNull();
        expect(refuseFrozenWrite(`${PROJECT}/project.json`)).toBeNull();
        expect(seen).toEqual(["manual", null]);

        // A second thaw is not a second event.
        thawProjectWrites();
        expect(seen).toEqual(["manual", null]);
        stop();
    });

    it("survives an observer that throws, rather than turning a refusal into a thrown write", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const stop = observeRefusedWrites(() => {
            throw new Error("observer exploded");
        });

        freezeProjectWrites({ projectPath: PROJECT, reason: { kind: "manual" } });
        expect(() => refuseFrozenWrite(`${PROJECT}/project.json`)).not.toThrow();

        stop();
        warn.mockRestore();
    });
});
