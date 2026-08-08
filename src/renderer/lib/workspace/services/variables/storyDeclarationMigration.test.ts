import { describe, expect, it, vi } from "vitest";
import { FsRejectErrorCode, type FsRequestResult } from "@shared/types/os";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story/document";
import type {
    StoryDeclarationBlock,
    StoryDocument,
    StoryId,
    StoryScene,
    StoryVariableScope,
} from "@shared/types/story/document";
import { join } from "@shared/utils/path";
import { Services, type WorkspaceContext } from "../services";
import { VariableRegistryService } from "./VariableRegistryService";

/**
 * The `/save` + `/global` retirement pass, driven through the real `VariableRegistryService.activate`
 * so the assertions are about the bytes that reach `editor/variables.json`, not about an in-memory
 * object a fake registry happened to return.
 *
 * The story side is a fake: `StoryService` is a large singleton whose disk layout is beside the
 * point here, and the pass only ever asks it three things (list, load, delete a row).
 */

const ROOT = join("D:/projects", "my-game");
const DOCUMENT = join(ROOT, "editor", "variables.json");

const SAVED_ROW = "6987a20b-6086-4aee-b49a-04397af993f6";
const GLOBAL_ROW = "a1bbd280-c1a5-4828-8734-cd6c3a4761d5";
const SCENE_ROW = "3f4e1c02-0000-4000-8000-000000000001";

function declaration(id: string, scope: StoryVariableScope, name: string, extra?: Partial<StoryDeclarationBlock["payload"]>): StoryDeclarationBlock {
    return {
        id,
        parentId: null,
        childrenIds: [],
        kind: "declaration",
        payload: { scope, name, valueType: "boolean", storageKey: id, ...extra },
    };
}

function documentWith(storyId: StoryId, rows: StoryDeclarationBlock[]): StoryDocument {
    const scene: StoryScene = {
        id: `${storyId}-scene`,
        name: "Corridor",
        runtimeName: "corridor",
        rootBlockIds: rows.map(row => row.id),
        blocks: Object.fromEntries(rows.map(row => [row.id, row])),
    };
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: storyId,
        name: "Chapter 1",
        chapters: [{ id: `${storyId}-chapter`, name: "One", sceneIds: [scene.id] }],
        scenes: { [scene.id]: scene },
    };
}

type StoryFake = {
    listStories(): { id: StoryId }[];
    loadStory(storyId: StoryId): Promise<StoryDocument>;
    deleteDeclarationRow(storyId: StoryId, variableId: string): boolean;
    documents: Map<StoryId, StoryDocument>;
};

function storyFake(documents: StoryDocument[]): StoryFake {
    const byId = new Map(documents.map(document => [document.id, document]));
    return {
        documents: byId,
        listStories: () => [...byId.keys()].map(id => ({ id })),
        loadStory: async (storyId: StoryId) => {
            const document = byId.get(storyId);
            if (!document) {
                throw new Error(`Story not found: ${storyId}`);
            }
            return document;
        },
        deleteDeclarationRow: (storyId: StoryId, variableId: string) => {
            const document = byId.get(storyId);
            if (!document) {
                return false;
            }
            for (const scene of Object.values(document.scenes)) {
                if (scene.blocks[variableId]) {
                    delete scene.blocks[variableId];
                    scene.rootBlockIds = scene.rootBlockIds.filter(id => id !== variableId);
                    return true;
                }
            }
            return false;
        },
    };
}

type Harness = {
    service: VariableRegistryService;
    ctx: WorkspaceContext;
    stories: StoryFake;
    files: Map<string, string>;
};

async function createHarness(documents: StoryDocument[], seed?: string): Promise<Harness> {
    const files = new Map<string, string>();
    if (seed !== undefined) {
        files.set(DOCUMENT, seed);
    }
    const stories = storyFake(documents);
    let nextId = 0;

    const ok = <T,>(data: T): FsRequestResult<T> => ({ ok: true, data });
    const stubs: Record<string, unknown> = {
        [Services.FileSystem]: {
            read: async (path: string) => {
                const value = files.get(path);
                return value === undefined
                    ? { ok: false, error: { code: FsRejectErrorCode.NOT_FOUND, message: "missing" } }
                    : ok(value);
            },
            write: async (path: string, data: string) => {
                files.set(path, data);
                return ok(undefined);
            },
            createDir: async () => ok(undefined),
            copyFile: async (src: string, dest: string) => {
                files.set(dest, files.get(src) ?? "");
                return ok(undefined);
            },
        },
        [Services.Project]: {},
        [Services.Uuid]: { generate: () => `minted-${++nextId}` },
        [Services.UIGraph]: { consumeLegacyPersistentVariables: () => null },
        [Services.SaveStatus]: { register: () => undefined, reportUnreadableDocument: vi.fn() },
        [Services.Story]: stories,
    };

    const ctx = {
        project: { getConfig: () => ({ projectPath: ROOT }) },
        services: {
            get: (id: string) => {
                const stub = stubs[id];
                if (!stub) {
                    throw new Error(`Service ${id} not found`);
                }
                return stub;
            },
        },
    } as unknown as WorkspaceContext;

    const service = new VariableRegistryService();
    await service.initialize(ctx, async () => undefined);
    return { service, ctx, stories, files };
}

/** Everything a scene still holds as a declaration row, whatever its scope. */
function remainingRows(document: StoryDocument): { id: string; scope: string }[] {
    return Object.values(document.scenes)
        .flatMap(scene => Object.values(scene.blocks))
        .filter((block): block is StoryDeclarationBlock => block.kind === "declaration")
        .map(block => ({ id: block.id, scope: block.payload.scope }));
}

describe("project-scope declaration migration", () => {
    it("converts a /save row and a /global row, keeping the row's id as the entry id", async () => {
        const document = documentWith("story-1", [
            declaration(SAVED_ROW, "saved", "Honest", { defaultValue: false }),
            declaration(GLOBAL_ROW, "persistent", "Location", { valueType: "string", defaultValue: "", description: "Where we are" }),
        ]);
        const { service, ctx, stories } = await createHarness([document]);

        await service.activate(ctx);

        // The whole point of the conversion: the entry id IS the block id, so every stored ref
        // (`{scope:"saved", variableId}`), every `saved:<id>` snapshot key and every save file keyed
        // by `storageKey` keeps resolving without a rewrite pass.
        expect(service.getEntry(SAVED_ROW)).toEqual({
            id: SAVED_ROW,
            name: "Honest",
            scope: "saved",
            valueType: "boolean",
            defaultValue: false,
            storageKey: SAVED_ROW,
        });
        expect(service.getEntry(GLOBAL_ROW)).toEqual({
            id: GLOBAL_ROW,
            name: "Location",
            scope: "persistent",
            valueType: "string",
            defaultValue: "",
            storageKey: GLOBAL_ROW,
            description: "Where we are",
        });
        expect(remainingRows(stories.documents.get("story-1")!)).toEqual([]);
    });

    it("leaves scene rows alone - the story still owns those", async () => {
        const document = documentWith("story-1", [
            declaration(SCENE_ROW, "scene", "hp", { valueType: "number", defaultValue: 100 }),
            declaration(SAVED_ROW, "saved", "Honest"),
        ]);
        const { service, ctx, stories } = await createHarness([document]);

        await service.activate(ctx);

        expect(remainingRows(stories.documents.get("story-1")!)).toEqual([{ id: SCENE_ROW, scope: "scene" }]);
        expect(service.listEntries().map(entry => entry.id)).toEqual([SAVED_ROW]);
    });

    /**
     * The idempotence requirement, and why the pass is gated on observable state rather than a flag.
     *
     * A frozen project's writes are dropped while reporting success, so a "have I run" flag would
     * mark the migration done having written nothing. The gate is instead "are there still rows",
     * and because entry ids come from block ids a re-run overwrites rather than duplicates - which is
     * what lets a frozen project, a partial pass or a failed write all re-converge on the next open.
     */
    it("is a no-op on the second run, byte for byte", async () => {
        const document = documentWith("story-1", [
            declaration(SAVED_ROW, "saved", "Honest", { defaultValue: false }),
            declaration(GLOBAL_ROW, "persistent", "Location", { valueType: "string" }),
        ]);
        const { service, ctx, files } = await createHarness([document]);

        await service.activate(ctx);
        const afterFirst = files.get(DOCUMENT);
        const revisionAfterFirst = service.getRevision();

        await service.activate(ctx);

        expect(files.get(DOCUMENT)).toBe(afterFirst);
        // Not even a mutation: with no rows left there is nothing to write, so the registry is not
        // re-saved and its `updatedAt` does not churn on every project open.
        expect(service.getRevision()).toBe(revisionAfterFirst);
        expect(service.listEntries().map(entry => entry.id).sort()).toEqual([SAVED_ROW, GLOBAL_ROW].sort());
    });

    it("re-converges rather than duplicating when a row survived an earlier pass", async () => {
        // What a frozen project leaves behind: the entry exists, the row was never deleted.
        const document = documentWith("story-1", [declaration(SAVED_ROW, "saved", "Honest Renamed", { defaultValue: true })]);
        const { service, ctx, stories } = await createHarness([document]);
        service.createEntry("saved", { name: "Stale" });
        const stale = service.listEntries()[0];

        await service.activate(ctx);

        expect(service.listEntriesInScope("saved").map(entry => entry.id).sort())
            .toEqual([SAVED_ROW, stale.id].sort());
        expect(service.getEntry(SAVED_ROW)?.name).toBe("Honest Renamed");
        expect(remainingRows(stories.documents.get("story-1")!)).toEqual([]);
    });

    it("touches nothing when no story declares a project-scoped variable", async () => {
        const document = documentWith("story-1", [declaration(SCENE_ROW, "scene", "hp")]);
        const { service, ctx, stories, files } = await createHarness([document]);
        const before = files.get(DOCUMENT);

        await service.activate(ctx);

        expect(files.get(DOCUMENT)).toBe(before);
        expect(service.listEntries()).toEqual([]);
        expect(remainingRows(stories.documents.get("story-1")!)).toEqual([{ id: SCENE_ROW, scope: "scene" }]);
    });

    it("sweeps every story, not just the first", async () => {
        const first = documentWith("story-1", [declaration(SAVED_ROW, "saved", "Honest")]);
        const second = documentWith("story-2", [declaration(GLOBAL_ROW, "persistent", "Location", { valueType: "string" })]);
        const { service, ctx, stories } = await createHarness([first, second]);

        await service.activate(ctx);

        expect(service.listEntries().map(entry => entry.id).sort()).toEqual([SAVED_ROW, GLOBAL_ROW].sort());
        expect(remainingRows(stories.documents.get("story-2")!)).toEqual([]);
    });

    /**
     * The rows are the only surviving copy of these variables until the registry write lands, so a
     * registry that could not be read (and therefore refuses to be written) must not cost them.
     */
    it("keeps the rows when the registry refuses to save", async () => {
        const broken = "{\"entries\": {\"gold\": {\"name\": \"Gold\", \"storageKey\": \"gold\"";
        const document = documentWith("story-1", [declaration(SAVED_ROW, "saved", "Honest")]);
        const { service, ctx, stories, files } = await createHarness([document], broken);

        await service.activate(ctx);

        expect(files.get(DOCUMENT)).toBe(broken);
        expect(remainingRows(stories.documents.get("story-1")!)).toEqual([{ id: SAVED_ROW, scope: "saved" }]);
    });
});
