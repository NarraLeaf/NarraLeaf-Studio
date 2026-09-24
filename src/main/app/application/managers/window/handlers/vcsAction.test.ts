import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Enough of Electron for the module graph behind the handler to load; the handler reaches none of
// it - what it does is decide which project a read is about and hand it to the manager.
vi.mock("electron", () => ({
    app: { getPath: () => "" },
    dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
    net: { request: vi.fn() },
}));

const { WINDOW_PROJECT_MISMATCH_CODE } = await import("@shared/types/window");
const { WorkingFileRefusedError, readWorkingSetFile } = await import("../../vcs/workingFile");
const {
    VcsAbortMergeHandler,
    VcsAddServerHandler,
    VcsCheckpointHandler,
    VcsCloneHandler,
    VcsCommitHandler,
    VcsCompleteMergeHandler,
    VcsDiffRevisionsHandler,
    VcsDiffWorkingTreeHandler,
    VcsGetChangedPathsHandler,
    VcsGetHistoryHandler,
    VcsGetInfoHandler,
    VcsGetMergeBaseHandler,
    VcsGetMergeDocumentHandler,
    VcsGetMergeStateHandler,
    VcsGetRemoteHandler,
    VcsGetServerSessionHandler,
    VcsGetStatusHandler,
    VcsGetSyncStateHandler,
    VcsGetThreeWayHandler,
    VcsInitRepositoryHandler,
    VcsIsRepositoryHandler,
    VcsPublishProjectHandler,
    VcsPushHandler,
    VcsReadBlobHandler,
    VcsReadRevisionDocumentsHandler,
    VcsReadWorkingFileHandler,
    VcsResolveConflictsHandler,
    VcsRestartConflictsHandler,
    VcsRestoreRevisionHandler,
    VcsSetRemoteHandler,
    VcsSignInHandler,
    VcsSignOutHandler,
    VcsSyncHandler,
    VcsUnresolveConflictsHandler,
} = await import("./vcsAction");
const { VcsUseServerSessionHandler } = await import("./vcsServerSessionAction");

type AppWindowLike = Parameters<InstanceType<typeof VcsReadWorkingFileHandler>["handle"]>[0];

/**
 * Two real projects on disk, and a real reader behind the handler.
 *
 * Both halves are deliberate, for the reason the build guard's fixtures give: the file in `theirs`
 * is genuinely readable, and the double genuinely reads it, so a refusal that stopped working would
 * fail on an *answer* rather than on some unrelated error. A double that could not read either way
 * would pass with or without the check.
 */
let root: string;
/** The project the window has open. */
let mine: string;
/** A project it does not, holding a file of the same name. */
let theirs: string;

const VERSIONED = "assets/content/note.txt";

/** A window on one project, whose VCS manager reads the working tree for real. */
function makeWindow(projectPath?: string) {
    const readWorkingFile = vi.fn(
        (request: { projectPath: string; path: string }) =>
            readWorkingSetFile(request.projectPath, request.path),
    );
    const app = { getVcsManager: () => ({ readWorkingFile }) };
    const window = {
        app,
        getApp: () => app,
        getProps: () => ({ projectPath }),
    } as unknown as AppWindowLike;
    return { window, readWorkingFile };
}

async function writeProject(name: string, contents: string): Promise<string> {
    const dir = path.join(root, name);
    await fs.mkdir(path.join(dir, "assets", "content"), { recursive: true });
    await fs.writeFile(path.join(dir, ...VERSIONED.split("/")), contents);
    return dir;
}

beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "nls-vcs-working-file-"));
    mine = await writeProject("mine", "the author's own note");
    theirs = await writeProject("theirs", "somebody else's note");
});

afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
});

/**
 * Which project's working tree this reads.
 *
 * The narrowness of this channel was all on the *relative* half of its request. `workingFile.ts`
 * refuses a `..` segment, an absolute path, anything outside version control and anything over the
 * ceiling - and every one of those is judged against a root the caller supplied. It opens no
 * session, never requires the root to be a repository, and never consults the window's filesystem
 * grant, so a renderer free to name the root had a general file reader in front of it: name the
 * root, and every versioned path under it is one request away.
 *
 * Binding the root to the window's own project is what makes the module's own documentation true -
 * "one repository-relative path" of *this* project.
 */
describe("VcsReadWorkingFileHandler", () => {
    it("reads a file out of the window's own project", async () => {
        const { window } = makeWindow(mine);

        const result = await new VcsReadWorkingFileHandler().handle(window, {
            projectPath: mine,
            path: VERSIONED,
        });

        expect(result.success).toBe(true);
        expect(Buffer.from(result.data!.contentBase64!, "base64").toString())
            .toBe("the author's own note");
    });

    /**
     * The hole, stated as the thing it prevents. `theirs/assets/content/note.txt` is versioned,
     * inside its own root and well under the ceiling, so every guard in the reader says yes to it -
     * they were never asked whose project it is.
     */
    it("refuses a project this window does not have open, and reads nothing", async () => {
        const { window, readWorkingFile } = makeWindow(mine);

        const result = await new VcsReadWorkingFileHandler().handle(window, {
            projectPath: theirs,
            path: VERSIONED,
        });

        expect(result.success).toBe(false);
        expect(result.code).toBe(WINDOW_PROJECT_MISMATCH_CODE);
        expect(readWorkingFile).not.toHaveBeenCalled();
    });

    /** The launcher, settings and the wizard have no project a payload could agree with. */
    it("refuses a window that has no project open", async () => {
        const { window, readWorkingFile } = makeWindow();

        const result = await new VcsReadWorkingFileHandler().handle(window, {
            projectPath: mine,
            path: VERSIONED,
        });

        expect(result.code).toBe(WINDOW_PROJECT_MISMATCH_CODE);
        expect(readWorkingFile).not.toHaveBeenCalled();
    });

    /**
     * A guard that refused the author their own project would be worse than the hole it closes, so
     * the two spellings of one directory are one question here as everywhere else - and the root the
     * reader receives is the window's own string rather than the caller's.
     */
    it("accepts the window's own project under another spelling", async () => {
        const { window, readWorkingFile } = makeWindow(mine);

        const result = await new VcsReadWorkingFileHandler().handle(window, {
            projectPath: mine + path.sep,
            path: VERSIONED,
        });

        expect(result.success).toBe(true);
        expect(readWorkingFile.mock.calls[0][0].projectPath).toBe(mine);
    });

    /**
     * The other half of the contract, which the guard must not have flattened: a file too large to
     * draw is an ANSWER the comparison has a sentence for, while a path that should never have been
     * named is a failure. Two different facts, and the surface tells them apart by this shape.
     */
    it("still answers rather than fails when the file is too large to draw", async () => {
        const { window, readWorkingFile } = makeWindow(mine);
        readWorkingFile.mockRejectedValueOnce(
            new WorkingFileRefusedError("tooLarge", VERSIONED, "it is enormous"),
        );

        const result = await new VcsReadWorkingFileHandler().handle(window, {
            projectPath: mine,
            path: VERSIONED,
        });

        expect(result).toMatchObject({ success: true, data: { contentBase64: null, refusal: "tooLarge" } });
    });

    /** The reader's own guards are untouched, and still refuse what no comparison can name. */
    it("still refuses a path that escapes the project", async () => {
        const { window } = makeWindow(mine);

        const result = await new VcsReadWorkingFileHandler().handle(window, {
            projectPath: mine,
            path: `../${path.basename(theirs)}/${VERSIONED}`,
        });

        expect(result.success).toBe(false);
        expect(result.code).not.toBe(WINDOW_PROJECT_MISMATCH_CODE);
    });
});

/**
 * Which project gets its working tree written over.
 *
 * These six are the ones with no way back. Everything else here either reads, or adds a revision
 * that leaves the author's files where they were; each of these replaces the bytes on disk with
 * bytes out of history, and the bytes it replaces were never committed - a restore checkpoints
 * first, but only what version control was already holding. So a payload naming another project is
 * not an operation on the wrong project, it is destroyed work in a project whose window showed
 * nobody any of it.
 *
 * `vcs.sync` is the sixth, and it reaches one step further than the rest: it settles the pending
 * saves of whatever window holds the project before it writes anything, so an unguarded one used
 * another window's editors as well as its disk.
 *
 * The double is a bare recorder rather than a real repository: what is under test is whether the
 * manager is reached at all and with which project, and it must record nothing when refused.
 */
describe("the version-control writers take their project from the window", () => {
    function makeWriter(projectPath?: string) {
        // Declared with the project argument so a test can read back which one crossed - two
        // spellings of one directory are two session keys in the manager behind this.
        const writer = () => vi.fn(async (_projectPath: string, ..._rest: unknown[]) => ({}));
        const manager = {
            restoreRevision: writer(),
            resolveConflicts: writer(),
            completeMerge: writer(),
            restartConflicts: writer(),
            abortMerge: writer(),
            sync: writer(),
            push: writer(),
            signIn: writer(),
            publishProject: writer(),
        };
        const app = { getVcsManager: () => manager };
        const window = {
            app,
            getApp: () => app,
            getProps: () => ({ projectPath }),
        } as unknown as AppWindowLike;
        return { window, manager };
    }

    type Manager = ReturnType<typeof makeWriter>["manager"];

    const writers = [
        {
            name: "vcs.restoreRevision",
            method: (manager: Manager) => manager.restoreRevision,
            run: (window: AppWindowLike, projectPath: string) =>
                new VcsRestoreRevisionHandler().handle(window, { projectPath, revision: "r1" } as never),
        },
        {
            name: "vcs.resolveConflicts",
            method: (manager: Manager) => manager.resolveConflicts,
            run: (window: AppWindowLike, projectPath: string) =>
                new VcsResolveConflictsHandler().handle(window, {
                    projectPath,
                    paths: ["assets/a.txt"],
                    choice: "theirs",
                } as never),
        },
        {
            name: "vcs.completeMerge",
            method: (manager: Manager) => manager.completeMerge,
            run: (window: AppWindowLike, projectPath: string) =>
                new VcsCompleteMergeHandler().handle(window, { projectPath, decisions: [] } as never),
        },
        {
            name: "vcs.restartConflicts",
            method: (manager: Manager) => manager.restartConflicts,
            run: (window: AppWindowLike, projectPath: string) =>
                new VcsRestartConflictsHandler().handle(window, {
                    projectPath,
                    paths: ["assets/a.txt"],
                } as never),
        },
        {
            name: "vcs.abortMerge",
            method: (manager: Manager) => manager.abortMerge,
            run: (window: AppWindowLike, projectPath: string) =>
                new VcsAbortMergeHandler().handle(window, { projectPath } as never),
        },
        {
            name: "vcs.sync",
            method: (manager: Manager) => manager.sync,
            run: (window: AppWindowLike, projectPath: string) =>
                new VcsSyncHandler().handle(window, { projectPath } as never),
        },
    ] as const;

    for (const writer of writers) {
        it(`${writer.name} writes the window's own project`, async () => {
            const { window, manager } = makeWriter(mine);

            const result = await writer.run(window, mine);

            expect(result.success).toBe(true);
            // Asserted with the window's own spelling: the manager keys a session off this string.
            expect(writer.method(manager).mock.calls[0][0]).toBe(mine);
        });

        it(`${writer.name} refuses a project this window does not have open, and writes nothing`, async () => {
            const { window, manager } = makeWriter(mine);

            const result = await writer.run(window, theirs);

            expect(result.success).toBe(false);
            expect(result.code).toBe(WINDOW_PROJECT_MISMATCH_CODE);
            expect(writer.method(manager)).not.toHaveBeenCalled();
        });

        it(`${writer.name} refuses a window that has no project open`, async () => {
            const { window, manager } = makeWriter();

            const result = await writer.run(window, mine);

            expect(result.code).toBe(WINDOW_PROJECT_MISMATCH_CODE);
            expect(writer.method(manager)).not.toHaveBeenCalled();
        });

        /** A guard that refused the author their own project would be worse than the hole it closes. */
        it(`${writer.name} accepts the window's own project under another spelling`, async () => {
            const { window, manager } = makeWriter(mine);

            const result = await writer.run(window, mine + path.sep);

            expect(result.success).toBe(true);
            expect(writer.method(manager).mock.calls[0][0]).toBe(mine);
        });
    }
});

/**
 * The handlers that send a project, or an account's credentials, to a server.
 *
 * Two of them take their project from the window and one deliberately does not, and the split is
 * about who calls them rather than about what they cost. `push` and `signIn` are reached only from
 * the workspace's version rail, which has never had a project to name but its own. `publishProject`
 * is also reached from the launcher's server tab, which has the wizard write a project and then
 * sends it - from a window holding no project at all, so an assertion there would refuse the only
 * way to make a project on a server. That is asserted here so the difference stays a decision.
 *
 * Which account a request spends is the manager's question - a sign-in serves a project only once
 * the author has said so, per (server, project) pair - and is pinned in `serverSessionUse.test.ts`.
 * What is pinned here is the half only a handler can see: that whatever a request says about "the
 * project this is for" comes from the window, never from the payload, wherever it decides which
 * project a sign-in is recorded for.
 */
describe("the handlers that reach a server", () => {
    function makeServerWindow(projectPath?: string, writable: string[] = []) {
        const call = () => vi.fn(async (_projectPath: string, ..._rest: unknown[]) => ({}));
        const manager = {
            push: call(),
            signIn: call(),
            publishProject: call(),
            addServer: vi.fn(async (_options: Record<string, unknown>) => ({ session: {}, servers: [] })),
            cloneRepository: call(),
            getServerSession: call(),
            useServerSession: call(),
        };
        // The folders this window holds a write grant over - for the launcher, the one the wizard it
        // opened handed back. Compared resolved, the way the storage manager compares them.
        const isPathAllowed = vi.fn(async (_window: unknown, fsPath: string, mode: string) =>
            mode === "write" && writable.some(entry => path.resolve(entry) === path.resolve(fsPath)));
        const app = { getVcsManager: () => manager, storageManager: { isPathAllowed } };
        const window = {
            app,
            getApp: () => app,
            getProps: () => ({ projectPath }),
        } as unknown as AppWindowLike;
        return { window, manager };
    }

    describe("vcs.push", () => {
        it("pushes the window's own project, under either spelling", async () => {
            const { window, manager } = makeServerWindow(mine);

            const result = await new VcsPushHandler().handle(window, { projectPath: mine + path.sep });

            expect(result.success).toBe(true);
            expect(manager.push.mock.calls[0][0]).toBe(mine);
        });

        it("refuses a project this window does not have open, and pushes nothing", async () => {
            const { window, manager } = makeServerWindow(mine);

            const result = await new VcsPushHandler().handle(window, { projectPath: theirs });

            expect(result.success).toBe(false);
            expect(result.code).toBe(WINDOW_PROJECT_MISMATCH_CODE);
            expect(manager.push).not.toHaveBeenCalled();
        });
    });

    describe("vcs.signIn", () => {
        it("signs in against the window's own project", async () => {
            const { window, manager } = makeServerWindow(mine);

            const result = await new VcsSignInHandler().handle(window, {
                projectPath: mine + path.sep,
                authUrl: "https://auth.example",
                token: "t",
            });

            expect(result.success).toBe(true);
            expect(manager.signIn.mock.calls[0][0]).toBe(mine);
        });

        /**
         * The refusal has to stay a FAILED call. A sign-in refused by the server travels as a
         * successful one carrying a coded problem, and the panel draws a sentence per code; a
         * mismatch folded into that shape would be drawn as a transport failure the author is
         * invited to fix, when what happened is a renderer naming a project it does not have.
         */
        it("refuses a project this window does not have open, without presenting the token", async () => {
            const { window, manager } = makeServerWindow(mine);

            const result = await new VcsSignInHandler().handle(window, {
                projectPath: theirs,
                authUrl: "https://auth.example",
                token: "t",
            });

            expect(result.success).toBe(false);
            expect(result.code).toBe(WINDOW_PROJECT_MISMATCH_CODE);
            expect(manager.signIn).not.toHaveBeenCalled();
        });
    });

    /**
     * The one that must NOT be held to the window's own project. Written as a test rather than as a
     * comment because the shape of the file invites the opposite: three neighbours assert, and adding
     * the fourth is a one-line change that breaks nothing tsc or the workspace can see - the flow it
     * breaks lives in the launcher, where no project is open to compare against.
     *
     * But it is bounded, the way `vcs.initRepository` is: a window with no project names only a
     * folder it holds a write grant over, which for the launcher is the folder the wizard it opened
     * made and handed back. Before that, any window with no project could name any repository on the
     * disk that was not on a server yet, and have it registered, pointed at and sent.
     */
    describe("vcs.publishProject", () => {
        it("publishes a project a window with none of its own has just made", async () => {
            const { window, manager } = makeServerWindow(undefined, [theirs]);

            const result = await new VcsPublishProjectHandler().handle(window, {
                projectPath: theirs,
                remoteOrigin: "lore://server.example:7000",
                name: "a-game",
            });

            expect(result.success).toBe(true);
            expect(manager.publishProject.mock.calls[0][0]).toBe(theirs);
            // Said to the manager as the launcher's act, which it holds to a project with no
            // server yet and records the sign-in for.
            expect(manager.publishProject.mock.calls[0][3]).toEqual({ newProject: true });
        });

        it("will not publish a folder a window with none of its own was never handed", async () => {
            const { window, manager } = makeServerWindow(undefined, [mine]);

            const result = await new VcsPublishProjectHandler().handle(window, {
                projectPath: theirs,
                remoteOrigin: "lore://server.example:7000",
                name: "a-game",
            });

            expect(result.success).toBe(false);
            expect(result.code).toBe(WINDOW_PROJECT_MISMATCH_CODE);
            expect(manager.publishProject).not.toHaveBeenCalled();
        });

        it("publishes only its own project from a window that has one", async () => {
            const { window, manager } = makeServerWindow(mine);

            const result = await new VcsPublishProjectHandler().handle(window, {
                projectPath: theirs,
                remoteOrigin: "lore://server.example:7000",
                name: "a-game",
            });

            expect(result.success).toBe(false);
            expect(result.code).toBe(WINDOW_PROJECT_MISMATCH_CODE);
            expect(manager.publishProject).not.toHaveBeenCalled();
        });

        it("asks for its own project as the project's act, not the launcher's", async () => {
            const { window, manager } = makeServerWindow(mine);

            await new VcsPublishProjectHandler().handle(window, {
                projectPath: mine,
                remoteOrigin: "lore://server.example:7000",
                name: "a-game",
            });

            expect(manager.publishProject.mock.calls[0][0]).toBe(mine);
            expect(manager.publishProject.mock.calls[0][3]).toEqual({ newProject: false });
        });
    });

    describe("vcs.getServerSession", () => {
        it("answers with where the project stands, not only the sign-in it uses", async () => {
            const { window, manager } = makeServerWindow(mine);
            const standing = { session: null, available: { remoteOrigin: "lore://x" }, declined: true };
            manager.getServerSession.mockResolvedValue(standing);

            const result = await new VcsGetServerSessionHandler().handle(window, { projectPath: mine });

            expect(result.success && result.data).toEqual(standing);
        });
    });

    describe("vcs.useServerSession", () => {
        it("puts the question about the window's own project", async () => {
            const { window, manager } = makeServerWindow(mine);

            const result = await new VcsUseServerSessionHandler().handle(window, { projectPath: mine + path.sep });

            expect(result.success).toBe(true);
            expect(manager.useServerSession.mock.calls[0][0]).toBe(mine);
        });

        /**
         * The server picker's question: the author has chosen a server this project is not on yet,
         * and what that server holds is not listed for this project until they say it uses the
         * sign-in there. The server is carried; the project is still the window's.
         */
        it("puts it about a server the project is not connected to, when one is named", async () => {
            const { window, manager } = makeServerWindow(mine);

            await new VcsUseServerSessionHandler().handle(window, {
                projectPath: mine,
                remoteOrigin: "lore://elsewhere.example:7000",
            });

            expect(manager.useServerSession.mock.calls[0]).toEqual([mine, "lore://elsewhere.example:7000"]);
        });

        it("will not put it about a project this window does not have open", async () => {
            const { window, manager } = makeServerWindow(mine);

            const result = await new VcsUseServerSessionHandler().handle(window, { projectPath: theirs });

            expect(result.code).toBe(WINDOW_PROJECT_MISMATCH_CODE);
            expect(manager.useServerSession).not.toHaveBeenCalled();
        });

        it("will not put it from a window with no project", async () => {
            const { window, manager } = makeServerWindow();

            const result = await new VcsUseServerSessionHandler().handle(window, { projectPath: theirs });

            expect(result.code).toBe(WINDOW_PROJECT_MISMATCH_CODE);
            expect(manager.useServerSession).not.toHaveBeenCalled();
        });
    });

    /**
     * Signing in from inside a project is that project's answer to the sign-in question - so the
     * project it answers for has to be the window's. There is no project field in this payload to
     * believe, and there must never be one.
     */
    describe("vcs.addServer", () => {
        it("records a sign-in made from a project's window for that project", async () => {
            const { window, manager } = makeServerWindow(mine);

            await new VcsAddServerHandler().handle(window, { authUrl: "", remoteUrl: "", token: "t" });

            expect(manager.addServer.mock.calls[0][0]).toMatchObject({ forProject: mine });
        });

        it("records one made from Settings or the launcher for no project", async () => {
            const { window, manager } = makeServerWindow();

            await new VcsAddServerHandler().handle(window, { authUrl: "", remoteUrl: "", token: "t" });

            expect(manager.addServer.mock.calls[0][0]).not.toHaveProperty("forProject");
        });
    });

    describe("vcs.clone", () => {
        it("fetches with the sign-in from the wizard, which has no project of its own", async () => {
            const { window, manager } = makeServerWindow();

            await new VcsCloneHandler().handle(window, { url: "lore://server.example:7000/a-game", destination: theirs });

            expect(manager.cloneRepository.mock.calls[0][2]).toEqual({ useSignIn: true });
        });

        it("fetches an anonymous copy for a project's window", async () => {
            const { window, manager } = makeServerWindow(mine);

            await new VcsCloneHandler().handle(window, { url: "lore://server.example:7000/a-game", destination: theirs });

            expect(manager.cloneRepository.mock.calls[0][2]).toEqual({ useSignIn: false });
        });
    });
});

/**
 * Everything else that names a project: the reads, the two handlers that add a revision, and the
 * ones that read or change which server a project reports to.
 *
 * Their only sender is the workspace asking about the project it has open - `VersionControlService`,
 * its startup preflight and its recovery shell - so the assertion changes nothing for an author and
 * refuses exactly the requests that were never theirs to make. What a foreign path would have bought
 * ranges from a listing of somebody's history to any file of theirs at any revision, and a status
 * scan that writes new directories into their staged state.
 *
 * The double answers every method, recording which project crossed, so each case fails on the
 * manager being reached (or reached with the caller's spelling) rather than on a missing method.
 */
describe("every other version-control handler that names a project takes it from the window", () => {
    function makeManagerWindow(projectPath?: string) {
        const calls: { method: string; args: unknown[] }[] = [];
        const answers: Record<string, unknown> = {
            readBlob: Buffer.from("bytes"),
            readRevisionDocuments: new Map<string, Buffer | null>(),
        };
        const manager = new Proxy({}, {
            get: (_target, method: string) => async (...args: unknown[]) => {
                calls.push({ method, args });
                return method in answers ? answers[method] : {};
            },
        });
        const app = { getVcsManager: () => manager };
        const window = {
            app,
            getApp: () => app,
            getProps: () => ({ projectPath }),
        } as unknown as AppWindowLike;
        return { window, calls };
    }

    /** The project argument of a recorded call: the first one, or the request's field for a blob. */
    const projectOf = (args: unknown[]) =>
        typeof args[0] === "string" ? args[0] : (args[0] as { projectPath: string }).projectPath;

    type Run = (window: AppWindowLike, projectPath: string) => Promise<{ success: boolean; code?: string }>;
    const readers: { name: string; run: Run }[] = [
        { name: "vcs.isRepository", run: (w, projectPath) => new VcsIsRepositoryHandler().handle(w, { projectPath }) },
        { name: "vcs.getInfo", run: (w, projectPath) => new VcsGetInfoHandler().handle(w, { projectPath }) },
        { name: "vcs.commit", run: (w, projectPath) => new VcsCommitHandler().handle(w, { projectPath }) },
        {
            name: "vcs.checkpoint",
            run: (w, projectPath) => new VcsCheckpointHandler().handle(w, { projectPath, reason: "interval" } as never),
        },
        { name: "vcs.getStatus", run: (w, projectPath) => new VcsGetStatusHandler().handle(w, { projectPath }) },
        { name: "vcs.getHistory", run: (w, projectPath) => new VcsGetHistoryHandler().handle(w, { projectPath, limit: 5 }) },
        {
            name: "vcs.readBlob",
            run: (w, projectPath) => new VcsReadBlobHandler().handle(w, { projectPath, revision: "r1", path: VERSIONED } as never),
        },
        {
            name: "vcs.readRevisionDocuments",
            run: (w, projectPath) => new VcsReadRevisionDocumentsHandler().handle(w, { projectPath, revision: "r1" } as never),
        },
        {
            name: "vcs.getChangedPaths",
            run: (w, projectPath) => new VcsGetChangedPathsHandler().handle(w, { projectPath, from: "r1", to: "r2" } as never),
        },
        {
            name: "vcs.diffRevisions",
            run: (w, projectPath) => new VcsDiffRevisionsHandler().handle(w, { projectPath, from: "r1", to: "r2" } as never),
        },
        { name: "vcs.diffWorkingTree", run: (w, projectPath) => new VcsDiffWorkingTreeHandler().handle(w, { projectPath }) },
        {
            name: "vcs.getThreeWay",
            run: (w, projectPath) => new VcsGetThreeWayHandler().handle(w, {
                projectPath, mine: "r1", theirs: "r2", path: VERSIONED,
            } as never),
        },
        {
            name: "vcs.getMergeBase",
            run: (w, projectPath) => new VcsGetMergeBaseHandler().handle(w, { projectPath, a: "r1", b: "r2" } as never),
        },
        { name: "vcs.getMergeState", run: (w, projectPath) => new VcsGetMergeStateHandler().handle(w, { projectPath }) },
        {
            name: "vcs.getMergeDocument",
            run: (w, projectPath) => new VcsGetMergeDocumentHandler().handle(w, { projectPath, path: VERSIONED }),
        },
        {
            name: "vcs.unresolveConflicts",
            run: (w, projectPath) => new VcsUnresolveConflictsHandler().handle(w, { projectPath, paths: [VERSIONED] }),
        },
        { name: "vcs.getRemote", run: (w, projectPath) => new VcsGetRemoteHandler().handle(w, { projectPath }) },
        {
            name: "vcs.setRemote",
            run: (w, projectPath) => new VcsSetRemoteHandler().handle(w, { projectPath, url: "lore://server.example:7000/game" }),
        },
        { name: "vcs.getSyncState", run: (w, projectPath) => new VcsGetSyncStateHandler().handle(w, { projectPath }) },
        { name: "vcs.getServerSession", run: (w, projectPath) => new VcsGetServerSessionHandler().handle(w, { projectPath }) },
        { name: "vcs.signOut", run: (w, projectPath) => new VcsSignOutHandler().handle(w, { projectPath }) },
    ];

    for (const reader of readers) {
        it(`${reader.name} answers for the window's own project, in the window's spelling`, async () => {
            const { window, calls } = makeManagerWindow(mine);

            const result = await reader.run(window, mine + path.sep);

            expect(result.success).toBe(true);
            expect(calls.length).toBeGreaterThan(0);
            for (const call of calls) {
                expect(projectOf(call.args)).toBe(mine);
            }
        });

        it(`${reader.name} refuses a project this window does not have open, and reaches nothing`, async () => {
            const { window, calls } = makeManagerWindow(mine);

            const result = await reader.run(window, theirs);

            expect(result.success).toBe(false);
            expect(result.code).toBe(WINDOW_PROJECT_MISMATCH_CODE);
            expect(calls).toEqual([]);
        });

        it(`${reader.name} refuses a window that has no project open`, async () => {
            const { window, calls } = makeManagerWindow();

            const result = await reader.run(window, mine);

            expect(result.code).toBe(WINDOW_PROJECT_MISMATCH_CODE);
            expect(calls).toEqual([]);
        });
    }
});

/**
 * Putting a folder under version control: the one handler here asked legitimately about a folder
 * that is no window's project.
 *
 * The project wizard asks it about the folder it has just written a new project into, and the wizard
 * has no project of its own - asserting the window's project would refuse "create with version
 * control" outright, from a window neither tsc nor the workspace ever sees. So a window with no
 * project is held to the folders it was granted to WRITE, which the wizard's new folder is and
 * somebody else's project is not; a window with a project is asked the ordinary question.
 */
describe("vcs.initRepository", () => {
    function makeInitWindow(options: { projectPath?: string; writable: string[] }) {
        const initRepository = vi.fn(async (_projectPath: string, _options: unknown) => ({}));
        const isPathAllowed = vi.fn(async (_window: unknown, fsPath: string, mode: string) =>
            mode === "write" && options.writable.includes(fsPath));
        const app = { getVcsManager: () => ({ initRepository }), storageManager: { isPathAllowed } };
        const window = {
            app,
            getApp: () => app,
            getProps: () => (options.projectPath === undefined ? {} : { projectPath: options.projectPath }),
        } as unknown as AppWindowLike;
        return { window, initRepository, isPathAllowed };
    }

    it("puts the wizard's freshly written folder under version control", async () => {
        const { window, initRepository, isPathAllowed } = makeInitWindow({ writable: [theirs] });

        const result = await new VcsInitRepositoryHandler().handle(window, { projectPath: theirs });

        expect(result.success).toBe(true);
        expect(initRepository.mock.calls[0][0]).toBe(theirs);
        expect(isPathAllowed).toHaveBeenCalledWith(window, theirs, "write");
    });

    it("refuses a window with no project a folder it was not granted to write", async () => {
        const { window, initRepository } = makeInitWindow({ writable: [mine] });

        const result = await new VcsInitRepositoryHandler().handle(window, { projectPath: theirs });

        expect(result.success).toBe(false);
        expect(result.code).toBe(WINDOW_PROJECT_MISMATCH_CODE);
        expect(initRepository).not.toHaveBeenCalled();
    });

    it("refuses a window with no project a request that names no folder", async () => {
        const { window, initRepository } = makeInitWindow({ writable: [mine] });

        for (const projectPath of [undefined, "", 7] as unknown as string[]) {
            const result = await new VcsInitRepositoryHandler().handle(window, { projectPath });
            expect(result.code).toBe(WINDOW_PROJECT_MISMATCH_CODE);
        }
        expect(initRepository).not.toHaveBeenCalled();
    });

    it("puts the workspace's own project under version control, in the window's spelling", async () => {
        const { window, initRepository } = makeInitWindow({ projectPath: mine, writable: [mine] });

        const result = await new VcsInitRepositoryHandler().handle(window, { projectPath: mine + path.sep });

        expect(result.success).toBe(true);
        expect(initRepository.mock.calls[0][0]).toBe(mine);
    });

    /**
     * A window with a project may write more than its project - a folder the author picked to export
     * into - and "anywhere it may write" would let it plant a repository there. It is asked about its
     * own project and nothing else, whatever else it was granted.
     */
    it("refuses a workspace another folder, even one it was granted to write", async () => {
        const { window, initRepository } = makeInitWindow({ projectPath: mine, writable: [mine, theirs] });

        const result = await new VcsInitRepositoryHandler().handle(window, { projectPath: theirs });

        expect(result.code).toBe(WINDOW_PROJECT_MISMATCH_CODE);
        expect(initRepository).not.toHaveBeenCalled();
    });
});
