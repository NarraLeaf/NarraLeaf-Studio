import { describe, expect, it } from "vitest";
import { loadDocument } from "@shared/documents/documentIo";
import { DocumentPathError } from "@shared/documents/documentPath";
import { voiceDocumentSpec } from "@shared/documents/specs";
import { FsRejectErrorCode, type FsRequestResult } from "@shared/types/os";
import { join } from "@shared/utils/path";
import { RendererDocumentStorage, type DocumentFileSystem } from "./DocumentStorage";

const ROOT = join("D:/projects", "my-game");

const ok = <T,>(data: T): FsRequestResult<T> => ({ ok: true, data });
const fail = (code: FsRejectErrorCode): FsRequestResult<never> => ({ ok: false, error: { code, message: code } });

type Harness = {
    storage: RendererDocumentStorage;
    files: Map<string, string>;
    calls: string[];
    readError: FsRejectErrorCode | null;
};

function createHarness(): Harness {
    const files = new Map<string, string>();
    const calls: string[] = [];
    const directories = new Set<string>([ROOT]);
    // One object throughout: the fake reads `harness.readError` at call time, so a test that flips
    // it after construction has to be flipping the very field the closure sees.
    const harness = { files, calls, readError: null } as Harness;

    const fs: DocumentFileSystem = {
        read: async path => {
            calls.push(`read ${path}`);
            if (harness.readError) {
                return fail(harness.readError);
            }
            const value = files.get(path);
            return value === undefined ? fail(FsRejectErrorCode.NOT_FOUND) : ok(value);
        },
        write: async (path, data) => {
            calls.push(`write ${path}`);
            // The real writer creates a temp sibling in the target's directory, so a missing parent
            // is a failed write rather than an implicitly created tree. Modelled, or the test would
            // pass with the `createDir` call removed.
            if (!directories.has(parentOf(path))) {
                return fail(FsRejectErrorCode.NOT_FOUND);
            }
            files.set(path, data);
            return ok(undefined);
        },
        createDir: async path => {
            calls.push(`createDir ${path}`);
            for (let current = path; current.length > ROOT.length; current = parentOf(current)) {
                directories.add(current);
            }
            return ok(undefined);
        },
        copyFile: async (src, dest) => {
            calls.push(`copyFile ${src} -> ${dest}`);
            const value = files.get(src);
            if (value === undefined) {
                return fail(FsRejectErrorCode.NOT_FOUND);
            }
            if (!directories.has(parentOf(dest))) {
                return fail(FsRejectErrorCode.NOT_FOUND);
            }
            files.set(dest, value);
            return ok(undefined);
        },
    };

    harness.storage = new RendererDocumentStorage(fs, ROOT);
    return harness;
}

function parentOf(path: string): string {
    return path.replace(/[\\/][^\\/]+$/, "");
}

describe("RendererDocumentStorage", () => {
    it("resolves project-relative paths against the project root", async () => {
        const harness = createHarness();
        harness.files.set(join(ROOT, "editor", "voice", "ja.json"), "{}");

        expect(await harness.storage.read("editor/voice/ja.json")).toBe("{}");
    });

    it("accepts a Windows-separated path for the same document", async () => {
        const harness = createHarness();
        harness.files.set(join(ROOT, "editor", "voice", "ja.json"), "{}");

        expect(await harness.storage.read("editor\\voice\\ja.json")).toBe("{}");
    });

    it("reports a missing file as null and every other failure as a throw", async () => {
        const harness = createHarness();

        expect(await harness.storage.read("editor/variables.json")).toBeNull();

        harness.readError = FsRejectErrorCode.PERMISSION_DENIED;
        // Not null: a file we were refused still has its contents, and calling that "missing" would
        // hand the caller an empty document to write back over it.
        await expect(harness.storage.read("editor/variables.json")).rejects.toThrow(/PERMISSION_DENIED/);
    });

    it("creates the parent directory before writing", async () => {
        const harness = createHarness();

        await harness.storage.write("editor/voice/ja.json", "{}\n");

        expect(harness.calls).toEqual([
            `createDir ${join(ROOT, "editor", "voice")}`,
            `write ${join(ROOT, "editor", "voice", "ja.json")}`,
        ]);
        expect(harness.files.get(join(ROOT, "editor", "voice", "ja.json"))).toBe("{}\n");
    });

    it("creates the destination directory before copying, which is what makes quarantine possible", async () => {
        const harness = createHarness();
        harness.files.set(join(ROOT, "editor", "variables.json"), "{oops");

        await harness.storage.copy("editor/variables.json", ".nlstudio/quarantine/stamp/editor/variables.json");

        expect(harness.files.get(join(ROOT, ".nlstudio", "quarantine", "stamp", "editor", "variables.json")))
            .toBe("{oops");
    });

    it("refuses to address anything outside the project", async () => {
        const harness = createHarness();

        await expect(harness.storage.read("../../../etc/passwd")).rejects.toThrow(DocumentPathError);
        await expect(harness.storage.write("D:/elsewhere/file.json", "{}")).rejects.toThrow(DocumentPathError);
        await expect(harness.storage.copy("editor/variables.json", "/tmp/leak.json")).rejects.toThrow(DocumentPathError);
    });

    it("carries an unreadable document into a quarantine directory that never existed", async () => {
        const harness = createHarness();
        harness.files.set(join(ROOT, "editor", "voice", "ja.json"), "{truncated");

        const result = await loadDocument(voiceDocumentSpec, harness.storage, "editor/voice/ja.json", {
            now: () => new Date("2026-07-27T14:32:11.123Z"),
        });

        expect(result.status).toBe("corrupt");
        expect(result.status === "corrupt" && result.quarantinePath)
            .toBe(".nlstudio/quarantine/2026-07-27T14-32-11-123Z/editor/voice/ja.json");
        expect(harness.files.get(join(
            ROOT, ".nlstudio", "quarantine", "2026-07-27T14-32-11-123Z", "editor", "voice", "ja.json",
        ))).toBe("{truncated");
        // And the file itself was never written to.
        expect(harness.calls.filter(call => call.startsWith("write "))).toEqual([]);
    });
});
