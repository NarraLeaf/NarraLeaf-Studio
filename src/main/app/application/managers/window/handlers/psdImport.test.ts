import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppWindow } from "../appWindow";

const mocks = vi.hoisted(() => ({
    getPath: vi.fn(),
    showOpenDialog: vi.fn(),
    readPsdDocument: vi.fn(),
    bakePsdLayers: vi.fn(),
}));

vi.mock("electron", () => ({ app: { getPath: mocks.getPath }, session: {} }));
vi.mock("../fileDialog", () => ({
    dialogTranslator: () => ({ t: (key: string) => key }),
    showOpenDialog: mocks.showOpenDialog,
}));
vi.mock("@/app/application/managers/psdImportManager", () => ({
    readPsdDocument: mocks.readPsdDocument,
    bakePsdLayers: mocks.bakePsdLayers,
}));

const { PsdBakeHandler, PsdOpenHandler } = await import("./psdImport");

let tempDir: string;

function makeWindow(initiallyAllowed: string[] = []) {
    const allowed = new Set(initiallyAllowed);
    const closeListeners: Array<() => void> = [];
    const storageManager = {
        isPathAllowed: vi.fn(async (_window: unknown, filePath: string) => allowed.has(filePath)),
        grantFileSystemAccess: vi.fn((_window: unknown, filePath: string) => { allowed.add(filePath); }),
    };
    const window = {
        getApp: () => ({}),
        onClose: (listener: () => void) => { closeListeners.push(listener); return { cancel: () => undefined }; },
        app: { storageManager },
    } as unknown as AppWindow;
    return { window, storageManager, close: () => closeListeners.forEach(listener => listener()) };
}

beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-psd-handler-"));
    vi.clearAllMocks();
    mocks.getPath.mockReturnValue(tempDir);
    mocks.readPsdDocument.mockResolvedValue({ width: 1, height: 1, fileName: "sheet.psd", layers: [] });
    mocks.bakePsdLayers.mockImplementation(async (_app, request) => {
        await fs.mkdir(request.outputDir, { recursive: true });
        const filePath = path.join(request.outputDir, "layer.png");
        await fs.writeFile(filePath, request.filePath);
        return [{ path: ["layer"], name: "layer", filePath }];
    });
});

afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tempDir, { recursive: true, force: true });
});

describe("PSD file access and output lifetime", () => {
    it("refuses to bake a file the window cannot read", async () => {
        const { window } = makeWindow();
        const result = await new PsdBakeHandler().handle(window, { request: { filePath: "/private/sheet.psd", layers: [] } });

        expect(result).toMatchObject({ success: false, code: "PERMISSION_DENIED" });
        expect(mocks.bakePsdLayers).not.toHaveBeenCalled();
    });

    it("grants the picked file for the later bake, including its security bookmark", async () => {
        const selected = path.join(tempDir, "sheet.psd");
        const { window, storageManager } = makeWindow();
        mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [selected], bookmarks: ["bookmark"] });

        expect((await new PsdOpenHandler().handle(window)).success).toBe(true);
        expect(mocks.showOpenDialog.mock.calls[0][1]).toMatchObject({ securityScopedBookmarks: true });
        expect(storageManager.grantFileSystemAccess).toHaveBeenCalledWith(window, selected, "read", false, "bookmark");
        expect((await new PsdBakeHandler().handle(window, { request: { filePath: selected, layers: [] } })).success).toBe(true);
    });

    it("does not read a selected path that remains protected", async () => {
        const selected = path.join(tempDir, "protected.psd");
        const { window, storageManager } = makeWindow();
        mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [selected] });
        storageManager.isPathAllowed.mockResolvedValue(false);

        expect(await new PsdOpenHandler().handle(window)).toMatchObject({ success: false, code: "PERMISSION_DENIED" });
        expect(mocks.readPsdDocument).not.toHaveBeenCalled();
    });

    it("keeps each window's baked files available when another import starts", async () => {
        const first = makeWindow(["/first.psd"]);
        const second = makeWindow(["/second.psd"]);
        const handler = new PsdBakeHandler();
        vi.spyOn(Date, "now").mockReturnValue(1234);

        const a = await handler.handle(first.window, { request: { filePath: "/first.psd", layers: [] } });
        const b = await handler.handle(second.window, { request: { filePath: "/second.psd", layers: [] } });
        expect(a.success && b.success).toBe(true);
        if (!a.success || !b.success) return;
        expect(a.data.layers[0].filePath).not.toBe(b.data.layers[0].filePath);
        await expect(fs.readFile(a.data.layers[0].filePath, "utf8")).resolves.toBe("/first.psd");
        await expect(fs.readFile(b.data.layers[0].filePath, "utf8")).resolves.toBe("/second.psd");
    });

    it("keeps earlier results in the same window available to overlapping consumers", async () => {
        const { window } = makeWindow(["/first.psd", "/second.psd"]);
        const handler = new PsdBakeHandler();
        const a = await handler.handle(window, { request: { filePath: "/first.psd", layers: [] } });
        const b = await handler.handle(window, { request: { filePath: "/second.psd", layers: [] } });
        expect(a.success && b.success).toBe(true);
        if (!a.success || !b.success) return;
        await expect(fs.readFile(a.data.layers[0].filePath, "utf8")).resolves.toBe("/first.psd");
    });

    it("removes completed output when its owning window closes", async () => {
        const first = makeWindow(["/first.psd"]);
        const second = makeWindow(["/second.psd"]);
        const handler = new PsdBakeHandler();
        const a = await handler.handle(first.window, { request: { filePath: "/first.psd", layers: [] } });
        const b = await handler.handle(second.window, { request: { filePath: "/second.psd", layers: [] } });
        expect(a.success && b.success).toBe(true);
        if (!a.success || !b.success) return;

        first.close();
        await vi.waitFor(async () => expect(await fs.access(a.data.layers[0].filePath).then(() => true, () => false)).toBe(false));
        await expect(fs.readFile(b.data.layers[0].filePath, "utf8")).resolves.toBe("/second.psd");
    });

    it("cleans up a bake that finishes after the window closes without granting access", async () => {
        const { window, storageManager, close } = makeWindow(["/first.psd"]);
        let finish: (() => void) | undefined;
        let started: (() => void) | undefined;
        const hasStarted = new Promise<void>(resolve => { started = resolve; });
        const canFinish = new Promise<void>(resolve => { finish = resolve; });
        let outputDir = "";
        mocks.bakePsdLayers.mockImplementation(async (_app, request) => {
            outputDir = request.outputDir;
            started?.();
            await canFinish;
            await fs.mkdir(outputDir, { recursive: true });
            await fs.writeFile(path.join(outputDir, "layer.png"), "pixels");
            return [];
        });
        const result = new PsdBakeHandler().handle(window, { request: { filePath: "/first.psd", layers: [] } });
        await hasStarted;
        close();
        finish?.();

        expect((await result).success).toBe(false);
        expect(storageManager.grantFileSystemAccess).not.toHaveBeenCalled();
        await expect(fs.access(outputDir)).rejects.toThrow();
    });
});
