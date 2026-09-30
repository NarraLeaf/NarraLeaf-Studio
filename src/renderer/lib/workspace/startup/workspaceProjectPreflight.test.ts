import { beforeEach, describe, expect, it, vi } from "vitest";
import { DirEntry } from "@shared/utils/nlproj";
import {
    ensureWorkspaceProjectCanStart,
    getWorkspaceProjectPreflightIssue,
    isProjectLockedError,
    WorkspaceStartupErrorKind,
} from "./workspaceProjectPreflight";

const bridge = vi.hoisted(() => ({
    acquireSessionLock: vi.fn(),
    getAvailability: vi.fn(),
    getMergeState: vi.fn(),
}));
vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        workspace: { acquireSessionLock: bridge.acquireSessionLock },
        vcs: { getAvailability: bridge.getAvailability, getMergeState: bridge.getMergeState },
    }),
}));

const filesystem = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("../services/core/FileSystem", () => ({
    BaseFileSystemService: { list: filesystem.list },
}));

const file = (name: string, ext: string | null): DirEntry => ({
    name,
    ext,
    type: "file",
});

const PROJECT = "D:/games/demo";

const HOLDER = {
    hostname: "studio-two",
    startedAt: "2026-09-01T09:14:00.000Z",
    sameHost: false,
};

beforeEach(() => {
    vi.clearAllMocks();
    bridge.acquireSessionLock.mockResolvedValue({ success: true, data: { ok: true } });
    bridge.getAvailability.mockResolvedValue({ success: true, data: { available: false } });
    filesystem.list.mockResolvedValue({ ok: true, data: [file("Demo", ".nlproj")] });
});

describe("workspaceProjectPreflight", () => {
    it("allows a project folder with an nlproj file", () => {
        expect(getWorkspaceProjectPreflightIssue([file("Demo", ".nlproj")])).toBeNull();
    });

    it("reports missing project config when no nlproj exists", () => {
        const issue = getWorkspaceProjectPreflightIssue([]);
        expect(issue?.kind).toBe(WorkspaceStartupErrorKind.MissingProjectConfig);
    });

    it("does not parse project.json when nlproj is absent", () => {
        const issue = getWorkspaceProjectPreflightIssue(
            [file("project", ".json")],
        );
        expect(issue?.kind).toBe(WorkspaceStartupErrorKind.MissingProjectConfig);
    });
});

describe("the session claim", () => {
    it("lets a project this Studio holds start up", async () => {
        await expect(ensureWorkspaceProjectCanStart(PROJECT)).resolves.toBeUndefined();
        expect(bridge.acquireSessionLock).toHaveBeenCalledOnce();
    });

    it("refuses a project another Studio holds, and names who has it", async () => {
        bridge.acquireSessionLock.mockResolvedValue({ success: true, data: { ok: false, holder: HOLDER } });

        const failure = await ensureWorkspaceProjectCanStart(PROJECT).catch((error: Error) => error);
        expect(failure).toBeInstanceOf(Error);
        if (!(failure instanceof Error) || !isProjectLockedError(failure)) {
            throw new Error("expected the project-locked failure");
        }
        expect(failure.holder).toEqual(HOLDER);
        expect(failure.kind).toBe(WorkspaceStartupErrorKind.ProjectLocked);
    });

    it("claims the project before anything reads it", async () => {
        // The order is the guarantee: a refused window must not have read a document, let alone
        // written one back. Nothing may run between the two but the claim.
        bridge.acquireSessionLock.mockResolvedValue({ success: true, data: { ok: false, holder: HOLDER } });

        await ensureWorkspaceProjectCanStart(PROJECT).catch(() => undefined);

        expect(filesystem.list).not.toHaveBeenCalled();
        expect(bridge.getAvailability).not.toHaveBeenCalled();
    });

    it("opens the project when the claim could not be made at all", async () => {
        // This gate exists to stop a second editor. A project nobody can open because one message
        // did not come back is the worse of the two failures.
        bridge.acquireSessionLock.mockResolvedValue({ success: false, error: "no host" });

        await expect(ensureWorkspaceProjectCanStart(PROJECT)).resolves.toBeUndefined();
        expect(filesystem.list).toHaveBeenCalledOnce();
    });
});
