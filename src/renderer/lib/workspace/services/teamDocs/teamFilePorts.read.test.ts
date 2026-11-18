import { afterEach, describe, expect, it, vi } from "vitest";
import { FsRejectErrorCode } from "@shared/types/os";
import { BaseFileSystemService } from "../core/FileSystem";
import type { WorkspaceContext } from "../services";
import { createTeamFilePorts } from "./teamFilePorts";
import { changesSince } from "./teamFileSync";

const file = { name: "notes", ext: ".txt", type: "file", fileName: "notes.txt" } as const;
const otherFile = { name: "other", ext: ".txt", type: "file", fileName: "other.txt" } as const;
const directory = { name: "editor", ext: null, type: "directory", fileName: "editor" } as const;
const failure = (code = FsRejectErrorCode.IO_ERROR) => ({
    ok: false as const,
    error: { code, message: "disk I/O error" },
});
const bytes = new TextEncoder().encode("new content");
const reference = new Map([["notes.txt", "old digest"]]);

function ports() {
    const ctx = { project: { getConfig: () => ({ projectPath: "/project" }) } } as unknown as WorkspaceContext;
    return createTeamFilePorts(ctx, { remoteOrigin: "local", project: "project" });
}

afterEach(() => vi.restoreAllMocks());

describe("Team file scan failures", () => {
    it.each(["whole", "all"] as const)("stops a %s scan when the project directory cannot be listed", async scope => {
        vi.spyOn(BaseFileSystemService, "list").mockResolvedValue(failure());
        const submit = vi.fn();
        const scan = async () => {
            for (const change of await changesSince(ports(), reference, scope)) submit(change);
        };

        await expect(scan()).rejects.toThrow("disk I/O error");
        expect(submit).not.toHaveBeenCalled();
    });

    it("stops when a listed subdirectory disappears or cannot be listed", async () => {
        vi.spyOn(BaseFileSystemService, "list")
            .mockResolvedValueOnce({ ok: true, data: [file, directory] })
            .mockResolvedValueOnce(failure(FsRejectErrorCode.NOT_FOUND));
        vi.spyOn(BaseFileSystemService, "readRaw").mockResolvedValue({ ok: true, data: bytes });
        const submit = vi.fn();
        const scan = async () => {
            for (const change of await changesSince(ports(), reference, "whole")) submit(change);
        };

        await expect(scan()).rejects.toThrow("disk I/O error");
        expect(submit).not.toHaveBeenCalled();
    });

    it.each(["whole", "all"] as const)("stops a %s scan when a listed file cannot be read", async scope => {
        vi.spyOn(BaseFileSystemService, "list").mockResolvedValue({ ok: true, data: [file] });
        vi.spyOn(BaseFileSystemService, "readRaw").mockResolvedValue(failure(FsRejectErrorCode.PERMISSION_DENIED));
        const submit = vi.fn();
        const scan = async () => {
            for (const change of await changesSince(ports(), reference, scope)) submit(change);
        };

        await expect(scan()).rejects.toThrow("disk I/O error");
        expect(submit).not.toHaveBeenCalled();
    });

    it("stops when reading changed bytes fails after the manifest was built", async () => {
        vi.spyOn(BaseFileSystemService, "list").mockResolvedValue({ ok: true, data: [file, otherFile] });
        let otherReads = 0;
        vi.spyOn(BaseFileSystemService, "readRaw").mockImplementation(async path => {
            if (path.endsWith("other.txt") && ++otherReads === 2) return failure();
            return { ok: true, data: bytes };
        });
        const submit = vi.fn();
        const scan = async () => {
            const agreed = new Map([...reference, ["other.txt", "old digest"]]);
            for (const change of await changesSince(ports(), agreed, "whole")) submit(change);
        };

        await expect(scan()).rejects.toThrow("disk I/O error");
        expect(submit).not.toHaveBeenCalled();
    });

    it("stops an offline scan when new asset bytes cannot be read", async () => {
        vi.spyOn(BaseFileSystemService, "list")
            .mockResolvedValueOnce({ ok: true, data: [{ ...directory, name: "assets", fileName: "assets" }] })
            .mockResolvedValueOnce({ ok: true, data: [{ ...directory, name: "content", fileName: "content" }] })
            .mockResolvedValueOnce({ ok: true, data: [file] });
        vi.spyOn(BaseFileSystemService, "readRaw").mockResolvedValue(failure());
        const submit = vi.fn();
        const scan = async () => {
            for (const change of await changesSince(ports(), new Map(), "all")) submit(change);
        };

        await expect(scan()).rejects.toThrow("disk I/O error");
        expect(submit).not.toHaveBeenCalled();
    });

    it("preserves the missing-file and deliberate-deletion contracts", async () => {
        vi.spyOn(BaseFileSystemService, "readRaw").mockResolvedValue(failure(FsRejectErrorCode.NOT_FOUND));
        vi.spyOn(BaseFileSystemService, "list").mockResolvedValue({ ok: true, data: [] });

        await expect(ports().read("notes.txt")).resolves.toBeNull();
        await expect(changesSince(ports(), reference, "whole")).resolves.toEqual([{ path: "notes.txt", bytes: null }]);
    });

    it("returns changed bytes after successful reads", async () => {
        vi.spyOn(BaseFileSystemService, "list").mockResolvedValue({ ok: true, data: [file] });
        vi.spyOn(BaseFileSystemService, "readRaw").mockResolvedValue({ ok: true, data: bytes });

        await expect(changesSince(ports(), reference, "whole")).resolves.toEqual([{ path: "notes.txt", bytes }]);
    });
});
