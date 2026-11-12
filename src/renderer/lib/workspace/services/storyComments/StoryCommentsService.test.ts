import { beforeEach, describe, expect, it, vi } from "vitest";
import { FsRejectErrorCode, type FsRequestResult } from "@shared/types/os";
import { join } from "@shared/utils/path";
import { STORY_COMMENTS_SCHEMA_VERSION } from "@shared/types/storyComments";
import { Services, type WorkspaceContext } from "../services";
import { HistoryService } from "../history/HistoryService";
import { projectHistoryScope, storySceneHistoryScope } from "../history/historyScopes";
import { StoryCommentsService } from "./StoryCommentsService";

/**
 * Review threads: the document, the one-thread-per-row rule, the undo steps, and the author name.
 */

let authorSetting: unknown = "Ada";
let teamSession: { account: { displayName: string; username: string; userId: string } } | null = null;

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        app: {
            state: {
                onGlobalStateChanged: () => ({ cancel: () => undefined }),
                getGlobalState: async () => ({ success: true as const, data: { value: authorSetting } }),
            },
        },
    }),
    getPrivilegedInterface: () => ({}),
}));

const ROOT = join("D:/projects", "my-game");
const documentPath = join(ROOT, "editor", "story-comments.json");

async function createHarness(seed?: string) {
    const files = new Map<string, string>();
    if (seed !== undefined) files.set(documentPath, seed);
    const unreadable = vi.fn();
    const history = new HistoryService();
    const ok = <T,>(data: T): FsRequestResult<T> => ({ ok: true, data });
    const stubs: Record<string, unknown> = {
        [Services.FileSystem]: {
            read: async (path: string) => {
                const value = files.get(path);
                return value === undefined
                    ? { ok: false, error: { code: FsRejectErrorCode.NOT_FOUND, message: "missing" } }
                    : ok(value);
            },
            writeFileNoFollowOrCreate: async (path: string, data: string) => {
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
        [Services.History]: history,
        [Services.VersionControl]: {
            onSessionChanged: () => () => undefined,
            getServerSession: async () => teamSession,
        },
        [Services.SaveStatus]: { register: () => undefined, reportUnreadableDocument: unreadable },
    };
    const ctx = {
        project: { getConfig: () => ({ projectPath: ROOT }) },
        services: {
            get: (id: string) => {
                const stub = stubs[id];
                if (!stub) throw new Error(`Service ${id} not found`);
                return stub;
            },
        },
    } as unknown as WorkspaceContext;
    const service = new StoryCommentsService();
    await service.initialize(ctx, async () => undefined);
    await service.resolveAuthor();
    return { service, files, history, unreadable };
}

const row = { storyId: "story", sceneId: "scene", blockId: "block-1" };

beforeEach(() => {
    authorSetting = "Ada";
    teamSession = null;
});

describe("story comments", () => {
    it("writes nothing until there is a thread, then round-trips it", async () => {
        const { service, files } = await createHarness();
        expect(files.has(documentPath)).toBe(false);

        const thread = service.createThread({ ...row, text: "  Hello   there ", body: " Too long ", todo: true });
        await service.flushPendingChanges();

        expect(thread).not.toBeNull();
        const saved = JSON.parse(files.get(documentPath)!);
        expect(saved.schemaVersion).toBe(STORY_COMMENTS_SCHEMA_VERSION);
        const stored = saved.threads[thread!.id];
        expect(stored).toMatchObject({ ...row, excerpt: "Hello there", todo: true, resolved: false });
        expect(stored.comments).toHaveLength(1);
        expect(stored.comments[0]).toMatchObject({ body: "Too long", author: { name: "Ada" } });

        const reread = await createHarness(files.get(documentPath));
        expect(reread.service.threadForBlock("block-1")?.comments[0].body).toBe("Too long");
    });

    it("keeps one open thread per row: a second comment becomes a reply", async () => {
        const { service } = await createHarness();
        const first = service.createThread({ ...row, body: "One" })!;
        service.createThread({ ...row, body: "Two" });
        expect(service.listThreads()).toHaveLength(1);
        expect(service.getThread(first.id)?.comments.map(comment => comment.body)).toEqual(["One", "Two"]);
    });

    it("records each edit as one undo step on the stack it was made from", async () => {
        const { service, history } = await createHarness();
        const scopeId = storySceneHistoryScope("story", "scene");
        const thread = service.createThread({ ...row, body: "One" }, { scopeId })!;
        service.setResolved(thread.id, true, { scopeId });
        expect(service.getThread(thread.id)?.resolved).toBe(true);
        expect(service.getThread(thread.id)?.resolvedBy?.name).toBe("Ada");

        expect(history.undo(scopeId)).toBe(true);
        expect(service.getThread(thread.id)?.resolved).toBe(false);
        expect(history.undo(scopeId)).toBe(true);
        expect(service.getThread(thread.id)).toBeNull();
        expect(history.redo(scopeId)).toBe(true);
        expect(service.threadForBlock("block-1")?.id).toBe(thread.id);
        // Nothing landed on the project stack.
        expect(history.canUndo(projectHistoryScope())).toBe(false);
    });

    it("removes the thread with its last comment", async () => {
        const { service } = await createHarness();
        const thread = service.createThread({ ...row, body: "One" })!;
        expect(service.deleteComment(thread.id, thread.comments[0].id)).toBe(true);
        expect(service.listThreads()).toHaveLength(0);
    });

    it("signs with the Team account when the project is signed in, else with the local name", async () => {
        teamSession = { account: { displayName: "Ada Blackwood", username: "ada", userId: "u-1" } };
        const team = await createHarness();
        const thread = team.service.createThread({ ...row, body: "Hi" })!;
        expect(thread.comments[0].author).toEqual({ name: "Ada Blackwood", teamUserId: "u-1" });

        teamSession = null;
        authorSetting = "";
        const local = await createHarness();
        expect(local.service.getAuthor()).toEqual({ name: "" });
    });

    it("refuses to overwrite a file it could not read", async () => {
        const { service, unreadable } = await createHarness("{ \"threads\": [] }");
        expect(unreadable).toHaveBeenCalled();
        service.createThread({ ...row, body: "One" });
        await expect(service.save()).rejects.toThrow(/Refusing to write/);
    });
});
