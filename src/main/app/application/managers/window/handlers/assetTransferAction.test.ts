import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WindowAppType } from "@shared/types/window";
import type { AssetTransferEntry, AssetTransferOfferResult, AssetTransferRedeemResult } from "@shared/types/assetTransfer";
import { StorageManager } from "../../storageManager";
import type { AppWindow } from "../appWindow";
import { AssetTransferOfferHandler, AssetTransferRedeemHandler } from "./assetTransferAction";

vi.mock("electron", () => ({
    app: {
        startAccessingSecurityScopedResource: vi.fn(() => vi.fn()),
    },
    dialog: { showOpenDialog: vi.fn() },
    net: { request: vi.fn() },
}));

vi.mock("@shared/utils/persistentState", () => ({
    PersistentState: class { },
}));

const offerHandler = new AssetTransferOfferHandler();
const redeemHandler = new AssetTransferRedeemHandler();

let tempDir: string;
let storageManager: StorageManager;
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
        getWindowType: () => windowType,
        getProps: () => ({ projectPath }),
        getWebContents: () => ({ id: webContentsId }),
        app: { storageManager },
    } as unknown as AppWindow;
}

async function asset(project: string, name: string, contents: string): Promise<string> {
    const target = path.join(project, "assets", "content", name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents, "utf8");
    return target;
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
    } as any);
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
