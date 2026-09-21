import { describe, expect, it } from "vitest";
import { createTranslator, SUPPORTED_LOCALES } from "@shared/i18n";
import { FsRejectErrorCode } from "@shared/types/os";
import { describeFileWriteFailure } from "./writeFailureReason";

/**
 * The sentence a surface shows for a write it asked for: an export, a text file's save, a new file,
 * a project icon. Each of these used to put the filesystem's own message on screen - English in
 * every language, quoting the whole path, which for an asset is its id split into folders.
 */
describe("describeFileWriteFailure", () => {
    const en = createTranslator("en").t;

    it("names what the author named in quotes, then the reason", () => {
        expect(describeFileWriteFailure("zh-CN.csv", { code: FsRejectErrorCode.PERMISSION_DENIED }, en))
            .toBe("Could not save “zh-CN.csv”. The file is read-only, or Studio is not allowed to write to it.");
    });

    it("names a store by its name, without quotes", () => {
        expect(describeFileWriteFailure(
            { store: "workspace.shell.save.stores.projectIcon" },
            { code: FsRejectErrorCode.NO_SPACE },
            en,
        )).toBe("Could not save the project icon. The disk is full.");
    });

    it("stops after the name when the disk said nothing an author can act on", () => {
        expect(describeFileWriteFailure("notes.txt", { code: FsRejectErrorCode.IPC_ERROR }, en))
            .toBe("Could not save “notes.txt”.");
    });

    it.each(SUPPORTED_LOCALES)("carries no placeholder and, outside English, no English (%s)", locale => {
        const t = createTranslator(locale).t;
        const lines = Object.values(FsRejectErrorCode).flatMap(code => [
            describeFileWriteFailure("notes.txt", { code }, t),
            describeFileWriteFailure({ store: "workspace.shell.save.stores.assets" }, { code }, t),
        ]);
        for (const line of lines) {
            expect(line).not.toMatch(/\{\w+\}/);
            if (locale !== "en") {
                expect(line.replace(/notes\.txt|Studio/g, "")).not.toMatch(/[A-Za-z]{3,}/);
            }
        }
    });
});
