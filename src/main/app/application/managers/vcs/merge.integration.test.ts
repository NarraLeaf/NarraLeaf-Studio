import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";
import { VCS_UNCONFIGURED_REMOTE_URL, isVcsPlatformSupported } from "@shared/types/vcs";
import {
    branchMergeStart,
    closeStore,
    commit,
    createBranch,
    createRepository,
    flushRepository,
    openStore,
    releaseRepository,
    repositoryStatus,
    stage,
    switchBranch,
    type LoreGlobals,
    type StoreHandle,
} from "./lore";
import { abortMerge, readMergeState, resolveConflicts, restartConflicts, unresolveConflicts } from "./merge";
import { blobAt } from "./revisionReader";
import { cloneInto, publishToRemote, pushToRemote, syncFromRemote, writeRemote } from "./remote";

/**
 * The merge surface, held against the behaviour that was measured before it was written.
 *
 * **These are specifications, not probes.** `mergeSpike*.integration.test.ts` are the D0
 * experiments: they print what the backend does and assert nothing, which is right for
 * finding something out and useless for keeping it true. Every expectation below is one of
 * the findings recorded in docs/version-control.md §4.23-§4.30, written so that a backend
 * upgrade which changes it fails the build rather than silently changing what Studio shows
 * an author mid-merge.
 *
 * Three of them are load-bearing enough to name here:
 *
 *  - **a conflicted sync NAMES its conflicting paths.** It used to answer `["*"]` for every
 *    conflict, because the filter ran over per-file events whose conflict fields the decoder
 *    hard-codes to `false` (§4.24). If this regresses, the resolve UI has nothing to draw;
 *  - **`revisionMerged` alone does not mean "a merge is open"** - it is still set after the
 *    merge is committed. Only paired with `revisionStaged` does it mean it;
 *  - **abandoning a merge is a complete rollback** (§4.27). Without that, "cancel" cannot be
 *    offered at all.
 *
 * The local block needs no server. The remote block needs one, and is skipped without it:
 *
 * ```bash
 * # loreserver 0.8.5 - the version Studio pins.
 * LORE_TEST_REMOTE="lore://127.0.0.1:41337" \
 *   npx vitest run src/main/app/application/managers/vcs/merge.integration.test.ts
 * ```
 */

const supported = isVcsPlatformSupported() || Boolean(process.env.LORE_LIB_PATH);
const SERVER = (process.env.LORE_TEST_REMOTE ?? "").trim();
const remoteEnabled = supported && SERVER !== "";

const DOCUMENT = "doc.json";
const BASE_TEXT = `${JSON.stringify({ id: "scene", title: "Prologue", version: 7 }, null, 2)}\n`;
const MINE_TEXT = `${JSON.stringify({ id: "scene", title: "Prologue (mine)", version: 7 }, null, 2)}\n`;
const THEIRS_TEXT = `${JSON.stringify({ id: "scene", title: "Prologue (theirs)", version: 7 }, null, 2)}\n`;
/** An answer NEITHER side wrote, which is the only thing `working-tree` can express. */
const THIRD_TEXT = `${JSON.stringify({ id: "scene", title: "Prologue (agreed)", version: 7 }, null, 2)}\n`;

const roots: string[] = [];
const held: LoreGlobals[] = [];

function tmp(prefix: string): string {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
    roots.push(root);
    return root;
}

/**
 * `storeKeepAlive` left unset deliberately: with it on, every flush waits out the
 * keep-alive window (§4.22), and this file flushes after every write verb.
 */
function offline(root: string): LoreGlobals {
    const globals: LoreGlobals = { repositoryPath: root, offline: true, identity: "spec@narraleaf", cache: true };
    held.push(globals);
    return globals;
}

function online(root: string): LoreGlobals {
    return { ...offline(root), offline: false };
}

function write(root: string, relative: string, contents: string): void {
    fs.writeFileSync(path.join(root, relative), contents, "utf-8");
}

function read(root: string, relative: string): string {
    return fs.readFileSync(path.join(root, relative), "utf-8");
}

function sha256(bytes: Buffer): string {
    return crypto.createHash("sha256").update(bytes).digest("hex");
}

async function commitAll(globals: LoreGlobals, root: string, message: string): Promise<string> {
    await stage(globals, [root]);
    const revision = await commit(globals, message);
    await flushRepository(globals);
    return revision.revision;
}

/**
 * One store, used and given straight back.
 *
 * The repository lock is exclusive and blocking WITHIN one process as well as across
 * processes (§4.28): a second `openStore` on a repository this process already holds never
 * returns. So nothing here keeps a handle across a step.
 */
async function withStore<T>(
    globals: LoreGlobals,
    root: string,
    use: (store: StoreHandle) => Promise<T>,
): Promise<T> {
    const store = await openStore(globals, root);
    try {
        return await use(store);
    } finally {
        await flushRepository(globals).catch(() => undefined);
        await closeStore(globals, store).catch(() => undefined);
        await releaseRepository(globals).catch(() => undefined);
    }
}

interface Fixture {
    root: string;
    globals: LoreGlobals;
    repositoryId: string;
    /** Tip of `main`, the branch the merge runs from. */
    mine: string;
    /** Tip of `feature`, the branch merged in. */
    theirs: string;
}

/** Two branches that changed the same key of the same document: a guaranteed conflict. */
async function twoSided(prefix: string): Promise<Fixture> {
    const root = tmp(prefix);
    const globals = offline(root);
    const created = await createRepository(globals, {
        repositoryUrl: VCS_UNCONFIGURED_REMOTE_URL,
        description: "merge spec",
    });
    write(root, DOCUMENT, BASE_TEXT);
    await commitAll(globals, root, "base");

    await createBranch(globals, "feature");
    await switchBranch(globals, { branch: "feature" });
    write(root, DOCUMENT, THEIRS_TEXT);
    const theirs = await commitAll(globals, root, "theirs");

    await switchBranch(globals, { branch: "main" });
    write(root, DOCUMENT, MINE_TEXT);
    const mine = await commitAll(globals, root, "mine");
    return { root, globals, repositoryId: created.repository, mine, theirs };
}

afterAll(async () => {
    for (const globals of held) await releaseRepository(globals).catch(() => undefined);
    for (const root of roots) {
        try {
            fs.rmSync(root, { recursive: true, force: true });
        } catch {
            // A held repository can outlive the test; a leftover temp directory is not a failure.
        }
    }
}, 180_000);

describe.skipIf(!supported)("merge state", () => {
    /**
     * The headline of the whole milestone: after a conflicted merge, Studio can say that
     * there is one and name the file - without having kept anything in memory.
     *
     * Everything else in this file depends on that being answerable from the repository
     * alone, because the author is allowed to close the window on an unfinished merge.
     */
    it("reports an open merge and names the conflicted path", async () => {
        const fixture = await twoSided("nl-merge-state-");
        expect((await readMergeState(fixture.globals, fixture.root)).inProgress).toBe(false);

        const started = await branchMergeStart(fixture.globals, { branch: "feature" });
        expect(started.conflicts).toEqual([DOCUMENT]);

        const state = await readMergeState(fixture.globals, fixture.root);
        expect(state.inProgress).toBe(true);
        expect(state.conflicts).toEqual([DOCUMENT]);
        // The incoming side, not this one - the merge is `feature` coming into `main`.
        expect(state.incoming).toBe(fixture.theirs);
    }, 120_000);

    /**
     * The state survives letting go of the repository and reading it again on fresh globals.
     *
     * As close to "the author restarted Studio" as one process can get, and it is the case
     * this whole design is for: a merge is repository state, and a Studio that could only
     * answer while it still held the operation's result would strand anyone who closed the
     * window on a conflicted sync.
     */
    it("still reports the merge after the repository has been released and reopened", async () => {
        const fixture = await twoSided("nl-merge-reopen-");
        await branchMergeStart(fixture.globals, { branch: "feature" });
        await flushRepository(fixture.globals);
        await releaseRepository(fixture.globals);

        const reopened = offline(fixture.root);
        const state = await readMergeState(reopened, fixture.root);
        expect(state.inProgress).toBe(true);
        expect(state.conflicts).toEqual([DOCUMENT]);
    }, 120_000);

    /**
     * Why the signal is a CONJUNCTION, and not the obvious single field.
     *
     * `revisionMerged` keeps its value after the merge is committed - so a check on it alone
     * would report every project that has ever merged as permanently mid-merge. Pairing it
     * with `revisionStaged`, which the commit clears, is what makes it mean something. This
     * pins both halves: the raw field is still set, and the answer built from it is not.
     */
    it("does not read a finished merge as an open one, though the backend still names the merged revision", async () => {
        const fixture = await twoSided("nl-merge-finished-");
        await branchMergeStart(fixture.globals, { branch: "feature" });
        await resolveConflicts(fixture.globals, fixture.root, [DOCUMENT], "mine");
        const merged = await commit(fixture.globals, "merged");
        await flushRepository(fixture.globals);

        // Two parents: a merge revision really is one, which is what a history rail draws.
        expect(merged.parents).toHaveLength(2);

        const header = await repositoryStatus(fixture.globals, { scan: false, revisionOnly: true });
        expect(header.revision?.revisionMerged).toBeTruthy();
        expect(header.revision?.revisionStaged).toBeUndefined();

        const state = await readMergeState(fixture.globals, fixture.root);
        expect(state.inProgress).toBe(false);
        expect(state.conflicts).toEqual([]);
        expect(state.incoming).toBeUndefined();
    }, 120_000);

    /**
     * The reason the conflicted paths are rebuilt from disk instead of read out of status.
     *
     * All four forms of the status call report an EMPTY file list during a conflicted merge:
     * the merge has already recorded its own result as the staged revision, so by the
     * backend's reckoning nothing is pending. Anything that looked for conflicts there -
     * including the three conflict flags on a file change - finds nothing, forever.
     */
    it("is invisible to every form of the status call", async () => {
        const fixture = await twoSided("nl-merge-status-");
        await branchMergeStart(fixture.globals, { branch: "feature" });

        const absolute = path.join(fixture.root, DOCUMENT);
        for (const options of [
            { scan: true },
            { scan: true, checkDirty: true },
            { scan: false },
            { scan: true, checkDirty: true, paths: [absolute] },
        ]) {
            expect((await repositoryStatus(fixture.globals, options)).files).toEqual([]);
        }

        // And the conflicted document itself is not parseable, which is why the sidecars
        // matter: the merge writes diff3 markers straight into the JSON (§4.23).
        expect(() => JSON.parse(read(fixture.root, DOCUMENT))).toThrow();
    }, 120_000);
});

describe.skipIf(!supported)("settling a merge", () => {
    /**
     * Taking one side wholesale: the working tree is overwritten, and the merge stays OPEN.
     *
     * The second half is the contract the UI is built on - settling is not committing, so an
     * author can decide one file, look at it, and decide the next. A resolve that committed
     * would make "decide one file" impossible.
     */
    it("takes theirs into the working tree without recording anything", async () => {
        const fixture = await twoSided("nl-merge-theirs-");
        await branchMergeStart(fixture.globals, { branch: "feature" });

        const result = await resolveConflicts(fixture.globals, fixture.root, [DOCUMENT], "theirs");
        expect(read(fixture.root, DOCUMENT)).toBe(THEIRS_TEXT);
        // Still open, and the path is STILL LISTED - settling leaves no readable mark, so
        // the list means "the merge left these to a human" and not "these are undecided".
        // The proof that it really was settled is the commit below, which is refused while
        // anything is not.
        expect(result.state.inProgress).toBe(true);
        expect(result.state.conflicts).toEqual([DOCUMENT]);

        await commit(fixture.globals, "took theirs");
        await flushRepository(fixture.globals);
        const closed = await readMergeState(fixture.globals, fixture.root);
        expect(closed.inProgress).toBe(false);
        expect(closed.conflicts).toEqual([]);
    }, 120_000);

    /**
     * The only observation that separates a settled path from an unsettled one - and the
     * reason `conflicts` cannot claim to be a to-do list.
     *
     * It is a WRITE, so nothing may run it to answer a question. What it buys is that D6's
     * commit cannot silently record a half-settled merge: the refusal names the path, so an
     * author who missed a file is told which one.
     */
    it("refuses to commit while a path is unsettled, and names it", async () => {
        const fixture = await twoSided("nl-merge-refuse-");
        await branchMergeStart(fixture.globals, { branch: "feature" });
        await expect(commit(fixture.globals, "unresolved"))
            .rejects.toThrow(new RegExp(`${DOCUMENT}.*conflict`, "i"));
    }, 120_000);

    /**
     * `working-tree` settles an answer NEITHER side wrote, byte for byte.
     *
     * This is the mechanism the whole per-change resolve rests on: the backend has no
     * in-memory write API, so the only way to record a merged document is to write it into
     * the working tree and say it is settled. If the bytes that come out of the revision were
     * ever anything but the bytes written in, per-change merging would be impossible and the
     * feature would have to stop at "take one side".
     */
    it("commits exactly the bytes written into the working tree", async () => {
        const fixture = await twoSided("nl-merge-working-");
        await branchMergeStart(fixture.globals, { branch: "feature" });

        write(fixture.root, DOCUMENT, THIRD_TEXT);
        const result = await resolveConflicts(fixture.globals, fixture.root, [DOCUMENT], "working-tree");
        // Unlike `mine`/`theirs`, this verb names what it settled (§4.25).
        expect(result.files).toEqual([DOCUMENT]);
        expect(read(fixture.root, DOCUMENT)).toBe(THIRD_TEXT);

        // No merge-staging step: a plain commit closes it (§4.25).
        const merged = await commit(fixture.globals, "agreed");
        await flushRepository(fixture.globals);

        const committed = await withStore(fixture.globals, fixture.root, (store) =>
            blobAt(fixture.globals, store, fixture.repositoryId, merged.revision, DOCUMENT));
        expect(sha256(committed)).toBe(sha256(Buffer.from(THIRD_TEXT, "utf-8")));
    }, 120_000);

    /**
     * Undoing a choice really does undo it.
     *
     * Asserted through the commit refusal rather than through the state, because the state
     * cannot see it: `conflicts` lists the path both before and after. The commit is the
     * only thing that distinguishes them, and here it is used as an oracle - the merge is
     * abandoned rather than completed, so nothing is recorded either way.
     */
    it("unresolves a settled path", async () => {
        const fixture = await twoSided("nl-merge-unresolve-");
        await branchMergeStart(fixture.globals, { branch: "feature" });
        await resolveConflicts(fixture.globals, fixture.root, [DOCUMENT], "mine");

        const undone = await unresolveConflicts(fixture.globals, fixture.root, [DOCUMENT]);
        expect(undone.state.inProgress).toBe(true);
        expect(undone.state.conflicts).toEqual([DOCUMENT]);
        await expect(commit(fixture.globals, "should be refused"))
            .rejects.toThrow(new RegExp(`${DOCUMENT}.*conflict`, "i"));
    }, 120_000);

    /**
     * Restarting throws the working-tree bytes away and merges the path again.
     *
     * The difference from unresolving, and the only way back from a merge result the author
     * edited into something they no longer want: the markers come back.
     */
    it("re-merges a path, discarding what was in the working tree", async () => {
        const fixture = await twoSided("nl-merge-restart-");
        await branchMergeStart(fixture.globals, { branch: "feature" });
        write(fixture.root, DOCUMENT, THIRD_TEXT);

        const state = await restartConflicts(fixture.globals, fixture.root, [DOCUMENT]);
        expect(state.inProgress).toBe(true);
        expect(read(fixture.root, DOCUMENT)).not.toBe(THIRD_TEXT);
        expect(read(fixture.root, DOCUMENT)).toContain("<<<<<<<");
    }, 120_000);

    /**
     * Abandoning is a COMPLETE rollback - the measurement that lets "cancel" exist at all.
     *
     * Not just the conflicted file: the whole working tree goes back to what it was, the
     * merge's own leftovers are removed, and the repository stops reporting a merge.
     */
    it("abandons a merge and leaves the working tree as it was", async () => {
        const fixture = await twoSided("nl-merge-abort-");
        const before = read(fixture.root, DOCUMENT);
        expect(before).toBe(MINE_TEXT);

        await branchMergeStart(fixture.globals, { branch: "feature" });
        expect((await readMergeState(fixture.globals, fixture.root)).inProgress).toBe(true);

        const state = await abortMerge(fixture.globals, fixture.root);
        expect(state.inProgress).toBe(false);
        expect(state.conflicts).toEqual([]);
        expect(read(fixture.root, DOCUMENT)).toBe(before);
        // The three sides the merge dropped next to the file are gone too.
        expect(fs.readdirSync(fixture.root).filter((name) => name.includes("~"))).toEqual([]);
    }, 120_000);
});

describe.skipIf(!remoteEnabled)("a conflicted sync", () => {
    /** Unique per run: the server keeps repositories by name, so a fixed one collides. */
    function serverUrl(name: string): string {
        return `${SERVER}/${name}-${Date.now().toString(36)}`;
    }

    /**
     * The defect this milestone was written to fix, stated as a requirement.
     *
     * A sync whose automerge could not settle a file must NAME that file. The old code
     * filtered the per-file sync events on conflict flags that the decoder writes as `false`
     * unconditionally - those events have no such fields - so the filter could never match
     * and every conflicted sync degraded to the `["*"]` placeholder. An author cannot resolve
     * `*`, and no UI can draw it.
     *
     * The fixture commits through OFFLINE globals, exactly as `VcsManager` does. Committing
     * online here would be the §4.29 trap: the process that writes such a revision cannot
     * read its new content back, and the failure would look like a defect in this feature.
     */
    it("names the conflicting paths instead of answering with a placeholder", async () => {
        const authorRoot = tmp("nl-merge-sync-author-");
        const authorGlobals = offline(authorRoot);
        const created = await createRepository(authorGlobals, {
            repositoryUrl: VCS_UNCONFIGURED_REMOTE_URL,
            description: "merge spec",
        });
        write(authorRoot, DOCUMENT, BASE_TEXT);
        await commitAll(authorGlobals, authorRoot, "base");

        const url = serverUrl("merge-conflict");
        await writeRemote(authorRoot, url);
        await publishToRemote(online(authorRoot), { url, repositoryId: created.repository });
        await pushToRemote(online(authorRoot));
        await releaseRepository(online(authorRoot));

        // A second machine edits the same document and pushes.
        const cloneRoot = path.join(tmp("nl-merge-sync-clone-"), "project");
        await cloneInto(online(cloneRoot), { repositoryUrl: url });
        write(cloneRoot, DOCUMENT, THEIRS_TEXT);
        await commitAll(offline(cloneRoot), cloneRoot, "theirs");
        await pushToRemote(online(cloneRoot));
        await releaseRepository(online(cloneRoot));

        // The author edits the SAME document without syncing first, so the two diverge on
        // the one file. Their push is refused with the sentence that names the remedy.
        write(authorRoot, DOCUMENT, MINE_TEXT);
        await commitAll(authorGlobals, authorRoot, "mine");
        await expect(pushToRemote(online(authorRoot))).rejects.toThrow(/diverged/i);

        const synced = await syncFromRemote(online(authorRoot));
        expect(synced.conflicts).toEqual([DOCUMENT]);
        expect(synced.conflicts).not.toContain("*");

        // And the sync leaves the same open merge a local one does - one mechanism, not two.
        const state = await readMergeState(authorGlobals, authorRoot);
        expect(state.inProgress).toBe(true);
        expect(state.conflicts).toEqual([DOCUMENT]);

        await releaseRepository(authorGlobals);
    }, 300_000);
});
