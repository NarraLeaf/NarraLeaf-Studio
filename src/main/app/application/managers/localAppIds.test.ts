import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodeProjectConfig, getProjectConfigFileName } from "@shared/utils/nlproj";
import { listLocalAppIds } from "./localAppIds";

/**
 * The app IDs the projects on this machine use, which a new project's is kept apart from.
 *
 * Two sources: the projects Studio has met, by path, and every project directly inside the folders
 * new projects are made in - a copied project dropped into the projects folder has never been
 * opened, and it is the likeliest project to share a new one's ID.
 */
describe("listLocalAppIds", () => {
    let root: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "local-app-ids-"));
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    function project(directory: string, name: string, identifier?: string): string {
        const projectPath = path.join(root, directory);
        fs.mkdirSync(projectPath, { recursive: true });
        fs.writeFileSync(
            path.join(projectPath, getProjectConfigFileName(name)),
            encodeProjectConfig({ name, ...(identifier !== undefined ? { identifier } : {}), metadata: {} } as never),
        );
        return projectPath;
    }

    it("reads the projects it is pointed at and the ones inside the folders it is given", async () => {
        const opened = project("elsewhere/moonlit", "Moonlit", "moonlit");
        project("Projects/my-game", "My Game", "my-game");
        project("Projects/my-game-copy", "My Game", "my-game");
        fs.mkdirSync(path.join(root, "Projects", "not-a-project"), { recursive: true });
        fs.writeFileSync(path.join(root, "Projects", "notes.txt"), "loose file");

        const found = await listLocalAppIds({ projectPaths: [opened], folders: [path.join(root, "Projects")] });

        expect(found.map(entry => [entry.appId, entry.projectName]).sort()).toEqual([
            ["moonlit", "Moonlit"],
            ["my-game", "My Game"],
            ["my-game", "My Game"],
        ]);
        expect(found.find(entry => entry.appId === "moonlit")?.key).toBe("com.narraleaf.games.moonlit");
    });

    it("counts a project once however it is reached, and skips what it cannot read", async () => {
        const mine = project("Projects/my-game", "My Game", "com.studio.game");
        fs.mkdirSync(path.join(root, "Projects", "broken"), { recursive: true });
        fs.writeFileSync(path.join(root, "Projects", "broken", "Broken.nlproj"), "not a config");

        const found = await listLocalAppIds({
            projectPaths: [mine, `${mine}${path.sep}`, "relative/path", path.join(root, "gone")],
            folders: [path.join(root, "Projects"), path.join(root, "missing")],
        });

        expect(found).toHaveLength(1);
        expect(found[0]).toMatchObject({ appId: "com.studio.game", key: "com.studio.game", projectName: "My Game" });
    });

    it("compares a project with no ID by the one its build ships with", async () => {
        project("Projects/old", "Ghost Story");
        const [found] = await listLocalAppIds({ projectPaths: [], folders: [path.join(root, "Projects")] });
        expect(found).toMatchObject({ appId: "", key: "com.narraleaf.games.ghost-story" });
    });
});
