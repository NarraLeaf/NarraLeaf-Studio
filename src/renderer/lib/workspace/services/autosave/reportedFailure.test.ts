import { describe, expect, it, vi } from "vitest";
import { FsRejectErrorCode } from "@shared/types/os";
import { UIService } from "../core/UIService";
import { DocumentWriteError, RendererDocumentStorage, type DocumentFileSystem } from "../core/DocumentStorage";
import { isReportedToAuthor, markReportedToAuthor } from "./reportedFailure";
import { storeWrite } from "./writeReport";

/**
 * One failure, one notice, when a failure travels two ways at once: to the save-status surface, which
 * words it, and on to the panel that asked, which catches it.
 */

function refusingStorage(report: ReturnType<typeof storeWrite>) {
    const fs = {
        read: async () => ({ ok: false, error: { code: FsRejectErrorCode.NOT_FOUND, message: "missing" } }),
        writeFileNoFollowOrCreate: async () => ({
            ok: false,
            error: { code: FsRejectErrorCode.PERMISSION_DENIED, message: "EPERM: operation not permitted, open 'D:\\p\\editor\\voice\\ja.json.tmp'" },
        }),
        createDir: async () => ({ ok: true, data: undefined }),
        copyFile: async () => ({ ok: true, data: undefined }),
    } as unknown as DocumentFileSystem;
    return new RendererDocumentStorage(fs, "D:/p", report);
}

async function writeFailure(report: ReturnType<typeof storeWrite>): Promise<unknown> {
    return refusingStorage(report).write("editor/voice/ja.json", "{}").then(() => null, error => error);
}

describe("a document write the save-status surface reports", () => {
    it("is marked as already said", async () => {
        const error = await writeFailure(storeWrite("workspace.shell.save.stores.voice", "retried"));
        expect(error).toBeInstanceOf(DocumentWriteError);
        expect(isReportedToAuthor(error)).toBe(true);
    });

    it("is not, when the storage said its writer would say it", async () => {
        const error = await writeFailure(storeWrite("workspace.shell.save.stores.voice", "handledByWriter"));
        expect(isReportedToAuthor(error)).toBe(false);
    });
});

describe("UIService.showError", () => {
    it("shows nothing for a failure the author has already been told about", () => {
        const ui = new UIService();
        const error = vi.spyOn(ui.notifications, "error");
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        vi.spyOn(console, "error").mockImplementation(() => undefined);

        ui.showError(markReportedToAuthor(new Error("Failed to write editor/voice/ja.json: EPERM")));
        expect(error).not.toHaveBeenCalled();

        ui.showError(new Error("Something else"));
        expect(error).toHaveBeenCalledTimes(1);
    });
});
