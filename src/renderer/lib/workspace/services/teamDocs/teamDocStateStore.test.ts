import { describe, expect, it, vi } from "vitest";
import { FsRejectErrorCode } from "@shared/types/os";
import { writeTeamDocStore } from "./teamDocStateStore";

describe("Team document state storage", () => {
    it("writes the recovery state as JSON", async () => {
        const fs = {
            createDir: vi.fn().mockResolvedValue({ ok: true, data: undefined }),
            write: vi.fn().mockResolvedValue({ ok: true, data: undefined }),
        };
        const store = { version: 1, project: "project", state: { seq: 4, conflicts: [{ mine: "AP8=" }] } };
        await writeTeamDocStore(fs, "/project/.nlstudio/services", "/project/.nlstudio/services/team_docs.json", store);
        expect(JSON.parse(fs.write.mock.calls[0][1])).toEqual(store);
    });

    it("rejects a failed or refused filesystem write", async () => {
        const fs = {
            createDir: vi.fn().mockResolvedValue({ ok: true, data: undefined }),
            write: vi.fn()
                .mockResolvedValueOnce({ ok: false, error: { code: FsRejectErrorCode.NO_SPACE, message: "disk full" } })
                .mockResolvedValueOnce({ ok: true, data: undefined, refused: true }),
        };
        await expect(writeTeamDocStore(fs, "/dir", "/dir/team_docs.json", {})).rejects.toThrow();
        await expect(writeTeamDocStore(fs, "/dir", "/dir/team_docs.json", {})).rejects.toThrow();
    });

    it("stops when the state directory cannot be created", async () => {
        const fs = {
            createDir: vi.fn().mockResolvedValue({ ok: false, error: { code: FsRejectErrorCode.PERMISSION_DENIED, message: "denied" } }),
            write: vi.fn(),
        };
        await expect(writeTeamDocStore(fs, "/dir", "/dir/team_docs.json", {})).rejects.toThrow();
        expect(fs.write).not.toHaveBeenCalled();
    });
});
