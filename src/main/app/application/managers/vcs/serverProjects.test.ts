import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    createServerProject,
    deleteServerProject,
    getServerProject,
    listServerProjectHistory,
    listServerProjects,
} from "./serverProjects";

/**
 * What a server actually sends, including everything it does not send.
 *
 * The shapes here are measured against a running deployment rather than read off a
 * specification, and the ones that matter are the incomplete ones. A server records a
 * project the moment it is created and reads its repository afterwards, so there is always
 * a window in which a project exists and nothing is known about its contents - and on a
 * deployment whose reader is not working, that window never closes. Every one of these
 * tests is about a field that is missing rather than one that is there, because a missing
 * field turning into a zero is how a panel comes to say a project has no versions.
 *
 * The transport is mocked and the reading is not: what is under test is the decision about
 * what an answer means, which is the half that cannot be seen by looking at the wire.
 */

const askServer = vi.hoisted(() => vi.fn());

vi.mock("./serverApi", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    askServer,
}));

const CREDENTIALS = {
    authUrl: "https://team.example.lan:41402",
    token: "token",
    userDataDir: "D:/userData",
};
const PROJECT_ID = "019fda5ba4fe799096aaab7585aa4722";

/** The row every answer carries: the fields nothing downstream works without. */
function projectRow(extra: Record<string, unknown> = {}) {
    return {
        id: PROJECT_ID,
        name: "Moonlit",
        description: "",
        createdAt: 1786767612503,
        remote: "lore://team.example.lan:41337/moonlit",
        ...extra,
    };
}

/** The next ask answers with this document. */
function answers(value: unknown): void {
    askServer.mockResolvedValue({ ok: true, value });
}

/** Narrow a result to its answer, failing the test rather than the type check. */
function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
    expect(result).toMatchObject({ ok: true });
    return result as Extract<T, { ok: true }>;
}

beforeEach(() => askServer.mockReset());

describe("a project the server has not read", () => {
    it("keeps an empty history as empty rather than as zero versions", async () => {
        answers({ projects: [projectRow({ history: {} })] });

        const result = await listServerProjects(CREDENTIALS);

        const [project] = ok(result).projects;
        // The three ways an absent fact becomes an invented one.
        expect(project.history).toEqual({});
        expect(project.history).not.toHaveProperty("revisions");
        expect(project.history).not.toHaveProperty("lastAt");
    });

    it("carries no history at all for a server too old to send the field", async () => {
        answers({ projects: [projectRow()] });

        const result = await listServerProjects(CREDENTIALS);

        expect(ok(result).projects[0]).not.toHaveProperty("history");
    });

    it("says the file is unreadable, and keeps the server's reason out of the answer", async () => {
        answers({
            project: projectRow({ history: {} }),
            file: { readable: false, reason: "project store not opened; run the reader first" },
        });

        const result = await getServerProject({ ...CREDENTIALS, projectId: PROJECT_ID });

        const detail = ok(result).detail;
        expect(detail.file).toEqual({ readable: false });
        // The sentence is English written for whoever runs the server; it reaches the log
        // through a field of its own and nothing that is drawn.
        expect(JSON.stringify(detail)).not.toContain("reader");
        expect(ok(result).reason).toBe("project store not opened; run the reader first");
    });

    it("reads a file that is unreadable and said nothing else at all", async () => {
        answers({ project: projectRow(), file: {} });

        const result = await getServerProject({ ...CREDENTIALS, projectId: PROJECT_ID });

        expect(result).toMatchObject({ ok: true, reason: "" });
        expect(ok(result).detail.file).toEqual({ readable: false });
    });

    it("leaves revisions absent rather than empty when the history says nothing", async () => {
        answers({ more: false });

        const result = await listServerProjectHistory({ ...CREDENTIALS, projectId: PROJECT_ID });

        expect(result).toEqual({ ok: true, page: { more: false } });
        expect(ok(result).page).not.toHaveProperty("revisions");
    });
});

describe("a project the server has read", () => {
    it("keeps every count the server gave, and invents none it did not", async () => {
        answers({
            project: projectRow(),
            file: { readable: true, title: "Moonlit", stageWidth: 1920, stageHeight: 1080, scenes: 12 },
        });

        const result = await getServerProject({ ...CREDENTIALS, projectId: PROJECT_ID });

        const file = ok(result).detail.file;
        expect(file).toEqual({
            readable: true, title: "Moonlit", stageWidth: 1920, stageHeight: 1080, scenes: 12,
        });
        // Asset counts were not given, so there are none - not zero of them.
        expect(file).not.toHaveProperty("assets");
        expect(file).not.toHaveProperty("assetBytes");
    });

    it("tells an empty history from an absent one, because they are different facts", async () => {
        answers({ revisions: [], more: false });

        const result = await listServerProjectHistory({ ...CREDENTIALS, projectId: PROJECT_ID });

        expect(result).toEqual({ ok: true, page: { revisions: [], more: false } });
    });

    it("reads a revision that carries nothing but its id", async () => {
        answers({ revisions: [{ id: "a1b2c3d4" }, { id: "e5f6", at: 1786767612503, by: "ada" }], more: true });

        const result = await listServerProjectHistory({ ...CREDENTIALS, projectId: PROJECT_ID });

        expect(result).toEqual({
            ok: true,
            page: {
                revisions: [{ id: "a1b2c3d4" }, { id: "e5f6", at: 1786767612503, by: "ada" }],
                more: true,
            },
        });
    });

    it("refuses a history with an entry it cannot read rather than one row short", async () => {
        answers({ revisions: [{ id: "a1b2c3d4" }, { message: "no id" }], more: false });

        const result = await listServerProjectHistory({ ...CREDENTIALS, projectId: PROJECT_ID });

        expect(result).toEqual({ ok: false, problem: { kind: "unknown" } });
    });
});

/**
 * Asking a server to record a project this machine already has.
 *
 * The id is the whole of what makes this different from making a new project, and it
 * has to survive in both directions: out, because the row the server writes is what
 * every later permission question is answered from, and back, because a server that
 * answered with a different one made a project that is not this one.
 */
describe("publishing a project that already exists", () => {
    it("sends the repository id, so the server records the repository this machine holds", async () => {
        answers({ project: projectRow() });

        const result = await createServerProject({
            ...CREDENTIALS,
            name: "moonlit",
            repositoryId: PROJECT_ID,
        });

        expect(askServer).toHaveBeenCalledWith(expect.objectContaining({
            method: "POST",
            path: "/api/studio/v1/projects",
            expect: 201,
            body: JSON.stringify({ name: "moonlit", repositoryId: PROJECT_ID }),
        }));
        expect(ok(result).project.id).toBe(PROJECT_ID);
    });

    it("sends no id at all when there is none, which is what makes a new project", async () => {
        answers({ project: projectRow() });

        await createServerProject({ ...CREDENTIALS, name: "moonlit", description: "new" });

        expect(askServer).toHaveBeenCalledWith(expect.objectContaining({
            body: JSON.stringify({ name: "moonlit", description: "new" }),
        }));
    });

    it("refuses a server that answered with a different repository", async () => {
        // What a server too old to know the field does: it ignores it, makes a
        // repository of its own, and answers with that one. Acting on it would connect
        // this project to a repository nobody made and push into it.
        answers({ project: projectRow({ id: "0123456789abcdef0123456789abcdef" }) });

        const result = await createServerProject({
            ...CREDENTIALS,
            name: "moonlit",
            repositoryId: PROJECT_ID,
        });

        expect(result).toEqual({ ok: false, problem: { kind: "wrong-repository" } });
    });

    it("accepts the id back in either spelling, because hex is hex", async () => {
        answers({ project: projectRow({ id: PROJECT_ID.toUpperCase() }) });

        const result = await createServerProject({
            ...CREDENTIALS,
            name: "moonlit",
            repositoryId: PROJECT_ID,
        });

        expect(result).toMatchObject({ ok: true });
    });
});

describe("taking a project off a server", () => {
    it("asks for the one project by DELETE, and expects the answer with no body", async () => {
        // 204 is what the server answers, and `expect` is what makes anything else a
        // refusal: a server too old for this route answers 404, and one that answered
        // 200 with a document has not done what was asked.
        answers(undefined);

        const result = await deleteServerProject({ ...CREDENTIALS, projectId: PROJECT_ID });

        expect(askServer).toHaveBeenCalledWith({
            ...CREDENTIALS,
            path: `/api/studio/v1/projects/${PROJECT_ID}`,
            method: "DELETE",
            expect: 204,
        });
        expect(result).toEqual({ ok: true });
    });

    it("carries nothing back on success, because there is nothing to carry", async () => {
        // The server sends no document, so there is no shape to read and nothing that
        // could be read wrongly. What a reader wants next is the list, fetched again.
        answers(undefined);

        await expect(deleteServerProject({ ...CREDENTIALS, projectId: PROJECT_ID }))
            .resolves.toEqual({ ok: true });
    });

    it("sends no body, so there is no argument that could ask for more than the row", async () => {
        answers(undefined);

        await deleteServerProject({ ...CREDENTIALS, projectId: PROJECT_ID });

        expect(askServer.mock.calls[0]?.[0]).not.toHaveProperty("body");
    });

    it("escapes the id into the path rather than pasting it in", async () => {
        answers(undefined);

        await deleteServerProject({ ...CREDENTIALS, projectId: "a/b" });

        expect(askServer).toHaveBeenCalledWith(expect.objectContaining({
            path: "/api/studio/v1/projects/a%2Fb",
        }));
    });

    it("hands a refusal straight back, coded as it came", async () => {
        // Including the 404 a server too old for the route answers with, which arrives
        // as `rejected` like any other status this does not expect. The sentence an
        // author reads for it is written in the renderer.
        for (const problem of [{ kind: "refused" }, { kind: "unreachable" }] as const) {
            askServer.mockResolvedValue({ ok: false, problem });
            await expect(deleteServerProject({ ...CREDENTIALS, projectId: PROJECT_ID }))
                .resolves.toEqual({ ok: false, problem });
        }
    });
});

describe("asking", () => {
    it("puts the project id in the path and a page size on the history", async () => {
        answers({ more: false });

        await listServerProjectHistory({ ...CREDENTIALS, projectId: "a/b", limit: 5, before: "c d" });

        expect(askServer).toHaveBeenCalledWith(expect.objectContaining({
            path: "/api/studio/v1/projects/a%2Fb/history?limit=5&before=c+d",
        }));
    });

    it("hands a refusal straight back, coded as it came", async () => {
        askServer.mockResolvedValue({ ok: false, problem: { kind: "unreachable" } });

        await expect(getServerProject({ ...CREDENTIALS, projectId: PROJECT_ID }))
            .resolves.toEqual({ ok: false, problem: { kind: "unreachable" } });
        await expect(listServerProjectHistory({ ...CREDENTIALS, projectId: PROJECT_ID }))
            .resolves.toEqual({ ok: false, problem: { kind: "unreachable" } });
    });
});
