import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { showOpenDialog } = vi.hoisted(() => ({ showOpenDialog: vi.fn() }));

vi.mock("electron", () => ({
    dialog: { showOpenDialog },
    net: { request: vi.fn() },
}));

const { AssetExportToFolderHandler } = await import("./assetAction");
type AppWindowLike = Parameters<InstanceType<typeof AssetExportToFolderHandler>["handle"]>[0];

let root: string;
let project: string;
let exportDir: string;

/**
 * A window as this handler uses one: a storage manager that grants the project and nothing else,
 * which is the shape the real one has for a workspace window.
 */
function makeWindow(overrides: { protectedPath?: boolean } = {}) {
    return {
        win: {},
        app: {
            storageManager: {
                isPathProtected: vi.fn(async () => overrides.protectedPath ?? false),
                grantFileSystemAccess: vi.fn(),
                isPathAllowed: vi.fn(async (_window: unknown, fsPath: string, mode: string) => {
                    const target = path.resolve(fsPath);
                    if (mode === "write") {
                        return target === exportDir || target.startsWith(`${exportDir}${path.sep}`);
                    }
                    return target === project || target.startsWith(`${project}${path.sep}`);
                }),
            },
        },
    } as unknown as AppWindowLike;
}

beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "nl-asset-export-"));
    project = path.join(root, "project");
    exportDir = path.join(root, "out");
    await fs.mkdir(project, { recursive: true });
    await fs.mkdir(exportDir, { recursive: true });
    showOpenDialog.mockReset();
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [exportDir], bookmarks: [] });
});

afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
});

async function shard(id: string, contents: string): Promise<string> {
    const target = path.join(project, "assets", "content", id);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents, "utf8");
    return target;
}

describe("AssetExportToFolderHandler", () => {
    const handler = new AssetExportToFolderHandler();

    it("copies each shard out under the name and folder the renderer asked for", async () => {
        const room = await shard("a1", "room-bytes");
        const alley = await shard("a2", "alley-bytes");

        const result = await handler.handle(makeWindow(), {
            entries: [
                { sourcePath: room, relativePath: "room.png" },
                { sourcePath: alley, relativePath: "backdrops/night/alley.png" },
            ],
        });

        expect(result).toMatchObject({ success: true, data: { canceled: false, exportedCount: 2 } });
        await expect(fs.readFile(path.join(exportDir, "room.png"), "utf8")).resolves.toBe("room-bytes");
        await expect(fs.readFile(path.join(exportDir, "backdrops", "night", "alley.png"), "utf8"))
            .resolves.toBe("alley-bytes");
    });

    it("reports the dismissed dialog as a cancel rather than a failure", async () => {
        showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });

        await expect(handler.handle(makeWindow(), {
            entries: [{ sourcePath: await shard("a1", "x"), relativePath: "room.png" }],
        })).resolves.toEqual({ success: true, data: { canceled: true } });
    });

    it("suffixes rather than overwrites a file that is already there", async () => {
        await fs.writeFile(path.join(exportDir, "room.png"), "already-here", "utf8");

        await handler.handle(makeWindow(), {
            entries: [{ sourcePath: await shard("a1", "room-bytes"), relativePath: "room.png" }],
        });

        await expect(fs.readFile(path.join(exportDir, "room.png"), "utf8")).resolves.toBe("already-here");
        await expect(fs.readFile(path.join(exportDir, "room-1.png"), "utf8")).resolves.toBe("room-bytes");
    });

    it("refuses a source the window has no read grant for", async () => {
        const outside = path.join(root, "secret.txt");
        await fs.writeFile(outside, "not-yours", "utf8");

        const result = await handler.handle(makeWindow(), {
            entries: [{ sourcePath: outside, relativePath: "secret.txt" }],
        });

        expect(result).toMatchObject({ success: true, data: { exportedCount: 0 } });
        expect(result.success && result.data.failures).toHaveLength(1);
        await expect(fs.access(path.join(exportDir, "secret.txt"))).rejects.toThrow();
    });

    it("keeps a crafted relative path inside the chosen folder", async () => {
        const room = await shard("a1", "room-bytes");

        const result = await handler.handle(makeWindow(), {
            entries: [
                { sourcePath: room, relativePath: "../escaped.png" },
                { sourcePath: room, relativePath: "/absolute.png" },
            ],
        });

        // Both still export: a segment that means "somewhere else" is dropped rather than obeyed, so
        // what is left is a plain name under the folder the author picked.
        expect(result).toMatchObject({ success: true, data: { exportedCount: 2 } });
        await expect(fs.access(path.join(root, "escaped.png"))).rejects.toThrow();
        await expect(fs.readFile(path.join(exportDir, "escaped.png"), "utf8")).resolves.toBe("room-bytes");
        await expect(fs.readFile(path.join(exportDir, "absolute.png"), "utf8")).resolves.toBe("room-bytes");
    });

    it("copies a bundle asset as the directory it is", async () => {
        const bundle = path.join(project, "assets", "content", "m1");
        await fs.mkdir(path.join(bundle, "textures"), { recursive: true });
        await fs.writeFile(path.join(bundle, "model.json"), "{}", "utf8");
        await fs.writeFile(path.join(bundle, "textures", "skin.png"), "px", "utf8");

        const result = await handler.handle(makeWindow(), {
            entries: [{ sourcePath: bundle, relativePath: "hero", isDirectory: true }],
        });

        expect(result).toMatchObject({ success: true, data: { exportedCount: 1 } });
        await expect(fs.readFile(path.join(exportDir, "hero", "textures", "skin.png"), "utf8")).resolves.toBe("px");
    });

    it("refuses a folder inside protected Studio storage", async () => {
        const result = await handler.handle(makeWindow({ protectedPath: true }), {
            entries: [{ sourcePath: await shard("a1", "x"), relativePath: "room.png" }],
        });

        expect(result).toMatchObject({ success: false });
    });

    it("carries on past a failure and names what did not land", async () => {
        const room = await shard("a1", "room-bytes");
        const missing = path.join(project, "assets", "content", "gone");

        const result = await handler.handle(makeWindow(), {
            entries: [
                { sourcePath: missing, relativePath: "gone.png" },
                { sourcePath: room, relativePath: "room.png" },
            ],
        });

        expect(result).toMatchObject({ success: true, data: { exportedCount: 1 } });
        expect(result.success && result.data.failures?.[0].relativePath).toBe("gone.png");
        await expect(fs.readFile(path.join(exportDir, "room.png"), "utf8")).resolves.toBe("room-bytes");
    });
});
