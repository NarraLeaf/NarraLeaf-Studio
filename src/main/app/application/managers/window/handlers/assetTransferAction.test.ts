import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WindowAppType } from "@shared/types/window";
import type { AssetTransferEntry, AssetTransferOfferResult, AssetTransferRedeemResult } from "@shared/types/assetTransfer";
import { StorageManager } from "../../storageManager";
import { PluginPermissionManager } from "../../pluginPermissionManager";
import { FileSystemHashHandler } from "../../protocol/fileSystemHandler";
import { Fs } from "@shared/utils/fs";
import type { AppWindow } from "../appWindow";
import { AssetTransferOfferHandler, AssetTransferRedeemHandler } from "./assetTransferAction";
import { AssetExportToFolderHandler } from "./assetAction";
import { PrivilegedFsCallHandler } from "./privilegedAction";
import {
    FsCopyDirHandler,
    FsDeleteDirHandler,
    FsDirectorySizeHandler,
    FsListHandler,
    FsMoveDirHandler,
    FsMoveFileHandler,
    FsRenameHandler,
    FsRequestReadDirHandler,
} from "./fsAction";

const { showOpenDialog } = vi.hoisted(() => ({ showOpenDialog: vi.fn() }));

vi.mock("electron", () => ({
    app: {
        startAccessingSecurityScopedResource: vi.fn(() => vi.fn()),
    },
    dialog: { showOpenDialog },
    net: { request: vi.fn() },
}));

vi.mock("@shared/utils/persistentState", () => ({
    PersistentState: class {
        private store: Record<string, unknown>;
        constructor(config: { defaults: Record<string, unknown> }) { this.store = structuredClone(config.defaults); }
        getItem(key: string) { return this.store[key]; }
        setItem(key: string, value: unknown) { this.store[key] = value; }
    },
}));

const offerHandler = new AssetTransferOfferHandler();
const redeemHandler = new AssetTransferRedeemHandler();

let tempDir: string;
let storageManager: StorageManager;
let pluginPermissionManager: PluginPermissionManager;
/** The project the copy comes out of, and one the pasting window owns instead. */
let sourceProject: string;
let targetProject: string;

/**
 * A window as the handlers see one: the real storage manager, so the declared project grant and
 * `isPathAllowed` behave exactly as they do in the app. Nothing here is stubbed except the pieces
 * of `App` the manager reads.
 */
function makeWindow(
    webContentsId: number,
    windowType: WindowAppType,
    projectPath: string,
): AppWindow {
    return {
        win: {},
        getWindowType: () => windowType,
        getProps: () => ({ projectPath }),
        getWebContents: () => ({ id: webContentsId }),
        getApp: () => ({
            hasExperimentalCondition: () => false,
            getCommandLineBuild: () => false,
            getCommandLineCheck: () => false,
            globalState: { get: (key: string) => key === "app.language" ? "en" : undefined },
        }),
        refuseUnattendedPrompt: () => undefined,
        app: { storageManager, pluginPermissionManager, logger: { debug: vi.fn() } },
    } as unknown as AppWindow;
}

async function asset(project: string, name: string, contents: string): Promise<string> {
    const target = path.join(project, "assets", "content", name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents, "utf8");
    return target;
}

/** A model bundle's shape on disk: a manifest at the root and its textures in a folder below it. */
async function bundle(root: string): Promise<{ root: string; manifest: string; texture: string }> {
    const manifest = path.join(root, "hiyori.model3.json");
    const texture = path.join(root, "hiyori.2048", "texture_00.png");
    await fs.mkdir(path.dirname(texture), { recursive: true });
    await fs.writeFile(manifest, "{}", "utf8");
    await fs.writeFile(texture, "png-bytes", "utf8");
    return { root, manifest, texture };
}

function entry(sourcePath: string, overrides: Partial<AssetTransferEntry> = {}): AssetTransferEntry {
    return {
        assetId: "asset-1",
        fileName: "room.png",
        type: "image",
        size: 10,
        sourcePath,
        ...overrides,
    };
}

async function offer(window: AppWindow, entries: AssetTransferEntry[]): Promise<AssetTransferOfferResult> {
    const result = await offerHandler.handle(window, { entries });
    expect(result.success).toBe(true);
    return (result as { success: true; data: AssetTransferOfferResult }).data;
}

function redeem(window: AppWindow, token: string): AssetTransferRedeemResult {
    const result = redeemHandler.handle(window, { token });
    expect(result.success).toBe(true);
    return (result as { success: true; data: AssetTransferRedeemResult }).data;
}

/** The token from an offer that was expected to succeed. */
async function tokenFor(window: AppWindow, entries: AssetTransferEntry[]): Promise<string> {
    const result = await offer(window, entries);
    expect(result.offered).toBe(true);
    return (result as { offered: true; token: string }).token;
}

beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-asset-transfer-"));
    sourceProject = path.join(tempDir, "project-a");
    targetProject = path.join(tempDir, "project-b");
    await fs.mkdir(sourceProject, { recursive: true });
    await fs.mkdir(targetProject, { recursive: true });
    storageManager = new StorageManager({
        getUserDataDir: () => path.join(tempDir, "user-data"),
        getBuiltInPluginsDir: () => path.join(tempDir, "app", "dist", "builtin-plugins"),
        logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
        hasExperimentalCondition: () => false,
    } as any);
    pluginPermissionManager = new PluginPermissionManager(path.join(tempDir, "user-data"));
});

describe("recursive file operations", () => {
    it("does not export into protected storage below the selected folder", async () => {
        const window = makeWindow(1, WindowAppType.Workspace, sourceProject);
        const source = await asset(sourceProject, "exported", "author asset");
        const userData = path.join(tempDir, "user-data");
        await fs.mkdir(path.join(userData, "plugins"), { recursive: true });
        showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [userData], bookmarks: [] });
        const result = await new AssetExportToFolderHandler().handle(window, {
            entries: [{ sourcePath: source, relativePath: "plugins/exported.txt" }],
        });
        expect(result).toMatchObject({ success: true, data: { exportedCount: 0 } });
        await expect(fs.access(path.join(userData, "plugins", "exported.txt"))).rejects.toThrow();
    });

    it("refuses protected descendants through the privileged filesystem facade", async () => {
        const window = makeWindow(1, WindowAppType.Workspace, sourceProject);
        const userData = path.join(tempDir, "user-data");
        const secret = path.join(userData, "plugins", "private.txt");
        await fs.mkdir(path.dirname(secret), { recursive: true });
        await fs.writeFile(secret, "private plugin data");
        storageManager.grantFileSystemAccess(window, userData, "readwrite", true);
        const destination = path.join(sourceProject, "copied-data");

        const result = await new PrivilegedFsCallHandler().handle(window, {
            actor: { kind: "facade", id: "default" }, operation: "copyDir", src: userData, dest: destination,
        });
        expect(result).toMatchObject({ success: true, data: { ok: false, error: { code: "PERMISSION_DENIED" } } });
        await expect(fs.access(path.join(destination, "plugins", "private.txt"))).rejects.toThrow();
    });

    it("does not let a plugin turn a non-recursive grant into a tree copy", async () => {
        const window = makeWindow(1, WindowAppType.Workspace, sourceProject);
        const model = await bundle(path.join(tempDir, "outside", "model"));
        const destination = path.join(sourceProject, "copy");
        storageManager.grantFileSystemAccess(window, model.root, "read", false);
        const plugin = { id: "plugin.test", version: "1.0.0" };
        for (const [index, grant] of [
            { path: model.root, mode: "read" as const, recursive: false },
            { path: sourceProject, mode: "write" as const, recursive: true },
        ].entries()) {
            const request = { kind: "filesystem" as const, plugin, requestId: `grant-${index}`, persistence: "temporary" as const, ...grant };
            pluginPermissionManager.grantPermission(request, { requestId: request.requestId, approved: true });
        }
        const result = await new PrivilegedFsCallHandler().handle(window, {
            actor: { kind: "plugin", pluginId: plugin.id, version: plugin.version }, operation: "copyDir", src: model.root, dest: destination,
        });
        expect(result).toMatchObject({ success: true, data: { ok: false, error: { code: "PERMISSION_DENIED" } } });
        await expect(fs.access(destination)).rejects.toThrow();
    });

    it("lets a plugin copy a tree when both plugin and window grants are recursive", async () => {
        const window = makeWindow(1, WindowAppType.Workspace, sourceProject);
        const model = await bundle(path.join(tempDir, "outside", "model"));
        const destination = path.join(sourceProject, "copy");
        storageManager.grantFileSystemAccess(window, model.root, "read", true);
        const plugin = { id: "plugin.test", version: "1.0.0" };
        for (const [index, grant] of [
            { path: model.root, mode: "read" as const, recursive: true },
            { path: sourceProject, mode: "write" as const, recursive: true },
        ].entries()) {
            const request = { kind: "filesystem" as const, plugin, requestId: `grant-${index}`, persistence: "temporary" as const, ...grant };
            pluginPermissionManager.grantPermission(request, { requestId: request.requestId, approved: true });
        }
        const result = await new PrivilegedFsCallHandler().handle(window, {
            actor: { kind: "plugin", pluginId: plugin.id, version: plugin.version }, operation: "copyDir", src: model.root, dest: destination,
        });
        expect(result).toMatchObject({ success: true, data: { ok: true } });
        await expect(fs.readFile(path.join(destination, "hiyori.2048", "texture_00.png"), "utf8")).resolves.toBe("png-bytes");
    });

    it("lets a plugin follow an internal link in its recursive grant", async () => {
        const window = makeWindow(1, WindowAppType.Workspace, sourceProject);
        const allowed = path.join(sourceProject, "allowed");
        const inside = path.join(allowed, "content");
        await fs.mkdir(inside, { recursive: true });
        await fs.writeFile(path.join(inside, "asset.txt"), "author asset");
        await fs.symlink(inside, path.join(allowed, "alias"), process.platform === "win32" ? "junction" : "dir");
        const plugin = { id: "plugin.test", version: "1.0.0" };
        for (const [index, grant] of [
            { path: allowed, mode: "read" as const, recursive: true },
            { path: sourceProject, mode: "write" as const, recursive: true },
        ].entries()) {
            const request = { kind: "filesystem" as const, plugin, requestId: `grant-${index}`, persistence: "temporary" as const, ...grant };
            pluginPermissionManager.grantPermission(request, { requestId: request.requestId, approved: true });
        }
        const destination = path.join(sourceProject, "copied-asset.txt");
        const result = await new PrivilegedFsCallHandler().handle(window, {
            actor: { kind: "plugin", pluginId: plugin.id, version: plugin.version }, operation: "copyFile",
            src: path.join(allowed, "alias", "asset.txt"), dest: destination,
        });
        expect(result).toMatchObject({ success: true, data: { ok: true } });
        await expect(fs.readFile(destination, "utf8")).resolves.toBe("author asset");
    });

    it("does not copy a tree containing protected Studio storage", async () => {
        const window = makeWindow(1, WindowAppType.Workspace, sourceProject);
        const userData = path.join(tempDir, "user-data");
        const secret = path.join(userData, "plugins", "private.txt");
        await fs.mkdir(path.dirname(secret), { recursive: true });
        await fs.writeFile(secret, "private plugin data");
        storageManager.grantFileSystemAccess(window, userData, "read", true);

        expect(await storageManager.isPathAllowed(window, secret, "read")).toBe(false);
        const destination = path.join(sourceProject, "copied-data");
        const result = await new FsCopyDirHandler().handle(window, { src: userData, dest: destination });
        expect(result).toMatchObject({ success: true, data: { ok: false, error: { code: "PERMISSION_DENIED" } } });
        await expect(fs.access(path.join(destination, "plugins", "private.txt"))).rejects.toThrow();
    });

    it("serves internal links but refuses links outside a directory hash", async () => {
        const window = makeWindow(1, WindowAppType.Workspace, sourceProject);
        const model = await bundle(path.join(sourceProject, "model"));
        const outside = path.join(tempDir, "outside");
        await fs.mkdir(outside);
        await fs.writeFile(path.join(outside, "secret.txt"), "outside secret");
        await fs.symlink(outside, path.join(model.root, "escape"), process.platform === "win32" ? "junction" : "dir");
        await fs.symlink(path.dirname(model.texture), path.join(model.root, "inside"), process.platform === "win32" ? "junction" : "dir");

        const granted = await new FsRequestReadDirHandler().handle(window, { path: model.root });
        expect(granted.success && granted.data.ok).toBe(true);
        if (!granted.success || !granted.data.ok) throw new Error("Directory grant failed");
        const handler = new FileSystemHashHandler("app", {}, storageManager, { mayRunProjectCode: () => true });
        const hash = granted.data.data;
        const get = (name: string) => handler.handle({ url: `app://fs/${hash}/${name}`, method: "GET" } as Request);
        const internal = await get("inside/texture_00.png");
        expect(internal.statusCode).toBe(200);
        expect(Buffer.isBuffer(internal.data) && internal.data.toString()).toBe("png-bytes");
        expect((await get("escape/secret.txt")).statusCode).toBe(403);
    });

    it("refuses a file replaced after directory hash resolution", async () => {
        const window = makeWindow(1, WindowAppType.Workspace, sourceProject);
        const model = await bundle(path.join(sourceProject, "model"));
        const outside = path.join(tempDir, "outside");
        await fs.mkdir(outside);
        await fs.writeFile(path.join(outside, "texture_00.png"), "outside secret");
        const physicalTexture = await fs.realpath(model.texture);
        const granted = await new FsRequestReadDirHandler().handle(window, { path: model.root });
        if (!granted.success || !granted.data.ok) throw new Error("Directory grant failed");
        const handler = new FileSystemHashHandler("app", {}, storageManager, { mayRunProjectCode: () => true });
        const originalOpen = Fs.openForRead.bind(Fs);
        let swapped = false;
        const probe = vi.spyOn(Fs, "openForRead").mockImplementation(async file => {
            if (file === physicalTexture) {
                swapped = true;
                const parent = path.dirname(model.texture);
                await fs.rename(parent, `${parent}-original`);
                await fs.symlink(outside, parent, process.platform === "win32" ? "junction" : "dir");
            }
            return originalOpen(file);
        });
        try {
            const response = await handler.handle({ url: `app://fs/${granted.data.data}/hiyori.2048/texture_00.png`, method: "GET" } as Request);
            expect(swapped).toBe(true);
            expect(response.statusCode).toBe(403);
        } finally {
            probe.mockRestore();
        }
    });

    it("does not mint a directory hash when its root is replaced after authorization", async () => {
        const window = makeWindow(1, WindowAppType.Workspace, sourceProject);
        const model = await bundle(path.join(sourceProject, "model"));
        const outside = path.join(tempDir, "outside");
        await fs.mkdir(outside);
        await fs.writeFile(path.join(outside, "secret.txt"), "outside secret");
        const originalCheck = Fs.isDirExists.bind(Fs);
        let swapped = false;
        const probe = vi.spyOn(Fs, "isDirExists").mockImplementation(async candidate => {
            const result = await originalCheck(candidate);
            if (candidate === model.root) {
                swapped = true;
                await fs.rename(model.root, `${model.root}-original`);
                await fs.symlink(outside, model.root, process.platform === "win32" ? "junction" : "dir");
            }
            return result;
        });
        try {
            const result = await new FsRequestReadDirHandler().handle(window, { path: model.root });
            expect(swapped).toBe(true);
            expect(result).toMatchObject({ success: true, data: { ok: false, error: { code: "PERMISSION_DENIED" } } });
        } finally {
            probe.mockRestore();
        }
    });

    it("does not turn a non-recursive read grant into access to a directory tree", async () => {
        const window = makeWindow(1, WindowAppType.Workspace, sourceProject);
        const model = await bundle(path.join(tempDir, "outside", "model"));
        const destination = path.join(sourceProject, "copy");
        storageManager.grantFileSystemAccess(window, model.root, "read", false);

        for (const result of [
            await new FsRequestReadDirHandler().handle(window, { path: model.root }),
            await new FsDirectorySizeHandler().handle(window, { path: model.root }),
            await new FsCopyDirHandler().handle(window, { src: model.root, dest: destination }),
        ]) {
            expect(result).toMatchObject({ success: true, data: { ok: false, error: { code: "PERMISSION_DENIED" } } });
        }
        await expect(fs.access(destination)).rejects.toThrow();
    });

    it("does not delete or move a tree through a non-recursive write grant", async () => {
        const window = makeWindow(1, WindowAppType.Workspace, sourceProject);
        const model = await bundle(path.join(tempDir, "outside", "model"));
        storageManager.grantFileSystemAccess(window, model.root, "readwrite", false);

        const deleted = await new FsDeleteDirHandler().handle(window, { path: model.root });
        expect(deleted).toMatchObject({ success: true, data: { ok: false, error: { code: "PERMISSION_DENIED" } } });
        const moved = await new FsMoveDirHandler().handle(window, { src: model.root, dest: path.join(sourceProject, "moved") });
        expect(moved).toMatchObject({ success: true, data: { ok: false, error: { code: "PERMISSION_DENIED" } } });
        await expect(fs.readFile(model.texture, "utf8")).resolves.toBe("png-bytes");
    });

    it("does not copy a tree under a non-recursive destination grant", async () => {
        const window = makeWindow(1, WindowAppType.Workspace, sourceProject);
        const model = await bundle(path.join(sourceProject, "model"));
        const destination = path.join(tempDir, "outside", "copy");
        await fs.mkdir(path.dirname(destination), { recursive: true });
        storageManager.grantFileSystemAccess(window, destination, "write", false);

        const result = await new FsCopyDirHandler().handle(window, { src: model.root, dest: destination });
        expect(result).toMatchObject({ success: true, data: { ok: false, error: { code: "PERMISSION_DENIED" } } });
        await expect(fs.access(destination)).rejects.toThrow();
    });

    it("does not move a directory by claiming it is a file", async () => {
        const window = makeWindow(1, WindowAppType.Workspace, sourceProject);
        const model = await bundle(path.join(tempDir, "outside", "model"));
        const renamed = path.join(tempDir, "outside", "renamed");
        storageManager.grantFileSystemAccess(window, model.root, "readwrite", false);
        storageManager.grantFileSystemAccess(window, renamed, "write", false);

        const result = await new FsRenameHandler().handle(window, { oldPath: model.root, newName: "renamed", isDir: false });
        expect(result).toMatchObject({ success: true, data: { ok: false, error: { code: "PERMISSION_DENIED" } } });
        const moved = await new FsMoveFileHandler().handle(window, { src: model.root, dest: path.join(sourceProject, "moved") });
        expect(moved).toMatchObject({ success: true, data: { ok: false, error: { code: "PERMISSION_DENIED" } } });
        await expect(fs.readFile(model.texture, "utf8")).resolves.toBe("png-bytes");
    });
});

afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
});

describe("offering a manifest", () => {
    it("refuses the whole manifest when one file is outside the offering window's project", async () => {
        const source = makeWindow(1, WindowAppType.Workspace, sourceProject);
        const mine = await asset(sourceProject, "a1", "room-bytes");
        const theirs = await asset(targetProject, "b1", "alley-bytes");

        // The readable half must not survive the unreadable one: a paste cannot tell a short
        // manifest from a complete one, so half an offer would import a subset silently.
        await expect(offer(source, [entry(mine), entry(theirs, { assetId: "asset-2" })]))
            .resolves.toEqual({ offered: false, reason: "unreadable" });
        await expect(offer(source, [entry(mine)])).resolves.toMatchObject({ offered: true });
    });

    it("refuses a path that walks out of the project under a different spelling", async () => {
        const source = makeWindow(1, WindowAppType.Workspace, sourceProject);
        await asset(targetProject, "b1", "alley-bytes");
        // Assembled rather than joined: `path.join` would normalize it here, and the point is that
        // the handler resolves what a renderer actually sent.
        const escaped = [sourceProject, "assets", "..", "..", "project-b", "assets", "content", "b1"].join(path.sep);

        await expect(offer(source, [entry(escaped)])).resolves.toEqual({ offered: false, reason: "unreadable" });
    });

    it("refuses a window type that does not take part in asset transfer", async () => {
        // The Launcher declares no runtime grants at all, so it can neither offer nor redeem.
        const launcher = makeWindow(1, WindowAppType.Launcher, sourceProject);

        await expect(offer(launcher, [entry(await asset(sourceProject, "a1", "room-bytes"))]))
            .resolves.toEqual({ offered: false, reason: "not-permitted" });
    });

    it("refuses Studio's own application storage", async () => {
        const pluginsDir = path.join(tempDir, "user-data", "plugins", "narraleaf.gallery");
        await fs.mkdir(pluginsDir, { recursive: true });
        const pluginFile = path.join(pluginsDir, "main.js");
        await fs.writeFile(pluginFile, "// plugin", "utf8");
        const source = makeWindow(1, WindowAppType.Workspace, sourceProject);

        await expect(offer(source, [entry(pluginFile)])).resolves.toEqual({ offered: false, reason: "protected" });
    });

    it("refuses a directory the offering window may read but not walk", async () => {
        // A bundle outside the project, reachable through a grant on the directory itself. That is
        // enough to open the path named, and reaches none of the files that are the model - so it
        // is not enough to hand the tree to another window.
        const source = makeWindow(1, WindowAppType.Workspace, sourceProject);
        const outside = await bundle(path.join(tempDir, "elsewhere", "hiyori"));
        storageManager.grantFileSystemAccess(source, outside.root, "read", false);

        await expect(offer(source, [entry(outside.root, { fileName: "Hiyori", type: "model", isDirectory: true })]))
            .resolves.toEqual({ offered: false, reason: "unreadable" });
        // The same path as a file entry is offered, which is what pins the refusal on the recursion
        // rather than on the grant being absent.
        await expect(offer(source, [entry(outside.root, { fileName: "Hiyori", type: "model" })]))
            .resolves.toMatchObject({ offered: true });
    });

    it("refuses an entry that does not describe a file", async () => {
        const source = makeWindow(1, WindowAppType.Workspace, sourceProject);
        const readable = await asset(sourceProject, "a1", "room-bytes");

        await expect(offer(source, [entry(readable, { sourcePath: "assets/content/a1" })]))
            .resolves.toEqual({ offered: false, reason: "invalid-entry" });
        await expect(offer(source, [entry(readable, { assetId: "  " })]))
            .resolves.toEqual({ offered: false, reason: "invalid-entry" });
        await expect(offer(source, [])).resolves.toEqual({ offered: false, reason: "empty" });
    });
});

describe("redeeming a token", () => {
    it("hands the pasting window read access to exactly the offered files", async () => {
        const source = makeWindow(1, WindowAppType.Workspace, sourceProject);
        const target = makeWindow(2, WindowAppType.Workspace, targetProject);
        const room = await asset(sourceProject, "a1", "room-bytes");
        const sibling = await asset(sourceProject, "a2", "alley-bytes");

        await expect(storageManager.isPathAllowed(target, room, "read")).resolves.toBe(false);

        const result = redeem(target, await tokenFor(source, [entry(room)]));

        expect(result).toEqual({
            available: true,
            entries: [{ assetId: "asset-1", fileName: "room.png", type: "image", size: 10, sourcePath: room }],
        });
        await expect(storageManager.isPathAllowed(target, room, "read")).resolves.toBe(true);
        // Only what the manifest named: a file next to it in the same project stays unreachable,
        // and the grant is read-only.
        await expect(storageManager.isPathAllowed(target, sibling, "read")).resolves.toBe(false);
        await expect(storageManager.isPathAllowed(target, room, "write")).resolves.toBe(false);
    });

    it("hands over a model bundle's whole tree, and a file's own path only", async () => {
        const source = makeWindow(1, WindowAppType.Workspace, sourceProject);
        const target = makeWindow(2, WindowAppType.Workspace, targetProject);
        const model = await bundle(path.join(sourceProject, "assets", "content", "mo", "de", "l1"));
        const room = await asset(sourceProject, "a1", "room-bytes");

        const result = redeem(target, await tokenFor(source, [
            entry(model.root, { assetId: "asset-model", fileName: "Hiyori", type: "model", isDirectory: true }),
            entry(room, { assetId: "asset-room" }),
        ]));

        expect(result.available).toBe(true);
        // The textures are what the model is: a grant stopping at the root would import a folder
        // whose contents the pasting window cannot read.
        await expect(storageManager.isPathAllowed(target, model.texture, "read")).resolves.toBe(true);
        await expect(storageManager.isPathAllowed(target, model.manifest, "read")).resolves.toBe(true);
        await expect(storageManager.isPathAllowed(target, model.texture, "write")).resolves.toBe(false);
        // The file entry beside it is unchanged: its own path, and nothing next to it.
        await expect(storageManager.isPathAllowed(target, room, "read")).resolves.toBe(true);
        await expect(storageManager.isPathAllowed(target, path.join(path.dirname(room), "a2"), "read"))
            .resolves.toBe(false);
    });

    it("carries the directory flag through to the pasting window", async () => {
        const source = makeWindow(1, WindowAppType.Workspace, sourceProject);
        const target = makeWindow(2, WindowAppType.Workspace, targetProject);
        const model = await bundle(path.join(sourceProject, "assets", "content", "mo", "de", "l1"));

        const result = redeem(target, await tokenFor(source, [
            entry(model.root, { assetId: "asset-model", fileName: "Hiyori", type: "model", size: undefined, isDirectory: true }),
        ]));

        expect(result).toEqual({
            available: true,
            entries: [{
                assetId: "asset-model",
                fileName: "Hiyori",
                type: "model",
                isDirectory: true,
                sourcePath: model.root,
            }],
        });
    });

    it("does not take a truthy value of another shape for a directory", async () => {
        const source = makeWindow(1, WindowAppType.Workspace, sourceProject);
        const target = makeWindow(2, WindowAppType.Workspace, targetProject);
        const model = await bundle(path.join(tempDir, "elsewhere", "hiyori"));
        storageManager.grantFileSystemAccess(source, model.root, "read", false);

        const result = redeem(target, await tokenFor(source, [
            entry(model.root, {
                fileName: "Hiyori",
                type: "model",
                isDirectory: "yes" as unknown as boolean,
            }),
        ]));

        expect(result.available).toBe(true);
        expect((result as { entries: AssetTransferEntry[] }).entries[0].isDirectory).toBeUndefined();
        await expect(storageManager.isPathAllowed(target, model.texture, "read")).resolves.toBe(false);
    });

    it("reports a token this process never minted as nothing available", async () => {
        const target = makeWindow(2, WindowAppType.Workspace, targetProject);

        // What a copy from another running Studio, or from a previous run, looks like here.
        expect(redeem(target, "y9d2Zk1QpFhWn3sVb7tLxA")).toEqual({ available: false, reason: "unknown-token" });
        expect(redeem(target, "")).toEqual({ available: false, reason: "unknown-token" });
    });

    it("refuses a window type that does not take part in asset transfer", async () => {
        const source = makeWindow(1, WindowAppType.Workspace, sourceProject);
        const token = await tokenFor(source, [entry(await asset(sourceProject, "a1", "room-bytes"))]);
        const launcher = makeWindow(2, WindowAppType.Launcher, targetProject);

        expect(redeem(launcher, token)).toEqual({ available: false, reason: "not-permitted" });
        await expect(storageManager.isPathAllowed(launcher, path.join(sourceProject, "assets", "content", "a1"), "read"))
            .resolves.toBe(false);
    });

    it("keeps working for a second paste of the same clipboard", async () => {
        const source = makeWindow(1, WindowAppType.Workspace, sourceProject);
        const first = makeWindow(2, WindowAppType.Workspace, targetProject);
        const second = makeWindow(3, WindowAppType.Workspace, targetProject);
        const room = await asset(sourceProject, "a1", "room-bytes");
        const token = await tokenFor(source, [entry(room)]);

        expect(redeem(first, token).available).toBe(true);
        expect(redeem(second, token).available).toBe(true);
        await expect(storageManager.isPathAllowed(second, room, "read")).resolves.toBe(true);
    });

    it("forgets the offer once the offering window is gone", async () => {
        const source = makeWindow(1, WindowAppType.Workspace, sourceProject);
        const other = makeWindow(9, WindowAppType.Workspace, sourceProject);
        const target = makeWindow(2, WindowAppType.Workspace, targetProject);
        const token = await tokenFor(source, [entry(await asset(sourceProject, "a1", "room-bytes"))]);

        // An unrelated window closing leaves it alone.
        storageManager.revokeWindowFileSystemAccess(other);
        expect(redeem(target, token).available).toBe(true);

        storageManager.revokeWindowFileSystemAccess(source);
        expect(redeem(target, token)).toEqual({ available: false, reason: "unknown-token" });
    });

    it("lets the pasting window walk and copy a bundle it has redeemed", async () => {
        // The transport half of importing a model, against a real tree and the same handlers the
        // renderer calls: the library reads the source by listing it folder by folder, then copies
        // it whole. A grant that stopped at the root would fail at the first of those.
        const source = makeWindow(1, WindowAppType.Workspace, sourceProject);
        const target = makeWindow(2, WindowAppType.Workspace, targetProject);
        const model = await bundle(path.join(sourceProject, "assets", "content", "mo", "de", "l1"));
        const destination = path.join(targetProject, "assets", "content", "mo", "de", "l1");

        redeem(target, await tokenFor(source, [
            entry(model.root, { assetId: "asset-model", fileName: "Hiyori", type: "model", isDirectory: true }),
        ]));

        const listed = await new FsListHandler().handle(target, { path: path.dirname(model.texture) });
        expect(listed.success && listed.data.ok).toBe(true);

        const copied = await new FsCopyDirHandler().handle(target, { src: model.root, dest: destination });
        expect(copied.success && copied.data.ok).toBe(true);
        await expect(fs.readFile(path.join(destination, "hiyori.model3.json"), "utf8")).resolves.toBe("{}");
        await expect(fs.readFile(path.join(destination, "hiyori.2048", "texture_00.png"), "utf8"))
            .resolves.toBe("png-bytes");
    });

    it("takes the grants down with the window that redeemed them", async () => {
        const source = makeWindow(1, WindowAppType.Workspace, sourceProject);
        const target = makeWindow(2, WindowAppType.Workspace, targetProject);
        const room = await asset(sourceProject, "a1", "room-bytes");

        redeem(target, await tokenFor(source, [entry(room)]));
        await expect(storageManager.isPathAllowed(target, room, "read")).resolves.toBe(true);

        storageManager.revokeWindowFileSystemAccess(target);
        await expect(storageManager.isPathAllowed(target, room, "read")).resolves.toBe(false);
    });
});
