import { beforeEach, describe, expect, it, vi } from "vitest";
import { FsRejectErrorCode } from "@shared/types/os";
import { ValidationService } from "./validationService";

const mocks = vi.hoisted(() => ({
    fs: {
        isDirExists: vi.fn(),
        isDir: vi.fn(),
        list: vi.fn(),
    },
}));

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        fs: mocks.fs,
    }),
}));

describe("ValidationService directory validation", () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it("reports permission errors instead of treating denied paths as creatable", async () => {
        mocks.fs.isDirExists.mockResolvedValue({
            success: true,
            data: {
                ok: false,
                error: {
                    code: FsRejectErrorCode.PERMISSION_DENIED,
                    message: "File system access is not allowed for path: /Users/me/Documents/Game",
                },
            },
        });

        const result = await ValidationService.validateProjectDirectory("/Users/me/Documents/Game");

        expect(result.success).toBe(false);
        expect(result.errors.directory).toBe("File system access is not allowed for path: /Users/me/Documents/Game");
        expect(mocks.fs.isDirExists).toHaveBeenCalledWith("/Users/me/Documents/Game");
        expect(mocks.fs.isDir).not.toHaveBeenCalled();
        expect(mocks.fs.list).not.toHaveBeenCalled();
    });

    it("allows an authorized project directory that will be created later", async () => {
        mocks.fs.isDirExists.mockResolvedValue({
            success: true,
            data: {
                ok: true,
                data: false,
            },
        });

        const result = await ValidationService.validateProjectDirectory("/Users/me/Documents/Game");

        expect(result.success).toBe(true);
        expect(result.data).toEqual({
            exists: false,
            isDirectory: false,
            isEmpty: true,
            canWrite: true,
        });
        expect(mocks.fs.isDir).not.toHaveBeenCalled();
        expect(mocks.fs.list).not.toHaveBeenCalled();
    });
});
