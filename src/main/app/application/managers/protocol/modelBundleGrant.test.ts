import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectModelBundleEntry } from "@shared/utils/modelBundle";
import { StorageManager } from "../storageManager";
import type { AppWindow } from "../window/appWindow";
import { FileSystemHashHandler } from "./fileSystemHandler";

vi.mock("electron", () => ({
    app: { startAccessingSecurityScopedResource: vi.fn(() => vi.fn()) },
}));

vi.mock("@shared/utils/persistentState", () => ({
    PersistentState: class { },
}));

/**
 * The Live2D "Hiyori" tree, path-for-path as it ships (18 files across three levels), with
 * placeholder bytes.
 *
 * The real sample is not committed - it is licensed material - but its *shape* is the whole point of
 * these tests, so the paths are verbatim. Two properties of that shape matter and are both present:
 * the manifest's references are relative and reach into subdirectories, and one motion
 * (`Hiyori_m04`) is named only under `TapBody` inside the manifest, so the root listing does not
 * imply the file set.
 */
const HIYORI_FILES = [
    "Hiyori.2048/texture_00.png",
    "Hiyori.2048/texture_01.png",
    "Hiyori.cdi3.json",
    "Hiyori.moc3",
    "Hiyori.model3.json",
    "Hiyori.physics3.json",
    "Hiyori.pose3.json",
    "Hiyori.userdata3.json",
    ...Array.from({ length: 10 }, (_, index) => `motions/Hiyori_m${String(index + 1).padStart(2, "0")}.motion3.json`),
];

/** The relative references the real `Hiyori.model3.json` actually contains. */
const HIYORI_SIBLING_REFERENCES = [
    "Hiyori.moc3",
    "Hiyori.2048/texture_00.png",
    "Hiyori.2048/texture_01.png",
    "Hiyori.physics3.json",
    "motions/Hiyori_m01.motion3.json",
    "motions/Hiyori_m04.motion3.json",
];

function makeWindow(webContentsId: number): AppWindow {
    return { getWebContents: () => ({ id: webContentsId }) } as unknown as AppWindow;
}

function makeRequest(url: string): Request {
    return { url, method: "GET" } as unknown as Request;
}

/**
 * Build the entry URL exactly the way `resolveWorkspaceAssetUrl` does, so what these tests fetch is
 * the string the engine is actually handed - not an approximation of it.
 */
function entryUrl(grant: string, entry: string): string {
    return `app://fs/${grant}/${entry.split("/").map(encodeURIComponent).join("/")}`;
}

describe("model bundle directory grants", () => {
    let root: string;
    let storageManager: StorageManager;
    let handler: FileSystemHashHandler;

    beforeEach(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), "nls-model-bundle-"));
        for (const relative of HIYORI_FILES) {
            const target = path.join(root, relative);
            await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.writeFile(target, Buffer.from(`bytes:${relative}`));
        }
        storageManager = new StorageManager({ logger: { error: vi.fn(), warn: vi.fn() } } as any);
        handler = new FileSystemHashHandler("app", {}, storageManager);
    });

    afterEach(async () => {
        await fs.rm(root, { recursive: true, force: true });
    });

    function grant(): string {
        return storageManager.allocateDirectoryHash(root, 7);
    }

    /**
     * The contract the whole asset type exists for: a sibling named by a relative path in the
     * manifest resolves against the served entry URL, and the resulting URL is itself servable.
     */
    it("resolves every relative sibling of the entry URL to servable bytes", async () => {
        const entry = detectModelBundleEntry(HIYORI_FILES).entry;
        expect(entry).toBe("Hiyori.model3.json");

        const url = entryUrl(grant(), entry!);
        expect((await handler.handle(makeRequest(url))).statusCode).toBe(200);

        for (const reference of HIYORI_SIBLING_REFERENCES) {
            const siblingUrl = new URL(reference, url).href;
            const response = await handler.handle(makeRequest(siblingUrl));
            expect(response.statusCode, `${reference} -> ${siblingUrl}`).toBe(200);
            expect(Buffer.isBuffer(response.data) && response.data.toString()).toBe(`bytes:${reference}`);
        }
    });

    it("reports the real MIME type per file, not one type for the whole bundle", async () => {
        const url = entryUrl(grant(), "Hiyori.model3.json");
        const manifest = await handler.handle(makeRequest(url));
        expect(manifest.headers["Content-Type"]).toContain("json");

        const texture = await handler.handle(makeRequest(new URL("Hiyori.2048/texture_00.png", url).href));
        expect(texture.headers["Content-Type"]).toBe("image/png");
    });

    it("stays readable across repeated fetches", async () => {
        // A one-shot grant would die on the first texture. Hiyori alone is 18 reads, and the engine
        // re-fetches whenever its cache evicts.
        const hash = grant();
        for (let attempt = 0; attempt < 3; attempt += 1) {
            const response = await handler.handle(makeRequest(entryUrl(hash, "Hiyori.model3.json")));
            expect(response.statusCode).toBe(200);
        }
    });

    it("dies with the window that owns it, and not with any other", async () => {
        const hash = grant();
        storageManager.revokeWindowFileSystemAccess(makeWindow(99));
        expect((await handler.handle(makeRequest(entryUrl(hash, "Hiyori.moc3")))).statusCode).toBe(200);

        storageManager.revokeWindowFileSystemAccess(makeWindow(7));
        expect((await handler.handle(makeRequest(entryUrl(hash, "Hiyori.moc3")))).statusCode).toBe(404);
    });

    it("refuses to serve anything outside the granted root", async () => {
        const hash = grant();
        await fs.writeFile(path.join(path.dirname(root), "outside.txt"), "secret");

        for (const escape of [
            "app://fs/{hash}/../outside.txt",
            "app://fs/{hash}/motions/../../outside.txt",
            `app://fs/{hash}/${encodeURIComponent("../outside.txt")}`,
            "app://fs/{hash}/%2e%2e%2foutside.txt",
        ]) {
            const response = await handler.handle(makeRequest(escape.replace("{hash}", hash)));
            expect(response.statusCode, escape).not.toBe(200);
        }
    });

    it("404s a bundle path asked of an ordinary single-file grant", async () => {
        // Serving the file and ignoring the trailing path would make a broken sibling reference look
        // like it had resolved.
        const fileHash = storageManager.allocateHash(path.join(root, "Hiyori.moc3"), true, "read");
        storageManager.updateStatus(fileHash, "ready");
        expect((await handler.handle(makeRequest(`app://fs/${fileHash}/Hiyori.moc3`))).statusCode).toBe(404);
    });
});
