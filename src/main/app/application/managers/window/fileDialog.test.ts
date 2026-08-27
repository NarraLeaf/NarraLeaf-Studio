import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ dialog: {} }));

const { validateOpenAnswer, validateSaveAnswer } = await import("./fileDialog");

/**
 * What a scripted answer is allowed to be.
 *
 * The experimental `scripted-file-dialog` condition answers the picker from the page instead of
 * from a system dialog, and the answer goes on to mint the same grant a picked path would. So the
 * answer has to be a path the dialog could actually have returned - otherwise an acceptance run can
 * hand the product something no author is able to pick, and pass on a capability that does not
 * exist.
 */
describe("scripted answers to an open dialog", () => {
    let root: string;
    let file: string;
    let folder: string;

    beforeEach(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), "nls-file-dialog-"));
        file = path.join(root, "picked.txt");
        folder = path.join(root, "picked-folder");
        await fs.writeFile(file, "x");
        await fs.mkdir(folder);
    });

    afterEach(async () => {
        await fs.rm(root, { recursive: true, force: true });
    });

    it("takes a file for a file picker and a folder for a folder picker", () => {
        expect(validateOpenAnswer(["openFile"], [file])).toBeNull();
        expect(validateOpenAnswer(["openDirectory"], [folder])).toBeNull();
    });

    it("refuses the other kind, which is what the native dialog would have refused", () => {
        expect(validateOpenAnswer(["openFile"], [folder])).toContain("is a folder");
        expect(validateOpenAnswer(["openDirectory"], [file])).toContain("is a file");
    });

    it("refuses a path that is not there, however plausible it looks", () => {
        expect(validateOpenAnswer(["openFile"], [path.join(root, "never-written.txt")]))
            .toContain("does not exist");
    });

    it("refuses a relative path, because a dialog never returns one", () => {
        expect(validateOpenAnswer(["openFile"], ["picked.txt"])).toContain("not an absolute path");
    });

    it("honours multiSelections in both directions", () => {
        expect(validateOpenAnswer(["openFile"], [file, file])).toContain("takes one path");
        expect(validateOpenAnswer(["openFile", "multiSelections"], [file, file])).toBeNull();
    });

    it("treats an empty answer as a mistake rather than a cancel", () => {
        // Cancelling is its own verb on the page object; answering with nothing is not the same
        // thing, and silently reading it as one would hide a driver bug as a user action.
        expect(validateOpenAnswer(["openFile"], [])).toContain("cancel it");
    });
});

describe("scripted answers to a save dialog", () => {
    let root: string;

    beforeEach(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), "nls-file-dialog-save-"));
    });

    afterEach(async () => {
        await fs.rm(root, { recursive: true, force: true });
    });

    it("takes a file that does not exist yet, which is the whole point of saving", () => {
        expect(validateSaveAnswer([path.join(root, "export.csv")])).toBeNull();
    });

    it("refuses a folder that does not exist, because the dialog cannot navigate to one", () => {
        expect(validateSaveAnswer([path.join(root, "nowhere", "export.csv")]))
            .toContain("does not exist");
    });

    it("refuses a folder as the destination, and refuses two paths", () => {
        expect(validateSaveAnswer([root])).toContain("is a folder");
        expect(validateSaveAnswer([path.join(root, "a.csv"), path.join(root, "b.csv")]))
            .toContain("exactly one path");
    });
});
