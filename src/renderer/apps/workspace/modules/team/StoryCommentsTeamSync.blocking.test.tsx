// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FsRejectErrorCode, type FsRequestResult } from "@shared/types/os";
import { join } from "@shared/utils/path";
import { STORY_COMMENTS_SCHEMA_VERSION } from "@shared/types/storyComments";

import { StoryCommentsService } from "@/lib/workspace/services/storyComments/StoryCommentsService";
import { HistoryService } from "@/lib/workspace/services/history/HistoryService";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { StoryCommentsTeamSyncMount } from "./StoryCommentsTeamSync";

const fixture = vi.hoisted(() => ({
    service: null as StoryCommentsService | null,
    call: vi.fn(),
    event: undefined as undefined | ((message: { remoteOrigin: string; topic: string; payload: unknown }) => void),
}));

vi.mock("@/lib/team", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTeamCapability: (_connection: unknown, capability: string) => capability === "comments",
    useTeamConnection: () => ({ state: "ready", since: 1 }),
}));
vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        app: { state: {
            onGlobalStateChanged: () => ({ cancel: () => undefined }),
            getGlobalState: async () => ({ success: true, data: { value: "Ada" } }),
        } },
        team: {
            call: (...args: unknown[]) => fixture.call(...args),
            subscribe: async () => undefined,
            unsubscribe: async () => undefined,
            onEvent: (handler: typeof fixture.event) => { fixture.event = handler; return { cancel: () => { fixture.event = undefined; } }; },
        },
    }),
    getPrivilegedInterface: () => ({}),
}));
vi.mock("../story-comments/storyCommentsState", () => ({ useStoryCommentsService: () => fixture.service }));
vi.mock("./TeamProjectContext", () => ({
    useTeamProjectSurface: () => ({ remoteOrigin: "team", state: { kind: "verified", project: { id: "p1" } } }),
}));

const ROOT = join("D:/projects", "my-game");
const documentPath = join(ROOT, "editor", "story-comments.json");

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
}

async function createService(localCreatedAt = 4) {
    const files = new Map<string, string>([[documentPath, JSON.stringify({
        schemaVersion: STORY_COMMENTS_SCHEMA_VERSION,
        threads: {
            "local-a": {
                id: "local-a", storyId: "story", sceneId: "scene", blockId: "a", todo: false, resolved: false,
                createdAt: localCreatedAt, comments: [{ id: "local-ca", author: { name: "Ada" }, body: "local edited opening", createdAt: localCreatedAt }],
            },
            "local-b": {
                id: "local-b", storyId: "story", sceneId: "scene", blockId: "b", todo: false, resolved: false,
                createdAt: 2, teamThreadId: "t-b",
                comments: [{ id: "local-cb", teamCommentId: "c-b", author: { name: "Bob" }, body: "other opening", createdAt: 2 }],
            },
        },
    })]]);
    const ok = <T,>(data: T): FsRequestResult<T> => ({ ok: true, data });
    const stubs: Record<string, unknown> = {
        [Services.FileSystem]: {
            read: async (path: string) => files.has(path) ? ok(files.get(path)!)
                : { ok: false, error: { code: FsRejectErrorCode.NOT_FOUND, message: "missing" } },
            writeFileNoFollowOrCreate: async (path: string, value: string) => { files.set(path, value); return ok(undefined); },
            createDir: async () => ok(undefined),
            copyFile: async () => ok(undefined),
        },
        [Services.Project]: {},
        [Services.History]: new HistoryService(),
        [Services.VersionControl]: { onSessionChanged: () => () => undefined, getServerSession: async () => null },
        [Services.SaveStatus]: { register: () => undefined, reportUnreadableDocument: () => undefined },
    };
    const context = {
        project: { getConfig: () => ({ projectPath: ROOT }) },
        services: { get: (id: string) => {
            if (!stubs[id]) throw new Error(`Service ${id} not found`);
            return stubs[id];
        } },
    } as unknown as WorkspaceContext;
    const service = new StoryCommentsService();
    await service.initialize(context, async () => undefined);
    await service.resolveAuthor();
    return service;
}

function server() {
    const threads = {
        "t-a": { id: "t-a", project: "p1", anchor: { document: "story:story", element: "scene/a" }, kind: "comment", status: "open", createdAt: 1, updatedAt: 1, comments: 1 },
        "t-b": { id: "t-b", project: "p1", anchor: { document: "story:story", element: "scene/b" }, kind: "comment", status: "open", createdAt: 2, updatedAt: 2, comments: 1 },
    };
    const opening = {
        "t-a": { id: "c-a", thread: "t-a", author: "ada", body: "original opening", createdAt: 1 },
        "t-b": { id: "c-b", thread: "t-b", author: "bob", body: "other opening", createdAt: 2 },
    };
    const replies: string[] = [];
    const started = deferred();
    const release = deferred();
    let watch = false;
    let sawList = false;
    let watchedReads = 0;
    let failedThread: string | null = null;
    fixture.call.mockImplementation(async (_origin: string, method: string, params: { thread?: string; after?: string; body?: string }) => {
        const answer = (value: unknown) => ({ success: true, data: { ok: true, value } });
        if (method === "threads.list") {
            if (watch) sawList = true;
            return answer({ threads: Object.values(threads) });
        }
        if (method === "threads.get") {
            const id = params.thread as keyof typeof threads;
            if (watch && id === "t-a" && ++watchedReads === (sawList ? 2 : 1)) {
                started.resolve();
                await release.promise;
            }
            if (id === failedThread && params.after !== undefined) {
                return { success: true, data: { ok: false, problem: { kind: "offline" } } };
            }
            return answer({ thread: threads[id], comments: [opening[id]], ...(id === failedThread ? { cursor: "next" } : {}) });
        }
        if (method === "threads.create") return answer({ thread: threads["t-a"], comment: opening["t-a"] });
        if (method === "threads.reply") {
            replies.push(params.body!);
            return answer({ comment: { id: `new-${replies.length}`, thread: params.thread, author: "ada", body: params.body, createdAt: 3 } });
        }
        throw new Error(`Unexpected method: ${method}`);
    });
    return {
        replies, started, release,
        watch: () => { watch = true; },
        setFailure: (thread: string | null) => { failedThread = thread; },
    };
}

async function drain() {
    await act(async () => { for (let i = 0; i < 50; i += 1) await Promise.resolve(); });
}

function emit(thread: string) {
    act(() => fixture.event?.({ remoteOrigin: "team", topic: "project:p1/threads", payload: { thread } }));
}

beforeEach(() => {
    vi.useFakeTimers();
    fixture.call.mockReset();
    fixture.service = null;
    fixture.event = undefined;
});
afterEach(() => {
    cleanup();
    fixture.service?.dispose();
    vi.useRealTimers();
});

it.each([1, 4])("sends an unrelated reply after a locally blocked discussion is read (local time %s)", async localCreatedAt => {
    const backend = server();
    fixture.service = await createService(localCreatedAt);
    render(<StoryCommentsTeamSyncMount />);
    await drain();
    expect(fixture.service.getThread("local-a")!.teamThreadId).toBeUndefined();

    emit("t-a");
    await drain();
    backend.watch();
    emit("t-a");
    await drain();
    await backend.started.promise;
    act(() => { fixture.service!.reply("local-b", "unrelated reply"); });
    backend.release.resolve();
    await drain();
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    await drain();

    expect(backend.replies).toEqual(["unrelated reply"]);
    expect(fixture.service.getThread("local-a")!.comments[0].body).toBe("local edited opening");
    expect(fixture.call.mock.calls.filter(call => call[1] === "threads.create")).toHaveLength(1);
});

it.each(["t-a", "t-b"])("keeps unrelated replies local until every comment page of %s can be read", async failedThread => {
    const backend = server();
    fixture.service = await createService();
    render(<StoryCommentsTeamSyncMount />);
    await drain();
    backend.setFailure(failedThread);

    emit(failedThread);
    await drain();
    act(() => { fixture.service!.reply("local-b", "unrelated reply"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    await drain();
    expect(backend.replies).toEqual([]);
    expect(fixture.service.getThread("local-b")!.comments.map(comment => comment.body)).toContain("unrelated reply");

    backend.setFailure(null);
    emit("t-b");
    await drain();
    expect(backend.replies).toEqual(["unrelated reply"]);
    expect(fixture.service.getThread("local-a")!.comments[0].body).toBe("local edited opening");
});
