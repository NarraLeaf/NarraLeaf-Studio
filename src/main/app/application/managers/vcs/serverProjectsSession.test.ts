import { describe, expect, it, vi } from "vitest";
import type { TeamCallOutcome } from "@shared/types/team";
import type { VcsServerProject } from "@shared/types/vcs";
import {
    createServerProjectOverSession,
    listServerProjectsOverSession,
} from "./serverProjectsSession";

/**
 * The two questions publishing asks a server over its session.
 *
 * What is worth pinning here is the id-echo: a server too old to understand the request
 * records a repository of its own and answers with that id, and pushing at the name it chose
 * would push into a repository nobody made. So a returned id that differs from the one sent
 * is a refusal, written nowhere else. The list's all-or-nothing and the problem mapping ride
 * along, because a hole in the list is one somebody scrolls past without noticing.
 */

const ORIGIN = "lore://team.example.lan:41337";
const REPOSITORY = "019fda5ba4fe799096aaab7585aa4722";

/** A whole project row, as a server lists one. */
function row(id = REPOSITORY, name = "driftwood") {
    return { id, name, description: "", createdAt: 0, remote: `${ORIGIN}/${name}` };
}

/** A `call` that hands back one prepared outcome, and records what it was asked. */
function calling(outcome: TeamCallOutcome) {
    return vi.fn(() => Promise.resolve(outcome));
}

describe("listing a server's projects over the session", () => {
    it("reads the rows under the key the wire carries", async () => {
        const call = calling({ ok: true, value: { projects: [row()] } });
        const result = await listServerProjectsOverSession(call, ORIGIN);

        expect(call).toHaveBeenCalledWith(ORIGIN, "projects.list");
        expect(result).toEqual({ ok: true, projects: [row()] });
    });

    it("refuses the whole list rather than draw one with a hole in it", async () => {
        // A row missing the fields everything downstream reads is dropped by the reader, and
        // a list one project short reads as a list nobody counts.
        const call = calling({ ok: true, value: { projects: [row(), { id: "only-an-id" }] } });
        const result = await listServerProjectsOverSession(call, ORIGIN);

        expect(result).toEqual({ ok: false, problem: { kind: "unknown" } });
    });

    it("maps a host that did not answer to unreachable", async () => {
        const call = calling({ ok: false, problem: { kind: "offline", detail: "ECONNREFUSED" } });
        const result = await listServerProjectsOverSession(call, ORIGIN);

        expect(result).toEqual({ ok: false, problem: { kind: "unreachable" } });
    });

    it("keeps an empty history as empty rather than as zero versions", async () => {
        // A server records a project the moment it is created and reads its repository
        // afterwards, so an empty history object is the ordinary answer for one made a
        // moment ago. Every field it does not carry has to survive as nothing: a zero here
        // is a panel saying nobody has ever worked on the project.
        const call = calling({ ok: true, value: { projects: [{ ...row(), history: {} }] } });
        const result = await listServerProjectsOverSession(call, ORIGIN);

        expect(result).toMatchObject({ ok: true });
        const [project] = (result as { ok: true; projects: VcsServerProject[] }).projects;
        expect(project?.history).toEqual({});
        expect(project?.history).not.toHaveProperty("revisions");
        expect(project?.history).not.toHaveProperty("lastAt");
    });

    it("carries no history at all for a server that did not send the field", async () => {
        const call = calling({ ok: true, value: { projects: [row()] } });
        const result = await listServerProjectsOverSession(call, ORIGIN);

        expect(result).toMatchObject({ ok: true });
        expect((result as { ok: true; projects: VcsServerProject[] }).projects[0])
            .not.toHaveProperty("history");
    });
});

describe("recording a project over the session", () => {
    it("sends the name, the id and a stable client id, and hands back the row", async () => {
        const call = calling({ ok: true, value: { project: row() } });
        const result = await createServerProjectOverSession(call, ORIGIN, {
            name: "driftwood",
            repositoryId: REPOSITORY,
            clientId: REPOSITORY,
        });

        expect(call).toHaveBeenCalledWith(ORIGIN, "projects.create", {
            name: "driftwood",
            repositoryId: REPOSITORY,
            clientId: REPOSITORY,
        });
        expect(result).toEqual({ ok: true, project: row() });
    });

    it("accepts an id whichever way either side spelled its hex", async () => {
        const call = calling({ ok: true, value: { project: row(REPOSITORY.toUpperCase()) } });
        const result = await createServerProjectOverSession(call, ORIGIN, {
            name: "driftwood",
            repositoryId: REPOSITORY,
        });

        expect(result.ok).toBe(true);
    });

    it("refuses a server that recorded a different repository than it was asked to", async () => {
        // What a server too old to understand the id does: it makes one of its own.
        const call = calling({ ok: true, value: { project: row("ffffffffffffffffffffffffffffffff") } });
        const result = await createServerProjectOverSession(call, ORIGIN, {
            name: "driftwood",
            repositoryId: REPOSITORY,
        });

        expect(result).toEqual({ ok: false, problem: { kind: "wrong-repository" } });
    });

    it("passes a coded refusal through as one refusal", async () => {
        const call = calling({ ok: false, problem: { kind: "refused", code: "refused", detail: "" } });
        const result = await createServerProjectOverSession(call, ORIGIN, {
            name: "driftwood",
            repositoryId: REPOSITORY,
        });

        expect(result).toEqual({ ok: false, problem: { kind: "refused" } });
    });
});
