import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { isVcsPlatformSupported } from "@shared/types/vcs";
import { ATOMIC_WRITE_TEMP_SUFFIX } from "@shared/utils/fs";
import type { LoreGlobals } from "./lore/call";
import {
    closeStore,
    closeTree,
    createRepository,
    flushRepository,
    loadTree,
    openStore,
    releaseRepository,
    treeNode,
    type StoreHandle,
    type TreeHandle,
} from "./lore/verbs";
import {
    getStatus,
    IncompleteRepositoryError,
    initRepository,
    RepositoryExistsError,
    type InitRepositoryResult,
} from "./repository";
import { renderWorkingSetIgnoreFile } from "./workingSet";

/**
 * Putting a real project directory under version control, against the real library.
 *
 * The assertions that matter read the COMMITTED REVISION TREE rather than anything
 * `initRepository` returned. Checking the return value would only prove that the list
 * Studio built matches itself; the question worth answering is what the repository
 * now contains, because that is the thing an author will still have in a year.
 *
 * Only runs where Epic ships a native build (no Intel Mac, no Windows ARM64 - see
 * docs/version-control.md §7).
 */

const supported = isVcsPlatformSupported() || Boolean(process.env.LORE_LIB_PATH);

const STORY = "editor/story/stories/prologue/storydoc.json";
const ASSET = "assets/content/ab/cd/sprite.png";
const ICON = "resources/icons/derived/icon.png";
const CONFIG = "project.json";

const PLUGIN = ".nlstudio/plugins/x.js";
const THUMBNAIL = "editor/cache/thumbnail/ab/cd/y.png";
const REMOTE = "editor/assets/remote/ab/cd/z.bin";
const BUILD = "dist/out.js";
const SCRATCH = `editor/story/index.json${ATOMIC_WRITE_TEMP_SUFFIX}`;

/** Added by a test, inside a directory that is already tracked. */
const NOTES = "editor/story/stories/prologue/notes.json";
const RENAMED = "assets/content/ab/cd/renamed.png";
/** Added by a test, inside a directory that is not. */
const LOCALE = "editor/localization/en.json";

let root: string;
let globals: LoreGlobals;
let created: InitRepositoryResult;
let store: StoreHandle;
let tree: TreeHandle;

/** The committed content of every versioned file, so a test can put the tree back. */
const COMMITTED: ReadonlyArray<[string, string]> = [
    [CONFIG, JSON.stringify({ name: "prologue" })],
    [STORY, JSON.stringify({ version: 9, scenes: [] })],
    [ASSET, "PNG-BYTES"],
    [ICON, "BAKED-PNG-BYTES"],
];

function write(relative: string, bytes: string): void {
    const absolute = path.join(root, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, bytes);
}

/**
 * Put the working tree back to the committed state.
 *
 * Rewriting a file with the bytes it already had is measured NOT to register as a
 * change, so this really does restore cleanliness rather than trading one pending
 * modification for another.
 */
function restoreWorkingTree(): void {
    for (const [relative, bytes] of COMMITTED) write(relative, bytes);
    fs.rmSync(path.join(root, NOTES), { force: true });
    fs.rmSync(path.join(root, RENAMED), { force: true });
}

/** Whether a path exists in the committed tree. Lore refuses to resolve one that does not. */
async function committed(relative: string): Promise<boolean> {
    try {
        await treeNode(globals, tree, relative);
        return true;
    } catch {
        return false;
    }
}

beforeAll(async () => {
    if (!supported) return;

    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nl-repository-")));
    globals = { repositoryPath: root, offline: true, cache: true };

    // A project shaped the way Studio writes one, mixing the four kinds of thing the
    // policy has to tell apart: authored documents, imported binary assets, files
    // baked from an author's source, and machine-local state.
    write(CONFIG, JSON.stringify({ name: "prologue" }));
    write(STORY, JSON.stringify({ version: 9, scenes: [] }));
    write(ASSET, "PNG-BYTES");
    write(ICON, "BAKED-PNG-BYTES");
    write(PLUGIN, "module.exports = {};");
    write(THUMBNAIL, "THUMB-BYTES");
    write(REMOTE, "CACHED-REMOTE-BYTES");
    write(BUILD, "console.log(1);");
    write(SCRATCH, "{\"half\":");

    created = await initRepository(globals, { identity: "author@narraleaf", message: "Enable version control" });

    store = await openStore(globals, root);
    tree = await loadTree(globals, store, created.repositoryId, created.revision);
}, 180_000);

afterAll(async () => {
    if (tree) await closeTree(globals, tree).catch(() => undefined);
    if (store) await closeStore(globals, store).catch(() => undefined);
    // Closing the store does not let go of the repository: Lore keeps it open for a
    // while after the last call, and on Windows the removal below then fails with
    // EPERM. In production the same handles block the author's own `lore` CLI.
    if (root) await releaseRepository(globals).catch(() => undefined);
    if (root) fs.rmSync(root, { recursive: true, force: true });
});

describe.skipIf(!supported)("repository init", () => {
    it("creates a repository and a first commit, offline and without a server", () => {
        expect(created.repositoryId).toMatch(/^[0-9a-f]{32}$/);
        expect(created.revision).toMatch(/^[0-9a-f]{64}$/);
        expect(fs.existsSync(path.join(root, ".lore"))).toBe(true);
    });

    it("commits the author's content", async () => {
        expect(await committed(CONFIG)).toBe(true);
        expect(await committed(STORY)).toBe(true);
        expect(await committed(ASSET)).toBe(true);
        // Generated, but generated INTO the shipped package. Cache is what gets
        // rebuilt on demand; this does not.
        expect(await committed(ICON)).toBe(true);
    }, 60_000);

    it("keeps machine-local state, caches, build output and half-written files out of history", async () => {
        expect(await committed(PLUGIN)).toBe(false);
        expect(await committed(THUMBNAIL)).toBe(false);
        expect(await committed(REMOTE)).toBe(false);
        expect(await committed(BUILD)).toBe(false);
        // The atomic writer's scratch sibling exists for a few milliseconds during
        // every save. Committing one puts a truncated document in permanent history.
        expect(await committed(SCRATCH)).toBe(false);
    }, 60_000);

    it("commits the exclusion policy itself, so it travels with the project", async () => {
        // The backend enforces exclusion by reading this file out of the working
        // tree. Leaving it uncommitted would mean a collaborator's clone versions
        // everything this one does not.
        expect(await committed(".loreignore")).toBe(true);
        expect(fs.readFileSync(path.join(root, ".loreignore"), "utf-8")).toBe(renderWorkingSetIgnoreFile());
    }, 60_000);

    it("never commits the repository's own directory", async () => {
        expect(await committed(".lore/config.toml")).toBe(false);
    }, 60_000);

    it("counts only the files it actually committed", () => {
        // Four project files plus the ignore file; the five excluded paths are not in
        // the number, which is what a "N files added to version control" message says.
        expect(created.fileCount).toBe(5);
    });

    it("refuses a directory that is already a repository instead of starting a second history", async () => {
        await expect(initRepository(globals)).rejects.toBeInstanceOf(RepositoryExistsError);
        // And the refusal left the existing history alone.
        const status = await getStatus(globals);
        expect(status.head).toBe(created.revision);
    }, 60_000);
});

describe.skipIf(!supported)("repository status", () => {
    afterEach(() => {
        if (supported) restoreWorkingTree();
    });

    it("reports a clean tree immediately after init", async () => {
        const status = await getStatus(globals);
        expect(status.clean).toBe(true);
        expect(status.files).toEqual([]);
        expect(status.branch).toBe("main");
        expect(status.head).toBe(created.revision);
        expect(status.revisionNumber).toBe(1);
        // Nothing staged and nothing waiting: the zero-filled hash Lore reports for
        // "absent" must not come back as a revision id.
        expect(status.stagedRevision).toBeUndefined();
        expect(status.counts).toEqual({ added: 0, modified: 0, deleted: 0, moved: 0, copied: 0 });
    }, 60_000);

    it("describes a purely local repository as having no remote", async () => {
        const status = await getStatus(globals);
        expect(status.sync.remoteAvailable).toBe(false);
        expect(status.sync.remoteBranchExists).toBe(false);
        expect(status.sync.localAhead).toBe(false);
        expect(status.sync.remoteAhead).toBe(false);
        expect(status.sync.remoteRevision).toBeUndefined();
    }, 60_000);

    it("reports edits and additions, and stays silent about excluded paths", async () => {
        write(STORY, JSON.stringify({ version: 9, scenes: ["prologue"] }));
        write(NOTES, "notes");
        // All three of these change on disk constantly while Studio runs. If the
        // ignore file were written after staging rather than before, or if it named
        // an unanchored pattern where an anchored one was meant, this is where it
        // would show: as entries the author never asked about.
        write(THUMBNAIL, "NEW-THUMB-BYTES");
        write(BUILD, "console.log(2);");
        write(SCRATCH, "{\"still-half\":");

        const status = await getStatus(globals);
        const byPath = new Map(status.files.map((file) => [file.path.replace(/\\/g, "/"), file]));

        expect(byPath.get(STORY)?.kind).toBe("modified");
        expect(byPath.get(NOTES)?.kind).toBe("added");
        expect([...byPath.keys()].sort()).toEqual([NOTES, STORY].sort());
        expect(status.clean).toBe(false);
        expect(status.counts.modified).toBe(1);
        expect(status.counts.added).toBe(1);
    }, 60_000);

    it("reports a delete, and a rename as the delete plus add Lore actually records", async () => {
        fs.rmSync(path.join(root, ICON));
        fs.renameSync(path.join(root, ASSET), path.join(root, RENAMED));

        const status = await getStatus(globals);
        const byPath = new Map(status.files.map((file) => [file.path.replace(/\\/g, "/"), file]));

        expect(byPath.get(ICON)?.kind).toBe("deleted");
        // Measured: Lore's status does not pair a rename up, and `summary.moves`
        // stays zero. Anything upstream that wants to show a rename has to infer it.
        expect(byPath.get(ASSET)?.kind).toBe("deleted");
        expect(byPath.get(RENAMED)?.kind).toBe("added");
        expect(status.counts.moved).toBe(0);
        expect(status.counts.deleted).toBe(2);
    }, 60_000);

    it("reports repository-relative paths, which is the opposite of what staging wants", async () => {
        write(STORY, JSON.stringify({ version: 9, scenes: ["prologue"] }));
        const status = await getStatus(globals);
        expect(status.files.length).toBeGreaterThan(0);
        for (const file of status.files) {
            expect(path.isAbsolute(file.path)).toBe(false);
        }
    }, 60_000);

    /**
     * Last on purpose: it leaves state behind that no later test could tell apart
     * from a bug.
     */
    it("keeps reporting a never-committed directory after it is gone", async () => {
        // A status scan is not a pure read. Seeing a NEW DIRECTORY records it in the
        // repository's staged state, so deleting it afterwards is reported as a
        // deletion even though nothing was ever committed there - and it stays
        // reported for the rest of the session. Verified by controlled comparison:
        // the identical sequence without the intermediate scan reports nothing, and
        // the same sequence with a new file in an ALREADY TRACKED directory also
        // reports nothing. It is the directory that gets remembered.
        //
        // Pinned here rather than worked around: hiding it would need a tree lookup
        // per deleted entry, and if a Lore upgrade drops the behaviour this test is
        // what says so.
        write(LOCALE, "{}");
        const seen = await getStatus(globals);
        expect(seen.files.map((file) => file.path.replace(/\\/g, "/"))).toContain(LOCALE);

        fs.rmSync(path.join(root, "editor/localization"), { recursive: true, force: true });

        const after = await getStatus(globals);
        const byPath = new Map(after.files.map((file) => [file.path.replace(/\\/g, "/"), file]));
        expect(byPath.get(LOCALE)?.kind).toBe("deleted");
        expect(byPath.get("editor/localization")).toMatchObject({ kind: "deleted", directory: true });
    }, 60_000);
});

/**
 * What happens when setup does not finish.
 *
 * The state under test is a directory that passes every cheap "is this a repository"
 * check and holds nothing - no commits, so no readable repository id. Left alone it
 * makes the project permanently un-initialisable behind a message saying it is already
 * done, which for a milestone about not losing the author's work is the worst kind of
 * defect: the recovery path itself lies.
 *
 * Each case gets its own project directory, and the failure is injected rather than
 * waited for.
 */
describe.skipIf(!supported)("interrupted setup", () => {
    const created: Array<{ directory: string; globals: LoreGlobals }> = [];

    function project(): { directory: string; globals: LoreGlobals } {
        const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nl-repository-partial-")));
        const entry = { directory, globals: { repositoryPath: directory, offline: true, cache: true } };
        created.push(entry);
        return entry;
    }

    afterAll(async () => {
        for (const entry of created) {
            await flushRepository(entry.globals).catch(() => undefined);
            await releaseRepository(entry.globals).catch(() => undefined);
            for (let attempt = 0; attempt < 20; attempt++) {
                try {
                    fs.rmSync(entry.directory, { recursive: true, force: true });
                    break;
                } catch {
                    await new Promise((resolve) => setTimeout(resolve, 100));
                }
            }
        }
    });

    it("rolls back the repository it created, so the author can simply try again", async () => {
        const { directory, globals: local } = project();
        fs.writeFileSync(path.join(directory, CONFIG), JSON.stringify({ name: "partial" }));
        // The injected failure: a DIRECTORY standing where the ignore file has to be
        // written. The write fails after `repositoryCreate` has already put `.lore/`
        // on disk, which is exactly the window that used to strand a project.
        fs.mkdirSync(path.join(directory, ".loreignore"));

        const failure = await initRepository(local).catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(Error);
        // The cause the author needs, not whatever the cleanup ran into.
        expect(failure).not.toBeInstanceOf(RepositoryExistsError);
        expect(failure).not.toBeInstanceOf(IncompleteRepositoryError);
        // An `errno` code means this is the filesystem failure that was injected, so
        // `repositoryCreate` had already succeeded and there really was a `.lore/` to
        // roll back. A failure in the create step itself carries no code, and would
        // have made the assertion below pass without proving anything.
        expect((failure as NodeJS.ErrnoException).code).toBeTruthy();
        expect(fs.existsSync(path.join(directory, ".lore"))).toBe(false);

        fs.rmdirSync(path.join(directory, ".loreignore"));
        const result = await initRepository(local);
        expect(result.revision).toMatch(/^[0-9a-f]{64}$/);
        expect(result.fileCount).toBe(2);
    }, 120_000);

    it("names a rollback that could not run, instead of claiming the project is already versioned", async () => {
        const { directory, globals: local } = project();
        // Precisely what a failed rollback leaves behind: a repository directory with
        // no commits in it.
        await createRepository(local, { repositoryUrl: "lore://127.0.0.1:41337/local" });

        const failure = await initRepository(local).catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(IncompleteRepositoryError);
        expect(failure).not.toBeInstanceOf(RepositoryExistsError);
        // Actionable: it says which directory to remove. The author has no other way
        // to know, and every other message here would have them guessing.
        expect((failure as Error).message).toContain(path.join(directory, ".lore"));
    }, 120_000);
});
