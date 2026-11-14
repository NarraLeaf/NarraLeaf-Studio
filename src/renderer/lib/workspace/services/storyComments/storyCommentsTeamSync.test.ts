import { beforeEach, describe, expect, it, vi } from "vitest";
import { FsRejectErrorCode, type FsRequestResult } from "@shared/types/os";
import { join } from "@shared/utils/path";
import { STORY_COMMENTS_SCHEMA_VERSION } from "@shared/types/storyComments";
import { Services, type WorkspaceContext } from "../services";
import { HistoryService } from "../history/HistoryService";
import { projectHistoryScope, storySceneHistoryScope } from "../history/historyScopes";
import { StoryCommentsService } from "./StoryCommentsService";
import { StoryCommentsTeamSync, storyRowOfAnchor, type StoryCommentsTeamTransport } from "./storyCommentsTeamSync";
import type { TeamComment, TeamThread } from "@shared/types/team";

/**
 * Story-row comments kept in step with a Team server: pushed once each, pulled as the server has
 * them, and resolved in both directions.
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

/** A Team server's threads, in memory, honouring client ids the way the real one does. */
function fakeServer() {
    const threads = new Map<string, TeamThread>();
    const comments = new Map<string, TeamComment[]>();
    const byClient = new Map<string, string>();
    let next = 1;
    const calls: string[] = [];
    const todos = new Map<string, string>();
    const transport: StoryCommentsTeamTransport = {
        listThreads: async () => ({ threads: [...threads.values()] }),
        getThread: async id => {
            const thread = threads.get(id);
            return thread === undefined ? null : { thread, comments: comments.get(id) ?? [] };
        },
        createThread: async input => {
            calls.push(`create:${input.clientId}`);
            const known = byClient.get(input.clientId);
            if (known !== undefined) return { thread: threads.get(known)!, opening: comments.get(known)![0] };
            const id = `t${next++}`;
            const thread: TeamThread = { id, project: "p", anchor: input.anchor, kind: "comment", status: "open", createdAt: 1, updatedAt: 1, comments: 1 };
            const opening: TeamComment = { id: `c${next++}`, thread: id, author: "ada", body: input.body, createdAt: 1 };
            threads.set(id, thread);
            comments.set(id, [opening]);
            byClient.set(input.clientId, id);
            return { thread, opening };
        },
        reply: async input => {
            calls.push(`reply:${input.clientId}`);
            const comment: TeamComment = { id: `c${next++}`, thread: input.thread, author: "ada", body: input.body, createdAt: 2 };
            comments.set(input.thread, [...(comments.get(input.thread) ?? []), comment]);
            return comment;
        },
        createTodo: async input => {
            calls.push(`todo:${input.anchor.element}`);
            todos.set(`d${next}`, "open");
            return `d${next++}`;
        },
        setTodoStatus: async (id, status) => {
            calls.push(`todo-status:${id}:${status}`);
            todos.set(id, status);
            return true;
        },
        resolve: async (id, resolved) => {
            calls.push(`resolve:${id}:${resolved}`);
            const thread = threads.get(id);
            if (thread) threads.set(id, { ...thread, status: resolved ? "resolved" : "open" });
            return true;
        },
    };
    return { threads, comments, calls, todos, transport };
}

beforeEach(() => {
    authorSetting = "Ada";
    teamSession = null;
});

describe("the story-row anchor", () => {
    it("names a story and a row, and nothing else parses as one", () => {
        expect(storyRowOfAnchor({ document: "story:main", element: "scene/row" })).toEqual({ storyId: "main", sceneId: "scene", blockId: "row" });
        expect(storyRowOfAnchor({ document: "ui:main", element: "scene/row" })).toBeNull();
        expect(storyRowOfAnchor({ document: "story:main", element: "row" })).toBeNull();
    });
});

describe("keeping story comments in step with Team", () => {
    it("sends a local thread and its replies once, with their local ids as client ids", async () => {
        const { service } = await createHarness();
        const server = fakeServer();
        const thread = service.createThread({ ...row, body: "first" })!;
        service.reply(thread.id, "second");
        const sync = new StoryCommentsTeamSync(service, server.transport);

        await sync.push();
        await sync.push();

        expect(server.calls).toEqual([`create:${thread.id}`, `reply:${service.getThread(thread.id)!.comments[1]!.id}`]);
        const synced = service.getThread(thread.id)!;
        expect(synced.teamThreadId).toBe("t1");
        expect(synced.comments.every(comment => comment.teamCommentId !== undefined)).toBe(true);
        expect(server.threads.get("t1")!.anchor).toEqual({ document: "story:story", element: "scene/block-1" });
    });

    it("takes a thread somebody else opened, and keeps an unsent local reply after the server's", async () => {
        const { service } = await createHarness();
        const server = fakeServer();
        await server.transport.createThread({ anchor: { document: "story:story", element: "scene/block-9" }, body: "from the web", clientId: "web-1" });
        const sync = new StoryCommentsTeamSync(service, server.transport);

        await sync.pullAll();
        const pulled = service.listThreads().find(thread => thread.teamThreadId === "t1")!;
        expect(pulled).toMatchObject({ storyId: "story", sceneId: "scene", blockId: "block-9" });
        expect(pulled.comments.map(comment => comment.body)).toEqual(["from the web"]);

        service.reply(pulled.id, "answered in Studio");
        await sync.pullThread("t1");
        expect(service.getThread(pulled.id)!.comments.map(comment => comment.body)).toEqual(["from the web", "answered in Studio"]);
        await sync.push();
        expect(server.comments.get("t1")!.map(comment => comment.body)).toEqual(["from the web", "answered in Studio"]);
    });

    it("resolves on the server a thread resolved here, and the other way round", async () => {
        const { service } = await createHarness();
        const server = fakeServer();
        const thread = service.createThread({ ...row, body: "fix this" })!;
        const sync = new StoryCommentsTeamSync(service, server.transport);
        await sync.push();

        service.setResolved(thread.id, true);
        await sync.push();
        expect(server.threads.get("t1")!.status).toBe("resolved");

        server.threads.set("t1", { ...server.threads.get("t1")!, status: "open" });
        await sync.pullThread("t1");
        expect(service.getThread(thread.id)!.resolved).toBe(false);
    });

    it("turns a thread marked as a to-do into a project to-do on the row, finished when the thread is resolved", async () => {
        const { service } = await createHarness();
        const server = fakeServer();
        const thread = service.createThread({ ...row, body: "redraw this", todo: true })!;
        const sync = new StoryCommentsTeamSync(service, server.transport);

        await sync.push();
        await sync.push();
        const todoId = service.getThread(thread.id)!.teamTodoId!;
        expect(server.calls.filter(call => call.startsWith("todo:"))).toEqual(["todo:scene/block-1"]);

        service.setResolved(thread.id, true);
        await sync.push();
        expect(server.todos.get(todoId)).toBe("done");
    });
});
