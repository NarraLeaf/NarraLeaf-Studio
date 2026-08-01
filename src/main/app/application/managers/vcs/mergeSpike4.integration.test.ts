import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";
import { VCS_UNCONFIGURED_REMOTE_URL, isVcsPlatformSupported } from "@shared/types/vcs";
import {
    closeStore,
    commit,
    createRepository,
    flushRepository,
    history,
    openStore,
    releaseRepository,
    repositoryStatus,
    resetLoreLibraryForRetry,
    stage,
    syncRevision,
    type LoreGlobals,
    type StoreHandle,
} from "./lore";
import { blobAt, listFilesAt } from "./revisionReader";
import { cloneInto, publishToRemote, pushToRemote, writeRemote } from "./remote";

/**
 * D0 follow-up, round three: is the sync poisoning (§4.29) curable inside one process?
 *
 * `mergeSpike2`'s R2 established the defect and `mergeSpike3`'s R3 established that it is
 * the PROCESS that is poisoned, not the repository - a second process reads the same
 * bytes fine. What neither could answer is the question Studio actually needs answered,
 * because `VcsManager`'s session lives in the main process for as long as the project is
 * open: after a sync, can that process heal itself, or does the author have to restart
 * Studio before history, diffs and V4 restore work again?
 *
 * Everything cheap has been tried and recorded as useless in §4.29 (`repositoryFlush`,
 * `closeStore`+`openStore`, waiting 45 s, `offline` both ways, a store opened with the
 * real remote, both read routes). The one lever left is
 * {@link resetLoreLibraryForRetry} - dropping the loaded {@link LoreLibrary} so the next
 * call re-runs `koffi.load`. Note what that does NOT reset, because it bounds what a
 * positive result would mean: koffi's process-global type registry is deliberately kept
 * (re-registering throws), the DLL is never `unload`ed, and Lore's own process-global
 * state lives inside that DLL. On Windows a second `LoadLibraryW` of an already-loaded
 * module returns the same HMODULE, so "reload" here means new JS function bindings over
 * the same native image, not a fresh Lore.
 *
 * Order is the experiment, not a detail: variant 1 resets AFTER the repository is
 * released, variant 2 resets while it is still held, and both are measured rather than
 * one being assumed to subsume the other.
 *
 * This is a probe. Nothing about Lore's behaviour is asserted; observations are printed.
 *
 * ```bash
 * LORE_TEST_REMOTE="lore://127.0.0.1:41337" npx vitest run \
 *   src/main/app/application/managers/vcs/mergeSpike4.integration.test.ts
 * ```
 */

const supported = isVcsPlatformSupported() || Boolean(process.env.LORE_LIB_PATH);
const SERVER = (process.env.LORE_TEST_REMOTE ?? "").trim();
const remoteEnabled = supported && SERVER !== "";

const DOCUMENT = "doc.json";
const RUN = Date.now().toString(36);

const BASE_TEXT = `${JSON.stringify({ id: "scene", title: "Prologue", version: 7 }, null, 2)}\n`;
const MINE_TEXT = `${JSON.stringify({ id: "scene", title: "Prologue (main)", version: 7 }, null, 2)}\n`;
const THEIRS_TEXT = `${JSON.stringify({ id: "scene", title: "Prologue (feature)", version: 7 }, null, 2)}\n`;

// -- plumbing ---------------------------------------------------------------

function report(name: string, observations: unknown): void {
    console.log(`\n### ${name}\n${JSON.stringify(observations, null, 2)}`);
}

interface Failure { error: string }

async function observe<T>(run: () => Promise<T>): Promise<T | Failure> {
    try {
        return await run();
    } catch (error) {
        const call = error as Error & { errorCode?: number };
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

/**
 * Same as {@link observe}, but a call that never settles becomes an observation instead
 * of a hung run.
 *
 * Needed here specifically: §4.28 says a second `openStore` on a repository whose lock is
 * still held blocks FOREVER, and variant 2 deliberately resets the library binding before
 * the release, which is exactly the shape that could leave the lock held. The native
 * thread stays stuck either way - this only keeps the remaining experiments reachable.
 */
async function guarded<T>(label: string, ms: number, run: () => Promise<T>): Promise<T | Failure> {
    let timer: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([
            run(),
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error(`${label} did not settle within ${ms} ms`)), ms);
            }),
        ]);
    } catch (error) {
        const call = error as Error & { errorCode?: number };
        return {
            error: error instanceof Error
                ? `${error.name}: ${error.message}${call.errorCode === undefined ? "" : ` code=${call.errorCode}`}`
                : String(error),
        };
    } finally {
        if (timer) clearTimeout(timer);
    }
}

interface Session { root: string; globals: LoreGlobals; store?: StoreHandle }

const roots: string[] = [];
const sessions: Session[] = [];

function tmp(prefix: string): string {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
    roots.push(root);
    return root;
}

/** `storeKeepAlive` left unset: with it on every flush waits out the window (§4.22). */
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
}, 240_000);

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

/** Open, use, release - never two stores on one repository at once (§4.28). */
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

// -- the fixture ------------------------------------------------------------

interface Poisoned {
    name: string;
    root: string;
    offlineGlobals: LoreGlobals;
    onlineGlobals: LoreGlobals;
    repositoryId: string;
    /** The author's own commit, made BEFORE the sync. §4.29 says even this becomes unreadable. */
    revision: string;
    url: string;
    cloneRoot: string;
    cloneGlobals: LoreGlobals;
    conflicts?: number;
    automerges?: number;
    setupError?: string;
}

/**
 * Build a repository, publish it, let a clone push a change, commit locally, sync.
 *
 * The clone writes a DIFFERENT file so the sync is clean: §4.29 measured conflicted and
 * clean syncs failing identically, and a clean one has fewer moving parts to confuse a
 * recovery result with.
 */
async function poisonedFixture(name: string): Promise<Poisoned> {
    const root = tmp(`nl-m4-${name}-`);
    const offlineGlobals = offline(root);
    const onlineGlobals = online(root);
    track({ root, globals: onlineGlobals });
    const cloneRoot = path.join(tmp(`nl-m4-${name}-clone-`), "project");
    const cloneGlobals = online(cloneRoot);
    track({ root: cloneRoot, globals: cloneGlobals });

    const fixture: Poisoned = {
        name,
        root,
        offlineGlobals,
        onlineGlobals,
        repositoryId: "",
        revision: "",
        url: `${SERVER}/m4-${name}-${RUN}`,
        cloneRoot,
        cloneGlobals,
    };

    try {
        const created = await createRepository(offlineGlobals, {
            repositoryUrl: VCS_UNCONFIGURED_REMOTE_URL,
            description: "merge spike 4",
        });
        fixture.repositoryId = created.repository;
        write(root, DOCUMENT, BASE_TEXT);
        await commitAll(offlineGlobals, root, "base");
        await writeRemote(root, fixture.url);
        await publishToRemote(onlineGlobals, { url: fixture.url, repositoryId: created.repository });
        await pushToRemote(onlineGlobals);
        await releaseRepository(onlineGlobals);

        await cloneInto(cloneGlobals, { repositoryUrl: fixture.url });
        write(cloneRoot, "other.json", THEIRS_TEXT);
        await commitAll(cloneGlobals, cloneRoot, "theirs");
        await pushToRemote(cloneGlobals);
        await releaseRepository(cloneGlobals);

        write(root, DOCUMENT, MINE_TEXT);
        fixture.revision = await commitAll(onlineGlobals, root, "mine");
        const synced = await syncRevision(onlineGlobals);
        fixture.conflicts = synced.progress?.fileConflict ?? 0;
        fixture.automerges = synced.progress?.fileAutomerge ?? 0;
        // The tail §4.29 already proved insufficient on its own. Every recovery variant
        // below therefore differs from this known-failing state by exactly one call.
        await flushRepository(onlineGlobals);
        await releaseRepository(onlineGlobals);
    } catch (error) {
        fixture.setupError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
    return fixture;
}

/** Tree and bytes, side by side: §4.29's signature is the tree reading while bytes do not. */
async function readBack(fixture: Poisoned, label: string) {
    return guarded(label, 120_000, () => withStore(fixture.offlineGlobals, fixture.root, async (store) => ({
        tree: await observe(async () =>
            (await listFilesAt(fixture.offlineGlobals, store, fixture.repositoryId, fixture.revision))
                .map((entry) => entry.path).sort()),
        bytes: await observe(async () => ({
            byteLength: (await blobAt(
                fixture.offlineGlobals, store, fixture.repositoryId, fixture.revision, DOCUMENT,
            )).byteLength,
        })),
    })));
}

function bytesRead(result: unknown): boolean {
    const bytes = (result as { bytes?: unknown } | undefined)?.bytes as { byteLength?: number } | undefined;
    return typeof bytes?.byteLength === "number";
}

type Variant = "resetAfterRelease" | "resetBeforeRelease";

/**
 * One recovery attempt, differing from the known-failing tail by where the reset lands.
 *
 * `resetAfterRelease` is the safe reading of §4.29's open question: give every handle
 * back first, then drop the binding. `resetBeforeRelease` drops it while Lore still holds
 * the repository, which is the ordering that could strand the lock - measured rather than
 * reasoned about, since a positive result for only one of them changes what Studio has to
 * do at the call site.
 */
async function recover(fixture: Poisoned, variant: Variant) {
    const steps: Record<string, unknown> = { variant };
    if (variant === "resetBeforeRelease") {
        steps.reset = await observe(async () => {
            resetLoreLibraryForRetry();
            return "called";
        });
        steps.flush = await guarded("flush", 60_000, () => flushRepository(fixture.onlineGlobals).then(() => "ok"));
        steps.release = await guarded("release", 60_000, () =>
            releaseRepository(fixture.onlineGlobals).then(() => "ok"));
    } else {
        steps.flush = await guarded("flush", 60_000, () => flushRepository(fixture.onlineGlobals).then(() => "ok"));
        steps.release = await guarded("release", 60_000, () =>
            releaseRepository(fixture.onlineGlobals).then(() => "ok"));
        steps.reset = await observe(async () => {
            resetLoreLibraryForRetry();
            return "called";
        });
    }
    steps.readAfterRecovery = await readBack(fixture, `${fixture.name}:${variant}`);
    return steps;
}

// ===========================================================================
// R4 - can the process that synced heal itself?
// ===========================================================================

describe.skipIf(!remoteEnabled)("R4 - recovering from the sync poisoning in one process", () => {
    it("measures resetLoreLibraryForRetry, both orderings, and what else the poison touches", async () => {
        const observations: Record<string, unknown> = { run: RUN, server: SERVER };
        try {
            // -- 1. baseline: does the defect still reproduce at all? ---------------
            const a = await poisonedFixture("a");
            observations.fixtureA = {
                setupError: a.setupError,
                revision: a.revision,
                conflicts: a.conflicts,
                automerges: a.automerges,
            };
            if (a.setupError) return;

            const baseline = await readBack(a, "a:baseline");
            observations.step1_baselineAfterSync = baseline;

            // Only `storageGet` is supposed to be affected. If the verbs that never touch
            // content still answer, the poison is narrow and Studio could at least keep
            // showing the history LIST after a sync while every document read is dead -
            // which is a different (and worse-looking) product decision than "all dark".
            observations.step1b_nonContentVerbs = {
                status: await guarded("status", 60_000, () => observe(async () => {
                    const status = await repositoryStatus(a.offlineGlobals, { scan: false, revisionOnly: true });
                    return {
                        revision: status.revision?.revision,
                        branch: status.revision?.branch,
                        revisionMerged: status.revision?.revisionMerged,
                    };
                })),
                history: await guarded("history", 60_000, () => observe(async () => {
                    const graph = await history(a.offlineGlobals, { limit: 20 });
                    return {
                        repository: graph.header?.repository,
                        nodes: [...graph.nodes.values()].map((node) => node.number).sort((x, y) => x - y),
                    };
                })),
            };
            await observe(() => releaseRepository(a.offlineGlobals));

            if (bytesRead(baseline)) {
                observations.stopped = "the baseline read SUCCEEDED - the defect did not reproduce here";
                return;
            }

            // -- 2. reset after everything is given back ---------------------------
            observations.step2_resetAfterRelease = await recover(a, "resetAfterRelease");
            const afterVariant1 = bytesRead(
                (observations.step2_resetAfterRelease as { readAfterRecovery?: unknown }).readAfterRecovery);

            // -- 3. the other ordering, on its own repository ----------------------
            const b = await poisonedFixture("b");
            observations.fixtureB = { setupError: b.setupError, revision: b.revision };
            let afterVariant2 = false;
            if (!b.setupError) {
                observations.step3_baselineB = await readBack(b, "b:baseline");
                observations.step3_resetBeforeRelease = await recover(b, "resetBeforeRelease");
                afterVariant2 = bytesRead(
                    (observations.step3_resetBeforeRelease as { readAfterRecovery?: unknown }).readAfterRecovery);

                // Is the poison scoped to the repository that synced, or to the process?
                // B's sync happened after A was (possibly) healed, so if A is dark again
                // then one project's sync blinds every project the window has open, and a
                // per-project remedy cannot be correct.
                observations.step3b_readAAfterBSync = await readBack(a, "a:afterBSync");
            }

            // -- 4. stability: two more poison/recover cycles with the winner -------
            const winner: Variant | null = afterVariant1 ? "resetAfterRelease"
                : afterVariant2 ? "resetBeforeRelease" : null;
            observations.step4_winner = winner;
            if (winner) {
                const repeats: unknown[] = [];
                for (const name of ["c", "d"]) {
                    const fixture = await poisonedFixture(name);
                    if (fixture.setupError) {
                        repeats.push({ name, setupError: fixture.setupError });
                        continue;
                    }
                    const before = await readBack(fixture, `${name}:baseline`);
                    const recovered = await recover(fixture, winner);
                    repeats.push({
                        name,
                        poisonedBeforeRecovery: !bytesRead(before),
                        readAfterRecovery: (recovered as { readAfterRecovery?: unknown }).readAfterRecovery,
                    });
                }
                observations.step4_repeats = repeats;
            }

            // -- 5. does a SECOND sync in a poisoned process fail differently? ------
            const e = await poisonedFixture("e");
            observations.step5_secondSync = e.setupError ? { setupError: e.setupError } : await observe(async () => {
                const firstRead = await readBack(e, "e:baseline");
                write(e.cloneRoot, "third.json", THEIRS_TEXT);
                await commitAll(e.cloneGlobals, e.cloneRoot, "theirs again");
                await pushToRemote(e.cloneGlobals);
                await releaseRepository(e.cloneGlobals);
                const second = await guarded("secondSync", 120_000, async () => {
                    const synced = await syncRevision(e.onlineGlobals);
                    return {
                        conflicts: synced.progress?.fileConflict ?? 0,
                        automerges: synced.progress?.fileAutomerge ?? 0,
                        target: synced.target?.targetRevision,
                        targetIsLocal: synced.target?.local,
                    };
                });
                await observe(() => flushRepository(e.onlineGlobals));
                await observe(() => releaseRepository(e.onlineGlobals));
                return {
                    poisonedAfterFirstSync: !bytesRead(firstRead),
                    secondSyncResult: second,
                    readAfterSecondSync: await readBack(e, "e:afterSecondSync"),
                };
            });

            // -- 6. is a reset safe while a store handle is open? -------------------
            // Asked on a throwaway local repository and asked LAST, because the honest
            // answer might be "the handle is stranded and the lock is never given back",
            // and that outcome must not be able to take the measurements above with it.
            observations.step6_resetWithStoreHandleOpen = await observe(async () => {
                const root = tmp("nl-m4-f-");
                const globals = offline(root);
                track({ root, globals });
                const created = await createRepository(globals, {
                    repositoryUrl: VCS_UNCONFIGURED_REMOTE_URL,
                    description: "merge spike 4 (handle safety)",
                });
                write(root, DOCUMENT, BASE_TEXT);
                const revision = await commitAll(globals, root, "only commit");
                const store = await openStore(globals, root);
                const readBeforeReset = await observe(async () => ({
                    byteLength: (await blobAt(globals, store, created.repository, revision, DOCUMENT)).byteLength,
                }));
                resetLoreLibraryForRetry();
                // The same handle id, through freshly bound function pointers.
                const readAfterResetOnSameHandle = await guarded("sameHandleRead", 60_000, () => observe(async () => ({
                    byteLength: (await blobAt(globals, store, created.repository, revision, DOCUMENT)).byteLength,
                })));
                const closed = await guarded("closeAfterReset", 60_000, () =>
                    closeStore(globals, store).then(() => "ok"));
                const released = await guarded("releaseAfterReset", 60_000, () =>
                    releaseRepository(globals).then(() => "ok"));
                const reopened = await guarded("reopenAfterReset", 60_000, () =>
                    withStore(globals, root, async (handle) => ({
                        byteLength: (await blobAt(globals, handle, created.repository, revision, DOCUMENT)).byteLength,
                    })));
                return { readBeforeReset, readAfterResetOnSameHandle, closed, released, reopened };
            });
        } finally {
            report("R4 RECOVERY AFTER SYNC", observations);
        }
        expect(Object.keys(observations).length).toBeGreaterThan(0);
    }, 1_200_000);
});
