import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadDocument } from "@shared/documents/documentIo";
import { DocumentPathError } from "@shared/documents/documentPath";
import { voiceDocumentSpec } from "@shared/documents/specs";
import { MainDocumentStorage } from "./documentStorage";

let root: string;
let storage: MainDocumentStorage;

beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "nls-docstore-"));
    storage = new MainDocumentStorage(root);
});

afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
});

describe("MainDocumentStorage", () => {
    it("reports a file that is not there as null rather than failing", async () => {
        expect(await storage.read("editor/variables.json")).toBeNull();
    });

    it("creates the directories a document needs", async () => {
        await storage.write("editor/voice/ja.json", "{}\n");

        expect(await fs.readFile(path.join(root, "editor", "voice", "ja.json"), "utf-8")).toBe("{}\n");
        expect(await storage.read("editor/voice/ja.json")).toBe("{}\n");
    });

    /**
     * The reason the port asks for `copy` rather than read-then-write. A truncated write can cut a
     * multi-byte sequence in half, and decoding that to a string replaces the tail with U+FFFD - so
     * a read-then-write "copy" would quarantine bytes that are not the bytes that failed, which is
     * the only thing the quarantined copy is for.
     */
    it("copies byte for byte, including bytes that are not valid UTF-8", async () => {
        const truncated = Buffer.concat([Buffer.from("{\"a\": \"", "utf-8"), Buffer.from([0xe6, 0x97])]);
        await fs.mkdir(path.join(root, "editor"), { recursive: true });
        await fs.writeFile(path.join(root, "editor", "variables.json"), truncated);

        await storage.copy("editor/variables.json", ".nlstudio/quarantine/stamp/editor/variables.json");

        const copied = await fs.readFile(path.join(root, ".nlstudio", "quarantine", "stamp", "editor", "variables.json"));
        expect(copied.equals(truncated)).toBe(true);
    });

    it("refuses to address anything outside the project root", async () => {
        await expect(storage.read("../secrets.json")).rejects.toThrow(DocumentPathError);
        await expect(storage.write(path.join(root, "editor", "x.json"), "{}")).rejects.toThrow(DocumentPathError);
    });

    it("quarantines an unreadable document and leaves the original alone", async () => {
        await fs.mkdir(path.join(root, "editor", "voice"), { recursive: true });
        await fs.writeFile(path.join(root, "editor", "voice", "ja.json"), "{truncated", "utf-8");

        const result = await loadDocument(voiceDocumentSpec, storage, "editor/voice/ja.json", {
            now: () => new Date("2026-07-27T14:32:11.123Z"),
        });

        expect(result.status).toBe("corrupt");
        expect(result.status === "corrupt" && result.quarantinePath)
            .toBe(".nlstudio/quarantine/2026-07-27T14-32-11-123Z/editor/voice/ja.json");
        expect(await fs.readFile(path.join(root, "editor", "voice", "ja.json"), "utf-8")).toBe("{truncated");
    });

    it("round-trips a document the renderer would have written", async () => {
        const document = {
            schemaVersion: 1 as const,
            locale: "ja",
            units: { "text-1": { assetId: "a1", sourceHash: "h1", status: "linked" as const } },
        };
        await storage.write("editor/voice/ja.json", voiceDocumentSpec.serialize(document));

        const result = await loadDocument(voiceDocumentSpec, storage, "editor/voice/ja.json");

        expect(result).toEqual({ status: "loaded", document, normalized: true });
    });
});
