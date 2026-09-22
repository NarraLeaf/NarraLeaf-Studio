import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSpan, streamFileSpan } from "./fileBody";

/**
 * A streamed body owns the file handle it reads from, and the renderer decides when it is done with
 * it - by reading to the end, or by abandoning the request (a seeking `<video>` does that constantly).
 * Every one of those ways out has to close the handle, or each seek leaks a descriptor into the main
 * process for as long as the garbage collector takes to notice.
 */
describe("streamFileSpan", () => {
    const SIZE = 3 * 256 * 1024 + 17;
    const bytes = Buffer.from(Array.from({ length: SIZE }, (_, index) => (index * 7) % 256));
    let tempDir: string;
    let filePath: string;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-fs-body-"));
        filePath = path.join(tempDir, "clip.bin");
        await fs.writeFile(filePath, bytes);
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    async function openWithCloseSpy() {
        const handle = await fs.open(filePath, "r");
        const close = vi.spyOn(handle, "close");
        return { handle, close };
    }

    it("delivers exactly the span it was given and closes the handle at the end", async () => {
        const { handle, close } = await openWithCloseSpy();

        const body = Buffer.from(await new Response(streamFileSpan(handle, 5, SIZE - 3)).arrayBuffer());

        expect(body.equals(bytes.subarray(5, SIZE - 2))).toBe(true);
        expect(close).toHaveBeenCalledTimes(1);
    });

    it("reads only as far as it has been asked", async () => {
        const { handle } = await openWithCloseSpy();
        const read = vi.spyOn(handle, "read");
        const reader = streamFileSpan(handle, 0, SIZE - 1).getReader();

        await reader.read();
        // One chunk handed over and at most one queued behind it - not the whole file.
        expect(read.mock.calls.length).toBeLessThanOrEqual(2);
        await reader.cancel();
    });

    it("closes the handle when the consumer abandons the body part-way", async () => {
        const { handle, close } = await openWithCloseSpy();
        const reader = streamFileSpan(handle, 0, SIZE - 1).getReader();

        await reader.read();
        await reader.cancel();

        expect(close).toHaveBeenCalledTimes(1);
    });

    it("fails the body, and closes the handle, when the file turns out shorter than declared", async () => {
        const { handle, close } = await openWithCloseSpy();
        await fs.truncate(filePath, 1000);

        await expect(new Response(streamFileSpan(handle, 0, SIZE - 1)).arrayBuffer()).rejects.toThrow();
        expect(close).toHaveBeenCalledTimes(1);
    });
});

describe("readFileSpan", () => {
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-fs-span-"));
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("reads the span, and only what is there when the file is shorter", async () => {
        const filePath = path.join(tempDir, "short.bin");
        await fs.writeFile(filePath, Buffer.from("0123456789"));
        const handle = await fs.open(filePath, "r");
        try {
            expect((await readFileSpan(handle, 2, 3)).toString()).toBe("234");
            expect((await readFileSpan(handle, 8, 10)).toString()).toBe("89");
        } finally {
            await handle.close();
        }
    });
});
