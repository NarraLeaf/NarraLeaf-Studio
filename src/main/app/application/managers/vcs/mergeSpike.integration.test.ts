import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";
import { VCS_UNCONFIGURED_REMOTE_URL, isVcsPlatformSupported } from "@shared/types/vcs";
import {
    branchMergeAbort,
    branchMergeResolve,
    branchMergeResolveMine,
    branchMergeResolveTheirs,
    branchMergeStart,
    closeStore,
    commit,
    createBranch,
    createRepository,
    flushRepository,
    listBranches,
    openStore,
    releaseRepository,
    repositoryStatus,
    stage,
    stageMerge,
    switchBranch,
    syncRevision,
    type LoreGlobals,
    type LoreStatusFilePayload,
    type StoreHandle,
} from "./lore";
import { blobAt, readRevisionGraph, threeWay } from "./revisionReader";
import { cloneInto, publishToRemote, pushToRemote, writeRemote } from "./remote";

/**
 * D0 of docs/plans/2026-07-31-004: the measurement harness for five unknown Lore
 * behaviours.
 *
 * **This file is a probe, not a spec.** Every other integration test in this directory
 * asserts a behaviour that was measured first and written down second. Here nothing has
 * been measured yet: §1.6 of the plan lists five questions whose answers change the
 * design, and an `expect(...)` about any of them would be a guess wearing the costume of
 * a test. So each experiment collects observations into a plain object and PRINTS it.
 * The only assertions are liveness ones - the experiment ran and produced something.
 *
 * Reading the output is the deliverable. Nothing here decides anything.
 *
 * ```bash
 * # local experiments (E1-E5): the native library is enough
 * npx vitest run src/main/app/application/managers/vcs/mergeSpike.integration.test.ts
 *
 * # E6 as well: loreserver 0.8.5, the version Studio pins
 * LORE_TEST_REMOTE="lore://127.0.0.1:41337" npx vitest run \
 *   src/main/app/application/managers/vcs/mergeSpike.integration.test.ts
 * ```
 *
 * The fixture is a canonically serialized JSON document shaped like Studio's own -
 * sorted keys, two-space indent, trailing newline, nested objects and arrays. A
 * `hello.txt` would answer a question nobody asked: what matters is what an automerge
 * does to the exact byte shape `DocumentSpec.serialize` produces, because that shape is
 * what `loadDocument` has to be able to parse back.
 */

const supported = isVcsPlatformSupported() || Boolean(process.env.LORE_LIB_PATH);
const SERVER = (process.env.LORE_TEST_REMOTE ?? "").trim();
const remoteEnabled = supported && SERVER !== "";

/** The one document every experiment merges, relative to the repository root. */
const DOCUMENT = "doc.json";

// -- fixture content --------------------------------------------------------

interface SpikeDocument {
    blocks: { id: string; speaker: string; text: string }[];
    characters: Record<string, { color: string; displayName: string }>;
    id: string;
    kind: string;
    notes: string;
    tags: string[];
    title: string;
    updatedAt: string;
    variables: Record<string, number | boolean>;
    version: number;
}

const BASE_DOCUMENT: SpikeDocument = {
    blocks: [
        { id: "b-001", speaker: "alice", text: "The lamps were still lit when we arrived." },
        { id: "b-002", speaker: "bob", text: "Nobody had thought to put them out." },
        { id: "b-003", speaker: "alice", text: "Nobody ever does." },
    ],
    characters: {
        alice: { color: "#c0ffee", displayName: "Alice" },
        bob: { color: "#facade", displayName: "Bob" },
    },
    id: "scene-prologue",
    kind: "story",
    notes: "",
    tags: ["opening", "tutorial"],
    title: "Prologue",
    updatedAt: "2026-07-31T00:00:00.000Z",
    variables: { affection: 0, metBob: false },
    version: 7,
};

/**
 * Serialize the way a `DocumentSpec` does: keys sorted at every level, two-space indent,
 * one trailing newline.
 *
 * The sort is what makes two independently written documents differ only where their
 * content differs, and it is also what puts the two keys E1a edits far apart in the text
 * - which is the whole point of the non-adjacent case.
 */
function canonical(document: unknown): string {
    return `${JSON.stringify(sortDeep(document), null, 2)}\n`;
}

function sortDeep(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortDeep);
    if (value && typeof value === "object") {
        const source = value as Record<string, unknown>;
        return Object.fromEntries(Object.keys(source).sort().map((key) => [key, sortDeep(source[key])]));
    }
    return value;
}

function edited(mutate: (document: SpikeDocument) => void): string {
    const clone = JSON.parse(JSON.stringify(BASE_DOCUMENT)) as SpikeDocument;
    mutate(clone);
    return canonical(clone);
}

const BASE_TEXT = canonical(BASE_DOCUMENT);

/** E1a: two keys the sort puts near opposite ends of the file. */
const EARLY_KEY_EDIT = edited((document) => { document.characters.alice.displayName = "Alicia"; });
const LATE_KEY_EDIT = edited((document) => { document.version = 8; });

/** E1b, E5, E6: both sides on the same key, which is the case that must conflict. */
const SAME_KEY_MINE = edited((document) => { document.title = "Prologue (main)"; });
const SAME_KEY_THEIRS = edited((document) => { document.title = "Prologue (feature)"; });

/** E3, E6: an answer neither side wrote, which is what a per-change resolution produces. */
const HAND_RESOLVED = edited((document) => { document.title = "Prologue (resolved by hand)"; });

// -- reporting --------------------------------------------------------------

/** The deliverable. Everything else in this file exists to fill the object handed here. */
function report(name: string, observations: unknown): void {
    console.log(`\n### ${name}\n${JSON.stringify(observations, null, 2)}`);
}

/**
 * A failure, rendered with everything Lore said about it.
 *
 * `LoreCallError` carries the backend's own message plus a Rust `file:line` trace, and
 * for a verb nobody has called before those are the observation - "it threw" is not.
 */
function errorText(error: unknown): string {
    if (!(error instanceof Error)) return String(error);
    const call = error as Error & { errorCode?: number; trace?: readonly string[] };
    const extra = [
        call.errorCode === undefined ? "" : `code=${call.errorCode}`,
        call.trace?.length ? `at ${call.trace.join(" | ")}` : "",
    ].filter(Boolean).join(" ");
    return extra ? `${error.name}: ${error.message} (${extra})` : `${error.name}: ${error.message}`;
}

interface Failure { error: string }

/**
 * Run one step and turn a failure into an observation.
 *
 * An experiment that throws still has to print what it learned before the throw, so no
 * step is allowed to unwind the `it`. The caller decides whether a failed step ends the
 * experiment or is itself the finding.
 */
async function observe<T>(run: () => Promise<T>): Promise<T | Failure> {
    try {
        return await run();
    } catch (error) {
        return { error: errorText(error) };
    }
}

function failed<T>(result: T | Failure): result is Failure {
    return Boolean(result) && typeof result === "object" && "error" in (result as object);
}

// -- repositories -----------------------------------------------------------

interface Spike { root: string; globals: LoreGlobals; store?: StoreHandle }

const roots: string[] = [];
const sessions: Spike[] = [];

function tmp(prefix: string): string {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
    roots.push(root);
    return root;
}

/**
 * Offline globals, matching the rest of Studio's read and write paths.
 *
 * `storeKeepAlive` is deliberately left unset: with it on, every `repositoryFlush` waits
 * out the keep-alive window (§4.22, measured at ~10 s) and these experiments flush a
 * great many times.
 */
function offline(root: string): LoreGlobals {
    return { repositoryPath: root, offline: true, identity: "spike@narraleaf", cache: true };
}

function online(root: string): LoreGlobals {
    return { ...offline(root), offline: false };
}

/** Register a session so the teardown can flush, close and release it. */
function track(spike: Spike): Spike {
    sessions.push(spike);
    return spike;
}

afterAll(async () => {
    for (const spike of sessions) {
        // flush -> closeStore -> release, in that order (§4.15/§4.19). Releasing without
        // flushing leaves the directory undeletable on Windows even when nothing was
        // committed, and closing the store alone does not release the repository lock.
        await flushRepository(spike.globals).catch(() => undefined);
        if (spike.store) await closeStore(spike.globals, spike.store).catch(() => undefined);
        await releaseRepository(spike.globals).catch(() => undefined);
    }
    for (const root of roots) {
        try {
            fs.rmSync(root, { recursive: true, force: true });
        } catch {
            // A leftover temp directory is not an experimental result.
        }
    }
}, 120_000);

function write(root: string, relative: string, contents: string): string {
    const absolute = path.join(root, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, contents, "utf-8");
    return absolute;
}

async function commitAll(globals: LoreGlobals, root: string, message: string): Promise<string> {
    await stage(globals, [root]);
    const revision = await commit(globals, message);
    // Not optional: an unflushed commit can be missing from the next session entirely,
    // and it is a race rather than a stable failure (§4.11).
    await flushRepository(globals);
    return revision.revision;
}

interface TwoSided {
    root: string;
    globals: LoreGlobals;
    /** The teardown's handle on this repository, so a later experiment can attach its store to it. */
    spike: Spike;
    repositoryId: string;
    /** Absolute, because that is the direction every write-side Lore call wants (§4.16). */
    document: string;
    baseRevision?: string;
    /** Tip of `main`, the side the merge runs from. */
    mineRevision?: string;
    /** Tip of `feature`, the side being merged in. */
    theirsRevision?: string;
    branches: string[];
    setupError?: string;
}

/**
 * One repository with two divergent branches, both having touched `doc.json`.
 *
 * Everything is caught and recorded rather than thrown: the branch verbs are the only
 * ones here Studio has never driven in anger, so a setup failure is itself a result and
 * has to reach the printed output instead of aborting the experiment.
 */
async function twoSidedRepository(prefix: string, mine: string, theirs: string): Promise<TwoSided> {
    const root = tmp(prefix);
    const globals = offline(root);
    const spike = track({ root, globals });
    const fixture: TwoSided = {
        root,
        globals,
        spike,
        repositoryId: "",
        document: path.join(root, DOCUMENT),
        branches: [],
    };

    try {
        const created = await createRepository(globals, {
            repositoryUrl: VCS_UNCONFIGURED_REMOTE_URL,
            description: "merge spike",
        });
        fixture.repositoryId = created.repository;

        write(root, DOCUMENT, BASE_TEXT);
        fixture.baseRevision = await commitAll(globals, root, "base");

        // Create then switch explicitly. Whether `branch_create` also switches is not
        // established, and a switch onto the branch we are already on is harmless either
        // way - guessing wrong in the other direction would commit both sides to `main`.
        await createBranch(globals, "feature");
        await switchBranch(globals, { branch: "feature" });
        write(root, DOCUMENT, theirs);
        fixture.theirsRevision = await commitAll(globals, root, "theirs");

        await switchBranch(globals, { branch: "main" });
        write(root, DOCUMENT, mine);
        fixture.mineRevision = await commitAll(globals, root, "mine");

        fixture.branches = (await listBranches(globals))
            .map((branch) => `${branch.name}${branch.isCurrent ? " (current)" : ""}`);
    } catch (error) {
        fixture.setupError = errorText(error);
    }

    return fixture;
}

// -- observation helpers ----------------------------------------------------

function sha256(bytes: Buffer): string {
    return crypto.createHash("sha256").update(bytes).digest("hex");
}

/**
 * The working tree copy of a document, described without interpreting it.
 *
 * `text` is printed verbatim and in full. It is small, and it is the single most
 * important observation of D0 - a summary of it would be exactly the guess this file
 * exists to avoid.
 */
function readWorkingCopy(absolute: string, needles: Readonly<Record<string, string>>) {
    if (!fs.existsSync(absolute)) return { exists: false };

    const bytes = fs.readFileSync(absolute);
    const text = bytes.toString("utf-8");

    let parsed = false;
    let parseError: string | undefined;
    try {
        JSON.parse(text);
        parsed = true;
    } catch (error) {
        parseError = String(error);
    }

    const contains: Record<string, boolean> = {};
    for (const [name, needle] of Object.entries(needles)) contains[name] = text.includes(needle);

    return {
        exists: true,
        byteLength: bytes.byteLength,
        sha256: sha256(bytes),
        parsed,
        parseError,
        conflictMarkers: {
            open: text.includes("<<<<<<<"),
            divider: text.includes("======="),
            close: text.includes(">>>>>>>"),
        },
        contains,
        text,
    };
}

/** The strings that say whether a side's edit survived into a merged file. */
const SAME_KEY_NEEDLES = {
    mineTitle: "Prologue (main)",
    theirsTitle: "Prologue (feature)",
    baseTitle: '"title": "Prologue"',
} as const;

const NON_ADJACENT_NEEDLES = {
    theirsDisplayName: '"displayName": "Alicia"',
    mineVersion: '"version": 8',
    baseDisplayName: '"displayName": "Alice"',
    baseVersion: '"version": 7',
} as const;

/**
 * All EIGHT of Lore's per-file conflict flags for one path.
 *
 * Three of them (`conflictAutomerged` / `conflictMine` / `conflictTheirs`) were being
 * decoded and discarded until this card; nothing has ever seen what they hold on a real
 * conflict, which is why they are reported raw here rather than folded into a verdict.
 */
function statusFlags(files: readonly LoreStatusFilePayload[], relative: string) {
    return files
        .filter((file) => file.path.replace(/\\/g, "/").endsWith(relative))
        .map((file) => ({
            path: file.path,
            action: file.action,
            type: file.type,
            staged: file.staged,
            merged: file.merged,
            conflict: file.conflict,
            conflictUnresolved: file.conflictUnresolved,
            conflictAutomerged: file.conflictAutomerged,
            conflictMine: file.conflictMine,
            conflictTheirs: file.conflictTheirs,
            dirty: file.dirty,
        }));
}

/**
 * Every working-tree file by content hash, `.lore/` excluded.
 *
 * `.lore/` is the repository's own state, which a merge is SUPPOSED to change; including
 * it would make the E5 comparison fail for the one reason that proves nothing.
 */
function manifest(root: string): Record<string, string> {
    const out: Record<string, string> = {};
    const walk = (directory: string, prefix: string): void => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            if (entry.name === ".lore") continue;
            const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
            const absolute = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                walk(absolute, relative);
                continue;
            }
            out[relative] = sha256(fs.readFileSync(absolute));
        }
    };
    walk(root, "");
    return out;
}

function manifestDifference(before: Record<string, string>, after: Record<string, string>): string[] {
    const paths = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...paths].filter((candidate) => before[candidate] !== after[candidate]).sort();
}

// ===========================================================================
// E1 - what does Lore's automerge do to canonical JSON?
// ===========================================================================

/**
 * Runs one branch merge and describes what it left on disk.
 *
 * Shared by the two E1 cases and by E5, because "what is in the working tree and what do
 * the eight flags say" is the same question in all of them; only the setup differs.
 */
async function describeMerge(
    fixture: TwoSided,
    needles: Readonly<Record<string, string>>,
): Promise<Record<string, unknown>> {
    const observations: Record<string, unknown> = {};

    const started = await observe(() => branchMergeStart(fixture.globals, { branch: "feature" }));
    observations.mergeStart = started;

    observations.workingCopy = readWorkingCopy(fixture.document, needles);

    // `scan: true` on purpose, even though a scan is not a pure read (§4.17): the
    // per-file conflict flags only exist on the scanning form, and this repository is
    // thrown away afterwards, so the state it writes cannot outlive the experiment.
    const status = await observe(() => repositoryStatus(fixture.globals, { scan: true }));
    observations.status = failed(status)
        ? status
        : {
            revision: status.revision?.revision,
            revisionNumber: status.revision?.revisionNumber,
            revisionStaged: status.revision?.revisionStaged,
            revisionMerged: status.revision?.revisionMerged,
            branch: status.revision?.branchName,
            summary: status.summary,
            document: statusFlags(status.files, DOCUMENT),
            otherFiles: status.files
                .filter((file) => !file.path.replace(/\\/g, "/").endsWith(DOCUMENT))
                .map((file) => file.path),
        };

    return observations;
}

describe.skipIf(!supported)("E1a - automerge, non-adjacent keys", () => {
    it("reports what a two-key merge leaves in the working tree", async () => {
        const observations: Record<string, unknown> = {};
        const fixture = await twoSidedRepository("nl-merge-e1a-", LATE_KEY_EDIT, EARLY_KEY_EDIT);
        observations.setup = {
            setupError: fixture.setupError,
            branches: fixture.branches,
            baseRevision: fixture.baseRevision,
            mineRevision: fixture.mineRevision,
            theirsRevision: fixture.theirsRevision,
            mineEdited: "version: 7 -> 8 (last key in sorted order)",
            theirsEdited: "characters.alice.displayName: Alice -> Alicia (near the top)",
        };

        if (!fixture.setupError) {
            Object.assign(observations, await describeMerge(fixture, NON_ADJACENT_NEEDLES));
        }

        report("E1a NON-ADJACENT KEYS", observations);
        expect(Object.keys(observations).length).toBeGreaterThan(0);
    }, 240_000);
});

/**
 * The conflicted fixture E2, E3 and E4 all read from.
 *
 * Built by E1b and shared rather than rebuilt, because E2 (whose bytes are on disk), E3
 * (does a hand-written resolution stick) and E4 (does the resulting revision have two
 * parents) are three questions about ONE merge - rebuilding it three times would let them
 * disagree. Each of them reports `skipped` if the step before it left nothing, so a
 * failure early in the chain costs the later output but not the earlier.
 */
let conflicted: TwoSided | null = null;
/** The revision E3's commit produced, which is E4's subject. */
let resolvedRevision: string | null = null;
/** A session re-opened after E3 released the repository; E4 reads the graph through it. */
let reopened: Spike | null = null;

describe.skipIf(!supported)("E1b - automerge, same key", () => {
    it("reports what a same-key merge leaves in the working tree", async () => {
        const observations: Record<string, unknown> = {};
        const fixture = await twoSidedRepository("nl-merge-e1b-", SAME_KEY_MINE, SAME_KEY_THEIRS);
        // Published before the merge is attempted, so that a merge failure still leaves
        // the later experiments a repository to probe.
        conflicted = fixture;

        observations.setup = {
            setupError: fixture.setupError,
            branches: fixture.branches,
            baseRevision: fixture.baseRevision,
            mineRevision: fixture.mineRevision,
            theirsRevision: fixture.theirsRevision,
            bothEdited: "title",
        };

        if (!fixture.setupError) {
            Object.assign(observations, await describeMerge(fixture, SAME_KEY_NEEDLES));
        }

        report("E1b SAME KEY", observations);
        expect(Object.keys(observations).length).toBeGreaterThan(0);
    }, 240_000);
});

// ===========================================================================
// E2 - on a conflict, whose bytes are in the working tree?
// ===========================================================================

describe.skipIf(!supported)("E2 - conflicted working-tree bytes", () => {
    it("compares the working tree against base, mine and theirs", async () => {
        const observations: Record<string, unknown> = {};
        const fixture = conflicted;
        if (!fixture || fixture.setupError || !fixture.mineRevision || !fixture.theirsRevision) {
            report("E2 WHOSE BYTES", { skipped: "E1b left no conflicted repository", setup: fixture?.setupError });
            expect(true).toBe(true);
            return;
        }

        const store = await observe(() => openStore(fixture.globals, fixture.root));
        if (failed(store)) {
            report("E2 WHOSE BYTES", { openStore: store });
            expect(true).toBe(true);
            return;
        }
        // Attached to the session the teardown already knows about rather than closed
        // here: E3 keeps writing to this repository, and closing the store is not what
        // releases it anyway (§4.15).
        fixture.spike.store = store;

        // threeWay does the merge-base walk and all three reads; reimplementing it here
        // would be measuring a second implementation rather than Lore.
        const sides = await observe(() => threeWay(
            fixture.globals,
            store,
            fixture.repositoryId,
            fixture.mineRevision as string,
            fixture.theirsRevision as string,
            DOCUMENT,
        ));

        const working = fs.existsSync(fixture.document) ? fs.readFileSync(fixture.document) : null;
        const workingHash = working ? sha256(working) : null;
        observations.workingTree = { exists: Boolean(working), byteLength: working?.byteLength ?? 0, sha256: workingHash };

        if (failed(sides)) {
            observations.threeWay = sides;
        } else {
            const digests = {
                base: sides.base ? sha256(sides.base) : null,
                mine: sha256(sides.mine),
                theirs: sha256(sides.theirs),
            };
            observations.threeWay = {
                baseRevision: sides.baseRevision,
                baseAbsent: sides.base === undefined,
                byteLengths: {
                    base: sides.base?.byteLength ?? null,
                    mine: sides.mine.byteLength,
                    theirs: sides.theirs.byteLength,
                },
                sha256: digests,
            };
            observations.workingTreeEquals = Object.entries(digests)
                .filter(([, digest]) => digest !== null && digest === workingHash)
                .map(([side]) => side);
        }

        // A second, independent read of one side, so that a surprising threeWay result can
        // be told apart from a surprising blobAt result.
        observations.blobAtMine = await observe(async () => {
            const bytes = await blobAt(fixture.globals, store, fixture.repositoryId, fixture.mineRevision as string, DOCUMENT);
            return { byteLength: bytes.byteLength, sha256: sha256(bytes) };
        });

        report("E2 WHOSE BYTES", observations);
        expect(Object.keys(observations).length).toBeGreaterThan(0);
    }, 240_000);
});

// ===========================================================================
// E3 - does branchMergeResolve accept bytes we wrote?
// ===========================================================================

describe.skipIf(!supported)("E3 - resolving with hand-written bytes", () => {
    it("writes a third answer, resolves, commits, and reads it back from a fresh session", async () => {
        const observations: Record<string, unknown> = {};
        const fixture = conflicted;
        if (!fixture || fixture.setupError) {
            report("E3 HAND-WRITTEN RESOLUTION", { skipped: "E1b left no conflicted repository" });
            expect(true).toBe(true);
            return;
        }

        // Neither side wrote this. If it survives the round trip, per-change merging is
        // possible at all; if it does not, D6 can only ever offer "take one side".
        fs.writeFileSync(fixture.document, HAND_RESOLVED, "utf-8");
        observations.wrote = { sha256: sha256(Buffer.from(HAND_RESOLVED, "utf-8")), byteLength: Buffer.byteLength(HAND_RESOLVED) };

        observations.resolve = await observe(() => branchMergeResolve(fixture.globals, [fixture.document]));

        // The plan's §4.4 pipeline, minus the metadata write: confirm there is something
        // to commit with the pure-read status form (§4.17), commit, flush (§4.11).
        const confirm = await observe(() => repositoryStatus(fixture.globals, { scan: false, revisionOnly: true }));
        observations.beforeCommit = failed(confirm) ? confirm : {
            revision: confirm.revision?.revision,
            revisionNumber: confirm.revision?.revisionNumber,
            revisionStaged: confirm.revision?.revisionStaged,
            revisionMerged: confirm.revision?.revisionMerged,
        };

        // Deliberately WITHOUT fileStageMerge first. Whether a merge commit needs its own
        // staging step is unknown, and which of the two attempts works is the finding.
        const firstCommit = await observe(() => commit(fixture.globals, "resolved by hand"));
        observations.commitWithoutStageMerge = failed(firstCommit)
            ? firstCommit
            : { revision: firstCommit.revision, revisionNumber: firstCommit.revisionNumber, parents: firstCommit.parents };

        let committed = failed(firstCommit) ? null : firstCommit;
        if (failed(firstCommit)) {
            observations.stageMerge = await observe(() => stageMerge(fixture.globals, [fixture.document]));
            const retry = await observe(() => commit(fixture.globals, "resolved by hand"));
            observations.commitAfterStageMerge = failed(retry)
                ? retry
                : { revision: retry.revision, revisionNumber: retry.revisionNumber, parents: retry.parents };
            committed = failed(retry) ? null : retry;
        }

        observations.flush = await observe(async () => {
            await flushRepository(fixture.globals);
            return "flushed";
        });
        observations.release = await observe(async () => {
            await releaseRepository(fixture.globals);
            return "released";
        });

        if (!committed) {
            report("E3 HAND-WRITTEN RESOLUTION", observations);
            expect(Object.keys(observations).length).toBeGreaterThan(0);
            return;
        }
        resolvedRevision = committed.revision;

        // A fresh session against the same directory - a new process is what §4.11's
        // measurement needed and is out of reach here, but re-opening after a release is
        // what a reader of this revision will actually do next.
        const freshGlobals = offline(fixture.root);
        const store = await observe(() => openStore(freshGlobals, fixture.root));
        if (failed(store)) {
            observations.reopen = store;
        } else {
            reopened = track({ root: fixture.root, globals: freshGlobals, store });
            observations.readBack = await observe(async () => {
                const bytes = await blobAt(freshGlobals, store, fixture.repositoryId, committed.revision, DOCUMENT);
                return {
                    byteLength: bytes.byteLength,
                    sha256: sha256(bytes),
                    identicalToWhatWeWrote: bytes.equals(Buffer.from(HAND_RESOLVED, "utf-8")),
                    text: bytes.toString("utf-8"),
                };
            });
        }

        report("E3 HAND-WRITTEN RESOLUTION", observations);
        expect(Object.keys(observations).length).toBeGreaterThan(0);
    }, 240_000);
});

// ===========================================================================
// E4 - does a merge revision have two parents?
// ===========================================================================

describe.skipIf(!supported)("E4 - merge revision parents", () => {
    it("reads the graph around the revision E3 committed", async () => {
        const observations: Record<string, unknown> = {};
        const fixture = conflicted;
        if (!fixture || !resolvedRevision) {
            report("E4 MERGE PARENTS", { skipped: "E3 committed no revision" });
            expect(true).toBe(true);
            return;
        }

        const globals = reopened?.globals ?? fixture.globals;
        const graph = await observe(() => readRevisionGraph(globals));
        if (failed(graph)) {
            report("E4 MERGE PARENTS", { readRevisionGraph: graph });
            expect(true).toBe(true);
            return;
        }

        const node = graph.get(resolvedRevision);
        observations.revision = resolvedRevision;
        observations.foundInGraph = Boolean(node);
        observations.parentCount = node?.parents.length ?? null;
        observations.parents = node?.parents ?? null;
        observations.preMergeTips = { mine: fixture.mineRevision, theirs: fixture.theirsRevision };
        observations.parentsIncludeMine = Boolean(fixture.mineRevision && node?.parents.includes(fixture.mineRevision));
        observations.parentsIncludeTheirs = Boolean(fixture.theirsRevision && node?.parents.includes(fixture.theirsRevision));
        // The whole DAG, so a parent that is neither tip can be placed rather than guessed at.
        observations.graph = [...graph.values()]
            .sort((a, b) => a.number - b.number)
            .map((entry) => ({ number: entry.number, revision: entry.revision, parents: entry.parents }));

        report("E4 MERGE PARENTS", observations);
        expect(Object.keys(observations).length).toBeGreaterThan(0);
    }, 120_000);
});

// ===========================================================================
// E5 - does branchMergeAbort fully roll the working tree back?
// ===========================================================================

describe.skipIf(!supported)("E5 - aborting a merge", () => {
    it("hashes the whole working tree before the merge, after it, and after the abort", async () => {
        const observations: Record<string, unknown> = {};
        const fixture = await twoSidedRepository("nl-merge-e5-", SAME_KEY_MINE, SAME_KEY_THEIRS);
        observations.setup = {
            setupError: fixture.setupError,
            branches: fixture.branches,
            mineRevision: fixture.mineRevision,
            theirsRevision: fixture.theirsRevision,
        };

        if (fixture.setupError) {
            report("E5 ABORT ROLLBACK", observations);
            expect(Object.keys(observations).length).toBeGreaterThan(0);
            return;
        }

        const before = manifest(fixture.root);
        observations.beforeMerge = before;
        const statusBefore = await observe(() => repositoryStatus(fixture.globals, { scan: true }));
        observations.statusBeforeMerge = failed(statusBefore)
            ? statusBefore
            : { summary: statusBefore.summary, document: statusFlags(statusBefore.files, DOCUMENT) };

        observations.mergeStart = await observe(() => branchMergeStart(fixture.globals, { branch: "feature" }));
        const during = manifest(fixture.root);
        observations.afterMerge = during;
        observations.mergeChangedPaths = manifestDifference(before, during);

        observations.abort = await observe(() => branchMergeAbort(fixture.globals));
        const after = manifest(fixture.root);
        observations.afterAbort = after;

        // The question the "cancel merge" button depends on. Reported as the set of paths
        // that differ rather than as a verdict, because a rollback that misses one file is
        // a different problem from one that misses all of them.
        observations.differsFromBeforeMerge = manifestDifference(before, after);
        observations.fullyRolledBack = manifestDifference(before, after).length === 0;

        const statusAfter = await observe(() => repositoryStatus(fixture.globals, { scan: true }));
        observations.statusAfterAbort = failed(statusAfter)
            ? statusAfter
            : {
                revision: statusAfter.revision?.revision,
                revisionMerged: statusAfter.revision?.revisionMerged,
                summary: statusAfter.summary,
                document: statusFlags(statusAfter.files, DOCUMENT),
            };

        report("E5 ABORT ROLLBACK", observations);
        expect(Object.keys(observations).length).toBeGreaterThan(0);
    }, 240_000);
});

// ===========================================================================
// E6 - a conflict arriving through revisionSync from a real server
// ===========================================================================

/** Unique per run: the server keeps repositories by name, so a fixed one collides on re-run. */
function serverUrl(name: string): string {
    return `${SERVER}/${name}-${Date.now().toString(36)}`;
}

describe.skipIf(!remoteEnabled)("E6 - conflict through revisionSync", () => {
    /**
     * The path Studio will actually hit (plan §4.1), and the one §7 of the plan does not
     * cover: a merge nobody started with `branchMergeStart`.
     *
     * Whether Lore considers a sync-induced merge the same kind of in-progress merge -
     * whether the resolve verbs even apply to it - decides whether D6 has one resolution
     * pipeline or two.
     */
    it("reports what a diverged sync leaves behind, and whether the resolve verbs apply to it", async () => {
        const observations: Record<string, unknown> = {};

        const authorRoot = tmp("nl-merge-e6-author-");
        const authorGlobals = offline(authorRoot);
        const authorOnline = online(authorRoot);
        track({ root: authorRoot, globals: authorOnline });
        const document = path.join(authorRoot, DOCUMENT);
        const url = serverUrl("syncconflict");
        observations.server = url;

        const setup = await observe(async () => {
            const created = await createRepository(authorGlobals, {
                repositoryUrl: VCS_UNCONFIGURED_REMOTE_URL,
                description: "merge spike (remote)",
            });
            write(authorRoot, DOCUMENT, BASE_TEXT);
            const base = await commitAll(authorGlobals, authorRoot, "base");
            // Both halves of connecting: the address alone leaves a project that pushes
            // and cannot be cloned (docs §5.3.1), and this experiment needs the clone.
            await writeRemote(authorRoot, url);
            await publishToRemote(authorOnline, { url, repositoryId: created.repository });
            await pushToRemote(authorOnline);
            await releaseRepository(authorOnline);
            return { repositoryId: created.repository, baseRevision: base };
        });
        observations.setup = setup;
        if (failed(setup)) {
            report("E6 SYNC CONFLICT", observations);
            expect(Object.keys(observations).length).toBeGreaterThan(0);
            return;
        }

        const cloneRoot = path.join(tmp("nl-merge-e6-clonebase-"), "project");
        const cloneOnline = online(cloneRoot);
        track({ root: cloneRoot, globals: cloneOnline });
        observations.clone = await observe(async () => {
            const cloned = await cloneInto(cloneOnline, { repositoryUrl: url });
            write(cloneRoot, DOCUMENT, SAME_KEY_THEIRS);
            const revision = await commitAll(cloneOnline, cloneRoot, "theirs, from the clone");
            await pushToRemote(cloneOnline);
            await releaseRepository(cloneOnline);
            return { branch: cloned.branch, revision };
        });

        // The author edits the SAME key without syncing: now both sides have moved.
        observations.author = await observe(async () => {
            write(authorRoot, DOCUMENT, SAME_KEY_MINE);
            return { revision: await commitAll(authorOnline, authorRoot, "mine, from the author") };
        });

        // `syncRevision` rather than `syncFromRemote`: the latter is a thin derivation over
        // exactly this call (remote.ts) and it discards the two counters this experiment is
        // about, `fileAutomerge` and `fileConflict`.
        const synced = await observe(() => syncRevision(authorOnline));
        observations.sync = failed(synced) ? synced : {
            target: synced.target && {
                branchName: synced.target.branchName,
                sourceRevision: synced.target.sourceRevision,
                targetRevision: synced.target.targetRevision,
                local: synced.target.local,
            },
            progress: synced.progress,
            revisions: synced.revisions,
            files: synced.files.map((file) => ({ path: file.path, action: file.action, type: file.type })),
        };

        observations.workingCopy = readWorkingCopy(document, SAME_KEY_NEEDLES);

        const status = await observe(() => repositoryStatus(authorOnline, { scan: true }));
        observations.status = failed(status) ? status : {
            revision: status.revision?.revision,
            revisionNumber: status.revision?.revisionNumber,
            revisionStaged: status.revision?.revisionStaged,
            revisionMerged: status.revision?.revisionMerged,
            summary: status.summary,
            document: statusFlags(status.files, DOCUMENT),
        };

        // A third answer again, so that `branchMergeResolve` has bytes of its own to take
        // if it applies here at all.
        fs.writeFileSync(document, HAND_RESOLVED, "utf-8");
        observations.resolve = await observe(() => branchMergeResolve(authorOnline, [document]));
        observations.resolveTheirs = await observe(() => branchMergeResolveTheirs(authorOnline, [document]));
        observations.resolveMine = await observe(() => branchMergeResolveMine(authorOnline, [document]));

        const confirm = await observe(() => repositoryStatus(authorOnline, { scan: false, revisionOnly: true }));
        observations.beforeCommit = failed(confirm) ? confirm : {
            revision: confirm.revision?.revision,
            revisionStaged: confirm.revision?.revisionStaged,
            revisionMerged: confirm.revision?.revisionMerged,
        };

        const firstCommit = await observe(() => commit(authorOnline, "resolved a sync conflict"));
        observations.commitWithoutStageMerge = firstCommit;
        let committed = failed(firstCommit) ? null : firstCommit;
        if (failed(firstCommit)) {
            observations.stageMerge = await observe(() => stageMerge(authorOnline, [document]));
            const retry = await observe(() => commit(authorOnline, "resolved a sync conflict"));
            observations.commitAfterStageMerge = retry;
            committed = failed(retry) ? null : retry;
        }

        observations.flush = await observe(async () => {
            await flushRepository(authorOnline);
            return "flushed";
        });
        observations.committedWorkingCopy = readWorkingCopy(document, SAME_KEY_NEEDLES);

        if (committed) {
            const graph = await observe(() => readRevisionGraph(authorGlobals));
            observations.mergeRevision = failed(graph) ? graph : {
                revision: committed.revision,
                parentCountFromCommitEvent: committed.parents.length,
                parentsFromCommitEvent: committed.parents,
                parentCountFromGraph: graph.get(committed.revision)?.parents.length ?? null,
                parentsFromGraph: graph.get(committed.revision)?.parents ?? null,
            };
        }

        report("E6 SYNC CONFLICT", observations);
        expect(Object.keys(observations).length).toBeGreaterThan(0);
    }, 240_000);
});
