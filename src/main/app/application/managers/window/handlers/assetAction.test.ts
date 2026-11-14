import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

/**
 * The app as a picker reads it: whether this launch answers dialogs from a page rather than opening
 * them, and the language its title and button are written in. A stored language keeps the resolver
 * off `electron/main`, which is not resolvable under the test runner.
 */
function appDouble() {
    return {
        hasExperimentalCondition: () => false,
        getCommandLineBuild: () => false,
        getCommandLineCheck: () => false,
        globalState: { get: (key: string) => (key === "app.language" ? "en" : undefined) },
    };
}

/**
 * A window as this handler uses one: a storage manager that grants the project and nothing else,
 * which is the shape the real one has for a workspace window.
 *
 * `isPathAllowed` answers for the project only - there is deliberately no write branch for the
 * export folder, because the handler must not need one. The copying happens in main.
 */
function makeWindow(overrides: { protectedPath?: boolean } = {}) {
    return {
        win: {},
        getApp: () => appDouble(),
        // A window somebody is looking at: the picker opens (see `unattendedPrompt.ts`).
        refuseUnattendedPrompt: () => undefined,
        app: {
            storageManager: {
                isPathProtected: vi.fn(async () => overrides.protectedPath ?? false),
                grantFileSystemAccess: vi.fn(),
                startSecurityScopedAccess: vi.fn(),
                isPathAllowed: vi.fn(async (_window: unknown, fsPath: string) => {
                    const target = path.resolve(fsPath);
                    return target === project || target.startsWith(`${project}${path.sep}`);
                }),
                isPathTreeAllowed: vi.fn(async (_window: unknown, fsPath: string) => {
                    const target = path.resolve(fsPath);
                    return target === project || target.startsWith(`${project}${path.sep}`);
                }),
            },
        },
    } as unknown as AppWindowLike;
}

/** The mocked storage manager off a window built by {@link makeWindow}. */
function storageOf(window: AppWindowLike) {
    return (window as unknown as {
        app: { storageManager: { grantFileSystemAccess: ReturnType<typeof vi.fn>; startSecurityScopedAccess: ReturnType<typeof vi.fn> } };
    }).app.storageManager;
}

beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "nl-asset-export-"));
    project = path.join(root, "project");
    exportDir = path.join(root, "out");
    await fs.mkdir(project, { recursive: true });
    await fs.mkdir(exportDir, { recursive: true });
    showOpenDialog.mockReset();
    showSaveDialog.mockReset();
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: path.join(exportDir, "chosen.png") });
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [exportDir], bookmarks: [] });
});

afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
});

/** A shard holding a real PNG header, which is what the export has to read a name out of. */
async function pngShard(id: string): Promise<string> {
    const target = path.join(project, "assets", "content", id);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.alloc(64),
    ]));
    return target;
}

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

    it("names a file from its bytes when the library holds no extension", async () => {
        // An asset record's `ext` is optional, and a shipped template's records do not carry it, so
        // the name arriving here can be a bare `classroom` - which would land as a file the author's
        // system cannot open.
        const result = await handler.handle(makeWindow(), {
            entries: [{ sourcePath: await pngShard("a1"), relativePath: "backdrops/classroom" }],
        });

        expect(result).toMatchObject({ success: true, data: { exportedCount: 1 } });
        await expect(fs.access(path.join(exportDir, "backdrops", "classroom.png"))).resolves.toBeUndefined();
    });

    it("leaves a name that already carries an extension alone", async () => {
        await handler.handle(makeWindow(), {
            entries: [{ sourcePath: await pngShard("a1"), relativePath: "room.png" }],
        });

        await expect(fs.access(path.join(exportDir, "room.png"))).resolves.toBeUndefined();
        await expect(fs.access(path.join(exportDir, "room.png.png"))).rejects.toThrow();
    });

    it("leaves a bundle unnamed: a folder has no extension", async () => {
        const bundle = path.join(project, "assets", "content", "m1");
        await fs.mkdir(bundle, { recursive: true });
        await fs.writeFile(path.join(bundle, "model.json"), "{}", "utf8");

        await handler.handle(makeWindow(), {
            entries: [{ sourcePath: bundle, relativePath: "hero", isDirectory: true }],
        });

        await expect(fs.access(path.join(exportDir, "hero", "model.json"))).resolves.toBeUndefined();
    });

    it("opens the security scope without granting the renderer the chosen folder", async () => {
        // The picker hands back a READ grant on purpose (`selectDirectory` in permissions.ts). Main
        // does the copying, so it needs the macOS scope open and nothing else; issuing a grant here
        // would leave the renderer able to write anywhere under the author's folder for the session.
        const window = makeWindow();
        await handler.handle(window, {
            entries: [{ sourcePath: await shard("a1", "room-bytes"), relativePath: "room.png" }],
        });

        expect(storageOf(window).grantFileSystemAccess).not.toHaveBeenCalled();
        expect(storageOf(window).startSecurityScopedAccess).toHaveBeenCalledWith(
            window,
            exportDir,
            undefined,
            "session",
        );
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

    it("keeps concurrent exports from overwriting the same name", async () => {
        const first = await shard("a1", "first");
        const second = await shard("a2", "second");
        const target = path.join(exportDir, "room.png");
        const originalAccess = fs.access.bind(fs);
        let count = 0;
        let release: (() => void) | undefined;
        const bothChecked = new Promise<void>(resolve => { release = resolve; });
        const access = vi.spyOn(fs, "access").mockImplementation(async candidate => {
            if (String(candidate) === target && count < 2) {
                count += 1;
                if (count === 2) release?.();
                await bothChecked;
                throw Object.assign(new Error("not found"), { code: "ENOENT" });
            }
            return originalAccess(candidate);
        });
        try {
            const results = await Promise.all([first, second].map(sourcePath => handler.handle(makeWindow(), {
                entries: [{ sourcePath, relativePath: "room.png" }],
            })));
            expect(results.every(result => result.success && result.data.exportedCount === 1)).toBe(true);
            const contents = await Promise.all(["room.png", "room-1.png"].map(name => fs.readFile(path.join(exportDir, name), "utf8")));
            expect(contents.sort()).toEqual(["first", "second"]);
        } finally {
            access.mockRestore();
        }
    });

    it("gives concurrent bundle exports distinct folders", async () => {
        const bundles = ["a", "b"].map(name => path.join(project, "assets", "content", name));
        for (const [index, bundle] of bundles.entries()) {
            await fs.mkdir(bundle, { recursive: true });
            await fs.writeFile(path.join(bundle, "model.json"), String(index));
        }

        const results = await Promise.all(bundles.map(sourcePath => handler.handle(makeWindow(), {
            entries: [{ sourcePath, relativePath: "model", isDirectory: true }],
        })));
        expect(results.every(result => result.success && result.data.exportedCount === 1)).toBe(true);
        const contents = await Promise.all(["model", "model-1"].map(name => fs.readFile(path.join(exportDir, name, "model.json"), "utf8")));
        expect(contents.sort()).toEqual(["0", "1"]);
    });

    it("does not follow a directory link outside the chosen folder", async () => {
        const outside = path.join(root, "outside");
        await fs.mkdir(outside);
        await fs.symlink(outside, path.join(exportDir, "link"), process.platform === "win32" ? "junction" : "dir");

        const result = await handler.handle(makeWindow(), {
            entries: [{ sourcePath: await shard("a1", "room-bytes"), relativePath: "link/room.png" }],
        });
        expect(result).toMatchObject({ success: true, data: { exportedCount: 0 } });
        await expect(fs.access(path.join(outside, "room.png"))).rejects.toThrow();
    });

    it("does not write outside when an export parent is replaced after its check", async () => {
        const outside = path.join(root, "outside");
        const parent = path.join(exportDir, "folder");
        await fs.mkdir(outside);
        await fs.mkdir(parent);
        const source = await shard("race", "room-bytes");
        const originalOpen = fs.open.bind(fs);
        const originalLstat = fs.lstat.bind(fs);
        let swapped = false;
        const swap = async () => {
            if (swapped) return;
            swapped = true;
            await fs.rename(parent, `${parent}-original`);
            await fs.symlink(outside, parent, process.platform === "win32" ? "junction" : "dir");
        };
        const openProbe = vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
            const result = await originalOpen(...args);
            if (process.platform !== "win32" && String(args[0]) === exportDir) await swap();
            return result;
        });
        const statProbe = vi.spyOn(fs, "lstat").mockImplementation(async (...args: Parameters<typeof fs.lstat>) => {
            const result = await originalLstat(...args);
            if (process.platform === "win32" && String(args[0]) === parent) await swap();
            return result;
        });
        try {
            await handler.handle(makeWindow(), {
                entries: [{ sourcePath: source, relativePath: "folder/room.png" }],
            });
            expect(swapped).toBe(true);
            await expect(fs.access(path.join(outside, "room.png"))).rejects.toThrow();
        } finally {
            openProbe.mockRestore();
            statProbe.mockRestore();
        }
    });

    it.runIf(process.platform === "darwin" || process.platform === "linux")("does not write through a replaced selected export directory", async () => {
        const outside = path.join(root, "outside");
        await fs.mkdir(outside);
        const source = await shard("root-race", "room-bytes");
        const originalOpen = fs.open.bind(fs);
        let swapped = false;
        const openProbe = vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
            if (String(args[0]) === exportDir && !swapped) {
                swapped = true;
                await fs.rename(exportDir, `${exportDir}-original`);
                await fs.symlink(outside, exportDir, process.platform === "win32" ? "junction" : "dir");
            }
            return originalOpen(...args);
        });
        try {
            const result = await handler.handle(makeWindow(), {
                entries: [{ sourcePath: source, relativePath: "room.png" }],
            });
            expect(swapped).toBe(true);
            expect(result).toMatchObject({ success: true, data: { exportedCount: 0 } });
            await expect(fs.access(path.join(outside, "room.png"))).rejects.toThrow();
        } finally {
            openProbe.mockRestore();
        }
    });

    it.runIf(process.platform === "darwin" || process.platform === "linux")("does not write into a parent moved outside after opening it", async () => {
        const parent = path.join(exportDir, "folder");
        const outside = path.join(root, "moved-outside");
        await fs.mkdir(parent);
        const source = await shard("move-race", "room-bytes");
        const originalStat = fs.stat.bind(fs);
        let swapped = false;
        const probe = vi.spyOn(fs, "stat").mockImplementation(async (...args: Parameters<typeof fs.stat>) => {
            if (!swapped && String(args[0]) === source) {
                swapped = true;
                await fs.rename(parent, outside);
            }
            return originalStat(...args);
        });
        try {
            await handler.handle(makeWindow(), { entries: [{ sourcePath: source, relativePath: "folder/room.png" }] });
            expect(swapped).toBe(true);
            await expect(fs.access(path.join(outside, "room.png"))).rejects.toThrow();
        } finally {
            probe.mockRestore();
        }
    });

    it("requires recursive read access before exporting a bundle", async () => {
        const bundle = path.join(project, "assets", "content", "m1");
        await fs.mkdir(bundle, { recursive: true });
        await fs.writeFile(path.join(bundle, "model.json"), "{}");
        const window = makeWindow();
        vi.mocked(window.app.storageManager.isPathTreeAllowed).mockResolvedValue(false);

        const result = await handler.handle(window, { entries: [{ sourcePath: bundle, relativePath: "model", isDirectory: true }] });
        expect(result).toMatchObject({ success: true, data: { exportedCount: 0 } });
        await expect(fs.access(path.join(exportDir, "model"))).rejects.toThrow();
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

    it.runIf(process.platform === "darwin" || process.platform === "linux")("keeps a bundle's relative internal links usable after export", async () => {
        const bundle = path.join(project, "model");
        await fs.mkdir(path.join(bundle, "textures"), { recursive: true });
        await fs.writeFile(path.join(bundle, "textures", "skin.png"), "px");
        await fs.symlink("textures", path.join(bundle, "alias"), "dir");

        const result = await handler.handle(makeWindow(), {
            entries: [{ sourcePath: bundle, relativePath: "hero", isDirectory: true }],
        });
        expect(result).toMatchObject({ success: true, data: { exportedCount: 1 } });
        await fs.rename(bundle, `${bundle}-original`);
        await expect(fs.readFile(path.join(exportDir, "hero", "alias", "skin.png"), "utf8")).resolves.toBe("px");
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

describe("AssetExportToFileHandler", () => {
    const handler = new AssetExportToFileHandler();

    it("writes the file where the author named it", async () => {
        const room = await shard("a1", "room-bytes");

        const result = await handler.handle(makeWindow(), {
            entry: { sourcePath: room, fileName: "room.png" },
        });

        expect(result).toMatchObject({
            success: true,
            data: { canceled: false, filePath: path.join(exportDir, "chosen.png") },
        });
        await expect(fs.readFile(path.join(exportDir, "chosen.png"), "utf8")).resolves.toBe("room-bytes");
    });

    it("opens the dialog on the library's own name for the file", async () => {
        await handler.handle(makeWindow(), {
            entry: { sourcePath: await shard("a1", "x"), fileName: "room.png" },
        });

        expect(showSaveDialog.mock.calls[0][1]).toMatchObject({ defaultPath: "room.png" });
    });

    it("fills the dialog with a name the bytes can be saved under", async () => {
        // The name has to be right BEFORE the dialog opens: it fills the field and picks the filter,
        // and an author who accepts what is offered must not end up with an extensionless file.
        await handler.handle(makeWindow(), {
            entry: { sourcePath: await pngShard("a1"), fileName: "classroom" },
        });

        expect(showSaveDialog.mock.calls[0][1]).toMatchObject({
            defaultPath: "classroom.png",
            filters: [{ name: "PNG", extensions: ["png"] }, { name: "All files", extensions: ["*"] }],
        });
    });

    it("overwrites what the dialog already asked about", async () => {
        // The save dialog confirms the replacement itself, so a second name-and-save has to land on
        // the file the author pointed at rather than beside it as the folder export would.
        await fs.writeFile(path.join(exportDir, "chosen.png"), "already-here", "utf8");

        await handler.handle(makeWindow(), {
            entry: { sourcePath: await shard("a1", "room-bytes"), fileName: "room.png" },
        });

        await expect(fs.readFile(path.join(exportDir, "chosen.png"), "utf8")).resolves.toBe("room-bytes");
    });

    it("opens the security scope without granting the renderer the chosen location", async () => {
        const window = makeWindow();
        await handler.handle(window, {
            entry: { sourcePath: await shard("a1", "x"), fileName: "room.png" },
        });

        expect(storageOf(window).grantFileSystemAccess).not.toHaveBeenCalled();
        expect(storageOf(window).startSecurityScopedAccess).toHaveBeenCalledWith(
            window,
            path.join(exportDir, "chosen.png"),
            undefined,
            "session",
        );
    });

    it("reports the dismissed dialog as a cancel rather than a failure", async () => {
        showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined });

        await expect(handler.handle(makeWindow(), {
            entry: { sourcePath: await shard("a1", "x"), fileName: "room.png" },
        })).resolves.toEqual({ success: true, data: { canceled: true } });
    });

    it("refuses a source the window has no read grant for, without opening a dialog", async () => {
        const outside = path.join(root, "secret.txt");
        await fs.writeFile(outside, "not-yours", "utf8");

        const result = await handler.handle(makeWindow(), {
            entry: { sourcePath: outside, fileName: "secret.txt" },
        });

        expect(result).toMatchObject({ success: false });
        expect(showSaveDialog).not.toHaveBeenCalled();
    });

    it("refuses a location inside protected Studio storage", async () => {
        const result = await handler.handle(makeWindow({ protectedPath: true }), {
            entry: { sourcePath: await shard("a1", "x"), fileName: "room.png" },
        });

        expect(result).toMatchObject({ success: false });
        await expect(fs.access(path.join(exportDir, "chosen.png"))).rejects.toThrow();
    });
});
