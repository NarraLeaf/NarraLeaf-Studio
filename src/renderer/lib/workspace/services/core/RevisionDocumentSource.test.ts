import { describe, expect, it, vi } from "vitest";
import { RevisionDocumentSource, type RevisionDocumentReader } from "./RevisionDocumentSource";

/**
 * The batching contract, which is the difference between a revision view that opens and one that
 * spends a minute on the network.
 *
 * The reader below counts CALLS, not paths: on a project with a remote each call can be a round trip
 * that fetches fragments (docs/version-control.md §6), and the whole design of this class is that a
 * whole-revision read costs one of them and everything afterwards costs none.
 */

const REVISION = "rev-1";

function createReader(documents: Record<string, string>) {
    const calls: (readonly string[] | undefined)[] = [];
    const reader: RevisionDocumentReader = {
        readRevisionDocuments: vi.fn(async (_revision, paths) => {
            calls.push(paths);
            const out = new Map<string, string | null>();
            if (paths) {
                for (const path of paths) out.set(path, documents[path] ?? null);
                return out;
            }
            // Whatever the revision holds that looks like a document, which is what the backend's
            // unfiltered read answers: it selects by suffix so that a project's assets do not cross
            // IPC. A test whose whole-revision read returned everything would never exercise the
            // fallback for a path the selection missed.
            for (const [path, text] of Object.entries(documents)) {
                if (path.endsWith(".json")) out.set(path, text);
            }
            return out;
        }),
    };
    return { reader, calls };
}

describe("RevisionDocumentSource", () => {
    it("reads the whole revision once and answers everything afterwards from memory", async () => {
        const { reader, calls } = createReader({
            "project.json": "{\"name\":\"game\"}",
            "editor/story/index.json": "{\"stories\":[]}",
        });
        const source = new RevisionDocumentSource(REVISION, reader);

        await source.prewarm();
        await expect(source.read("project.json")).resolves.toBe("{\"name\":\"game\"}");
        await expect(source.read("editor/story/index.json")).resolves.toBe("{\"stories\":[]}");

        expect(calls).toEqual([undefined]);
        expect(source.origin).toEqual({ kind: "revision", revision: REVISION });
    });

    /**
     * The prewarm enumerated the revision's tree, so a JSON path it did not return is genuinely absent
     * there. Confirming that with a round trip would mean one tree walk per document added since the
     * revision - and every project has some.
     */
    it("answers a document added after the revision as absent, without asking again", async () => {
        const { reader, calls } = createReader({ "project.json": "{}" });
        const source = new RevisionDocumentSource(REVISION, reader);

        await source.prewarm();

        await expect(source.read("editor/story/stories/new/storydoc.json")).resolves.toBeNull();
        expect(calls).toEqual([undefined]);
    });

    /**
     * The prewarm only claims the paths it actually covered. A versioned file that is not one of them
     * has to be asked for, or a filter chosen for payload size would start reporting files as deleted.
     */
    it("asks for a path the prewarm did not cover, rather than calling it absent", async () => {
        const { reader, calls } = createReader({ "plugins/thing/manifest.txt": "hello" });
        const source = new RevisionDocumentSource(REVISION, reader, path => path.endsWith(".json"));

        await source.prewarm();
        await expect(source.read("plugins/thing/manifest.txt")).resolves.toBe("hello");
        // And remembered, so a second reader of the same file does not pay for it again.
        await expect(source.read("plugins/thing/manifest.txt")).resolves.toBe("hello");

        expect(calls).toEqual([undefined, ["plugins/thing/manifest.txt"]]);
    });

    it("remembers that a targeted read came back absent", async () => {
        const { reader, calls } = createReader({});
        const source = new RevisionDocumentSource(REVISION, reader, () => false);

        await expect(source.read("editor/variables.json")).resolves.toBeNull();
        await expect(source.read("editor/variables.json")).resolves.toBeNull();

        expect(calls).toEqual([["editor/variables.json"]]);
    });

    /**
     * The view and the reload it starts both prewarm. Two network reads for one answer is the whole
     * cost this class exists to avoid, so the second has to wait on the first rather than start its own.
     */
    it("shares one whole-revision read between callers that arrive together", async () => {
        const { reader, calls } = createReader({ "project.json": "{}" });
        const source = new RevisionDocumentSource(REVISION, reader);

        await Promise.all([source.prewarm(), source.prewarm(), source.prewarm()]);

        expect(calls).toEqual([undefined]);
    });

    it("retries a prewarm that failed instead of remembering the failure", async () => {
        const { reader } = createReader({ "project.json": "{}" });
        const read = reader.readRevisionDocuments as ReturnType<typeof vi.fn>;
        read.mockRejectedValueOnce(new Error("the remote timed out"));
        const source = new RevisionDocumentSource(REVISION, reader);

        await expect(source.prewarm()).rejects.toThrow("the remote timed out");
        await expect(source.prewarm()).resolves.toBeUndefined();
        await expect(source.read("project.json")).resolves.toBe("{}");
    });

    it("accepts either separator, because callers build paths both ways", async () => {
        const { reader } = createReader({ "editor/story/index.json": "{}" });
        const source = new RevisionDocumentSource(REVISION, reader);

        await source.prewarm();

        await expect(source.read("editor\\story\\index.json")).resolves.toBe("{}");
    });
});
