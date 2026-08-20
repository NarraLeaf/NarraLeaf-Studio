import { beforeEach, describe, expect, it, vi } from "vitest";
import { getServerProject, listServerProjectHistory, listServerProjects } from "./serverProjects";

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
