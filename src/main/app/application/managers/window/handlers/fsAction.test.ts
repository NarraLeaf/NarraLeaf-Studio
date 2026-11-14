import { afterEach, describe, expect, it, vi } from "vitest";
import { Fs } from "@shared/utils/fs";
import { FsRejectErrorCode } from "@shared/types/os";
import type { AppWindow } from "../appWindow";
import { FsHashHandler, FsRequestReadHandler, FsRequestWriteHandler } from "./fsAction";

function makeWindow() {
    return {
        getWebContents: () => ({ id: 1 }),
        app: {
            logger: { debug: vi.fn() },
            storageManager: {
                isPathAllowed: async () => true,
                allocateHash: () => "hash",
                cleanup: vi.fn(),
                updateStatus: vi.fn(),
            },
        },
    } as unknown as AppWindow;
}

afterEach(() => vi.restoreAllMocks());

describe("file request errors", () => {
    it("does not issue a file-read grant for a directory", async () => {
        vi.spyOn(Fs, "isFileExists").mockResolvedValue({ ok: true, data: true });
        vi.spyOn(Fs, "isFile").mockResolvedValue({ ok: true, data: false });
        const window = makeWindow();
        const result = await new FsRequestReadHandler().handle(window, { path: "/folder", raw: true });
        expect(result).toMatchObject({ success: true, data: { ok: false, error: { code: FsRejectErrorCode.NOT_A_FILE } } });
        expect(window.app.storageManager.cleanup).toHaveBeenCalledWith("hash");
    });

    it("preserves an I/O error encountered while checking write access", async () => {
        vi.spyOn(Fs, "isDirExists").mockResolvedValue({ ok: true, data: true });
        vi.spyOn(Fs, "isWritableDir").mockResolvedValue({ ok: false, error: { code: FsRejectErrorCode.IO_ERROR, message: "I/O error" } });
        const window = makeWindow();
        const result = await new FsRequestWriteHandler().handle(window, { path: "/folder/file", raw: true });
        expect(result).toMatchObject({ success: true, data: { ok: false, error: { code: FsRejectErrorCode.IO_ERROR } } });
        expect(window.app.storageManager.cleanup).toHaveBeenCalledWith("hash");
    });

    it("preserves a permission failure when checking a file before hashing it", async () => {
        vi.spyOn(Fs, "isFileExists").mockResolvedValue({ ok: false, error: { code: FsRejectErrorCode.PERMISSION_DENIED, message: "denied" } });
        const result = await new FsHashHandler().handle(makeWindow(), { path: "/folder/file" });
        expect(result).toMatchObject({ success: true, data: { ok: false, error: { code: FsRejectErrorCode.PERMISSION_DENIED } } });
    });
});
