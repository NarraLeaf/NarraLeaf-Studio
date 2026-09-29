import { describe, expect, it } from "vitest";
import type { VersionControlService } from "@/lib/workspace/services/core/VersionControlService";
import { readDocumentNames } from "./nameSources";

/**
 * Where the working tree's names come from while a merge has left a library conflicted.
 *
 * A conflicted story library has diff3 markers in it and does not parse, so every story it names
 * went nameless on the merge panel - drawn as the stand-in "Story" beside a title the author had
 * given it. The merge keeps the author's own side beside the file, and the editors read that side
 * while the merge is open; the names are read from it too.
 */

const INDEX = "editor/story/index.json";
const STORY_ID = "5f0c2d9a-8b1e-4c7d-9a3f-6e2b1d0c4a8e";

function library(name: string, updatedAt: string): string {
    return JSON.stringify({
        schemaVersion: 1,
        stories: [{
            id: STORY_ID,
            name,
            documentPath: `editor/story/stories/${STORY_ID}/storydoc.json`,
            createdAt: "2026-09-20T10:00:00.000Z",
            updatedAt,
        }],
    }, null, 2);
}

/** The working tree as the backend leaves a conflicted file: markers in it, three copies beside it. */
const CONFLICTED = [
    "{",
    "  \"stories\": [",
    "    {",
    `      "id": "${STORY_ID}",`,
    "      \"name\": \"The Lighthouse\",",
    "<<<<<<< ours",
    "      \"updatedAt\": \"2026-09-27T08:40:00.000Z\"",
    "||||||| original",
    "      \"updatedAt\": \"2026-09-26T10:00:00.000Z\"",
    "=======",
    "      \"updatedAt\": \"2026-09-27T08:15:00.000Z\"",
    ">>>>>>> theirs",
    "    }",
    "  ]",
    "}",
].join("\n");

function workingTree(files: Record<string, string>): { service: VersionControlService; read: string[] } {
    const read: string[] = [];
    const encoder = new TextEncoder();
    const service = {
        readWorkingFile: async (path: string) => {
            read.push(path);
            if (!(path in files)) {
                throw new Error(`absent: ${path}`);
            }
            return encoder.encode(files[path]);
        },
    } as unknown as VersionControlService;
    return { service, read };
}

const WORKING = { before: null, after: { at: "working-tree" as const } };

describe("names read off the working tree", () => {
    it("come from the author's own copy of a library the merge left conflicted", async () => {
        const { service } = workingTree({
            [INDEX]: CONFLICTED,
            [`${INDEX}~mine`]: library("The Lighthouse", "2026-09-27T08:40:00.000Z"),
            [`${INDEX}~theirs`]: library("The Lighthouse", "2026-09-27T08:15:00.000Z"),
        });

        const names = await readDocumentNames(service, WORKING, new Set(["stories"]));

        expect(names.storyTitles.get(STORY_ID)).toBe("The Lighthouse");
    });

    it("come from the library itself whenever it reads, and nothing else is opened", async () => {
        const { service, read } = workingTree({
            [INDEX]: library("Harbour", "2026-09-27T08:40:00.000Z"),
            [`${INDEX}~mine`]: library("The Lighthouse", "2026-09-27T08:40:00.000Z"),
        });

        const names = await readDocumentNames(service, WORKING, new Set(["stories"]));

        expect(names.storyTitles.get(STORY_ID)).toBe("Harbour");
        expect(read).toEqual([INDEX]);
    });

    it("are missing, not invented, when neither the library nor a copy of it reads", async () => {
        const { service } = workingTree({ [INDEX]: CONFLICTED });

        const names = await readDocumentNames(service, WORKING, new Set(["stories"]));

        expect(names.storyTitles.size).toBe(0);
    });
});
