import { describe, expect, it } from "vitest";
import { isVersioned } from "@shared/vcs/workingSet";
import { shouldExcludeProjectPackagePath } from "@shared/utils/projectPackage";
import { UNDO_TRASH_DIRECTORY } from "./undoTrash";

/**
 * The undo trash holds the bytes of deleted assets and the bytes replacements wrote over - copies of
 * the author's art and recordings that only this machine's undo can reach. None of it may leave with
 * the project: not in a commit or a push to a Team server, not in an exported package.
 */
describe("the undo trash", () => {
    const slot = `${UNDO_TRASH_DIRECTORY}/0f6c2a1e-1.png`;

    it("is never versioned, so no commit and no Team push carries it", () => {
        expect(isVersioned(slot)).toBe(false);
        expect(isVersioned(UNDO_TRASH_DIRECTORY)).toBe(false);
    });

    it("is never exported with the project", () => {
        expect(shouldExcludeProjectPackagePath(slot)).toBe(true);
    });
});
