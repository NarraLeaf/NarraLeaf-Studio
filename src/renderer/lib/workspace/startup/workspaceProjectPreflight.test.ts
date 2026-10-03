import { beforeEach, describe, expect, it, vi } from "vitest";
import { FsRejectErrorCode } from "@shared/types/os";
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

    it("claims the project before any document is read", async () => {
        // The order is the guarantee: a refused window must not have read a document, let alone
        // written one back. The listing that tells a project from any other folder reads no
        // document, and it is the only thing allowed before the claim.
        bridge.acquireSessionLock.mockResolvedValue({ success: true, data: { ok: false, holder: HOLDER } });

        await ensureWorkspaceProjectCanStart(PROJECT).catch(() => undefined);

        expect(filesystem.list).toHaveBeenCalledOnce();
        expect(filesystem.list.mock.invocationCallOrder[0]).toBeLessThan(
            bridge.acquireSessionLock.mock.invocationCallOrder[0]!,
        );
        expect(bridge.getAvailability).not.toHaveBeenCalled();
    });

    it("never claims a folder that is not a project", async () => {
        // A claim writes `.nlstudio/` into the folder. Opening somebody's folder by mistake must
        // leave it exactly as it was, and say it is not a project.
        filesystem.list.mockResolvedValue({ ok: true, data: [file("notes", ".txt")] });

        const failure = await ensureWorkspaceProjectCanStart(PROJECT).catch((error: Error) => error);

        expect(failure).toMatchObject({ kind: WorkspaceStartupErrorKind.MissingProjectConfig, projectPath: PROJECT });
        expect(bridge.acquireSessionLock).not.toHaveBeenCalled();
    });

    it.each([FsRejectErrorCode.NOT_FOUND, FsRejectErrorCode.NOT_A_DIR])(
        "says a path with no folder there (%s) is not a project, and claims nothing",
        async code => {
            // A recent entry whose folder has gone. The claim used to create the folder, which is
            // the only reason this ever reached "not a project" rather than a read failure.
            filesystem.list.mockResolvedValue({ ok: false, error: { code, message: "gone" } });

            const failure = await ensureWorkspaceProjectCanStart(PROJECT).catch((error: Error) => error);

            expect(failure).toMatchObject({ kind: WorkspaceStartupErrorKind.MissingProjectConfig });
            expect(bridge.acquireSessionLock).not.toHaveBeenCalled();
        },
    );

    it("does not call a folder it could not read a non-project", async () => {
        filesystem.list.mockResolvedValue({
            ok: false,
            error: { code: FsRejectErrorCode.PERMISSION_DENIED, message: "denied" },
        });

        const failure = await ensureWorkspaceProjectCanStart(PROJECT).catch((error: Error) => error);

        expect(failure).toBeInstanceOf(Error);
        expect(failure).not.toMatchObject({ kind: WorkspaceStartupErrorKind.MissingProjectConfig });
        expect(bridge.acquireSessionLock).not.toHaveBeenCalled();
    });

    it("opens the project when the claim could not be made at all", async () => {
        // This gate exists to stop a second editor. A project nobody can open because one message
        // did not come back is the worse of the two failures.
        bridge.acquireSessionLock.mockResolvedValue({ success: false, error: "no host" });

        await expect(ensureWorkspaceProjectCanStart(PROJECT)).resolves.toBeUndefined();
        expect(filesystem.list).toHaveBeenCalledOnce();
    });
});
