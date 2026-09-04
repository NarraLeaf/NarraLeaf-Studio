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
    VcsCompleteMergeHandler,
    VcsReadWorkingFileHandler,
    VcsResolveConflictsHandler,
    VcsRestartConflictsHandler,
    VcsRestoreRevisionHandler,
} = await import("./vcsAction");

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
 * These five are the ones with no way back. Everything else here either reads, or adds a revision
 * that leaves the author's files where they were; each of these replaces the bytes on disk with
 * bytes out of history, and the bytes it replaces were never committed - a restore checkpoints
 * first, but only what version control was already holding. So a payload naming another project is
 * not an operation on the wrong project, it is destroyed work in a project whose window showed
 * nobody any of it.
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
