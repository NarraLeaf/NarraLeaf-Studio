import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StorageManager } from "../storageManager";
import type { AppWindow } from "../window/appWindow";
import { FileSystemHandler, FileSystemHashHandler } from "./fileSystemHandler";

vi.mock("electron", () => ({
    app: {
        startAccessingSecurityScopedResource: vi.fn(() => vi.fn()),
    },
}));

vi.mock("@shared/utils/persistentState", () => ({
    PersistentState: class { },
}));

function makeWindow(webContentsId: number): AppWindow {
    return {
        getWebContents: () => ({ id: webContentsId }),
    } as unknown as AppWindow;
}

function makeRequest(hash: string): Request {
    // The handler only reads url + method on the GET path; a stub keeps the
    // test independent of undici's scheme handling for custom protocols.
    return { url: `app://fs/${hash}`, method: "GET" } as unknown as Request;
}

describe("FileSystemHandler status codes", () => {
    let tempDir: string;
    let handler: FileSystemHandler;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-fs-serve-"));
        handler = new FileSystemHandler("app", {}, () => tempDir, "windows");
        handler.addRule({
            include: (requested) => new URL(requested).hostname === "windows",
            handler: (requested) => ({ path: handler.formatFileUrl(requested), noCache: false }),
        });
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    function makeAppRequest(pathname: string): Request {
        return { url: `app://windows${pathname}`, method: "GET" } as unknown as Request;
    }

    it("serves a built entry", async () => {
        await fs.mkdir(path.join(tempDir, "workspace"), { recursive: true });
        await fs.writeFile(path.join(tempDir, "workspace", "index.html"), "<html></html>");

        const response = await handler.handle(makeAppRequest("/workspace/index.html"));
        expect(response.statusCode).toBe(200);
        expect(response.headers["Content-Type"]).toContain("html");
    });

    it("reports a never-built entry as 404 rather than 500", async () => {
        // A workspace bundle missing from `dist` used to surface as an opaque 500,
        // which hid the fact that the app had simply failed to compile.
        const response = await handler.handle(makeAppRequest("/workspace/index.html"));
        expect(response.statusCode).toBe(404);
    });
});

describe("FileSystemHashHandler grant lifetimes", () => {
    let tempDir: string;
    let filePath: string;
    let storageManager: StorageManager;
    let handler: FileSystemHashHandler;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-fs-hash-"));
        filePath = path.join(tempDir, "asset.png");
        await fs.writeFile(filePath, Buffer.from("fake-png-bytes"));
        storageManager = new StorageManager({
            logger: { error: vi.fn(), warn: vi.fn() },
        } as any);
        handler = new FileSystemHashHandler("app", {}, storageManager);
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    function allocateReadyReadHash(): string {
        const hash = storageManager.allocateHash(filePath, true, "read");
        storageManager.updateStatus(hash, "ready");
        return hash;
    }

    it("destroys one-shot read grants after the first successful read", async () => {
        const hash = allocateReadyReadHash();

        const first = await handler.handle(makeRequest(hash));
        expect(first.statusCode).toBe(200);
        expect(first.headers["Cache-Control"]).toContain("no-store");

        const second = await handler.handle(makeRequest(hash));
        expect(second.statusCode).toBe(404);
    });

    it("keeps session grants readable across repeated fetches and allows private caching", async () => {
        const hash = allocateReadyReadHash();
        expect(storageManager.promoteToSessionRead(hash, 42)).toBe(true);

        for (let i = 0; i < 3; i++) {
            const response = await handler.handle(makeRequest(hash));
            expect(response.statusCode).toBe(200);
            expect(response.headers["Cache-Control"]).toBe("private, max-age=3600");
            expect(Buffer.isBuffer(response.data) && response.data.toString()).toBe("fake-png-bytes");
        }
    });

    it("revokes session grants when the owner window closes, not when others do", async () => {
        const hash = allocateReadyReadHash();
        expect(storageManager.promoteToSessionRead(hash, 42)).toBe(true);

        // An unrelated window closing must not revoke the grant
        storageManager.revokeWindowFileSystemAccess(makeWindow(99));
        expect((await handler.handle(makeRequest(hash))).statusCode).toBe(200);

        // The owner window closing revokes it: the URL dies with the session
        storageManager.revokeWindowFileSystemAccess(makeWindow(42));
        expect((await handler.handle(makeRequest(hash))).statusCode).toBe(404);
    });

    it("never promotes write grants or unknown hashes to session lifetime", () => {
        const writeHash = storageManager.allocateHash(filePath, true, "write");
        storageManager.updateStatus(writeHash, "ready");

        expect(storageManager.promoteToSessionRead(writeHash, 42)).toBe(false);
        expect(storageManager.promoteToSessionRead("missing-hash", 42)).toBe(false);
    });
});
