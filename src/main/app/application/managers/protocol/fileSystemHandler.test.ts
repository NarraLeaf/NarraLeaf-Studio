import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StorageManager } from "../storageManager";
import type { AppWindow } from "../window/appWindow";
import { encodeWriteBatchFrame } from "@shared/utils/writeBatchFrame";
import { FsRejectErrorCode } from "@shared/types/os";
import { FileSystemHandler, FileSystemHashHandler } from "./fileSystemHandler";
import { FILE_STREAM_THRESHOLD_BYTES } from "./fileBody";

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
        handler = new FileSystemHashHandler("app", {}, storageManager, { mayRunProjectCode: () => true });
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    function allocateReadyReadHash(): string {
        const hash = storageManager.allocateHash(filePath, true, "read", 1);
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
        const writeHash = storageManager.allocateHash(filePath, true, "write", 1);
        storageManager.updateStatus(writeHash, "ready");

        expect(storageManager.promoteToSessionRead(writeHash, 42)).toBe(false);
        expect(storageManager.promoteToSessionRead("missing-hash", 42)).toBe(false);
    });

    // The property a Dev Mode save depends on: the engine writes resolved URLs into the SavedGame,
    // so the same file has to produce the same URL in a later run or every stage image 404s.
    it("re-keys a read grant to a token derived from the file, stable across allocations", async () => {
        const first = await storageManager.stabilizeSessionRead(allocateReadyReadHash(), 42);
        expect(first).toBeTruthy();
        expect((await handler.handle(makeRequest(first!))).statusCode).toBe(200);

        // A second run: fresh grant over the same untouched file, same token.
        const second = await storageManager.stabilizeSessionRead(allocateReadyReadHash(), 42);
        expect(second).toBe(first);
    });

    it("mints a different token once the file's bytes change, so a cached response cannot outlive them", async () => {
        const before = await storageManager.stabilizeSessionRead(allocateReadyReadHash(), 42);
        await fs.writeFile(filePath, Buffer.from("different-png-bytes-entirely"));
        const after = await storageManager.stabilizeSessionRead(allocateReadyReadHash(), 42);

        expect(after).toBeTruthy();
        expect(after).not.toBe(before);
    });

    it("leaves the original token unusable and refuses grants it cannot stabilize", async () => {
        const hash = allocateReadyReadHash();
        const stable = await storageManager.stabilizeSessionRead(hash, 42);
        expect(stable).not.toBe(hash);
        expect((await handler.handle(makeRequest(hash))).statusCode).toBe(404);

        const writeHash = storageManager.allocateHash(filePath, true, "write", 1);
        storageManager.updateStatus(writeHash, "ready");
        await expect(storageManager.stabilizeSessionRead(writeHash, 42)).resolves.toBeNull();
        await expect(storageManager.stabilizeSessionRead("missing-hash", 42)).resolves.toBeNull();

        const goneHash = storageManager.allocateHash(path.join(tempDir, "not-here.png"), true, "read", 1);
        await expect(storageManager.stabilizeSessionRead(goneHash, 42)).resolves.toBeNull();
    });
});

/**
 * How a grant answers a media element. A `<video>` reads a clip as a series of `Range` requests - one
 * to start, one per seek outside what it has buffered - so ranges are honoured exactly where a grant
 * can be asked more than once, and a one-shot grant keeps answering whole files and dying after one.
 */
describe("FileSystemHashHandler byte ranges", () => {
    /** Every byte is its own offset (mod 256), so a slice says where it came from. */
    const SMALL_SIZE = 1000;
    let tempDir: string;
    let filePath: string;
    let storageManager: StorageManager;
    let handler: FileSystemHashHandler;

    const bytesFrom = (start: number, length: number) =>
        Buffer.from(Array.from({ length }, (_, index) => (start + index) % 256));

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-fs-range-"));
        filePath = path.join(tempDir, "clip.webm");
        await fs.writeFile(filePath, bytesFrom(0, SMALL_SIZE));
        storageManager = new StorageManager({
            logger: { error: vi.fn(), warn: vi.fn() },
        } as any);
        handler = new FileSystemHashHandler("app", {}, storageManager, { mayRunProjectCode: () => true });
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    function grant(target = filePath, lifetime: "once" | "session" = "session"): string {
        const hash = storageManager.allocateHash(target, true, "read", 7);
        storageManager.updateStatus(hash, "ready");
        if (lifetime === "session") {
            expect(storageManager.promoteToSessionRead(hash, 7)).toBe(true);
        }
        return hash;
    }

    function rangeRequest(url: string, range?: string): Request {
        return {
            url,
            method: "GET",
            headers: new Headers(range === undefined ? {} : { range }),
        } as unknown as Request;
    }

    async function bodyOf(data: unknown): Promise<Buffer> {
        if (Buffer.isBuffer(data)) {
            return data;
        }
        expect(data).toBeInstanceOf(ReadableStream);
        return Buffer.from(await new Response(data as ReadableStream<Uint8Array>).arrayBuffer());
    }

    it("answers a single range on a session grant with 206 and the bytes it names", async () => {
        const response = await handler.handle(rangeRequest(`app://fs/${grant()}`, "bytes=100-199"));

        expect(response.statusCode).toBe(206);
        expect(response.headers["Content-Range"]).toBe(`bytes 100-199/${SMALL_SIZE}`);
        expect(response.headers["Content-Length"]).toBe("100");
        expect(response.headers["Accept-Ranges"]).toBe("bytes");
        // The rest of a session grant's answer is unchanged by the range.
        expect(response.headers["Cache-Control"]).toBe("private, max-age=3600");
        expect(response.headers["Content-Type"]).toBe("application/octet-stream");
        expect((await bodyOf(response.data)).equals(bytesFrom(100, 100))).toBe(true);
    });

    it("answers the open-ended range a media element starts with as 206 over the whole file", async () => {
        // `bytes=0-` is what Chromium sends first; a 206 back is what tells it seeking by range works.
        const response = await handler.handle(rangeRequest(`app://fs/${grant()}`, "bytes=0-"));

        expect(response.statusCode).toBe(206);
        expect(response.headers["Content-Range"]).toBe(`bytes 0-${SMALL_SIZE - 1}/${SMALL_SIZE}`);
        expect((await bodyOf(response.data)).equals(bytesFrom(0, SMALL_SIZE))).toBe(true);
    });

    it("answers a suffix range with the last bytes of the file", async () => {
        const response = await handler.handle(rangeRequest(`app://fs/${grant()}`, "bytes=-10"));

        expect(response.statusCode).toBe(206);
        expect(response.headers["Content-Range"]).toBe(`bytes ${SMALL_SIZE - 10}-${SMALL_SIZE - 1}/${SMALL_SIZE}`);
        expect((await bodyOf(response.data)).equals(bytesFrom(SMALL_SIZE - 10, 10))).toBe(true);
    });

    it("clamps a range that runs past the end to the file", async () => {
        const response = await handler.handle(rangeRequest(`app://fs/${grant()}`, "bytes=990-5000"));

        expect(response.statusCode).toBe(206);
        expect(response.headers["Content-Range"]).toBe(`bytes 990-999/${SMALL_SIZE}`);
        expect(response.headers["Content-Length"]).toBe("10");
    });

    it.each(["bytes=1000-", "bytes=5000-6000", "bytes=-0"])("refuses %s with 416 and the file's size", async range => {
        const response = await handler.handle(rangeRequest(`app://fs/${grant()}`, range));

        expect(response.statusCode).toBe(416);
        expect(response.headers["Content-Range"]).toBe(`bytes */${SMALL_SIZE}`);
        expect(response.headers["Accept-Ranges"]).toBe("bytes");
        expect(response.data).toBeUndefined();
    });

    it.each(["bytes=0-1,5-6", "items=0-5", "bytes=9-3"])("answers %s, which it does not serve as a range, with the whole file", async range => {
        const response = await handler.handle(rangeRequest(`app://fs/${grant()}`, range));

        expect(response.statusCode).toBe(200);
        expect(response.headers["Content-Range"]).toBeUndefined();
        expect(response.headers["Content-Length"]).toBe(String(SMALL_SIZE));
        expect(response.headers["Accept-Ranges"]).toBe("bytes");
        expect((await bodyOf(response.data)).equals(bytesFrom(0, SMALL_SIZE))).toBe(true);
    });

    it("keeps serving repeated ranges from one session grant, as a seeking video asks for them", async () => {
        const url = `app://fs/${grant()}`;
        for (const [start, end] of [[0, 99], [600, 699], [0, 9], [950, 999]]) {
            const response = await handler.handle(rangeRequest(url, `bytes=${start}-${end}`));
            expect(response.statusCode).toBe(206);
            expect((await bodyOf(response.data)).equals(bytesFrom(start, end - start + 1))).toBe(true);
        }
        expect((await handler.handle(rangeRequest(url))).statusCode).toBe(200);
    });

    it("keeps a one-shot grant one-shot: a range gets the whole file, and nothing gets a second answer", async () => {
        const url = `app://fs/${grant(filePath, "once")}`;

        const first = await handler.handle(rangeRequest(url, "bytes=100-199"));
        expect(first.statusCode).toBe(200);
        expect(first.headers["Content-Range"]).toBeUndefined();
        // Advertising ranges would invite the follow-up request this grant cannot answer.
        expect(first.headers["Accept-Ranges"]).toBeUndefined();
        expect(first.headers["Cache-Control"]).toContain("no-store");
        expect((await bodyOf(first.data)).equals(bytesFrom(0, SMALL_SIZE))).toBe(true);

        expect((await handler.handle(rangeRequest(url, "bytes=100-199"))).statusCode).toBe(404);
        expect((await handler.handle(rangeRequest(url))).statusCode).toBe(404);
    });

    it("does not spend a one-shot grant on a read that failed", async () => {
        const target = path.join(tempDir, "late.webm");
        const url = `app://fs/${grant(target, "once")}`;

        expect((await handler.handle(rangeRequest(url))).statusCode).toBe(500);
        await fs.writeFile(target, bytesFrom(0, 10));
        expect((await handler.handle(rangeRequest(url))).statusCode).toBe(200);
    });

    it("serves ranges inside a directory grant, which is asked many times too", async () => {
        await fs.mkdir(path.join(tempDir, "bundle"));
        await fs.writeFile(path.join(tempDir, "bundle", "motion.bin"), bytesFrom(0, SMALL_SIZE));
        const hash = storageManager.allocateDirectoryHash(path.join(tempDir, "bundle"), 7);

        const response = await handler.handle(rangeRequest(`app://fs/${hash}/motion.bin`, "bytes=10-19"));
        expect(response.statusCode).toBe(206);
        expect(response.headers["Content-Range"]).toBe(`bytes 10-19/${SMALL_SIZE}`);
        expect((await bodyOf(response.data)).equals(bytesFrom(10, 10))).toBe(true);
    });

    it("keeps a distrusted window's script inert when it is asked for by range", async () => {
        await fs.mkdir(path.join(tempDir, "bundle"));
        await fs.writeFile(path.join(tempDir, "bundle", "runtime.js"), "export default 1;");
        const distrusted = new FileSystemHashHandler("app", {}, storageManager, { mayRunProjectCode: () => false });
        const hash = storageManager.allocateDirectoryHash(path.join(tempDir, "bundle"), 7);

        const response = await distrusted.handle(rangeRequest(`app://fs/${hash}/runtime.js`, "bytes=0-5"));
        expect(response.statusCode).toBe(206);
        expect(response.headers["Content-Type"]).toBe("text/plain; charset=utf-8");
        expect(response.headers["X-Content-Type-Options"]).toBe("nosniff");
    });

    it("answers an empty file whole, and refuses any range of it", async () => {
        const empty = path.join(tempDir, "empty.bin");
        await fs.writeFile(empty, Buffer.alloc(0));
        const url = `app://fs/${grant(empty)}`;

        const whole = await handler.handle(rangeRequest(url));
        expect(whole.statusCode).toBe(200);
        expect(whole.headers["Content-Length"]).toBe("0");
        expect((await handler.handle(rangeRequest(url, "bytes=0-"))).statusCode).toBe(416);
    });

    describe("a file too large to buffer", () => {
        const LARGE_SIZE = FILE_STREAM_THRESHOLD_BYTES + 12345;
        let largePath: string;

        beforeEach(async () => {
            largePath = path.join(tempDir, "large.webm");
            await fs.writeFile(largePath, bytesFrom(0, LARGE_SIZE));
        });

        it("streams the whole file rather than reading it into memory first", async () => {
            const response = await handler.handle(rangeRequest(`app://fs/${grant(largePath)}`));

            expect(response.statusCode).toBe(200);
            expect(response.data).toBeInstanceOf(ReadableStream);
            expect(response.headers["Content-Length"]).toBe(String(LARGE_SIZE));
            expect((await bodyOf(response.data)).equals(bytesFrom(0, LARGE_SIZE))).toBe(true);
        });

        it("streams a large range and buffers a small one", async () => {
            const url = `app://fs/${grant(largePath)}`;

            const large = await handler.handle(rangeRequest(url, "bytes=7-"));
            expect(large.statusCode).toBe(206);
            expect(large.data).toBeInstanceOf(ReadableStream);
            expect(large.headers["Content-Length"]).toBe(String(LARGE_SIZE - 7));
            expect((await bodyOf(large.data)).equals(bytesFrom(7, LARGE_SIZE - 7))).toBe(true);

            const small = await handler.handle(rangeRequest(url, `bytes=${LARGE_SIZE - 300}-${LARGE_SIZE - 201}`));
            expect(small.statusCode).toBe(206);
            expect(Buffer.isBuffer(small.data)).toBe(true);
            expect((await bodyOf(small.data)).equals(bytesFrom(LARGE_SIZE - 300, 100))).toBe(true);
        });

        it("streams to a one-shot grant too, and still spends it on the first request", async () => {
            const url = `app://fs/${grant(largePath, "once")}`;

            const first = await handler.handle(rangeRequest(url, "bytes=0-"));
            expect(first.statusCode).toBe(200);
            expect(first.data).toBeInstanceOf(ReadableStream);
            expect((await bodyOf(first.data)).byteLength).toBe(LARGE_SIZE);
            expect((await handler.handle(rangeRequest(url))).statusCode).toBe(404);
        });
    });
});

/**
 * One grant, N files, one `PUT`. The properties under test are the two that let a caller trust it:
 * a payload cannot land anywhere the grant did not already name, and a batch where only some files
 * made it says so per file rather than failing as a lump.
 */
describe("FileSystemHashHandler batched writes", () => {
    let tempDir: string;
    let storageManager: StorageManager;
    let handler: FileSystemHashHandler;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-fs-batch-"));
        storageManager = new StorageManager({
            logger: { error: vi.fn(), warn: vi.fn() },
        } as any);
        handler = new FileSystemHashHandler("app", {}, storageManager, { mayRunProjectCode: () => true });
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    function grant(entries: { path: string; raw: boolean; encoding?: string }[]): string {
        const hash = storageManager.allocateWriteBatchHash(entries as never, 1);
        storageManager.updateStatus(hash, "ready");
        return hash;
    }

    function putRequest(hash: string, body: Uint8Array): Request {
        return {
            url: `app://fs/${hash}`,
            method: "PUT",
            arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
        } as unknown as Request;
    }

    function results(response: { data: unknown }): { ok: boolean; error?: { message: string } }[] {
        return JSON.parse(String(response.data)).results;
    }

    const text = (value: string) => new TextEncoder().encode(value);

    it("writes every file the grant names, from one request", async () => {
        const paths = ["one.json", "two.json", "three.json"].map(name => path.join(tempDir, name));
        const hash = grant(paths.map(target => ({ path: target, raw: false, encoding: "utf-8" })));

        const response = await handler.handle(putRequest(hash, encodeWriteBatchFrame([
            text("{\"n\":1}"), text("{\"n\":2}"), text("{\"n\":3}"),
        ])));

        expect(response.statusCode).toBe(200);
        expect(results(response).every(result => result.ok)).toBe(true);
        for (const [index, target] of paths.entries()) {
            expect(JSON.parse(await fs.readFile(target, "utf-8")).n).toBe(index + 1);
        }
    });

    it("is one-shot, like every other write grant", async () => {
        const target = path.join(tempDir, "once.txt");
        const hash = grant([{ path: target, raw: true }]);

        expect((await handler.handle(putRequest(hash, encodeWriteBatchFrame([text("first")])))).statusCode).toBe(200);
        expect((await handler.handle(putRequest(hash, encodeWriteBatchFrame([text("second")])))).statusCode).toBe(404);
        expect(await fs.readFile(target, "utf-8")).toBe("first");
    });

    it("reports per file when only some of them land", async () => {
        const good = path.join(tempDir, "good.json");
        // A directory that is not there - what a VCS checkout looks like from under a running save.
        const orphan = path.join(tempDir, "gone", "orphan.json");
        const alsoGood = path.join(tempDir, "also-good.json");
        const hash = grant([good, orphan, alsoGood].map(target => ({ path: target, raw: false, encoding: "utf-8" })));

        const response = await handler.handle(putRequest(hash, encodeWriteBatchFrame([
            text("1"), text("2"), text("3"),
        ])));

        expect(response.statusCode).toBe(200);
        const reported = results(response);
        expect(reported.map(result => result.ok)).toEqual([true, false, true]);
        expect(reported[1].error!.message).toContain("Directory does not exist");
        // The failure of one must not cost the file behind it: a caller that had to re-owe the whole
        // set on any failure would be paying for the batch twice.
        expect(await fs.readFile(good, "utf-8")).toBe("1");
        expect(await fs.readFile(alsoGood, "utf-8")).toBe("3");
    });

    it("refuses a body whose payload count disagrees with the grant, writing nothing", async () => {
        const paths = ["a.json", "b.json"].map(name => path.join(tempDir, name));
        const hash = grant(paths.map(target => ({ path: target, raw: false, encoding: "utf-8" })));

        const response = await handler.handle(putRequest(hash, encodeWriteBatchFrame([text("only one")])));

        expect(response.statusCode).toBe(400);
        for (const target of paths) {
            await expect(fs.readFile(target)).rejects.toThrow();
        }
    });

    it("refuses a GET against a batched write grant", async () => {
        const hash = grant([{ path: path.join(tempDir, "nope.json"), raw: true }]);
        expect((await handler.handle(makeRequest(hash))).statusCode).toBe(405);
    });
});

/**
 * The execution gate. A puppet backend is `import()`ed from one of these URLs, and the import only
 * succeeds if the response says it is JavaScript - so whether a window may run what its project
 * supplied is decided here, per response, by asking the policy about the grant's owner.
 */
describe("FileSystemHashHandler and the code a window may run", () => {
    let tempDir: string;
    let storageManager: StorageManager;
    /** Windows the policy vouches for; every other owner is refused. */
    const trustedWindows = new Set<number>();
    let handler: FileSystemHashHandler;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-fs-code-"));
        await fs.writeFile(path.join(tempDir, "index.js"), "export default 1;");
        await fs.writeFile(path.join(tempDir, "page.html"), "<script>1</script>");
        await fs.writeFile(path.join(tempDir, "model.json"), "{}");
        await fs.writeFile(path.join(tempDir, "asset.png"), Buffer.from("png"));
        storageManager = new StorageManager({
            logger: { error: vi.fn(), warn: vi.fn() },
        } as any);
        trustedWindows.clear();
        handler = new FileSystemHashHandler("app", {}, storageManager, {
            mayRunProjectCode: owner => owner !== undefined && trustedWindows.has(owner),
        });
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    function textGrant(name: string, owner: number): string {
        const hash = storageManager.allocateHash(path.join(tempDir, name), false, "read", owner, "utf-8");
        storageManager.updateStatus(hash, "ready");
        return hash;
    }

    it("serves a trusted window's script as JavaScript", async () => {
        trustedWindows.add(1);
        const response = await handler.handle(makeRequest(textGrant("index.js", 1)));
        expect(response.statusCode).toBe(200);
        expect(response.headers["Content-Type"]).toMatch(/javascript/);
        expect(response.headers["X-Content-Type-Options"]).toBeUndefined();
    });

    it("serves a distrusted window's script as text a page cannot run", async () => {
        // The bytes still arrive - a distrusted project stays readable and editable - but under a
        // type no `import()` accepts and with sniffing off, so a classic script tag cannot guess
        // its way past the type either.
        const response = await handler.handle(makeRequest(textGrant("index.js", 2)));
        expect(response.statusCode).toBe(200);
        expect(String(response.data)).toBe("export default 1;");
        expect(response.headers["Content-Type"]).toBe("text/plain; charset=utf-8");
        expect(response.headers["X-Content-Type-Options"]).toBe("nosniff");
    });

    it("treats a page the same way", async () => {
        const response = await handler.handle(makeRequest(textGrant("page.html", 2)));
        expect(response.headers["Content-Type"]).toBe("text/plain; charset=utf-8");
    });

    it("leaves a distrusted window's data and images as they are", async () => {
        // Turning these inert would break the asset panel for no gain: nothing runs a JSON file
        // or an image, and the project is meant to stay readable.
        expect((await handler.handle(makeRequest(textGrant("model.json", 2)))).headers["Content-Type"]).toMatch(/json/);
        const image = storageManager.allocateHash(path.join(tempDir, "asset.png"), true, "read", 2);
        storageManager.updateStatus(image, "ready");
        expect((await handler.handle(makeRequest(image))).headers["Content-Type"]).toBe("application/octet-stream");
    });

    it("asks per response, so a grant withdrawn since the URL was minted is honoured", async () => {
        trustedWindows.add(1);
        const hash = textGrant("index.js", 1);
        storageManager.promoteToSessionRead(hash, 1);
        expect((await handler.handle(makeRequest(hash))).headers["Content-Type"]).toMatch(/javascript/);

        trustedWindows.delete(1);
        expect((await handler.handle(makeRequest(hash))).headers["Content-Type"]).toBe("text/plain; charset=utf-8");
    });

    it("applies to every file inside a directory grant", async () => {
        await fs.mkdir(path.join(tempDir, "bundle"));
        await fs.writeFile(path.join(tempDir, "bundle", "runtime.js"), "1");
        await fs.writeFile(path.join(tempDir, "bundle", "model.moc3"), Buffer.from([1, 2, 3]));
        const hash = storageManager.allocateDirectoryHash(path.join(tempDir, "bundle"), 2);

        const script = await handler.handle(makeRequest(`${hash}/runtime.js`));
        expect(script.headers["Content-Type"]).toBe("text/plain; charset=utf-8");
        // The model's own type survives: the runtime that would branch on it is the thing being
        // refused, and a trusted window's bundle is unaffected either way.
        const model = await handler.handle(makeRequest(`${hash}/model.moc3`));
        expect(model.statusCode).toBe(200);
        expect(model.headers["Content-Type"]).not.toBe("text/plain; charset=utf-8");
    });
});

/**
 * A single-file write the disk refuses. The renderer words the failure for the author from the
 * filesystem's code - a read-only file, a folder that is gone - so the answer has to carry the code,
 * and it must not be the grant URL the write went to, which names nothing anyone can act on.
 */
describe("FileSystemHashHandler refused writes", () => {
    let tempDir: string;
    let storageManager: StorageManager;
    let handler: FileSystemHashHandler;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-fs-refused-"));
        storageManager = new StorageManager({
            logger: { error: vi.fn(), warn: vi.fn() },
        } as any);
        handler = new FileSystemHashHandler("app", {}, storageManager, { mayRunProjectCode: () => true });
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("answers with the filesystem's own error, code and all, as JSON", async () => {
        // A file where the target's folder should be: no platform can create the scratch file.
        const blocker = path.join(tempDir, "not-a-folder");
        await fs.writeFile(blocker, "x");
        const target = path.join(blocker, "Demo.nlproj");
        const hash = storageManager.allocateHash(target, true, "write", 1);
        storageManager.updateStatus(hash, "ready");

        const body = new TextEncoder().encode("bytes");
        const response = await handler.handle({
            url: `app://fs/${hash}`,
            method: "PUT",
            arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
        } as unknown as Request);

        expect(response.statusCode).toBe(500);
        expect(response.headers?.["Content-Type"]).toBe("application/json");
        const error = JSON.parse(String(response.data)).error as { code: string; message: string };
        expect(Object.values(FsRejectErrorCode)).toContain(error.code);
        expect(error.message).not.toContain("app://");
        expect(error.message).not.toContain(hash);
    });

    it("answers a read it could not make the same way", async () => {
        // A folder where a file was granted: nothing can read it as one.
        const folder = path.join(tempDir, "a-folder");
        await fs.mkdir(folder);
        const hash = storageManager.allocateHash(folder, true, "read", 1);
        storageManager.updateStatus(hash, "ready");

        const response = await handler.handle({ url: `app://fs/${hash}`, method: "GET" } as unknown as Request);

        expect(response.statusCode).toBe(500);
        expect(response.headers?.["Content-Type"]).toBe("application/json");
        const error = JSON.parse(String(response.data)).error as { code: string; message: string };
        expect(Object.values(FsRejectErrorCode)).toContain(error.code);
        expect(error.message).not.toContain(hash);
    });
});
