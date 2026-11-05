import { describe, expect, it, vi } from "vitest";
import { WindowAppType } from "@shared/types/window";
import type { AppWindow } from "../appWindow";

vi.mock("electron", () => ({
    app: { getPath: (name: string) => (process.platform === "win32" ? `C:\\Users\\me\\${name}` : `/home/me/${name}`) },
    dialog: {},
}));

const { ProjectWizardListAppIdsHandler } = await import("./projectWizardAction");

/**
 * The app IDs the wizard keeps a new project's apart from.
 *
 * Asked by the wizard window only, and a folder besides the projects folder is listed only when this
 * window may read it - listing the projects in a folder is reading it. What goes back is names and
 * IDs: the wizard names the project an ID belongs to, and is told nothing about where it is.
 */
describe("projectWizard.listAppIds", () => {
    function windowOf(type: WindowAppType, allowed: (folder: string) => boolean) {
        const listLocalAppIds = vi.fn(async (_folders: string[]) => [
            { appId: "my-game", key: "com.narraleaf.games.my-game", projectName: "My Game", projectPath: "/somewhere/my-game" },
        ]);
        const window = {
            getWindowType: () => type,
            app: {
                listLocalAppIds,
                storageManager: { isPathAllowed: vi.fn(async (_window: unknown, folder: string) => allowed(folder)) },
            },
        } as unknown as AppWindow;
        return { window, listLocalAppIds };
    }

    const picked = process.platform === "win32" ? "D:\\Picked" : "/picked";
    const refused = process.platform === "win32" ? "D:\\Private" : "/private";

    it("answers the wizard with names and IDs, from the projects folder and the folders it may read", async () => {
        const { window, listLocalAppIds } = windowOf(WindowAppType.ProjectWizard, folder => folder === picked);

        const answer = await new ProjectWizardListAppIdsHandler().handle(window, { folders: [picked, refused, "relative"] });

        expect(answer).toEqual({
            success: true,
            data: { projects: [{ appId: "my-game", key: "com.narraleaf.games.my-game", projectName: "My Game" }] },
        });
        const folders = listLocalAppIds.mock.calls[0][0];
        expect(folders).toHaveLength(2);
        expect(folders[1]).toBe(picked);
        expect(folders).not.toContain(refused);
    });

    it("refuses every other window", async () => {
        const { window, listLocalAppIds } = windowOf(WindowAppType.Workspace, () => true);
        const answer = await new ProjectWizardListAppIdsHandler().handle(window, { folders: [] });
        expect(answer.success).toBe(false);
        expect(listLocalAppIds).not.toHaveBeenCalled();
    });
});
