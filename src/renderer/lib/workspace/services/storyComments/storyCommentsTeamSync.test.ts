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
    const repliesByClient = new Map<string, TeamComment>();
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
            const thread: TeamThread = { id, project: "p", anchor: input.anchor, kind: input.kind ?? "comment", status: "open", createdAt: 1, updatedAt: 1, comments: 1 };
            const opening: TeamComment = {
                id: `c${next++}`,
                thread: id,
                author: "ada",
                body: input.body,
                createdAt: 1,
                ...(input.suggestion === undefined ? {} : { suggestion: input.suggestion }),
            };
            threads.set(id, thread);
            comments.set(id, [opening]);
            byClient.set(input.clientId, id);
            return { thread, opening };
        },
        reply: async input => {
            calls.push(`reply:${input.clientId}`);
            const known = repliesByClient.get(input.clientId);
            if (known !== undefined) return known;
            const comment: TeamComment = { id: `c${next++}`, thread: input.thread, author: "ada", body: input.body, createdAt: 2 };
            comments.set(input.thread, [...(comments.get(input.thread) ?? []), comment]);
            repliesByClient.set(input.clientId, comment);
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

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
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
        expect(storyRowOfAnchor({ document: "story:", element: "scene/row" })).toBeNull();
    });
});

describe("suggested edits", () => {
    it("open a thread carrying the row's new text, which taking resolves; a later one replaces an untaken one", async () => {
        const { service } = await createHarness();
        const thread = service.createThread({ ...row, text: "Hello.", body: "warmer?", suggestion: "Hello there!" })!;
        expect(thread.suggestion).toBe("Hello there!");

        const again = service.createThread({ ...row, body: "or this", suggestion: "Hi!" })!;
        expect(again.id).toBe(thread.id);
        expect(service.getThread(thread.id)!.suggestion).toBe("Hi!");

        expect(service.markSuggestionApplied(thread.id)).toBe(true);
        const taken = service.getThread(thread.id)!;
        expect(taken.resolved).toBe(true);
        expect(taken.suggestionAppliedAt).toBeDefined();

        const plain = service.createThread({ ...row, blockId: "block-2", body: "just a note" })!;
        expect(service.markSuggestionApplied(plain.id)).toBe(false);
    });

    it("travel to Team as a suggestion thread, and come back from one", async () => {
        const { service } = await createHarness();
        const server = fakeServer();
        service.createThread({ ...row, body: "warmer?", suggestion: "Hello there!" });
        const sync = new StoryCommentsTeamSync(service, server.transport);
        await sync.push();
        expect(server.threads.get("t1")!.kind).toBe("suggestion");
        expect(server.comments.get("t1")![0]!.suggestion).toBe("Hello there!");

        await server.transport.createThread({
            anchor: { document: "story:story", element: "scene/block-7" },
            body: "from the web",
            clientId: "web-2",
            kind: "suggestion",
            suggestion: "Better line.",
        });
        await sync.pullAll();
        expect(service.listThreads().find(thread => thread.blockId === "block-7")!.suggestion).toBe("Better line.");
    });
});

describe("keeping story comments in step with Team", () => {
    it("reports an incomplete initial read when a thread list page fails", async () => {
        const { service } = await createHarness();
        const server = fakeServer();
        let calls = 0;
        server.transport.listThreads = async () => {
            calls += 1;
            return calls === 1 ? { threads: [], cursor: "next" } : null;
        };
        const sync = new StoryCommentsTeamSync(service, server.transport);

        expect(await sync.pullAll()).toBe(false);
        expect(calls).toBe(2);
    });

    it("reports an incomplete initial read when a comment page fails", async () => {
        const { service } = await createHarness();
        const server = fakeServer();
        await server.transport.createThread({ anchor: { document: "story:story", element: "scene/block-1" }, body: "first", clientId: "web" });
        const thread = server.threads.get("t1")!;
        server.transport.getThread = async (_id, after?: string) => after === undefined
            ? { thread, comments: server.comments.get("t1")!, cursor: "next" }
            : null;
        const sync = new StoryCommentsTeamSync(service, server.transport);

        expect(await sync.pullAll()).toBe(false);
        expect(service.listThreads()).toEqual([]);
    });

    it("reports a complete initial read after every list and comment page", async () => {
        const { service } = await createHarness();
        const server = fakeServer();
        await server.transport.createThread({ anchor: { document: "story:story", element: "scene/block-1" }, body: "first", clientId: "web" });
        const sync = new StoryCommentsTeamSync(service, server.transport);

        expect(await sync.pullAll()).toBe(true);
        expect(service.listThreads()[0]!.comments.map(comment => comment.body)).toEqual(["first"]);
    });

    it("stops an initial read if the server repeats a list cursor", async () => {
        const { service } = await createHarness();
        const server = fakeServer();
        const list = vi.fn(async () => ({ threads: [], cursor: "same" }));
        server.transport.listThreads = list;
        const sync = new StoryCommentsTeamSync(service, server.transport);

        expect(await sync.pullAll()).toBe(false);
        expect(list).toHaveBeenCalledTimes(2);
    });

    it("reports an incomplete initial read when the list still has more pages at its limit", async () => {
        const { service } = await createHarness();
        const server = fakeServer();
        let page = 0;
        server.transport.listThreads = async () => ({ threads: [], cursor: `page-${++page}` });
        const sync = new StoryCommentsTeamSync(service, server.transport);

        expect(await sync.pullAll()).toBe(false);
        expect(page).toBe(100);
    });

    it("does not push pending writes while a full read later fails", async () => {
        const { service } = await createHarness();
        const server = fakeServer();
        const thread = service.createThread({ ...row, body: "first" })!;
        const sync = new StoryCommentsTeamSync(service, server.transport);
        await sync.push();
        service.reply(thread.id, "second");
        const reply = server.transport.reply;
        server.transport.reply = async input => {
            await reply(input);
            return null;
        };
        await sync.push();
        server.transport.reply = reply;
        const unsent = service.createThread({ ...row, blockId: "other", body: "new thread" })!;
        server.calls.length = 0;
        server.transport.listThreads = async page => page.before === undefined
            ? { threads: [server.threads.get("t1")!], cursor: "next" }
            : null;

        expect(await sync.pullAll()).toBe(false);
        expect(server.calls).toEqual([]);
        expect(service.getThread(unsent.id)!.teamThreadId).toBeUndefined();
    });

    it("does not push pending writes if a later thread's comment page fails", async () => {
        const { service } = await createHarness();
        const server = fakeServer();
        const local = service.createThread({ ...row, body: "first" })!;
        const sync = new StoryCommentsTeamSync(service, server.transport);
        await sync.push();
        service.reply(local.id, "second");
        const reply = server.transport.reply;
        server.transport.reply = async input => { await reply(input); return null; };
        await sync.push();
        server.transport.reply = reply;
        const remote = await server.transport.createThread({ anchor: { document: "story:story", element: "scene/remote" }, body: "remote", clientId: "web" });
        service.createThread({ ...row, blockId: "unsent", body: "new thread" });
        server.calls.length = 0;
        const get = server.transport.getThread;
        server.transport.getThread = async (id, after) => {
            const answer = await get(id, after);
            if (id !== remote!.thread.id || answer === null) return answer;
            return after === undefined ? { ...answer, cursor: "next" } : null;
        };

        expect(await sync.pullAll()).toBe(false);
        expect(server.calls).toEqual([]);
    });

    it("reconciles pending writes only after every thread was read", async () => {
        const { service } = await createHarness();
        const server = fakeServer();
        const local = service.createThread({ ...row, body: "first" })!;
        const sync = new StoryCommentsTeamSync(service, server.transport);
        await sync.push();
        service.reply(local.id, "second");
        const reply = server.transport.reply;
        server.transport.reply = async input => { await reply(input); return null; };
        await sync.push();
        server.transport.reply = reply;
        const unsent = service.createThread({ ...row, blockId: "unsent", body: "new thread" })!;
        server.calls.length = 0;
        const callsBeforeLastPage: string[][] = [];
        server.transport.listThreads = async page => {
            if (page.before === undefined) return { threads: [server.threads.get("t1")!], cursor: "next" };
            callsBeforeLastPage.push([...server.calls]);
            return { threads: [] };
        };

        expect(await sync.pullAll()).toBe(true);
        expect(callsBeforeLastPage).toEqual([[]]);
        expect(service.getThread(local.id)!.comments.map(comment => comment.body)).toEqual(["first", "second"]);
        expect(service.getThread(unsent.id)!.teamThreadId).toBeDefined();
    });

    it("leaves a full read incomplete when an uncertain write remains unavailable", async () => {
        const { service } = await createHarness();
        const server = fakeServer();
        const local = service.createThread({ ...row, body: "first" })!;
        const sync = new StoryCommentsTeamSync(service, server.transport);
        await sync.push();
        service.reply(local.id, "second");
        server.transport.reply = vi.fn(async () => null);
        await sync.push();

        expect(await sync.pullAll()).toBe(false);
        expect(server.transport.reply).toHaveBeenCalledTimes(2);
        expect(service.getThread(local.id)!.comments.map(comment => comment.body)).toEqual(["first", "second"]);
    });

    it("defers an uncertain thread creation until the complete read succeeds", async () => {
        const { service } = await createHarness();
        const server = fakeServer();
        const local = service.createThread({ ...row, body: "first" })!;
        const create = server.transport.createThread;
        let loseResponse = true;
        server.transport.createThread = async input => {
            const result = await create(input);
            if (loseResponse) { loseResponse = false; return null; }
            return result;
        };
        const sync = new StoryCommentsTeamSync(service, server.transport);
        await sync.push();
        server.calls.length = 0;
        server.transport.listThreads = async page => page.before === undefined
            ? { threads: [server.threads.get("t1")!], cursor: "next" }
            : null;

        expect(await sync.pullAll()).toBe(false);
        expect(server.calls).toEqual([]);
        server.transport.listThreads = async () => ({ threads: [server.threads.get("t1")!] });
        expect(await sync.pullAll()).toBe(true);
        expect(service.listThreads()).toHaveLength(1);
        expect(service.getThread(local.id)!.teamThreadId).toBe("t1");
    });

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

    it("waits for an in-flight creation before applying its event", async () => {
        const { service } = await createHarness();
        const server = fakeServer();
        const created = deferred();
        const release = deferred();
        const create = server.transport.createThread;
        server.transport.createThread = async input => {
            const result = await create(input);
            created.resolve();
            await release.promise;
            return result;
        };
        const local = service.createThread({ ...row, body: "first" })!;
        const sync = new StoryCommentsTeamSync(service, server.transport);

        const push = sync.push();
        await created.promise;
        const pull = sync.pullThread("t1");
        await Promise.resolve();
        release.resolve();
        await Promise.all([push, pull]);

        expect(service.listThreads()).toHaveLength(1);
        expect(service.getThread(local.id)!.comments.map(comment => comment.body)).toEqual(["first"]);
    });

    it("reconciles an accepted thread whose response was lost before applying its event", async () => {
        const { service } = await createHarness();
        const server = fakeServer();
        const local = service.createThread({ ...row, body: "first" })!;
        const create = server.transport.createThread;
        let loseResponse = true;
        server.transport.createThread = async input => {
            const result = await create(input);
            if (loseResponse) {
                loseResponse = false;
                return null;
            }
            return result;
        };
        const sync = new StoryCommentsTeamSync(service, server.transport);

        await sync.push();
        await sync.pullThread("t1");

        expect(service.listThreads()).toHaveLength(1);
        expect(service.getThread(local.id)!.teamThreadId).toBe("t1");
        expect(server.threads.size).toBe(1);
    });

    it("bounds the retry when a thread creation remains unavailable", async () => {
        const { service } = await createHarness();
        const server = fakeServer();
        const local = service.createThread({ ...row, body: "first" })!;
        await server.transport.createThread({ anchor: { document: "story:story", element: "scene/block-1" }, body: "first", clientId: local.id });
        server.transport.createThread = vi.fn(async () => null);
        const sync = new StoryCommentsTeamSync(service, server.transport);

        await sync.push();
        await sync.pullThread("t1");

        expect(server.transport.createThread).toHaveBeenCalledTimes(2);
        expect(service.listThreads()).toHaveLength(1);
        expect(service.getThread(local.id)!.teamThreadId).toBeUndefined();
    });


    it("waits for an in-flight reply before applying its event", async () => {
        const { service } = await createHarness();
        const server = fakeServer();
        const local = service.createThread({ ...row, body: "first" })!;
        const sync = new StoryCommentsTeamSync(service, server.transport);
        await sync.push();
        service.reply(local.id, "second");
        const replied = deferred();
        const release = deferred();
        const reply = server.transport.reply;
        server.transport.reply = async input => {
            const result = await reply(input);
            replied.resolve();
            await release.promise;
            return result;
        };

        const push = sync.push();
        await replied.promise;
        const pull = sync.pullThread("t1");
        await Promise.resolve();
        release.resolve();
        await Promise.all([push, pull]);

        expect(service.getThread(local.id)!.comments.map(comment => comment.body)).toEqual(["first", "second"]);
    });

    it("refreshes a pull that began before a push completed", async () => {
        const { service } = await createHarness();
        const server = fakeServer();
        const local = service.createThread({ ...row, body: "first" })!;
        const sync = new StoryCommentsTeamSync(service, server.transport);
        await sync.push();
        const read = server.transport.getThread;
        const started = deferred();
        const release = deferred();
        let first = true;
        server.transport.getThread = async id => {
            const result = await read(id);
            if (first) {
                first = false;
                started.resolve();
                await release.promise;
            }
            return result;
        };

        const pull = sync.pullThread("t1");
        await started.promise;
        service.setResolved(local.id, true);
        await sync.push();
        release.resolve();
        await pull;

        expect(server.threads.get("t1")!.status).toBe("resolved");
        expect(service.getThread(local.id)!.resolved).toBe(true);
    });

    it("keeps a newer thread response when an older read completes later", async () => {
        const { service } = await createHarness();
        const server = fakeServer();
        await server.transport.createThread({ anchor: { document: "story:story", element: "scene/block-1" }, body: "first", clientId: "web" });
        const sync = new StoryCommentsTeamSync(service, server.transport);
        await sync.pullAll();
        const read = server.transport.getThread;
        const started = deferred();
        const release = deferred();
        let first = true;
        server.transport.getThread = async id => {
            const result = await read(id);
            if (first) {
                first = false;
                started.resolve();
                await release.promise;
            }
            return result;
        };

        const older = sync.pullThread("t1");
        await started.promise;
        server.threads.set("t1", { ...server.threads.get("t1")!, status: "resolved" });
        await sync.pullThread("t1");
        release.resolve();
        await older;

        expect(service.listThreads()[0]!.resolved).toBe(true);
    });

    it("retries an earlier failed reply before sending a later reply", async () => {
        const { service } = await createHarness();
        const server = fakeServer();
        const local = service.createThread({ ...row, body: "first" })!;
        service.reply(local.id, "second");
        service.reply(local.id, "third");
        const reply = server.transport.reply;
        let fail = true;
        server.transport.reply = async input => {
            if (fail) {
                fail = false;
                return null;
            }
            return reply(input);
        };
        const sync = new StoryCommentsTeamSync(service, server.transport);

        await sync.push();
        expect(server.comments.get("t1")!.map(comment => comment.body)).toEqual(["first"]);
        await sync.push();
        expect(server.comments.get("t1")!.map(comment => comment.body)).toEqual(["first", "second", "third"]);
    });

    it("reconciles an accepted reply whose response was lost before applying its event", async () => {
        const { service } = await createHarness();
        const server = fakeServer();
        const local = service.createThread({ ...row, body: "first" })!;
        const sync = new StoryCommentsTeamSync(service, server.transport);
        await sync.push();
        service.reply(local.id, "second");
        const reply = server.transport.reply;
        let loseResponse = true;
        server.transport.reply = async input => {
            const result = await reply(input);
            if (loseResponse) {
                loseResponse = false;
                return null;
            }
            return result;
        };

        await sync.push();
        await sync.pullThread("t1");

        expect(server.comments.get("t1")!.map(comment => comment.body)).toEqual(["first", "second"]);
        expect(service.getThread(local.id)!.comments.map(comment => comment.body)).toEqual(["first", "second"]);
    });

    it("bounds the retry when a reply remains unavailable", async () => {
        const { service } = await createHarness();
        const server = fakeServer();
        const local = service.createThread({ ...row, body: "first" })!;
        const sync = new StoryCommentsTeamSync(service, server.transport);
        await sync.push();
        service.reply(local.id, "second");
        server.transport.reply = vi.fn(async () => null);

        await sync.push();
        await sync.pullThread("t1");

        expect(server.transport.reply).toHaveBeenCalledTimes(2);
        expect(service.getThread(local.id)!.comments.map(comment => comment.body)).toEqual(["first", "second"]);
    });

    it("accepts the server thread if a pending local thread was removed", async () => {
        const { service } = await createHarness();
        const server = fakeServer();
        const local = service.createThread({ ...row, body: "first" })!;
        const sync = new StoryCommentsTeamSync(service, server.transport);
        await sync.push();
        service.reply(local.id, "second");
        server.transport.reply = async () => null;
        await sync.push();
        service.deleteThread(local.id);

        await sync.pullThread("t1");

        expect(service.listThreads().map(thread => thread.comments.map(comment => comment.body))).toEqual([["first"]]);
    });

    it("finds the opening comment when the create answer omits it", async () => {
        const { service } = await createHarness();
        const server = fakeServer();
        const local = service.createThread({ ...row, body: "first" })!;
        const create = server.transport.createThread;
        server.transport.createThread = async input => {
            const result = await create(input);
            return result === null ? null : { thread: result.thread };
        };
        const sync = new StoryCommentsTeamSync(service, server.transport);

        await sync.push();
        await sync.push();
        expect(server.comments.get("t1")!.map(comment => comment.body)).toEqual(["first"]);
        expect(service.getThread(local.id)!.comments[0]!.teamCommentId).toBe("c2");
    });

    it("retries creation if the opening comment cannot yet be read", async () => {
        const { service } = await createHarness();
        const server = fakeServer();
        const local = service.createThread({ ...row, body: "first" })!;
        const create = server.transport.createThread;
        server.transport.createThread = async input => {
            const result = await create(input);
            return result === null ? null : { thread: result.thread };
        };
        const get = server.transport.getThread;
        let unavailable = true;
        server.transport.getThread = async id => {
            if (unavailable) {
                unavailable = false;
                return null;
            }
            return get(id);
        };
        const sync = new StoryCommentsTeamSync(service, server.transport);

        await sync.push();
        expect(service.getThread(local.id)!.teamThreadId).toBeUndefined();
        await sync.pullThread("t1");
        expect(service.listThreads()).toHaveLength(1);
        expect(service.getThread(local.id)!.comments[0]!.teamCommentId).toBe("c2");
        expect(server.comments.get("t1")).toHaveLength(1);
    });

    it("stops an in-flight push before writing more or changing the closed service", async () => {
        const { service } = await createHarness();
        const server = fakeServer();
        const local = service.createThread({ ...row, body: "first" })!;
        service.reply(local.id, "second");
        const created = deferred();
        const release = deferred();
        const create = server.transport.createThread;
        server.transport.createThread = async input => {
            const result = await create(input);
            created.resolve();
            await release.promise;
            return result;
        };
        const sync = new StoryCommentsTeamSync(service, server.transport);

        const push = sync.push();
        await created.promise;
        sync.stop();
        release.resolve();
        await push;

        expect(server.comments.get("t1")!.map(comment => comment.body)).toEqual(["first"]);
        expect(service.getThread(local.id)!.teamThreadId).toBeUndefined();
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

    it("collects every page before replacing a thread's comments", async () => {
        const { service } = await createHarness();
        const server = fakeServer();
        await server.transport.createThread({ anchor: { document: "story:story", element: "scene/block-1" }, body: "first", clientId: "web" });
        const comments = Array.from({ length: 201 }, (_, index): TeamComment => ({
            id: `comment-${index}`, thread: "t1", author: "ada", body: `line-${index}`, createdAt: index,
        }));
        server.comments.set("t1", comments);
        server.threads.set("t1", { ...server.threads.get("t1")!, comments: comments.length });
        const sync = new StoryCommentsTeamSync(service, server.transport);
        await sync.pullAll();
        const thread = server.threads.get("t1")!;
        const cursors: (string | undefined)[] = [];
        server.transport.getThread = async (_id, after?: string) => {
            cursors.push(after);
            return after === undefined
                ? { thread, comments: comments.slice(0, 200), cursor: "page-two" }
                : { thread, comments: comments.slice(200) };
        };

        await sync.pullThread("t1");

        expect(service.listThreads()[0]!.comments.map(comment => comment.body)).toEqual(comments.map(comment => comment.body));
        expect(cursors).toEqual([undefined, "page-two"]);
    });

    it("retains the current thread when a later comment page fails", async () => {
        const { service } = await createHarness();
        const server = fakeServer();
        await server.transport.createThread({ anchor: { document: "story:story", element: "scene/block-1" }, body: "first", clientId: "web" });
        await server.transport.reply({ thread: "t1", body: "second", clientId: "reply" });
        const sync = new StoryCommentsTeamSync(service, server.transport);
        await sync.pullAll();
        const original = structuredClone(service.listThreads()[0]!);
        const changed = { ...server.threads.get("t1")!, status: "resolved" as const };
        const cursors: (string | undefined)[] = [];
        server.transport.getThread = async (_id, after?: string) => {
            cursors.push(after);
            return after === undefined
                ? { thread: changed, comments: [{ ...server.comments.get("t1")![0], body: "changed" }], cursor: "page-two" }
                : null;
        };

        await sync.pullThread("t1");

        expect(service.listThreads()[0]).toEqual(original);
        expect(cursors).toEqual([undefined, "page-two"]);
    });

    it("keeps the local thread unchanged while a later page is pending", async () => {
        const { service } = await createHarness();
        const server = fakeServer();
        await server.transport.createThread({ anchor: { document: "story:story", element: "scene/block-1" }, body: "first", clientId: "web" });
        await server.transport.reply({ thread: "t1", body: "second", clientId: "reply" });
        const sync = new StoryCommentsTeamSync(service, server.transport);
        await sync.pullAll();
        const local = service.listThreads()[0]!;
        service.reply(local.id, "unsent");
        const original = structuredClone(service.getThread(local.id)!);
        const started = deferred();
        const release = deferred();
        server.transport.getThread = async (_id, after?: string) => {
            const thread = server.threads.get("t1")!;
            if (after === undefined) return { thread, comments: [server.comments.get("t1")![0]], cursor: "page-two" };
            started.resolve();
            await release.promise;
            return { thread, comments: [server.comments.get("t1")![1]] };
        };

        const pull = sync.pullThread("t1");
        await started.promise;
        expect(service.getThread(local.id)).toEqual(original);
        release.resolve();
        await pull;

        expect(service.getThread(local.id)!.comments.map(comment => comment.body)).toEqual(["first", "second", "unsent"]);
    });

    it("discards a partial read when a page rejects", async () => {
        const { service } = await createHarness();
        const server = fakeServer();
        await server.transport.createThread({ anchor: { document: "story:story", element: "scene/block-1" }, body: "first", clientId: "web" });
        await server.transport.reply({ thread: "t1", body: "second", clientId: "reply" });
        const sync = new StoryCommentsTeamSync(service, server.transport);
        await sync.pullAll();
        const original = structuredClone(service.listThreads()[0]!);
        server.transport.getThread = async (_id, after?: string) => {
            if (after !== undefined) throw new Error("page unavailable");
            return { thread: server.threads.get("t1")!, comments: [server.comments.get("t1")![0]], cursor: "page-two" };
        };

        await expect(sync.pullThread("t1")).rejects.toThrow("page unavailable");
        expect(service.listThreads()[0]).toEqual(original);
    });

    it("discards a partial read if the synchroniser stops while a page is pending", async () => {
        const { service } = await createHarness();
        const server = fakeServer();
        await server.transport.createThread({ anchor: { document: "story:story", element: "scene/block-1" }, body: "first", clientId: "web" });
        const sync = new StoryCommentsTeamSync(service, server.transport);
        await sync.pullAll();
        const original = structuredClone(service.listThreads()[0]!);
        const started = deferred();
        const release = deferred();
        server.transport.getThread = async (_id, after?: string) => {
            const thread = { ...server.threads.get("t1")!, status: "resolved" as const };
            if (after === undefined) return { thread, comments: server.comments.get("t1")!, cursor: "page-two" };
            started.resolve();
            await release.promise;
            return { thread, comments: [] };
        };

        const pull = sync.pullThread("t1");
        await started.promise;
        sync.stop();
        release.resolve();
        await pull;

        expect(service.listThreads()[0]).toEqual(original);
    });

    it("discards a partial read if the server repeats a cursor", async () => {
        const { service } = await createHarness();
        const server = fakeServer();
        await server.transport.createThread({ anchor: { document: "story:story", element: "scene/block-1" }, body: "first", clientId: "web" });
        const sync = new StoryCommentsTeamSync(service, server.transport);
        await sync.pullAll();
        const original = structuredClone(service.listThreads()[0]!);
        const get = vi.fn(async () => ({ thread: server.threads.get("t1")!, comments: [], cursor: "same" }));
        server.transport.getThread = get;

        await sync.pullThread("t1");

        expect(get).toHaveBeenCalledTimes(2);
        expect(service.listThreads()[0]).toEqual(original);
    });

    it("restarts from the first page if a push completes during a page read", async () => {
        const { service } = await createHarness();
        const server = fakeServer();
        const local = service.createThread({ ...row, body: "first" })!;
        const sync = new StoryCommentsTeamSync(service, server.transport);
        await sync.push();
        const started = deferred();
        const release = deferred();
        const cursors: (string | undefined)[] = [];
        let firstSecondPage = true;
        server.transport.getThread = async (_id, after?: string) => {
            cursors.push(after);
            const thread = server.threads.get("t1")!;
            if (after === undefined) return { thread, comments: server.comments.get("t1")!, cursor: "page-two" };
            if (firstSecondPage) {
                firstSecondPage = false;
                started.resolve();
                await release.promise;
            }
            return { thread, comments: [] };
        };

        const pull = sync.pullThread("t1");
        await started.promise;
        service.setResolved(local.id, true);
        await sync.push();
        release.resolve();
        await pull;

        expect(cursors).toEqual([undefined, "page-two", undefined, "page-two"]);
        expect(service.getThread(local.id)!.resolved).toBe(true);
    });

    it("ignores an older multi-page read when a newer pull completes", async () => {
        const { service } = await createHarness();
        const server = fakeServer();
        await server.transport.createThread({ anchor: { document: "story:story", element: "scene/block-1" }, body: "first", clientId: "web" });
        const sync = new StoryCommentsTeamSync(service, server.transport);
        await sync.pullAll();
        const started = deferred();
        const release = deferred();
        let hold = true;
        server.transport.getThread = async (_id, after?: string) => {
            const thread = server.threads.get("t1")!;
            if (after === undefined) return { thread, comments: server.comments.get("t1")!, cursor: "page-two" };
            if (hold) {
                hold = false;
                started.resolve();
                await release.promise;
            }
            return { thread, comments: [] };
        };

        const older = sync.pullThread("t1");
        await started.promise;
        server.threads.set("t1", { ...server.threads.get("t1")!, status: "resolved" });
        await sync.pullThread("t1");
        release.resolve();
        await older;

        expect(service.listThreads()[0]!.resolved).toBe(true);
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
