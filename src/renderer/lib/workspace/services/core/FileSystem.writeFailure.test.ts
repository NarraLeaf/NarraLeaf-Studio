import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FsRejectErrorCode } from "@shared/types/os";
import { BaseFileSystemService } from "./FileSystem";

/**
 * What a write through a grant says when the disk refuses it.
 *
 * The protocol handler answers a refused `PUT` with the filesystem's error as JSON, and that is what
 * reaches the caller: the save-failure notice and the project settings both word the failure from
 * its code. Before, every one of these arrived as `IPC_ERROR` with the message
 * `Failed to write file to app://fs/<grant>: Internal Server Error`, which reached the interface.
 */

const privilegedFs = vi.hoisted(() => ({
    requestWrite: vi.fn(),
    requestWriteRaw: vi.fn(),
    requestRead: vi.fn(),
    requestReadRaw: vi.fn(),
}));

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({}),
    getPrivilegedInterface: () => ({ fs: privilegedFs }),
}));

const TARGET = "D:/projects/my-game/My Game.nlproj";
const GRANT = "Zt3bq0rWm9";

function answer(status: number, body: string, contentType: string): void {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, {
        status,
        statusText: status === 500 ? "Internal Server Error" : "Not Found",
        headers: { "Content-Type": contentType },
    })));
}

describe("a write the disk refuses", () => {
    beforeEach(() => {
        const granted = { success: true, data: { ok: true, data: GRANT } };
        privilegedFs.requestWrite.mockResolvedValue(granted);
        privilegedFs.requestWriteRaw.mockResolvedValue(granted);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it("carries the filesystem's code, not a transport failure", async () => {
        answer(500, JSON.stringify({
            error: { code: FsRejectErrorCode.PERMISSION_DENIED, message: "EPERM: operation not permitted, rename" },
        }), "application/json");

        const raw = await BaseFileSystemService.writeRaw(TARGET, new Uint8Array([1, 2, 3]));
        const text = await BaseFileSystemService.write(TARGET, "{}", "utf-8");

        for (const result of [raw, text]) {
            expect(result.ok).toBe(false);
            expect(!result.ok && result.error).toEqual({
                code: FsRejectErrorCode.PERMISSION_DENIED,
                message: "EPERM: operation not permitted, rename",
            });
        }
    });

    it("names the file rather than the grant URL when the answer is not the handler's JSON", async () => {
        answer(404, `Hash not found: ${GRANT}`, "text/plain");

        const result = await BaseFileSystemService.writeRaw(TARGET, new Uint8Array([1]));

        expect(result.ok).toBe(false);
        const error = !result.ok ? result.error : null;
        expect(error?.code).toBe(FsRejectErrorCode.IPC_ERROR);
        expect(error?.message).toContain(TARGET);
        expect(error?.message).not.toContain("app://");
        expect(error?.message).not.toContain(GRANT);
    });

    it("does not take a code it does not know from the body", async () => {
        answer(500, JSON.stringify({ error: { code: "EVERYTHING_IS_FINE", message: "?" } }), "application/json");

        const result = await BaseFileSystemService.writeRaw(TARGET, new Uint8Array([1]));

        expect(!result.ok && result.error.code).toBe(FsRejectErrorCode.IPC_ERROR);
    });
});

/**
 * The same answer for a read: the handler reports a refused read with the filesystem's error as
 * JSON, so a surface reading a project document or an asset can say the file may not be read,
 * rather than every refusal arriving as a transport failure with no reason an author can act on.
 */
describe("a read the disk refuses", () => {
    beforeEach(() => {
        const granted = { success: true, data: { ok: true, data: GRANT } };
        privilegedFs.requestRead.mockResolvedValue(granted);
        privilegedFs.requestReadRaw.mockResolvedValue(granted);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it("carries the filesystem's code, not a transport failure", async () => {
        answer(500, JSON.stringify({
            error: { code: FsRejectErrorCode.PERMISSION_DENIED, message: "EPERM: operation not permitted, open" },
        }), "application/json");

        const raw = await BaseFileSystemService.readRaw(TARGET);
        const text = await BaseFileSystemService.read(TARGET, "utf-8");

        for (const result of [raw, text]) {
            expect(result.ok).toBe(false);
            expect(!result.ok && result.error.code).toBe(FsRejectErrorCode.PERMISSION_DENIED);
        }
    });

    it("names the file rather than the grant URL when the answer is not the handler's JSON", async () => {
        answer(404, `Hash not found: ${GRANT}`, "text/plain");

        const result = await BaseFileSystemService.readRaw(TARGET);

        const error = !result.ok ? result.error : null;
        expect(error?.code).toBe(FsRejectErrorCode.IPC_ERROR);
        expect(error?.message).toContain(TARGET);
        expect(error?.message).not.toContain(GRANT);
    });
});
