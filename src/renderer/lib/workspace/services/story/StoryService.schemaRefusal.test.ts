import { beforeEach, describe, expect, it, vi } from "vitest";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import { findStoryDocumentTooNewError } from "@shared/story/migrateStoryDocument";
import {
    clearWorkspaceAnomalies,
    getWorkspaceAnomalies,
} from "@/lib/workspace/recovery/anomalyLog";
import { Services, type WorkspaceContext } from "../services";
import { StoryService } from "./StoryService";

vi.mock("@/lib/app/writeFreeze", () => ({ getProjectWriteFreeze: () => null }));

/**
 * What the workspace does with a story document a newer Studio wrote.
 *
 * The answer has to be all three of these at once, and any one of them alone is worse than useless.
 * The document must not load, because reading it means dropping every field this build has not heard
 * of. Nothing must be written back to it, because the next autosave would make that drop permanent
 * and there is no copy of what was lost. And the author has to be told, because a story that simply
 * refuses to open with no explanation reads as damage they caused.
 *
 * The third is what the anomaly is for: a `degraded` report is what puts the sticky recovery offer
 * on screen, and recovery mode's first act is to freeze the project so that looking at it cannot
 * destroy the evidence. That is the same treatment a file that will not parse gets, which is the
 * right one here - from the workspace's point of view this file cannot be read.
 */

const STORY_ID = "71bb159f-1322-4539-b09f-9593a426a67d";

function documentAtVersion(version: number) {
    return {
        schemaVersion: version,
        id: STORY_ID,
        name: "Skeleton",
        chapters: [],
        scenes: {},
        meta: { createdAt: "2026-08-07T04:03:28.336Z", updatedAt: "2026-08-07T04:03:28.336Z" },
    };
}

/** A real service over a filesystem that answers one document and records every write. */
function mountStoryService(document: unknown) {
    const writes: { path: string; data: unknown }[] = [];
    const fs = {
        readJSON: async () => ({ ok: true, data: document }),
        writeJSON: async (path: string, data: unknown) => {
            writes.push({ path, data });
            return { ok: true, data: undefined };
        },
        write: async (path: string, data: unknown) => {
            writes.push({ path, data });
            return { ok: true, data: undefined };
        },
        exists: async () => ({ ok: true, data: true }),
        createDir: async () => ({ ok: true, data: undefined }),
    };
    const service = new StoryService();
    service.setContext({
        project: {
            resolve: (...parts: (string | string[])[]) =>
                parts.flatMap(part => (Array.isArray(part) ? part : [part])).join("/").replace(/\/+/g, "/"),
        },
        services: {
            get(id: Services) {
                switch (id) {
                    case Services.FileSystem:
                        return fs;
                    default:
                        return {};
                }
            },
        },
    } as unknown as WorkspaceContext);
    (service as unknown as { index: unknown }).index = {
        schemaVersion: 1,
        stories: [{
            id: STORY_ID,
            name: "Skeleton",
            documentPath: `editor/story/stories/${STORY_ID}/storydoc.json`,
            createdAt: "2026-08-07T04:03:28.336Z",
            updatedAt: "2026-08-07T04:03:28.336Z",
        }],
        meta: {},
    };
    return { service, writes };
}

describe("StoryService and a document from a newer Studio", () => {
    beforeEach(() => {
        clearWorkspaceAnomalies();
    });

    it("refuses the document and carries both versions through the wrapper", async () => {
        const { service } = mountStoryService(documentAtVersion(STORY_DOCUMENT_SCHEMA_VERSION + 2));

        const failure = await service.loadStory(STORY_ID as never).then(
            () => null,
            (error: unknown) => error,
        );

        expect(failure).not.toBeNull();
        const refusal = findStoryDocumentTooNewError(failure);
        expect(refusal?.version).toBe(STORY_DOCUMENT_SCHEMA_VERSION + 2);
        expect(refusal?.supportedVersion).toBe(STORY_DOCUMENT_SCHEMA_VERSION);
    });

    it("says so in the author's language rather than in the ladder's", async () => {
        const { service } = mountStoryService(documentAtVersion(STORY_DOCUMENT_SCHEMA_VERSION + 2));

        const failure = await service.loadStory(STORY_ID as never).catch((error: unknown) => error);

        // The sentence a panel prints, not the developer one the ladder throws. Both numbers are in
        // it, which is the whole reason a surface has anything to say about this.
        expect((failure as Error).message).toContain("Skeleton");
        expect((failure as Error).message).toContain(String(STORY_DOCUMENT_SCHEMA_VERSION + 2));
        expect((failure as Error).message).toContain(String(STORY_DOCUMENT_SCHEMA_VERSION));
        expect((failure as Error).message).not.toContain("schema v");
    });

    it("reports it as degraded so the recovery offer appears", async () => {
        const { service } = mountStoryService(documentAtVersion(STORY_DOCUMENT_SCHEMA_VERSION + 1));

        await service.loadStory(STORY_ID as never).catch(() => undefined);

        const reported = getWorkspaceAnomalies();
        expect(reported).toHaveLength(1);
        expect(reported[0].source).toBe("story");
        // `degraded` and not `fatal`: the workspace came up, which is exactly the case the offer is
        // for - nothing on screen looks wrong and the author's next move is to start editing.
        expect(reported[0].severity).toBe("degraded");
        // Verbatim, because the recovery panel shows it as it arrived.
        expect(reported[0].raw).toContain(String(STORY_DOCUMENT_SCHEMA_VERSION + 1));
    });

    it("writes nothing, then or later", async () => {
        const { service, writes } = mountStoryService(documentAtVersion(STORY_DOCUMENT_SCHEMA_VERSION + 1));

        await service.loadStory(STORY_ID as never).catch(() => undefined);
        // A refused document never enters the in-memory map, so there is nothing for a save to
        // write - and asking for it by name is a programming error rather than a silent empty
        // document. This is the whole of the read-only guarantee: it is structural, not a flag.
        expect(() => service.getStoryDocument(STORY_ID as never)).toThrow();
        await service.saveStory(STORY_ID as never).catch(() => undefined);

        expect(writes).toEqual([]);
    });

    it("opens a document at the current version exactly as before", async () => {
        const { service } = mountStoryService(documentAtVersion(STORY_DOCUMENT_SCHEMA_VERSION));

        const document = await service.loadStory(STORY_ID as never);

        expect(document.id).toBe(STORY_ID);
        expect(getWorkspaceAnomalies()).toHaveLength(0);
    });
});
