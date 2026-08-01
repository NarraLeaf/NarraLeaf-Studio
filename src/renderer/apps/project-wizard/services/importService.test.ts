import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImportService } from "./importService";

const mocks = vi.hoisted(() => ({
    workspace: { importProjectPackage: vi.fn() },
    fs: { list: vi.fn() },
}));

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        workspace: mocks.workspace,
        fs: mocks.fs,
    }),
}));

vi.mock("@/lib/i18n", () => ({
    translate: (key: string) => key,
}));

const TARGET = "D:/Projects/unpacked";

function listing(entries: { name: string; ext: string | null; type: string }[]) {
    return { success: true, data: { ok: true, data: entries } };
}

const STUDIO_PROJECT = listing([{ name: "MyGame", ext: ".nlproj", type: "file" }]);
const LEGACY_PROJECT = listing([{ name: "project", ext: ".json", type: "file" }]);
const NOT_A_PROJECT = listing([{ name: "notes", ext: ".txt", type: "file" }]);

function unpacked(extra: Record<string, unknown> = {}) {
    return {
        success: true,
        data: { canceled: false, projectPath: TARGET, projectName: "My Game", fileCount: 120, ...extra },
    };
}

describe("ImportService", () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it("accepts a package that unpacked into a Studio project", async () => {
        mocks.workspace.importProjectPackage.mockResolvedValue(unpacked());
        mocks.fs.list.mockResolvedValue(STUDIO_PROJECT);

        expect(await ImportService.importProject()).toEqual({
            status: "imported",
            root: TARGET,
            projectName: "My Game",
            fileCount: 120,
        });
    });

    it("accepts a legacy project.json layout", async () => {
        mocks.workspace.importProjectPackage.mockResolvedValue(unpacked());
        mocks.fs.list.mockResolvedValue(LEGACY_PROJECT);

        expect((await ImportService.importProject()).status).toBe("imported");
    });

    /**
     * A `.nlspkg` is an archive, and an archive can hold anything. Studio writes these itself so
     * the usual case passes - which is exactly what makes a missing check here survive testing and
     * then hand the launcher a folder it cannot open.
     */
    it("refuses a package that unpacked into something Studio cannot open", async () => {
        mocks.workspace.importProjectPackage.mockResolvedValue(unpacked());
        mocks.fs.list.mockResolvedValue(NOT_A_PROJECT);

        expect(await ImportService.importProject()).toEqual({ status: "notAProject", root: TARGET });
    });

    /**
     * Backing out of a file dialog is an ordinary thing to do. Reporting it as a failure would put
     * a red panel in front of someone who simply changed their mind.
     */
    it("treats a cancelled dialog as cancelled, not as a failure", async () => {
        mocks.workspace.importProjectPackage.mockResolvedValue({ success: true, data: { canceled: true } });

        expect(await ImportService.importProject()).toEqual({ status: "cancelled" });
        expect(mocks.fs.list).not.toHaveBeenCalled();
    });

    it("treats a missing path as cancelled rather than importing nowhere", async () => {
        mocks.workspace.importProjectPackage.mockResolvedValue({ success: true, data: { canceled: false } });

        expect(await ImportService.importProject()).toEqual({ status: "cancelled" });
    });

    it("passes the main process's own refusal through", async () => {
        mocks.workspace.importProjectPackage.mockResolvedValue({
            success: false,
            error: "Selected import folder is inside protected Studio storage.",
        });

        expect(await ImportService.importProject()).toEqual({
            status: "failed",
            error: "Selected import folder is inside protected Studio storage.",
        });
    });

    it("survives a thrown error", async () => {
        mocks.workspace.importProjectPackage.mockRejectedValue(new Error("unreadable archive"));

        expect(await ImportService.importProject()).toEqual({ status: "failed", error: "unreadable archive" });
    });
});
