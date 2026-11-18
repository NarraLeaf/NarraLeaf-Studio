import { describe, expect, it, vi } from "vitest";

import { bytesOf, changesSince, contentFor, PRESENT, type TeamFilePorts } from "./teamFileSync";

describe("Team whole-file content", () => {
    const ports = {
        offer: vi.fn(),
        collect: vi.fn(),
    } as unknown as TeamFilePorts;

    it("preserves a UTF-8 byte order mark when a whole file travels inline", async () => {
        const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("Hello, 世界\n")]);
        const content = await contentFor(ports, "notes.txt", bytes);

        expect(content).not.toBe("unsendable");
        if (content === "unsendable") throw new Error("File could not be sent");
        expect(content).toEqual({ encoding: "utf8", data: "\ufeffHello, 世界\n" });
        expect(await bytesOf(ports, "notes.txt", content)).toEqual(bytes);
    });

    it("sends an authority document with a byte order mark as JSON text", async () => {
        const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("{}")]);

        expect(await contentFor(ports, "editor/services/character.json", bytes)).toEqual({
            encoding: "utf8",
            data: "{}",
        });
    });

    it("round-trips binary files and transfers large files", async () => {
        const binary = new Uint8Array([0, 0xff, 0x80, 1]);
        const inline = await contentFor(ports, "sample.bin", binary);
        expect(inline).toEqual({ encoding: "base64", data: "AP+AAQ==" });
        if (inline === "unsendable") throw new Error("File could not be sent");
        expect(await bytesOf(ports, "sample.bin", inline)).toEqual(binary);

        const large = new Uint8Array(64 * 1024 + 1).fill(0x61);
        const transfer = { transferId: "transfer", digest: "digest", size: large.length };
        const transferPorts = {
            offer: vi.fn(async () => transfer),
            collect: vi.fn(async () => large),
        } as unknown as TeamFilePorts;
        const content = await contentFor(transferPorts, "notes.txt", large);
        expect(content).toEqual({ blob: transfer });
        if (content === "unsendable") throw new Error("File could not be sent");
        expect(await bytesOf(transferPorts, "notes.txt", content)).toEqual(large);
    });

    it("reports files that cannot be sent or collected", async () => {
        const unavailable = {
            offer: async () => null,
            collect: async () => null,
        } as unknown as TeamFilePorts;
        const large = new Uint8Array(64 * 1024 + 1).fill(0x61);
        const transfer = { transferId: "transfer", digest: "digest", size: large.length };

        expect(await contentFor(unavailable, "editor/services/character.json", new Uint8Array([0]))).toBe("unsendable");
        expect(await contentFor(unavailable, "notes.txt", large)).toBe("unsendable");
        expect(await bytesOf(unavailable, "notes.txt", { blob: transfer })).toBe("unavailable");
    });

    it("reports changed, new and removed files without deleting unreferenced asset content", async () => {
        const text = (value: string) => new TextEncoder().encode(value);
        const files = new Map([
            ["notes.txt", text("new")],
            ["unchanged.txt", text("same")],
            ["new.txt", text("created")],
            ["assets/content/present", text("asset")],
        ]);
        const disk = {
            list: async () => [...files.keys()],
            read: async (path: string) => files.get(path) ?? null,
            digest: async (bytes: Uint8Array) => new TextDecoder().decode(bytes),
        } as unknown as TeamFilePorts;
        const agreed = new Map([
            ["notes.txt", "old"],
            ["unchanged.txt", "same"],
            ["removed.txt", "old"],
            ["assets/content/present", PRESENT],
            ["assets/content/removed", PRESENT],
        ]);

        expect(await changesSince(disk, agreed, "all")).toEqual([
            { path: "notes.txt", bytes: text("new") },
            { path: "new.txt", bytes: text("created") },
            { path: "removed.txt", bytes: null },
        ]);
    });
});
