import { beforeEach, describe, expect, it, vi } from "vitest";
import { createProjectFromWizard, launchProject, openProjectFromFolder, relocateRecentProject } from "./projectActions";

const fixture = vi.hoisted(() => ({
    wizard: vi.fn(),
    selectFolder: vi.fn(),
    list: vi.fn(),
    launch: vi.fn(),
    addRecent: vi.fn(),
    removeRecent: vi.fn(),
}));

vi.mock("@/lib/app/bridge", () => ({ getInterface: () => ({
    selectFolder: fixture.selectFolder,
    fs: { list: fixture.list },
    workspace: { launch: fixture.launch },
    app: {
        launchProjectWizard: fixture.wizard,
        addRecentProject: fixture.addRecent,
        removeRecentProject: fixture.removeRecent,
    },
}) }));
vi.mock("@/lib/i18n", () => ({ translate: (key: string) => key }));

beforeEach(() => {
    vi.resetAllMocks();
    fixture.launch.mockResolvedValue({ success: false, error: "open failed" });
    fixture.addRecent.mockResolvedValue({ success: true });
    fixture.removeRecent.mockResolvedValue({ success: true });
});

describe("launcher project actions", () => {
    it("reports a refused workspace launch after choosing a folder", async () => {
        fixture.selectFolder.mockResolvedValue({ success: true, data: { path: "/new" } });
        await expect(openProjectFromFolder()).resolves.toBe("open failed");
    });

    it("reports a refused workspace launch after the wizard finishes", async () => {
        fixture.wizard.mockResolvedValue({ success: true, data: { created: true, projectPath: "/new" } });
        await expect(createProjectFromWizard()).resolves.toBe("open failed");
    });

    it("keeps the relocated path in recents when the workspace fails to open", async () => {
        fixture.selectFolder.mockResolvedValue({ success: true, data: { path: "/new" } });
        fixture.list.mockResolvedValue({ success: true, data: { ok: true, data: [{ name: "Project", ext: ".nlproj", type: "file" }] } });
        const project = { name: "Project", path: "/old", openedAt: 1 };
        await expect(relocateRecentProject(project)).resolves.toEqual({ status: "error", message: "open failed" });
        expect(fixture.addRecent).toHaveBeenCalledWith("Project", "/new");
        expect(fixture.addRecent.mock.invocationCallOrder[0]).toBeLessThan(fixture.removeRecent.mock.invocationCallOrder[0]);
    });

    it("keeps the original recent when the new path could not be saved", async () => {
        fixture.selectFolder.mockResolvedValue({ success: true, data: { path: "/new" } });
        fixture.list.mockResolvedValue({ success: true, data: { ok: true, data: [{ name: "Project", ext: ".nlproj", type: "file" }] } });
        fixture.addRecent.mockResolvedValue({ success: false, error: "save failed" });
        await expect(relocateRecentProject({ name: "Project", path: "/old", openedAt: 1 }))
            .resolves.toEqual({ status: "error", message: "save failed" });
        expect(fixture.removeRecent).not.toHaveBeenCalled();
        expect(fixture.launch).not.toHaveBeenCalled();
    });

    it("opens a project repaired in place without removing its recent entry", async () => {
        fixture.selectFolder.mockResolvedValue({ success: true, data: { path: "/old" } });
        fixture.list.mockResolvedValue({ success: true, data: { ok: true, data: [{ name: "Project", ext: ".nlproj", type: "file" }] } });
        fixture.launch.mockResolvedValue({ success: true });
        await expect(relocateRecentProject({ name: "Project", path: "/old", openedAt: 1 }))
            .resolves.toEqual({ status: "relocated" });
        expect(fixture.addRecent).not.toHaveBeenCalled();
        expect(fixture.removeRecent).not.toHaveBeenCalled();
    });

    it("returns rejected launch errors to the caller", async () => {
        fixture.launch.mockRejectedValue(new Error("connection closed"));
        await expect(launchProject({ projectPath: "/new" })).resolves.toBe("connection closed");
    });
});
