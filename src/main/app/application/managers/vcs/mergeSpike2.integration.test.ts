import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";
import { VCS_UNCONFIGURED_REMOTE_URL, isVcsPlatformSupported } from "@shared/types/vcs";
import {
    branchMergeResolve,
    branchMergeResolveMine,
    branchMergeResolveTheirs,
    branchMergeStart,
    closeStore,
    commit,
    createBranch,
    createRepository,
    flushRepository,
    history,
    invoke,
    openStore,
    releaseRepository,
    repositoryStatus,
    stage,
    syncRevision,
    stageMerge,
    switchBranch,
    type LoreGlobals,
    type LoreStatusFilePayload,
    type StoreHandle,
} from "./lore";
// Not re-exported by the barrel, and the raw `invoke` in R1 needs them: an args struct
// field declared `LoreString` has to be handed the encoded value, not a bare string.
import { loreString, loreStringArray } from "./lore/values";
import { blobAt, listFilesAt, mergeBase, readEntryBytes, readRevisionGraph, threeWay } from "./revisionReader";
import { cloneInto, publishToRemote, pushToRemote, writeRemote } from "./remote";

/**
 * Measurement round two. Round one is `mergeSpike.integration.test.ts`; this file exists because
 * three of its answers were unusable and one experiment deadlocked.
 *
 * What round one settled, and this file does not repeat: an automerge of the same key
 * writes diff3 conflict markers into the document so it no longer parses; a merge
 * revision has two parents; `branchMergeAbort` rolls the working tree back exactly.
 *
 * What it could not settle, and this file is aimed at:
 *
 *  1. **Which resolve verb keeps the bytes we wrote.** Round one called all three in a
 *     row on one file and then committed, so the outcome ("theirs won") cannot be
 *     attributed. Here each verb gets its own repository and is the only one called.
 *  2. **The sidecars.** A conflicted merge leaves `<path>~base`, `~mine` and `~theirs`
 *     next to the document. Nothing in Studio knows they exist. If they are faithful
 *     copies, the write-back path never has to reconstruct anything from the DAG.
 *  3. **Whether a conflicted path can be discovered at all.** `repositoryStatus(scan)`
 *     returned nothing after a conflicted merge, and the sync result carries no per-file
 *     conflict flag, so today a conflicted sync can only say "something".
 *  4. **Why `threeWay` reports no base** for a merge whose base is demonstrably on disk.
 *
 * Same discipline as round one: this is a probe. Every observation is printed, and the
 * only assertions are that an experiment produced something.
 *
 * ```bash
 * npx vitest run src/main/app/application/managers/vcs/mergeSpike2.integration.test.ts
 * LORE_TEST_REMOTE="lore://127.0.0.1:41337" npx vitest run \
 *   src/main/app/application/managers/vcs/mergeSpike2.integration.test.ts
 * ```
 */

const supported = isVcsPlatformSupported() || Boolean(process.env.LORE_LIB_PATH);
const SERVER = (process.env.LORE_TEST_REMOTE ?? "").trim();
const remoteEnabled = supported && SERVER !== "";

const DOCUMENT = "doc.json";

// -- fixture content --------------------------------------------------------

const BASE_DOCUMENT = {
    blocks: [
        { id: "b-001", speaker: "alice", text: "The lamps were still lit when we arrived." },
        { id: "b-002", speaker: "bob", text: "Nobody had thought to put them out." },
    ],
    characters: { alice: { color: "#c0ffee", displayName: "Alice" } },
    id: "scene-prologue",
    kind: "story",
    tags: ["opening"],
    title: "Prologue",
    version: 7,
};

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

function titled(title: string): string {
    return canonical({ ...BASE_DOCUMENT, title });
}

const BASE_TEXT = canonical(BASE_DOCUMENT);
const MINE_TEXT = titled("Prologue (main)");
const THEIRS_TEXT = titled("Prologue (feature)");
/** A third answer neither side wrote - the thing a per-change resolution produces. */
const HAND_TEXT = titled("Prologue (resolved by hand)");

const NEEDLES = {
    mine: "Prologue (main)",
    theirs: "Prologue (feature)",
    hand: "Prologue (resolved by hand)",
} as const;

// -- plumbing ---------------------------------------------------------------

function report(name: string, observations: unknown): void {
    console.log(`\n### ${name}\n${JSON.stringify(observations, null, 2)}`);
}

interface Failure { error: string }

async function observe<T>(run: () => Promise<T>): Promise<T | Failure> {
    try {
        return await run();
    } catch (error) {
        const call = error as Error & { errorCode?: number; trace?: readonly string[] };
        return {
            error: error instanceof Error
                ? `${error.name}: ${error.message}${call.errorCode === undefined ? "" : ` code=${call.errorCode}`}`
                : String(error),
        };
    }
}

function failed<T>(result: T | Failure): result is Failure {
    return Boolean(result) && typeof result === "object" && "error" in (result as object);
}

interface Session { root: string; globals: LoreGlobals; store?: StoreHandle }

const roots: string[] = [];
const sessions: Session[] = [];

function tmp(prefix: string): string {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
    roots.push(root);
    return root;
}

/**
 * `storeKeepAlive` left unset on purpose: with it on, every flush waits out the
 * keep-alive window (§4.22, ~10 s measured) and these experiments flush repeatedly.
 */
function offline(root: string): LoreGlobals {
    return { repositoryPath: root, offline: true, identity: "spike@narraleaf", cache: true };
}

function online(root: string): LoreGlobals {
    return { ...offline(root), offline: false };
}

function track(session: Session): Session {
    sessions.push(session);
    return session;
}

afterAll(async () => {
    for (const session of sessions) {
        await flushRepository(session.globals).catch(() => undefined);
        if (session.store) await closeStore(session.globals, session.store).catch(() => undefined);
        await releaseRepository(session.globals).catch(() => undefined);
    }
    for (const root of roots) {
        try {
            fs.rmSync(root, { recursive: true, force: true });
        } catch {
            // A leftover temp directory is not an experimental result.
        }
    }
}, 180_000);

function write(root: string, relative: string, contents: string): string {
    const absolute = path.join(root, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, contents, "utf-8");
    return absolute;
}

async function commitAll(globals: LoreGlobals, root: string, message: string): Promise<string> {
    await stage(globals, [root]);
    const revision = await commit(globals, message);
    await flushRepository(globals);
    return revision.revision;
}

function sha256(bytes: Buffer): string {
    return crypto.createHash("sha256").update(bytes).digest("hex");
}

/** One working-tree file, described without interpreting it. */
function describeFile(absolute: string) {
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
    for (const [name, needle] of Object.entries(NEEDLES)) contains[name] = text.includes(needle);
    return {
        exists: true,
        byteLength: bytes.byteLength,
        sha256: sha256(bytes),
        parsed,
        parseError,
        hasMarkers: text.includes("<<<<<<<"),
        contains,
    };
}

function statusFlags(files: readonly LoreStatusFilePayload[]) {
    return files.map((file) => ({
        path: file.path,
        action: file.action,
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

/** Working-tree files by content hash, `.lore/` excluded (a merge is supposed to change it). */
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

// -- fixtures ---------------------------------------------------------------

interface TwoSided {
    root: string;
    globals: LoreGlobals;
    repositoryId: string;
    document: string;
    baseRevision?: string;
    /** Tip of `main`, the branch the merge runs from. */
    mineRevision?: string;
    /** Tip of `feature`, the branch being merged in. */
    theirsRevision?: string;
    setupError?: string;
}

async function twoSided(prefix: string): Promise<TwoSided> {
    const root = tmp(prefix);
    const globals = offline(root);
    track({ root, globals });
    const fixture: TwoSided = { root, globals, repositoryId: "", document: path.join(root, DOCUMENT) };
    try {
        const created = await createRepository(globals, {
            repositoryUrl: VCS_UNCONFIGURED_REMOTE_URL,
            description: "merge spike 2",
        });
        fixture.repositoryId = created.repository;
        write(root, DOCUMENT, BASE_TEXT);
        fixture.baseRevision = await commitAll(globals, root, "base");

        await createBranch(globals, "feature");
        await switchBranch(globals, { branch: "feature" });
        write(root, DOCUMENT, THEIRS_TEXT);
        fixture.theirsRevision = await commitAll(globals, root, "theirs");

        await switchBranch(globals, { branch: "main" });
        write(root, DOCUMENT, MINE_TEXT);
        fixture.mineRevision = await commitAll(globals, root, "mine");
    } catch (error) {
        fixture.setupError = error instanceof Error ? error.message : String(error);
    }
    return fixture;
}

/**
 * Read the repository with a store handle, then give the lock back.
 *
 * Round one deadlocked because two experiments held stores on the same repository at
 * once: Lore's repository lock is exclusive and BLOCKING (§4.12), and that turns out to
 * apply WITHIN one process, not only across them - the second `openStore` never returns.
 * So every store here is opened, used and released inside one call.
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

// ===========================================================================
// L0 - the sidecars, discoverability, and why threeWay finds no base
// ===========================================================================

describe.skipIf(!supported)("L0 - what a conflicted merge leaves behind", () => {
    it("describes the sidecars, every status form, and both branches' graphs", async () => {
        const observations: Record<string, unknown> = {};
        try {
            const fixture = await twoSided("nl-m2-l0-");
            observations.setup = {
                setupError: fixture.setupError,
                base: fixture.baseRevision,
                mine: fixture.mineRevision,
                theirs: fixture.theirsRevision,
            };
            if (fixture.setupError) return;

            const before = manifest(fixture.root);
            observations.mergeStart = await observe(() => branchMergeStart(fixture.globals, { branch: "feature" }));
            const after = manifest(fixture.root);

            observations.filesAddedByMerge = Object.keys(after)
                .filter((candidate) => !(candidate in before))
                .sort();

            // The sidecars, each described on its own. If these are faithful copies of the
            // three sides, the write-back path can read them off disk and never has to
            // rebuild anything from the revision DAG.
            const sidecars: Record<string, unknown> = {};
            for (const suffix of ["", "~base", "~mine", "~theirs"]) {
                sidecars[`${DOCUMENT}${suffix}`] = describeFile(`${fixture.document}${suffix}`);
            }
            observations.sidecars = sidecars;

            // Four status forms. Round one only tried `{scan:true}` and it reported nothing.
            observations.status = {
                scan: await observe(async () =>
                    statusFlags((await repositoryStatus(fixture.globals, { scan: true })).files)),
                scanCheckDirty: await observe(async () =>
                    statusFlags((await repositoryStatus(fixture.globals, { scan: true, checkDirty: true })).files)),
                noScan: await observe(async () =>
                    statusFlags((await repositoryStatus(fixture.globals, { scan: false })).files)),
                paths: await observe(async () => statusFlags((await repositoryStatus(fixture.globals, {
                    scan: true,
                    checkDirty: true,
                    paths: [fixture.document],
                })).files)),
            };

            // Why `threeWay` answered `baseAbsent` for a merge whose base is on disk. The
            // hypothesis is that the graph read only covers the CURRENT branch, so the two
            // tips have no common ancestor in it and there is nothing to find.
            observations.graphs = await observe(async () => {
                const current = await readRevisionGraph(fixture.globals);
                const featureBranch = await history(fixture.globals, { branch: "feature" });
                const union = new Map(current);
                for (const [key, node] of featureBranch.nodes) union.set(key, node);
                const describe = (nodes: ReadonlyMap<string, { number: number }>) =>
                    [...nodes.entries()].map(([revision, node]) => `#${node.number} ${revision.slice(0, 8)}`).sort();
                return {
                    currentBranchGraph: describe(current),
                    featureBranchGraph: describe(featureBranch.nodes),
                    theirsTipInCurrentGraph: current.has(fixture.theirsRevision as string),
                    baseFromCurrentGraph:
                        mergeBase(current, fixture.mineRevision as string, fixture.theirsRevision as string) ?? null,
                    baseFromUnionGraph:
                        mergeBase(union, fixture.mineRevision as string, fixture.theirsRevision as string) ?? null,
                    actualBaseRevision: fixture.baseRevision,
                };
            });

            observations.threeWay = await observe(() => withStore(fixture.globals, fixture.root, async (store) => {
                const sides = await threeWay(
                    fixture.globals,
                    store,
                    fixture.repositoryId,
                    fixture.mineRevision as string,
                    fixture.theirsRevision as string,
                    DOCUMENT,
                );
                return {
                    baseRevision: sides.baseRevision ?? null,
                    baseAbsent: sides.base === undefined,
                    sha256: {
                        base: sides.base ? sha256(sides.base) : null,
                        mine: sha256(sides.mine),
                        theirs: sha256(sides.theirs),
                    },
                };
            }));
        } finally {
            report("L0 CONFLICT SURFACE", observations);
        }
        expect(Object.keys(observations).length).toBeGreaterThan(0);
    }, 300_000);
});

// ===========================================================================
// L1-L3 - one resolve verb per repository, so the outcome is attributable
// ===========================================================================

type ResolveVerb = "resolve" | "mine" | "theirs";

/**
 * Reach a conflicted merge, call exactly ONE resolve verb, commit, and read back.
 *
 * `handWritten` is what separates the question "does the verb keep our bytes" from
 * "does the verb pick a side": only the `resolve` case writes a third answer first,
 * because `resolve_mine`/`resolve_theirs` are documented to choose for us and writing
 * bytes before them would make their result unattributable - which is the mistake round
 * one made by calling all three in sequence.
 */
async function resolveExperiment(
    prefix: string,
    verb: ResolveVerb,
    handWritten: boolean,
): Promise<Record<string, unknown>> {
    const observations: Record<string, unknown> = { verb, handWritten };
    const fixture = await twoSided(prefix);
    observations.setupError = fixture.setupError;
    if (fixture.setupError) return observations;

    observations.mergeStart = await observe(() => branchMergeStart(fixture.globals, { branch: "feature" }));

    if (handWritten) {
        fs.writeFileSync(fixture.document, HAND_TEXT, "utf-8");
        observations.wrote = { sha256: sha256(Buffer.from(HAND_TEXT, "utf-8")) };
    }

    const call = verb === "resolve" ? branchMergeResolve
        : verb === "mine" ? branchMergeResolveMine
            : branchMergeResolveTheirs;
    observations.resolveResult = await observe(() => call(fixture.globals, [fixture.document]));

    // Immediately after the verb and BEFORE the commit: this is where a verb that
    // overwrites the working tree becomes visible, and round one could not see it.
    observations.afterResolve = {
        document: describeFile(fixture.document),
        sidecarsStillPresent: ["~base", "~mine", "~theirs"]
            .filter((suffix) => fs.existsSync(`${fixture.document}${suffix}`)),
    };

    // The intended pipeline: confirm with the pure-read status form, commit, then
    // flush. Deliberately without `fileStageMerge` first - whether a merge commit
    // needs its own staging step is one of the things being measured.
    observations.beforeCommit = await observe(async () => {
        const status = await repositoryStatus(fixture.globals, { scan: false, revisionOnly: true });
        return {
            revision: status.revision?.revision,
            revisionStaged: status.revision?.revisionStaged,
            revisionMerged: status.revision?.revisionMerged,
        };
    });

    const first = await observe(() => commit(fixture.globals, `resolved via ${verb}`));
    observations.commitWithoutStageMerge = first;
    let committed = failed(first) ? null : first;
    if (failed(first)) {
        observations.stageMerge = await observe(() => stageMerge(fixture.globals, [fixture.document]));
        const retry = await observe(() => commit(fixture.globals, `resolved via ${verb}`));
        observations.commitAfterStageMerge = retry;
        committed = failed(retry) ? null : retry;
    }
    await observe(() => flushRepository(fixture.globals));

    observations.afterCommit = { document: describeFile(fixture.document) };
    if (!committed) return observations;

    // Parent ORDER, not just count: `flattenFirstParent` walks parent[0], so which side
    // sits there decides which line the history list shows.
    observations.mergeRevision = {
        revision: committed.revision,
        parents: committed.parents,
        parentCount: committed.parents.length,
        parent0IsLocalTip: committed.parents[0] === fixture.mineRevision,
        parent0IsIncomingTip: committed.parents[0] === fixture.theirsRevision,
    };

    observations.committedTree = await observe(() => withStore(fixture.globals, fixture.root, async (store) => {
        const files = await listFilesAt(fixture.globals, store, fixture.repositoryId, committed.revision);
        const bytes = await blobAt(fixture.globals, store, fixture.repositoryId, committed.revision, DOCUMENT);
        return {
            // A merge that silently commits three sidecars into the author's project is a
            // shipping defect, so this is checked rather than assumed either way.
            paths: files.map((file) => file.path).sort(),
            sidecarsCommitted: files.map((file) => file.path).filter((candidate) => candidate.includes("~")),
            document: {
                byteLength: bytes.byteLength,
                sha256: sha256(bytes),
                identicalToHandWritten: bytes.equals(Buffer.from(HAND_TEXT, "utf-8")),
                identicalToMine: bytes.equals(Buffer.from(MINE_TEXT, "utf-8")),
                identicalToTheirs: bytes.equals(Buffer.from(THEIRS_TEXT, "utf-8")),
                text: bytes.toString("utf-8"),
            },
        };
    }));

    return observations;
}

describe.skipIf(!supported)("L1 - branchMergeResolve with hand-written bytes", () => {
    it("writes a third answer, resolves, commits and reads it back", async () => {
        let observations: Record<string, unknown> = {};
        try {
            observations = await resolveExperiment("nl-m2-l1-", "resolve", true);
        } finally {
            report("L1 RESOLVE (HAND-WRITTEN)", observations);
        }
        expect(Object.keys(observations).length).toBeGreaterThan(0);
    }, 300_000);
});

describe.skipIf(!supported)("L2 - branchMergeResolveMine alone", () => {
    it("takes our side and reports what reached the revision", async () => {
        let observations: Record<string, unknown> = {};
        try {
            observations = await resolveExperiment("nl-m2-l2-", "mine", false);
        } finally {
            report("L2 RESOLVE MINE", observations);
        }
        expect(Object.keys(observations).length).toBeGreaterThan(0);
    }, 300_000);
});

describe.skipIf(!supported)("L3 - branchMergeResolveTheirs alone", () => {
    it("takes their side and reports what reached the revision", async () => {
        let observations: Record<string, unknown> = {};
        try {
            observations = await resolveExperiment("nl-m2-l3-", "theirs", false);
        } finally {
            report("L3 RESOLVE THEIRS", observations);
        }
        expect(Object.keys(observations).length).toBeGreaterThan(0);
    }, 300_000);
});

// ===========================================================================
// R1 - the production path: the same question on a sync-induced conflict
// ===========================================================================

describe.skipIf(!remoteEnabled)("R1 - resolving a sync conflict", () => {
    it("names every event the sync emits, then resolves with hand-written bytes", async () => {
        const observations: Record<string, unknown> = {};
        try {
            const authorRoot = tmp("nl-m2-r1-author-");
            const authorOffline = offline(authorRoot);
            const authorOnline = online(authorRoot);
            track({ root: authorRoot, globals: authorOnline });
            const document = path.join(authorRoot, DOCUMENT);
            const url = `${SERVER}/m2-r1-${Date.now().toString(36)}`;
            observations.server = url;

            const setup = await observe(async () => {
                const created = await createRepository(authorOffline, {
                    repositoryUrl: VCS_UNCONFIGURED_REMOTE_URL,
                    description: "merge spike 2 (remote)",
                });
                write(authorRoot, DOCUMENT, BASE_TEXT);
                const base = await commitAll(authorOffline, authorRoot, "base");
                // Both halves of connecting; the address alone leaves a project that pushes
                // and cannot be cloned (docs §5.3.1), and this experiment needs the clone.
                await writeRemote(authorRoot, url);
                await publishToRemote(authorOnline, { url, repositoryId: created.repository });
                await pushToRemote(authorOnline);
                await releaseRepository(authorOnline);
                return { repositoryId: created.repository, base };
            });
            observations.setup = setup;
            if (failed(setup)) return;

            const cloneRoot = path.join(tmp("nl-m2-r1-clonebase-"), "project");
            const cloneOnline = online(cloneRoot);
            track({ root: cloneRoot, globals: cloneOnline });
            observations.clone = await observe(async () => {
                const cloned = await cloneInto(cloneOnline, { repositoryUrl: url });
                write(cloneRoot, DOCUMENT, THEIRS_TEXT);
                const revision = await commitAll(cloneOnline, cloneRoot, "theirs, from the clone");
                await pushToRemote(cloneOnline);
                await releaseRepository(cloneOnline);
                return { branch: cloned.branch, revision };
            });

            observations.author = await observe(async () => {
                write(authorRoot, DOCUMENT, MINE_TEXT);
                return { revision: await commitAll(authorOnline, authorRoot, "mine, from the author") };
            });

            const before = manifest(authorRoot);

            // `invoke` directly rather than the `syncRevision` wrapper, because the wrapper
            // only forwards progress events. The question is whether ANY event names the
            // conflicted path: the sync file event carries no conflict flag, and the status
            // call reported nothing, so if no event names it either then the sidecars on
            // disk are the only discoverable signal a conflicted sync leaves.
            const tags: Record<string, number> = {};
            const named: string[] = [];
            observations.sync = await observe(async () => {
                const result = await invoke("revisionSync", authorOnline, {
                    revision: loreString(undefined),
                    forwardChanges: 0,
                    reset: 0,
                    rootFiles: loreStringArray(undefined),
                    dependencyTags: loreStringArray(undefined),
                    dependencyRecursive: 0,
                    dependencyDepthLimit: 0,
                }, {
                    onEvent: (event) => {
                        tags[String(event.tag)] = (tags[String(event.tag)] ?? 0) + 1;
                        const payload = event.data as { path?: string } | undefined;
                        if (payload && typeof payload.path === "string" && payload.path) {
                            named.push(`${event.tag}:${payload.path}`);
                        }
                    },
                });
                return { eventCount: result.events.length };
            });
            observations.syncTagHistogram = tags;
            observations.syncEventsNamingAPath = named;

            const after = manifest(authorRoot);
            observations.filesAddedBySync = Object.keys(after).filter((c) => !(c in before)).sort();
            observations.sidecars = Object.fromEntries(
                ["", "~base", "~mine", "~theirs"].map((suffix) =>
                    [`${DOCUMENT}${suffix}`, describeFile(`${document}${suffix}`)]),
            );

            observations.status = {
                scanCheckDirty: await observe(async () =>
                    statusFlags((await repositoryStatus(authorOnline, { scan: true, checkDirty: true })).files)),
            };

            fs.writeFileSync(document, HAND_TEXT, "utf-8");
            observations.resolveResult = await observe(() => branchMergeResolve(authorOnline, [document]));
            observations.afterResolve = { document: describeFile(document) };

            const first = await observe(() => commit(authorOnline, "resolved a sync conflict"));
            observations.commitWithoutStageMerge = first;
            let committed = failed(first) ? null : first;
            if (failed(first)) {
                observations.stageMerge = await observe(() => stageMerge(authorOnline, [document]));
                const retry = await observe(() => commit(authorOnline, "resolved a sync conflict"));
                observations.commitAfterStageMerge = retry;
                committed = failed(retry) ? null : retry;
            }
            await observe(() => flushRepository(authorOnline));
            observations.afterCommit = { document: describeFile(document) };
            if (!committed) return;

            const authorTip = (observations.author as { revision?: string })?.revision;
            const cloneTip = (observations.clone as { revision?: string })?.revision;
            observations.mergeRevision = {
                revision: committed.revision,
                parents: committed.parents,
                parent0IsLocalTip: committed.parents[0] === authorTip,
                parent0IsIncomingTip: committed.parents[0] === cloneTip,
            };

            // Three reads, not one. The local merge (L1) reads its own merge revision back
            // without trouble, so a failure here would be about the CLONED repository, and
            // the difference that matters is whether the store was opened with the remote
            // in the picture: `openStore` passes `hasRemoteConfig: 0`, and every semantic
            // diff D1 ever runs on a collaborating project goes through this exact call.
            const repositoryId = (setup as { repositoryId: string }).repositoryId;
            const readWith = async (globals: LoreGlobals, revision: string) =>
                withStore(globals, authorRoot, async (store) => {
                    const files = await listFilesAt(globals, store, repositoryId, revision);
                    const bytes = await blobAt(globals, store, repositoryId, revision, DOCUMENT);
                    return {
                        paths: files.map((file) => file.path).sort(),
                        sidecarsCommitted: files.map((f) => f.path).filter((c) => c.includes("~")),
                        sha256: sha256(bytes),
                        identicalToHandWritten: bytes.equals(Buffer.from(HAND_TEXT, "utf-8")),
                        identicalToMine: bytes.equals(Buffer.from(MINE_TEXT, "utf-8")),
                        identicalToTheirs: bytes.equals(Buffer.from(THEIRS_TEXT, "utf-8")),
                    };
                });

            observations.readMergeRevisionOffline = await observe(() => readWith(authorOffline, committed.revision));
            observations.readMergeRevisionOnline = await observe(() => readWith(authorOnline, committed.revision));
            // The author's own pre-merge commit, offline: if THIS fails too, the problem is
            // the store rather than anything to do with merging.
            observations.readOwnCommitOffline = await observe(() =>
                readWith(authorOffline, (observations.author as { revision: string }).revision));
        } finally {
            report("R1 SYNC CONFLICT RESOLVE", observations);
        }
        expect(Object.keys(observations).length).toBeGreaterThan(0);
    }, 300_000);
});

// ===========================================================================
// R2 - can a store read blobs at all once a remote is configured?
// ===========================================================================

/**
 * R1 could not read `doc.json` back from ANY revision of the connected project -
 * including a plain commit the author made locally, with no merge anywhere near it -
 * while the identical read on an unconnected repository (L1) works.
 *
 * That is not a merge question, and it is not a small one: `blobAt` is what history
 * browsing, `readRevisionDocuments`, `getThreeWay` and every diff D1 will ever run are
 * built on. If it stops working the moment a project gains a server, the semantic diff
 * this whole card is about would be dead on exactly the projects that need it.
 *
 * Four repositories, each differing from the last by one step, so the step that breaks
 * it is the answer. The fourth calls `storage_open` through `invoke` rather than the
 * {@link openStore} wrapper, because the wrapper hard-codes `hasRemoteConfig: 0` and the
 * hypothesis under test is that a connected repository's store needs the remote.
 */
describe.skipIf(!remoteEnabled)("R2 - blob reads on a connected repository", () => {
    it("isolates which step of connecting a server breaks blobAt", async () => {
        const observations: Record<string, unknown> = {};
        try {
            const step = async (
                name: string,
                connect: "none" | "address" | "published",
                open: "wrapper" | "withRemote",
            ) => {
                const root = tmp(`nl-m2-r2-${name}-`);
                const globals = offline(root);
                track({ root, globals });
                const url = `${SERVER}/m2-r2-${name}-${Date.now().toString(36)}`;
                return observe(async () => {
                    const created = await createRepository(globals, {
                        repositoryUrl: VCS_UNCONFIGURED_REMOTE_URL,
                        description: "merge spike 2 (blob reads)",
                    });
                    write(root, DOCUMENT, BASE_TEXT);
                    const revision = await commitAll(globals, root, "only commit");

                    if (connect !== "none") await writeRemote(root, url);
                    if (connect === "published") {
                        await publishToRemote(online(root), { url, repositoryId: created.repository });
                        await pushToRemote(online(root));
                        await releaseRepository(online(root));
                    }

                    const store = open === "wrapper"
                        ? await openStore(globals, root)
                        : {
                            handleId: (await invoke("storageOpen", globals, {
                                repositoryPath: loreString(root),
                                inMemory: 0,
                                remoteConfig: { remoteUrl: loreString(url) },
                                hasRemoteConfig: 1,
                                cacheTargetBytes: 0,
                                cacheTargetFragments: 0,
                            })).one<{ handleId: number }>(191).handleId,
                        };
                    try {
                        const bytes = await blobAt(globals, store, created.repository, revision, DOCUMENT);
                        return { read: "ok", byteLength: bytes.byteLength, matchesBase: bytes.equals(Buffer.from(BASE_TEXT, "utf-8")) };
                    } finally {
                        await flushRepository(globals).catch(() => undefined);
                        await closeStore(globals, store).catch(() => undefined);
                        await releaseRepository(globals).catch(() => undefined);
                    }
                });
            };

            observations.a_noRemote_wrapperStore = await step("a", "none", "wrapper");
            observations.b_addressOnly_wrapperStore = await step("b", "address", "wrapper");
            observations.c_published_wrapperStore = await step("c", "published", "wrapper");
            observations.d_published_storeWithRemote = await step("d", "published", "withRemote");

            // None of the four reproduced R1's failure, so the difference is further along.
            // Two candidates, separated here: an online session left open across the read
            // (R1 never released it), and the sync itself having happened at all.
            observations.e_publishedNotReleased = await observe(async () => {
                const root = tmp("nl-m2-r2-e-");
                const globals = offline(root);
                const onlineGlobals = online(root);
                track({ root, globals: onlineGlobals });
                const url = `${SERVER}/m2-r2-e-${Date.now().toString(36)}`;
                const created = await createRepository(globals, {
                    repositoryUrl: VCS_UNCONFIGURED_REMOTE_URL,
                    description: "merge spike 2 (unreleased)",
                });
                write(root, DOCUMENT, BASE_TEXT);
                const revision = await commitAll(globals, root, "only commit");
                await writeRemote(root, url);
                await publishToRemote(onlineGlobals, { url, repositoryId: created.repository });
                await pushToRemote(onlineGlobals);
                // Deliberately NOT released - this is the one thing R1 did differently.
                return withStore(globals, root, async (store) => {
                    const bytes = await blobAt(globals, store, created.repository, revision, DOCUMENT);
                    return { read: "ok", byteLength: bytes.byteLength };
                });
            });

            /**
             * The sync scenario, parameterised on the two things that could matter.
             *
             * `conflicting` says whether the two sides touch the same file - a clean sync
             * and a conflicted one are different code paths inside Lore. `storeRemote`
             * says whether the reading store is told about the remote, because after a
             * sync some of the repository's fragments came from the server and a store
             * with no remote may simply have nowhere to fetch them from.
             */
            const syncThenRead = async (
                name: string,
                conflicting: boolean,
                storeRemote: boolean,
            ) => observe(async () => {
                const root = tmp(`nl-m2-r2-${name}-`);
                const globals = offline(root);
                const onlineGlobals = online(root);
                track({ root, globals: onlineGlobals });
                const url = `${SERVER}/m2-r2-${name}-${Date.now().toString(36)}`;
                const created = await createRepository(globals, {
                    repositoryUrl: VCS_UNCONFIGURED_REMOTE_URL,
                    description: "merge spike 2 (sync then read)",
                });
                write(root, DOCUMENT, BASE_TEXT);
                await commitAll(globals, root, "base");
                await writeRemote(root, url);
                await publishToRemote(onlineGlobals, { url, repositoryId: created.repository });
                await pushToRemote(onlineGlobals);
                await releaseRepository(onlineGlobals);

                const cloneRoot = path.join(tmp(`nl-m2-r2-${name}-clone-`), "project");
                const cloneGlobals = online(cloneRoot);
                track({ root: cloneRoot, globals: cloneGlobals });
                await cloneInto(cloneGlobals, { repositoryUrl: url });
                // The same file for a conflict, a different one for a clean automerge.
                write(cloneRoot, conflicting ? DOCUMENT : "other.json", THEIRS_TEXT);
                await commitAll(cloneGlobals, cloneRoot, "theirs");
                await pushToRemote(cloneGlobals);
                await releaseRepository(cloneGlobals);

                write(root, DOCUMENT, MINE_TEXT);
                const mine = await commitAll(onlineGlobals, root, "mine");
                const synced = await syncRevision(onlineGlobals);
                await flushRepository(onlineGlobals);
                await releaseRepository(onlineGlobals);

                const store = storeRemote
                    ? {
                        handleId: (await invoke("storageOpen", globals, {
                            repositoryPath: loreString(root),
                            inMemory: 0,
                            remoteConfig: { remoteUrl: loreString(url) },
                            hasRemoteConfig: 1,
                            cacheTargetBytes: 0,
                            cacheTargetFragments: 0,
                        })).one<{ handleId: number }>(191).handleId,
                    }
                    : await openStore(globals, root);
                try {
                    // Two routes to the same bytes, because they reach the content address
                    // differently: `blobAt` resolves the path then asks for node info, while
                    // the walk `documentsAt` uses gets addresses straight out of the
                    // directory listing. D1's diff reads through the walk, so if only the
                    // resolve route is broken the diff is unaffected - and the two addresses
                    // are printed side by side rather than guessed at.
                    const entries = await observe(() => listFilesAt(globals, store, created.repository, mine));
                    const entry = failed(entries) ? undefined : entries.find((e) => e.path === DOCUMENT);
                    return {
                        conflicts: synced.progress?.fileConflict ?? 0,
                        automerges: synced.progress?.fileAutomerge ?? 0,
                        walkRoute: {
                            entries: failed(entries) ? entries : entries.map((e) => e.path),
                            address: entry && { hash: entry.hash, context: entry.context, size: entry.size },
                            read: entry
                                ? await observe(async () => ({
                                    byteLength: (await readEntryBytes(globals, store, created.repository, entry)).byteLength,
                                }))
                                : { error: "no entry" },
                        },
                        resolveRoute: await observe(async () => ({
                            byteLength: (await blobAt(globals, store, created.repository, mine, DOCUMENT)).byteLength,
                        })),
                    };
                } finally {
                    await flushRepository(globals).catch(() => undefined);
                    await closeStore(globals, store).catch(() => undefined);
                    await releaseRepository(globals).catch(() => undefined);
                }
            });

            observations.g_cleanSync_plainStore = await syncThenRead("g", false, false);
            observations.h_conflictedSync_storeWithRemote = await syncThenRead("h", true, true);

            observations.f_afterSyncConflict = await observe(async () => {
                const root = tmp("nl-m2-r2-f-");
                const globals = offline(root);
                const onlineGlobals = online(root);
                track({ root, globals: onlineGlobals });
                const url = `${SERVER}/m2-r2-f-${Date.now().toString(36)}`;
                const created = await createRepository(globals, {
                    repositoryUrl: VCS_UNCONFIGURED_REMOTE_URL,
                    description: "merge spike 2 (after sync)",
                });
                write(root, DOCUMENT, BASE_TEXT);
                await commitAll(globals, root, "base");
                await writeRemote(root, url);
                await publishToRemote(onlineGlobals, { url, repositoryId: created.repository });
                await pushToRemote(onlineGlobals);
                await releaseRepository(onlineGlobals);

                const cloneRoot = path.join(tmp("nl-m2-r2-f-clone-"), "project");
                const cloneGlobals = online(cloneRoot);
                track({ root: cloneRoot, globals: cloneGlobals });
                await cloneInto(cloneGlobals, { repositoryUrl: url });
                write(cloneRoot, DOCUMENT, THEIRS_TEXT);
                await commitAll(cloneGlobals, cloneRoot, "theirs");
                await pushToRemote(cloneGlobals);
                await releaseRepository(cloneGlobals);

                write(root, DOCUMENT, MINE_TEXT);
                const mine = await commitAll(onlineGlobals, root, "mine");
                await syncRevision(onlineGlobals);
                fs.writeFileSync(path.join(root, DOCUMENT), HAND_TEXT, "utf-8");
                await branchMergeResolve(onlineGlobals, [path.join(root, DOCUMENT)]);
                const merged = await commit(onlineGlobals, "resolved");
                await flushRepository(onlineGlobals);
                // Everything released before the read, so an unreleased handle cannot be
                // the explanation if this one still fails.
                await releaseRepository(onlineGlobals);

                return withStore(globals, root, async (store) => {
                    const own = await observe(async () => ({
                        byteLength: (await blobAt(globals, store, created.repository, mine, DOCUMENT)).byteLength,
                    }));
                    const atMerge = await observe(async () => ({
                        byteLength: (await blobAt(globals, store, created.repository, merged.revision, DOCUMENT)).byteLength,
                    }));
                    return { ownPreMergeCommit: own, mergeRevision: atMerge };
                });
            });
        } finally {
            report("R2 BLOB READS WHEN CONNECTED", observations);
        }
        expect(Object.keys(observations).length).toBeGreaterThan(0);
    }, 300_000);
});
