import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({}));
// `@` is the renderer under vitest and main under the main build, so main's own alias does not
// resolve here; the module is a re-export of `fs/promises` in any case.
vi.mock("@/utils/unpatchedFs", async () => ({ unpatchedFsPromises: await import("fs/promises") }));

/**
 * The folder picker, answered by the test.
 *
 * Counted as well as answered: a refused request must be refused before the author is asked
 * anything, so "the dialog never came up" is half of what a refusal test checks.
 */
const { showOpenDialog } = vi.hoisted(() => ({
    showOpenDialog: vi.fn(async (_window: unknown, _options: unknown) => ({
        canceled: false,
        filePaths: [] as string[],
        bookmarks: undefined as string[] | undefined,
    })),
}));
vi.mock("../fileDialog", () => ({
    showOpenDialog,
    dialogTranslator: () => ({ t: (key: string) => key }),
}));

const { WINDOW_PROJECT_MISMATCH_CODE } = await import("@shared/types/window");
const { encodeProjectConfig, getProjectConfigFileName } = await import("@shared/utils/nlproj");
const { WorkspaceExportProjectPackageHandler } = await import("./projectPackageAction");

type AppWindowLike = Parameters<InstanceType<typeof WorkspaceExportProjectPackageHandler>["handle"]>[0];

let root: string;
/** The project the calling workspace has open. */
let mine: string;
/** Another project on the same disk, readable by the same user. */
let theirs: string;
/** Where the author points the export. */
let exportDir: string;

/**
 * A window on one project - or on none, which is what the launcher and the wizard are.
 *
 * Storage says yes to everything, deliberately: the read grant was the only check before, and with
 * it answering yes the refusal below can only have come from the project assertion.
 */
function makeWindow(projectPath?: string) {
    return {
        getProps: () => ({ projectPath }),
        app: {
            storageManager: {
                isPathAllowed: async () => true,
                isPathProtected: async () => false,
                grantFileSystemAccess: () => undefined,
            },
        },
    } as unknown as AppWindowLike;
}

async function writeProject(name: string, identifier: string): Promise<string> {
    const dir = path.join(root, name);
    await fs.mkdir(path.join(dir, "assets"), { recursive: true });
    await fs.writeFile(
        path.join(dir, getProjectConfigFileName(name)),
        encodeProjectConfig({ name, identifier, metadata: { version: "1.0.0" } }),
    );
    await fs.writeFile(path.join(dir, "assets", "marker.txt"), `${name}-marker`);
    return dir;
}

beforeEach(async () => {
    vi.clearAllMocks();
    root = await fs.mkdtemp(path.join(os.tmpdir(), "nls-package-guard-"));
    mine = await writeProject("mine", "com.example.mine");
    theirs = await writeProject("theirs", "com.example.theirs");
    exportDir = path.join(root, "out");
    await fs.mkdir(exportDir);
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [exportDir], bookmarks: undefined });
});

afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
});

/**
 * Which project a workspace may export.
 *
 * A package is the whole tree - scripts, plugins, assets - written to a folder the caller picks
 * next, so naming a project here is naming a tree to copy out. Only the workspace exports, and only
 * its own project.
 */
describe("workspace.projectPackage.export", () => {
    it("refuses a workspace naming a project other than its own, before asking for a folder", async () => {
        const result = await new WorkspaceExportProjectPackageHandler().handle(makeWindow(mine), { projectPath: theirs });

        expect(result.success).toBe(false);
        expect(result.success === false && result.code).toBe(WINDOW_PROJECT_MISMATCH_CODE);
        expect(showOpenDialog).not.toHaveBeenCalled();
        expect(await fs.readdir(exportDir)).toEqual([]);
    });

    it("refuses a window with no project of its own", async () => {
        const result = await new WorkspaceExportProjectPackageHandler().handle(makeWindow(undefined), { projectPath: mine });

        expect(result.success === false && result.code).toBe(WINDOW_PROJECT_MISMATCH_CODE);
        expect(showOpenDialog).not.toHaveBeenCalled();
    });

    it("exports the window's own project, under either spelling of its path", async () => {
        const spelled = process.platform === "win32" ? mine.toUpperCase() : `${mine}${path.sep}`;
        const result = await new WorkspaceExportProjectPackageHandler().handle(makeWindow(mine), { projectPath: spelled });

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.canceled).toBe(false);
        expect(path.dirname(result.data.packagePath!)).toBe(exportDir);
        expect(path.basename(result.data.packagePath!)).toMatch(/^mine.*\.nlspkg$/);
        expect(result.data.fileCount).toBeGreaterThan(0);
        expect((await fs.stat(result.data.packagePath!)).size).toBe(result.data.byteLength);
    });
});
