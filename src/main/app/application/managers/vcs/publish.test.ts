import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseApp } from "../../baseApp";
import { VcsManager } from "./VcsManager";
import type { TeamSessionCall } from "./serverProjectsSession";

/**
 * Putting a project that already exists on to a server.
 *
 * **The order is the whole of it, and every wrong order has been shipped by somebody.**
 * Connecting without registering leaves a project that pushes from one machine and
 * cannot be cloned from any other. Registering without connecting leaves a row on the
 * server with nothing behind it. Sending before either is refused, because nothing on a
 * server reaches a repository that is not one of its projects. So what these assert is
 * the sequence and what survives each way it can stop, rather than what any one call
 * returns.
 *
 * A fake backend rather than a repository, for the same reason `shutdown.test.ts` uses
 * one: the question is about ordering between calls. What the calls themselves do
 * against a real `loreserver` is `remote.integration.test.ts`.
 */

const lore = vi.hoisted(() => {
    const calls: string[] = [];
    const failures = new Map<string, Error>();

    function step<T>(name: string, value: T): T {
        calls.push(name);
        const failure = failures.get(name);
        if (failure) throw failure;
        return value;
    }

    return {
        calls,
        failures,
        backend: {
            openStore: async () => ({ handleId: 1 }),
            closeStore: async () => undefined,
            flushRepository: async () => undefined,
            releaseRepository: async () => undefined,
            // The same id `.lore/id` carries. `setRemote` reads it off the history
            // header for its own registration, and the two disagreeing would mean the
            // address named a repository the pushes do not come from.
            readRepositoryIdentity: async () => ({
                repository: "019fda5ba4fe799096aaab7585aa4722",
                branch: "main",
            }),
            readRemote: async () => null,
            readBranchIdentity: async () => ({ head: "r2", headNumber: 2, branch: "main" }),
            writeRemote: async (_root: string, url: string | null) =>
                step(`writeRemote ${url ?? "null"}`, undefined),
            publishToRemote: async (_globals: unknown, options: { url: string; repositoryId: string }) =>
                step(`publishToRemote ${options.url} ${options.repositoryId}`, undefined),
            pushToRemote: async () => step("push", { branch: "main", alreadyPushed: false }),
        },
    };
});

vi.mock("./backend", () => ({
    requireVcsBackend: async () => lore.backend,
    getVcsAvailability: async () => ({ available: true }),
}));

/**
 * The two questions publishing asks the server, now answered over the session.
 *
 * `list` and `create` stand in for `projects.list` and `projects.create` on the wire: each
 * hands back a {@link TeamCallOutcome}, the value under the key the wire carries. The real
 * `serverProjectsSession` reader parses those, so a row still has to carry the fields it
 * insists on. The order the two are asked in is what these tests are about, so each records
 * itself in `lore.calls` before it answers.
 */
const server = vi.hoisted(() => ({
    list: vi.fn(),
    create: vi.fn(),
}));

/** The session transport handed to the manager: one function, dispatched by method. */
const teamSessionCall: TeamSessionCall = (_remoteOrigin, method, params) => {
    if (method === "projects.list") {
        lore.calls.push("list");
        return Promise.resolve(server.list());
    }
    if (method === "projects.create") {
        lore.calls.push("register");
        return Promise.resolve(server.create(params));
    }
    return Promise.resolve({ ok: false, problem: { kind: "unsupported" } });
};

const repositoryId = vi.hoisted(() => ({ value: "019fda5ba4fe799096aaab7585aa4722" as string | undefined }));

vi.mock("./localRepositories", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    readRepositoryId: () => repositoryId.value,
}));

// The token is sealed by the OS keyring, which is not a thing this test has one of.
vi.mock("./serverTokens", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    recallServerToken: () => "a-token",
}));

const PROJECT = process.platform === "win32" ? "D:\\projects\\driftwood" : "/projects/driftwood";
const ORIGIN = "lore://team.example.lan:41337";
const REPOSITORY = "019fda5ba4fe799096aaab7585aa4722";

/** A server this installation is signed in to, as the global state holds one. */
const SESSION = {
    authUrl: "https://team.example.lan:41402",
    remoteOrigin: ORIGIN,
    account: { userId: "u1", displayName: "Ada", username: "ada", email: "", identity: "ada" },
    signedInAt: 0,
};

function fakeApp(): BaseApp {
    const noop = () => undefined;
    const state = new Map<string, unknown>([["versionControl.serverSessions", [SESSION]]]);
    return {
        logger: { info: noop, warn: noop, error: noop, debug: noop },
        getGlobalState: () => ({
            get: (key: string) => state.get(key),
            set: (key: string, value: unknown) => { state.set(key, value); },
        }),
        getUserDataDir: () => "D:/userData",
    } as unknown as BaseApp;
}

/** The wire's answer to `projects.list`: the rows under their own key. */
function listed(projects: unknown[] = []) {
    return { ok: true, value: { projects } };
}

/** A whole project row, as a server lists it - the fields the reader insists on, and more. */
function projectRow(id = REPOSITORY) {
    return { id, name: "driftwood", description: "", createdAt: 0, remote: `${ORIGIN}/driftwood` };
}

/** The wire's answer to `projects.create`: the one row it recorded, under its own key. */
function recorded(id = REPOSITORY) {
    return { ok: true, value: { project: projectRow(id) } };
}

let manager: VcsManager;

beforeEach(() => {
    lore.calls.length = 0;
    lore.failures.clear();
    repositoryId.value = REPOSITORY;
    server.list.mockReset().mockResolvedValue(listed());
    server.create.mockReset().mockResolvedValue(recorded());
    manager = new VcsManager(fakeApp(), undefined, teamSessionCall);
});

describe("publishing a project to a server", () => {
    it("registers, connects and sends, in that order", async () => {
        await expect(manager.publishProject(PROJECT, ORIGIN, "driftwood")).resolves.toEqual({ ok: true });

        expect(lore.calls).toEqual([
            "list",
            "register",
            `writeRemote ${ORIGIN}/driftwood`,
            `publishToRemote ${ORIGIN}/driftwood ${REPOSITORY}`,
            "push",
        ]);
    });

    it("registers the repository this machine already has, rather than asking for a new one", async () => {
        await manager.publishProject(PROJECT, ORIGIN, "driftwood");

        // The id it already has, and a stable client id so a retry is not a second project.
        expect(server.create).toHaveBeenCalledWith(
            expect.objectContaining({ name: "driftwood", repositoryId: REPOSITORY, clientId: REPOSITORY }),
        );
    });

    it("writes nothing and sends nothing when the server will not record the project", async () => {
        server.create.mockResolvedValue({ ok: false, problem: { kind: "refused", code: "refused", detail: "" } });

        const outcome = await manager.publishProject(PROJECT, ORIGIN, "driftwood");

        expect(outcome).toEqual({ ok: false, problem: { kind: "refused" } });
        // The project is exactly as it was: no address, and no version off the machine.
        expect(lore.calls).toEqual(["list", "register"]);
    });

    it("stops before the registration when this installation cannot ask the server anything", async () => {
        const nobody = new VcsManager({
            logger: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
            getGlobalState: () => ({ get: () => undefined, set: () => undefined }),
            getUserDataDir: () => "D:/userData",
        } as unknown as BaseApp);

        await expect(nobody.publishProject(PROJECT, ORIGIN, "driftwood"))
            .resolves.toEqual({ ok: false, problem: { kind: "no-token" } });
        expect(lore.calls).toEqual([]);
    });

    it("connects a project the server already holds, and sends nothing", async () => {
        // The second machine joining work that is already published. Whether this
        // machine's versions belong on top of what is there is what Send asks, with the
        // state in front of the author. A whole row, because the reader keeps only rows
        // that carry the fields everything downstream reads.
        server.list.mockResolvedValue(listed([projectRow(REPOSITORY.toUpperCase())]));

        await expect(manager.publishProject(PROJECT, ORIGIN, "driftwood")).resolves.toEqual({ ok: true });

        expect(lore.calls).toEqual([
            "list",
            `writeRemote ${ORIGIN}/driftwood`,
            `publishToRemote ${ORIGIN}/driftwood ${REPOSITORY}`,
        ]);
    });

    it("puts the address back when connecting fails, and sends nothing", async () => {
        lore.failures.set(`publishToRemote ${ORIGIN}/driftwood ${REPOSITORY}`, new Error("loreserver said no"));

        await expect(manager.publishProject(PROJECT, ORIGIN, "driftwood"))
            .rejects.toThrow("loreserver said no");

        expect(lore.calls).toEqual([
            "list",
            "register",
            `writeRemote ${ORIGIN}/driftwood`,
            `publishToRemote ${ORIGIN}/driftwood ${REPOSITORY}`,
            // The rollback `setRemote` already ran, unchanged.
            "writeRemote null",
        ]);
    });

    it("keeps the address when the send fails, because the project is published by then", async () => {
        // Taking it away would unpublish nothing - the row and the repository are both
        // on the server - and would hide the two buttons that finish the job.
        lore.failures.set("push", new Error("Branch has diverged, sync to merge remote changes"));

        await expect(manager.publishProject(PROJECT, ORIGIN, "driftwood"))
            .rejects.toThrow("Branch has diverged");

        expect(lore.calls.filter((call) => call.startsWith("writeRemote")))
            .toEqual([`writeRemote ${ORIGIN}/driftwood`]);
    });

    it("refuses a project that is not under version control, before asking anything", async () => {
        repositoryId.value = undefined;

        await expect(manager.publishProject(PROJECT, ORIGIN, "driftwood"))
            .rejects.toThrow("not under version control");
        expect(lore.calls).toEqual([]);
    });

    it("hands back a list that could not be read, rather than registering a second time", async () => {
        server.list.mockResolvedValue({ ok: false, problem: { kind: "offline", detail: "" } });

        await expect(manager.publishProject(PROJECT, ORIGIN, "driftwood"))
            .resolves.toEqual({ ok: false, problem: { kind: "unreachable" } });
        expect(lore.calls).toEqual(["list"]);
    });
});
