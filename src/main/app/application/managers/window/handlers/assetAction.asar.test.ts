import os from "os";
import path from "path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ARCHIVE_NAMED_FILES, asarArchiveBytes, unsimulatedFs as fs, writeArchiveNamedTree } from "@shared/utils/asarPatchSimulation";

// Electron's asar patch, reproduced: see asarPatchSimulation.ts.
vi.mock("fs", async () => (await import("@shared/utils/asarPatchSimulation")).simulatedFsModule());
vi.mock("fs/promises", async () => (await import("@shared/utils/asarPatchSimulation")).simulatedFsPromisesModule());
afterAll(async () => (await import("@shared/utils/asarPatchSimulation")).restoreOriginalFs());

const { showOpenDialog, showSaveDialog } = vi.hoisted(() => ({
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
}));

vi.mock("electron", () => ({
    dialog: { showOpenDialog, showSaveDialog },
    net: { request: vi.fn() },
}));

const { AssetExportToFileHandler, AssetExportToFolderHandler } = await import("./assetAction");
type AppWindowLike = Parameters<InstanceType<typeof AssetExportToFolderHandler>["handle"]>[0];

let root: string;
let project: string;
let exportDir: string;

/** A window whose storage manager grants the project and nothing else, as a workspace window's does. */
function makeWindow(): AppWindowLike {
    return {
        win: {},
        getApp: () => ({
            hasExperimentalCondition: () => false,
            getCommandLineBuild: () => false,
            getCommandLineCheck: () => false,
            globalState: { get: (key: string) => (key === "app.language" ? "en" : undefined) },
        }),
        refuseUnattendedPrompt: () => undefined,
        app: {
            storageManager: {
                isPathProtected: vi.fn(async () => false),
                grantFileSystemAccess: vi.fn(),
                startSecurityScopedAccess: vi.fn(),
                isPathAllowed: vi.fn(async (_window: unknown, fsPath: string) => {
                    const target = path.resolve(fsPath);
                    return target === project || target.startsWith(`${project}${path.sep}`);
                }),
            },
        },
    } as unknown as AppWindowLike;
}

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nl-asset-export-asar-"));
    project = path.join(root, "project");
    exportDir = path.join(root, "out");
    fs.mkdirSync(project, { recursive: true });
    fs.mkdirSync(exportDir, { recursive: true });
    showOpenDialog.mockReset();
    showSaveDialog.mockReset();
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [exportDir], bookmarks: [] });
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

describe("exporting library files named like archives", () => {
    it("copies a model bundle holding them out byte for byte", async () => {
        const bundle = path.join(project, "assets", "content", "m1");
        const bytes = writeArchiveNamedTree(bundle);

        const result = await new AssetExportToFolderHandler().handle(makeWindow(), {
            entries: [{ sourcePath: bundle, relativePath: "hero", isDirectory: true }],
        });

        expect(result).toMatchObject({ success: true, data: { exportedCount: 1 } });
        for (const relative of ARCHIVE_NAMED_FILES) {
            expect(fs.readFileSync(path.join(exportDir, "hero", ...relative.split("/"))).equals(bytes[relative])).toBe(true);
        }
    });

    /**
     * The export never overwrites what is already in the chosen folder: it looks for a free name.
     * Asking whether `pack.asar` is free through the patched module answers yes when a real archive
     * of that name is there - the patch cannot find the empty path inside it - so the author's file
     * would be written over.
     */
    it("does not write over an archive already in the chosen folder", async () => {
        const shard = path.join(project, "assets", "content", "a1");
        const exported = asarArchiveBytes({ "exported.txt": "the library's archive" });
        fs.mkdirSync(path.dirname(shard), { recursive: true });
        fs.writeFileSync(shard, exported);
        const alreadyThere = asarArchiveBytes({ "mine.txt": "the author's own archive" });
        fs.writeFileSync(path.join(exportDir, "pack.asar"), alreadyThere);

        const result = await new AssetExportToFolderHandler().handle(makeWindow(), {
            entries: [{ sourcePath: shard, relativePath: "pack.asar" }],
        });

        expect(result).toMatchObject({ success: true, data: { exportedCount: 1 } });
        expect(fs.readFileSync(path.join(exportDir, "pack.asar")).equals(alreadyThere)).toBe(true);
        expect(fs.readFileSync(path.join(exportDir, "pack-1.asar")).equals(exported)).toBe(true);
    });

    it("copies one archive out to the file the author names", async () => {
        const shard = path.join(project, "assets", "content", "a2");
        const exported = asarArchiveBytes({ "exported.txt": "one archive" });
        fs.mkdirSync(path.dirname(shard), { recursive: true });
        fs.writeFileSync(shard, exported);
        showSaveDialog.mockResolvedValue({ canceled: false, filePath: path.join(exportDir, "chosen.asar") });

        const result = await new AssetExportToFileHandler().handle(makeWindow(), {
            entry: { sourcePath: shard, fileName: "chosen.asar" },
        });

        expect(result).toMatchObject({ success: true, data: { canceled: false } });
        expect(fs.readFileSync(path.join(exportDir, "chosen.asar")).equals(exported)).toBe(true);
    });
});
