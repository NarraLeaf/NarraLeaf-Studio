import { beforeEach, describe, expect, it, vi } from "vitest";

import { getThread, listMembers, listOverlay, listProjects, listThreads } from "./teamCall";

/**
 * What the calls in `teamCall` carry out of an answer.
 *
 * The half worth pinning without a server is what a caller is left holding, and the case
 * these were written for is an answer that is not the whole of what was asked for. A Team
 * server bounds every list it composes: a project's overlay is paged and says so with a
 * cursor, and the project and account lists are cut and say so with a count. A client that
 * read the rows and dropped the rest of the answer showed a short list with nothing beside
 * it saying it was short - which is indistinguishable, on screen, from a server that holds
 * that little.
 *
 * So each of these asserts the same thing from a different direction: what the server said
 * about the size of the collection reaches the caller.
 */

const call = vi.fn();

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({ team: { call } }),
}));

/** An answer as the bridge hands one over. */
function answers(value: unknown): void {
    call.mockResolvedValue({ success: true, data: { ok: true, value } });
}

/** One project row, in the least a server may send for one. */
function project(id: string): Record<string, unknown> {
    return { id, name: id, remote: `https://server.example/${id}.git` };
}

/** One overlay record, in the least a server may send for one. */
function overlayRecord(id: string): Record<string, unknown> {
    return {
        id,
        project: "p1",
        anchor: { document: "story.json", revision: "r1" },
        kind: "review",
        body: "something a person wrote",
    };
}

beforeEach(() => {
    call.mockReset();
});

describe("reading a project's overlay", () => {
    it("carries the cursor, so a page cannot read as the whole of one", async () => {
        answers({
            records: [overlayRecord("o1"), overlayRecord("o2")],
            head: "r1",
            total: 40,
            cursor: "o2",
        });

        const read = await listOverlay("https://server.example", "p1");
        expect(read.ok).toBe(true);
        if (!read.ok) return;
        expect(read.value.records).toHaveLength(2);
        expect(read.value.total).toBe(40);
        expect(read.value.cursor).toBe("o2");
    });

    it("leaves the cursor out where the whole of it arrived", async () => {
        answers({ records: [overlayRecord("o1")], head: "r1", total: 1 });

        const read = await listOverlay("https://server.example", "p1");
        expect(read.ok && read.value.cursor).toBeUndefined();
    });

    it("hands the cursor back as the place to carry on from", async () => {
        answers({ records: [], total: 0 });
        await listOverlay("https://server.example", "p1", { before: "o2", limit: 50 });

        expect(call).toHaveBeenCalledWith(
            "https://server.example",
            "overlay.list",
            { project: "p1", before: "o2", limit: 50 },
        );
    });
});

describe("reading a list a server answers whole", () => {
    it("says how many projects there are, not only how many arrived", async () => {
        answers({ projects: [project("a"), project("b")], total: 1200 });

        const read = await listProjects("https://server.example");
        expect(read.ok).toBe(true);
        if (!read.ok) return;
        expect(read.value.projects).toHaveLength(2);
        expect(read.value.total).toBe(1200);
    });

    it("says how many accounts there are, not only how many arrived", async () => {
        answers({ members: [{ username: "ada" }, { username: "grace" }], total: 1000 });

        const read = await listMembers("https://server.example");
        expect(read.ok).toBe(true);
        if (!read.ok) return;
        expect(read.value.members).toHaveLength(2);
        expect(read.value.total).toBe(1000);
    });

    it("counts what arrived for a server too old to state a total", async () => {
        // Never a figure below the rows in hand: a caller comparing the two would
        // otherwise be told a complete list was cut.
        answers({ projects: [project("a")] });

        const read = await listProjects("https://server.example");
        expect(read.ok && read.value.total).toBe(1);
    });

    it("is a refusal rather than an empty list when the shape is not one", async () => {
        answers({ projects: "several" });
        expect((await listProjects("https://server.example")).ok).toBe(false);
    });
});

describe("reading a conversation", () => {
    it("carries the cursor on a page of threads", async () => {
        answers({ threads: [], cursor: "t9" });
        const read = await listThreads("https://server.example", "p1");
        expect(read.ok && read.value.cursor).toBe("t9");
    });

    it("carries the cursor on a page of comments, beside the count on the thread", async () => {
        answers({
            thread: {
                id: "t1",
                project: "p1",
                anchor: {},
                createdAt: 1,
                updatedAt: 2,
                comments: 300,
            },
            comments: [{ id: "c1", thread: "t1", createdAt: 1 }],
            cursor: "c1",
        });

        const read = await getThread("https://server.example", "t1");
        expect(read.ok).toBe(true);
        if (!read.ok) return;
        expect(read.value.comments).toHaveLength(1);
        expect(read.value.thread.comments).toBe(300);
        expect(read.value.cursor).toBe("c1");
    });
});
