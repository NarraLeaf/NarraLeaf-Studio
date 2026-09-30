import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeProjectConfig } from "@shared/utils/nlproj";
import { WindowAppType } from "@shared/types/window";

const { ipcMainMock, handlerList } = vi.hoisted(() => {
    const handlers = new Map<string, (event: any, ...args: any[]) => Promise<any>>();
    return {
        ipcMainMock: {
            handlers,
            handle: vi.fn((channel: string, handler: (event: any, ...args: any[]) => Promise<any>) => {
                handlers.set(channel, handler);
            }),
            on: vi.fn(),
            once: vi.fn(),
            removeListener: vi.fn(),
            removeHandler: vi.fn(),
            removeAllListeners: vi.fn(),
        },
        handlerList: [] as unknown[],
    };
});

vi.mock("electron", () => ({ ipcMain: ipcMainMock }));
// The whole default table drags in every manager in the app; these tests need two channels of it.
vi.mock("./window/defaultHandlers", () => ({ createDefaultIPCHandlers: () => handlerList }));

import { forgetProjectStoreIdentifiers } from "../utils/windowProjectStore";
import { WindowManager } from "./windowManager";
import {
    BlueprintPersistenceGetValueHandler,
    BlueprintPersistenceSetValueHandler,
} from "./window/handlers/blueprintPersistenceAction";
import type { AppWindow } from "./window/appWindow";

let tempDir = "";

async function createProject(): Promise<string> {
    const projectPath = path.join(tempDir, "game");
    await fs.mkdir(projectPath, { recursive: true });
    await fs.writeFile(
        path.join(projectPath, "game.nlproj"),
        encodeProjectConfig({ name: "game", identifier: "com.example.game", metadata: {} }),
    );
    return projectPath;
}

/** A Dev Mode window whose page is process 7, with the app's one persistence store behind it. */
function createDevModeWindow(projectPath: string) {
    const store = new Map<string, unknown>();
    const storageManager = {
        createState: () => ({
            getItem: (key: string) => store.get(key),
            setItem: (key: string, value: unknown) => store.set(key, value),
            removeItem: (key: string) => store.delete(key),
        }),
        revokeWindowFileSystemAccess: vi.fn(),
    };
    let destroyed = false;
    const window = {
        app: { storageManager },
        getWindowType: () => WindowAppType.DevMode,
        getWebContents: () => ({ id: 7 }),
        getProps: () => ({ projectPath }),
        isDestroyed: () => destroyed,
        isClosed: () => destroyed,
    } as unknown as AppWindow;
    const app = { storageManager, menuManager: { forgetWindow: vi.fn() } };
    return { window, app, store, destroy: () => { destroyed = true; } };
}

/** What the page's preload does for `blueprintPersistence.*`: one invoke on the namespaced channel. */
function invoke(channel: string, data: unknown): Promise<any> {
    const handler = ipcMainMock.handlers.get(`narraleaf-studio:${channel}`);
    expect(handler).toBeDefined();
    return handler!({ sender: { id: 7 } }, data);
}

describe("WindowManager and a window on its way out", () => {
    beforeEach(async () => {
        forgetProjectStoreIdentifiers();
        ipcMainMock.handlers.clear();
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-window-closing-"));
        handlerList.length = 0;
        handlerList.push(new BlueprintPersistenceSetValueHandler(), new BlueprintPersistenceGetValueHandler());
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    /**
     * The order a close actually happens in. The main process sees `close` first and takes the
     * window off every list; only then does Chromium run the page's `beforeunload`, which is where
     * the game flushes the playtime it has banked since the last whole minute and the lines it has
     * marked read. That write used to arrive at a registry that had already forgotten the window.
     */
    it("lands the page's last write between close and closed, and nothing after", async () => {
        const projectPath = await createProject();
        const { window, app, store, destroy } = createDevModeWindow(projectPath);
        const manager = new WindowManager(app as never);
        manager.initialize();
        manager.registerWindow(window);

        // `close`: off the open list at once, so nothing goes on treating it as open.
        manager.unregisterClosingWindow(window);
        expect(manager.getWindows()).not.toContain(window);
        expect(manager.getWindowByWebContents({ id: 7 } as Electron.WebContents)).toBeUndefined();

        // `beforeunload`: the flush.
        await expect(invoke("blueprintPersistence.setValue", {
            projectRef: { projectPath },
            key: "nlr.playtimeTotal",
            value: 42,
        })).resolves.toEqual({ success: true, data: undefined });
        expect(store.get("nlr.playtimeTotal")).toBe(42);

        // Only the writes are answered: a read has nothing to keep, and is refused as before.
        await expect(invoke("blueprintPersistence.getValue", {
            projectRef: { projectPath },
            key: "nlr.playtimeTotal",
        })).resolves.toMatchObject({ success: false, error: expect.stringContaining("No live window") });

        // `closed`: forgotten for good.
        destroy();
        manager.unregisterWindow(window);
        expect(manager.getClosingWindowByWebContents({ id: 7 } as Electron.WebContents)).toBeUndefined();
        await expect(invoke("blueprintPersistence.setValue", {
            projectRef: { projectPath },
            key: "nlr.playtimeTotal",
            value: 43,
        })).resolves.toMatchObject({ success: false, error: expect.stringContaining("No live window") });
        expect(store.get("nlr.playtimeTotal")).toBe(42);
    });

    it("never keeps a window that was already destroyed when it started closing", () => {
        const { window, app, destroy } = createDevModeWindow(tempDir);
        const manager = new WindowManager(app as never);
        manager.registerWindow(window);
        destroy();

        manager.unregisterClosingWindow(window);

        expect(manager.getClosingWindowByWebContents({ id: 7 } as Electron.WebContents)).toBeUndefined();
    });
});
