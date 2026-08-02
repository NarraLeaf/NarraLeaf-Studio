import fs from "fs";
import path from "path";
import {
    VCS_REVISION_KIND_KEY,
    VCS_UNCONFIGURED_REMOTE_URL,
    type VcsChangeKind,
    type VcsCommitResult,
    type VcsFileChange,
    type VcsInitOptions,
    type VcsRevisionKind,
    type VcsStatus,
} from "@shared/types/vcs";
import { renderWorkingSetIgnoreFile } from "./workingSet";
import {
    commit,
    createRepository,
    flushRepository,
    getRevisionMetadata,
    history,
    listRevisionMetadata,
    releaseRepository,
    repositoryStatus,
    setRevisionMetadata,
    stage,
    type LoreGlobals,
    type LoreStatusFilePayload,
    type StageResult,
} from "./lore";

/**
 * Creating a repository, and reading where it stands.
 *
 * Everything below this module is Lore-shaped; everything above it is Studio-shaped.
 * That boundary is why the numeric file actions are mapped to a string union here
 * rather than passed through - the backend is pre-1.0 and its enum values are ABI.
 *
 * On why creating a repository is an explicit act and never automatic: it writes
 * `.lore/` into the author's project directory and takes an EXCLUSIVE lock on it.
 * The lock blocks rather than fails, so a project Studio opened eagerly would hang
 * the author's own `lore` CLI with no error anywhere to explain it.
 */

/** The backend's ignore file. Its name is part of Lore's contract, not ours. */
const IGNORE_FILE = ".loreignore";

/** Lore's own marker directory; its presence is what "already a repository" means. */
const REPOSITORY_DIRECTORY = ".lore";

/**
 * `repositoryCreate` fails outright without a URL even for a repository that will
 * never see a network (`lore-revision/src/repository/create.rs`), so a repository with
 * no server still has to name one. Connecting a server later rewrites it
 * (`remote.ts`), and `isVcsRemoteConfigured` is what reads this back as "none".
 *
 * **This used to be `lore://127.0.0.1:41337/local`, and that was a live hazard.**
 * Measured: the backend keeps only the ORIGIN of the URL it is given, so the `/local`
 * segment was dropped and every project Studio has ever created carries
 * `remote_url = "lore://127.0.0.1:41337"` - the default loreserver address. Nothing
 * dialled it while every call was offline, but a host running a local server would have
 * had its projects find it the moment one was not. `.invalid` is reserved by RFC 2606
 * and can never resolve, so the same mistake now fails to look up a name instead.
 *
 * Creating a repository must also stay OFFLINE: measured, `repositoryCreate` with
 * `offline: false` creates the repository ON THE SERVER named by this URL, and refuses
 * when one of that name already exists with a different id.
 */
const PLACEHOLDER_REPOSITORY_URL = VCS_UNCONFIGURED_REMOTE_URL;

const DEFAULT_INITIAL_MESSAGE = "Enable version control";

/**
 * The same shape the renderer sends over IPC, aliased rather than restated: two
 * declarations of one options bag is how a field arrives from the UI and is dropped
 * here without anything failing.
 */
export type InitRepositoryOptions = VcsInitOptions;

export interface InitRepositoryResult {
    /** Repository (partition) id, hex. */
    repositoryId: string;
    /** The initial commit. */
    revision: string;
    /** Files in that commit. Excludes directories, which Lore counts separately. */
    fileCount: number;
}

/** The directory already holds a working repository, so there is nothing safe to do. */
export class RepositoryExistsError extends Error {
    constructor(readonly root: string) {
        super(`${root} is already under version control`);
        this.name = "RepositoryExistsError";
    }
}

/**
 * A repository directory with no commits in it - what an interrupted setup leaves.
 *
 * Its own error because the alternative is a lie the author cannot act on. Such a
 * repository is unusable: its id is only readable off the revision history header, so
 * with no revisions there is nothing to read it back with. Reporting that as "already
 * under version control" tells the author the thing they are attempting is done while
 * nothing works, and leaves them to guess that the fix is deleting a hidden directory.
 * {@link initRepository} rolls this state back on its own; this error exists for the
 * case where the rollback could not.
 */
export class IncompleteRepositoryError extends Error {
    constructor(readonly root: string) {
        super(
            `${root} holds a version control repository with no commits, left behind by an interrupted setup. `
            + `Remove ${path.join(root, REPOSITORY_DIRECTORY)} and enable version control again.`,
        );
        this.name = "IncompleteRepositoryError";
    }
}

export function isRepositoryDirectory(root: string): boolean {
    return fs.existsSync(path.join(root, REPOSITORY_DIRECTORY));
}

/** How long to keep trying to remove a rolled-back repository directory. */
const ROLLBACK_ATTEMPTS = 20;
const ROLLBACK_RETRY_MS = 100;

/**
 * Whether the repository has any commits.
 *
 * Measured: a repository created but never committed to answers `revisionHistory`
 * with success and no header at all, so "no revisions" is a positive determination
 * rather than an inference from an error. A thrown error is deliberately NOT read as
 * "empty" - the two errors this feeds differ in what they tell the author to delete,
 * and being wrong in that direction destroys real history.
 */
async function hasRevisions(globals: LoreGlobals): Promise<boolean> {
    try {
        const { header } = await history(globals, { limit: 1 });
        return Boolean(header?.repository);
    } catch {
        return true;
    }
}

/**
 * Undo a `repositoryCreate` whose follow-up failed.
 *
 * Safe to do wholesale because nothing has been committed yet: this call created the
 * directory moments ago, still holds the exclusive lock on it, and there is no
 * history inside to lose. Removing it is what lets the author simply try again.
 *
 * The release is not optional. Lore keeps the repository open after the last call, and
 * while it does, Windows refuses to remove the directory with EPERM - the same
 * behaviour that once stopped a test deleting its own temp directory.
 *
 * Never throws. The caller has a real failure to report and the cleanup must not
 * replace it with a worse-explained one; a rollback that could not finish surfaces on
 * the next attempt as {@link IncompleteRepositoryError}.
 *
 * Only `.lore/` is removed. The ignore file is inert without a repository and the
 * retry rewrites it, so deleting it would be risk without benefit.
 */
async function discardCreatedRepository(globals: LoreGlobals, root: string): Promise<void> {
    await flushRepository(globals).catch(() => undefined);
    await releaseRepository(globals).catch(() => undefined);

    for (let attempt = 0; attempt < ROLLBACK_ATTEMPTS; attempt++) {
        try {
            fs.rmSync(path.join(root, REPOSITORY_DIRECTORY), { recursive: true, force: true });
            return;
        } catch {
            await new Promise((resolve) => setTimeout(resolve, ROLLBACK_RETRY_MS));
        }
    }
}

/**
 * Put a project under version control: create the repository, write the exclusion
 * policy, commit everything it allows.
 *
 * Three things here are not obvious and all three are load-bearing.
 *
 * **The ignore file is written before staging, not after.** Staging hands Lore the
 * repository root and lets it recurse, so the ignore file is the ONLY thing standing
 * between `node_modules` and permanent history. Written afterwards it would be
 * correct for every commit except the one that matters most.
 *
 * **It also guarantees the first commit is not empty.** Lore refuses to commit
 * nothing - `revisionCommit` answers "Nothing staged for commit" - and a repository
 * with zero revisions is unusable: its id lives on the history header, so nothing can
 * read it back. A brand new project with no files would hit exactly that without a
 * file the policy itself contributes.
 *
 * **The flush is mandatory.** Lore's mutable store holds branch tips in memory and
 * writes them lazily, so a process that commits and exits promptly can lose the
 * commit even though the call returned a revision. It is a race rather than a stable
 * failure, which is worse: it works until the machine is busy.
 *
 * **Everything after `repositoryCreate` is transactional.** A failure between creating
 * the repository and committing into it would otherwise leave a directory that reads
 * as a repository to every cheap test, contains nothing, and cannot be initialised
 * again - the author told they already have version control while none of it works.
 * So the repository is rolled back on failure, and the original error is what reaches
 * the caller rather than anything the cleanup ran into.
 */
export async function initRepository(
    globals: LoreGlobals,
    options: InitRepositoryOptions = {},
): Promise<InitRepositoryResult> {
    const root = globals.repositoryPath;
    const scoped: LoreGlobals = { ...globals, identity: options.identity ?? globals.identity };

    if (isRepositoryDirectory(root)) {
        // Lore would refuse too ("Repository already exist in path ..."), but only
        // after loading the native library, and re-initialising would orphan the
        // existing history rather than fail. WHICH refusal matters: one tells the
        // author they are done, the other tells them their setup was interrupted and
        // names the directory to remove.
        throw (await hasRevisions(scoped))
            ? new RepositoryExistsError(root)
            : new IncompleteRepositoryError(root);
    }

    const created = await createRepository(scoped, {
        repositoryUrl: options.repositoryUrl ?? PLACEHOLDER_REPOSITORY_URL,
        description: options.description,
    });

    try {
        fs.writeFileSync(path.join(root, IGNORE_FILE), renderWorkingSetIgnoreFile(), "utf-8");

        // The root, not a file list. Lore recurses and applies the ignore file itself,
        // which also sidesteps handing a large project's worth of paths across the FFI
        // boundary as one array. Paths that land outside the repository still raise -
        // that guard is the reason `stage` is not called with the escape hatch.
        const staged = await stage(scoped, [root]);
        const revision = await commit(scoped, options.message ?? DEFAULT_INITIAL_MESSAGE);
        await flushRepository(scoped);

        return {
            repositoryId: created.repository,
            revision: revision.revision,
            fileCount: staged.counts?.fileAddCount ?? 0,
        };
    } catch (error) {
        await discardCreatedRepository(scoped, root);
        throw error;
    }
}

/**
 * There was nothing to record, so no revision was made.
 *
 * Its own error rather than a null return, because the two callers want opposite
 * things: an author who pressed Commit needs to be told their tree is unchanged, and
 * an automatic checkpoint needs to do nothing at all. Both would be served badly by
 * Lore's own wording, which is what this replaces.
 *
 * Empty revisions are not a cosmetic problem. A history where every fifteen minutes
 * adds an identical entry is one the author cannot read, and "restore to before lunch"
 * stops being answerable.
 */
export class NothingToCommitError extends Error {
    constructor(readonly root: string) {
        // The message reaches an AUTHOR - it is rendered verbatim in the version rail, 320px wide -
        // so it does not name the repository. They know which project they are in; the path only
        // wrapped the sentence onto a second line. Anything logging this still has `root`.
        super("Nothing has changed since the last version");
        this.name = "NothingToCommitError";
    }
}

/**
 * Lore's refusal to make an empty revision.
 *
 * Matched on the message because that is the only thing it distinguishes itself by -
 * the error code is the generic one every failed verb returns. Pinned by
 * `commit.integration.test.ts`, so a reworded upstream fails a test rather than
 * turning a routine "nothing changed" into an opaque error in front of an author.
 */
function isNothingStaged(error: unknown): boolean {
    return error instanceof Error && /nothing staged for commit/i.test(error.message);
}

/**
 * Whether a commit would record anything, without scanning.
 *
 * `scan: false` is what makes this safe to ask: a scanning status is NOT a pure read -
 * it records newly discovered directories into staged state - while this form reports
 * only what is already staged (§4.17).
 *
 * Two sources because neither is enough alone. The stage result covers what this call
 * just staged; the staged revision covers work staged earlier and never committed,
 * which a stage of an unchanged tree reports as zero. Measured: a real change gives
 * `totalCount: 1` and a staged revision hash, a clean tree gives `totalCount: 0` and
 * no staged revision at all.
 */
async function hasSomethingToCommit(globals: LoreGlobals, staged: StageResult): Promise<boolean> {
    if ((staged.counts?.totalCount ?? 0) > 0) return true;
    const status = await repositoryStatus(globals, { scan: false, revisionOnly: true });
    return Boolean(status.revision?.revisionStaged);
}

/**
 * Record the working tree as a new revision.
 *
 * The order below is the whole content of this function, and every step is where it is
 * because moving it loses or corrupts something:
 *
 *  1. **Stage the repository root**, not a file list. Lore recurses and applies the
 *     ignore file itself, so the exclusion policy is enforced by the thing that also
 *     enforces it during a scan. A path that lands OUTSIDE the repository still raises
 *     rather than being skipped - `invoke` turns Lore's PATH_IGNORE into an error -
 *     which is the only reason a mistyped path cannot silently drop an asset out of
 *     history. (Excluded paths report FILTER_EXCLUDE instead, so the ignore file does
 *     not trip that guard.)
 *  2. **Establish that there is something to commit**, and refuse before writing
 *     anything if there is not. This is not merely a nicer error than Lore's: step 3
 *     has a side effect that outlives a failed commit.
 *  3. **Label the revision, BEFORE committing.** Measured, and the opposite of what the
 *     verb's name suggests: `revisionMetadataSet` writes to the STAGED revision - the
 *     one the next commit will create - not to the current head. Setting it afterwards
 *     put every label on the following revision, so a checkpoint read back as a commit
 *     and the next commit read back as a checkpoint. Measured with the same experiment:
 *     a set with NOTHING staged does not fail, it waits and attaches to whatever is
 *     committed next - which is why step 2 comes first, and why every commit path here
 *     writes the key (a stray label is then overwritten rather than inherited).
 *  4. **Flush.** NOT politeness. Lore holds branch tips in memory and writes them
 *     lazily, so a process that commits and exits promptly loses the commit even
 *     though the call returned a revision - and it is a RACE, not a stable failure,
 *     so it works until the machine is busy. Reporting success before this is
 *     reporting a commit that may not exist.
 *
 * The renderer's pending saves have to be flushed BEFORE this runs. That is the
 * caller's job (see VcsManager.commit) because only the main process can ask a window
 * to do it; a debounced auto-save still owed at step 1 would make this revision
 * describe a file that is about to change.
 */
export async function commitWorkingTree(
    globals: LoreGlobals,
    options: { message: string; kind: VcsRevisionKind },
): Promise<VcsCommitResult> {
    const staged = await stage(globals, [globals.repositoryPath]);
    if (!(await hasSomethingToCommit(globals, staged))) {
        throw new NothingToCommitError(globals.repositoryPath);
    }

    // Namespaced because these keys share one map with Lore's own - a revision already
    // carries `branch`, `timestamp`, `message`, `created-by` and `committed-by`.
    await setRevisionMetadata(globals, { [VCS_REVISION_KIND_KEY]: options.kind });

    let revision;
    try {
        revision = await commit(globals, options.message);
    } catch (error) {
        if (isNothingStaged(error)) throw new NothingToCommitError(globals.repositoryPath);
        throw error;
    }

    await flushRepository(globals);

    return {
        revision: revision.revision,
        number: revision.revisionNumber,
        kind: options.kind,
        // Directories are excluded: they are counted separately by Lore and an author
        // reading "12 files" does not mean the folders those files are in.
        fileCount: (staged.counts?.fileAddCount ?? 0)
            + (staged.counts?.fileModifyCount ?? 0)
            + (staged.counts?.fileDeleteCount ?? 0)
            + (staged.counts?.fileMoveCount ?? 0),
    };
}

/**
 * What kind of revision this is, or undefined when it does not say.
 *
 * Undefined is a real answer and the history UI has to render it: the repository's
 * first commit was written by {@link initRepository} before kinds existed, and any
 * revision made by another client carries whatever that client wrote. Treating absence
 * as either kind would mislabel those.
 *
 * A failed read degrades to undefined rather than throwing. This is called once per
 * revision to build a list, and Lore reports "this revision has no such key" the same
 * way it reports a lookup that went wrong - so the alternative is a history panel that
 * cannot render because one entry predates a metadata key.
 */
export async function readRevisionKind(
    globals: LoreGlobals,
    revision: string,
): Promise<VcsRevisionKind | undefined> {
    const entry = await getRevisionMetadata(globals, revision, VCS_REVISION_KIND_KEY).catch(() => undefined);
    return toRevisionKind(entry?.text);
}

/** Only the two kinds Studio writes. Anything else is another client's vocabulary. */
function toRevisionKind(value: string | undefined): VcsRevisionKind | undefined {
    return value === "commit" || value === "checkpoint" ? value : undefined;
}

/**
 * Lore's own metadata keys, which share one map with Studio's namespaced ones.
 *
 * Their spelling is Lore's, not Studio's, which is why they live here and not in
 * `@shared/types/vcs`: nothing above this module is allowed to know them.
 *
 * `committed-by` rather than `created-by`: a revision carries both, and they differ once
 * a revision is rewritten (a rebase, a graft) - the author reading a history wants who
 * put this revision on the branch.
 */
const LORE_MESSAGE_KEY = "message";
const LORE_TIMESTAMP_KEY = "timestamp";
const LORE_COMMITTER_KEY = "committed-by";

/**
 * Everything one revision says about itself, in ONE backend call.
 *
 * Deliberately not four calls, and deliberately not a second pass after
 * {@link readRevisionKind}: `revisionMetadataList` hands back every key on a revision,
 * so a history read that already pays one round trip per revision for the kind gets the
 * message, the time and the author for essentially free. Measured over a six-revision
 * repository, median of nine runs: the six single-key `revisionMetadataGet` calls this
 * replaces took 4.2ms, the six `revisionMetadataList` calls take 5.6ms. Same number of
 * round trips, ~0.2ms per revision more, three fields instead of one.
 *
 * Every field is optional and absence is a real answer, not a failure:
 *
 *  - the repository's first commit predates {@link VCS_REVISION_KIND_KEY}, so it has no
 *    kind at all, and a revision from another client carries that client's vocabulary;
 *  - a key that is not there must read as ABSENT rather than as an empty string, which
 *    would render as a commit with a blank author instead of one that did not say.
 *
 * `timestamp` is the one key Lore does not write as a string - it is NUMERIC, epoch
 * MILLISECONDS (measured against wall clock across a commit; see
 * `revisionDetails.integration.test.ts`). The decoder reads that union member because
 * of this call site; before it did, the value arrived silently absent.
 *
 * A failed read degrades to an empty answer rather than throwing, for
 * {@link readRevisionKind}'s reason: Lore reports "no such key" the same way it reports
 * a lookup that went wrong, and a history panel must not fail to render because one
 * entry predates a key.
 */
export interface RevisionDetails {
    kind?: VcsRevisionKind;
    message?: string;
    /** Epoch milliseconds, UTC. */
    timestamp?: number;
    author?: string;
}

export async function readRevisionDetails(
    globals: LoreGlobals,
    revision: string,
): Promise<RevisionDetails> {
    const entries = await listRevisionMetadata(globals, revision).catch(() => []);
    const byKey = new Map(entries.map((entry) => [entry.key, entry]));

    const details: RevisionDetails = {};
    const kind = toRevisionKind(byKey.get(VCS_REVISION_KIND_KEY)?.text);
    if (kind) details.kind = kind;
    // Empty is absent on purpose: an empty string would render as a revision with a
    // blank title or a blank author rather than as one that did not say.
    const message = byKey.get(LORE_MESSAGE_KEY)?.text;
    if (message) details.message = message;
    const timestamp = byKey.get(LORE_TIMESTAMP_KEY)?.numeric;
    if (timestamp !== undefined) details.timestamp = timestamp;
    const author = byKey.get(LORE_COMMITTER_KEY)?.text;
    if (author) details.author = author;
    // Keys the revision does not carry are OMITTED, not set to undefined: an explicit
    // undefined survives the IPC structured clone as a present key, so `"author" in
    // entry` would answer yes for a revision that never had one.
    return details;
}

/**
 * Where the repository stands, WITHOUT walking the working tree: which branch, which head, and
 * which number that head carries.
 *
 * The same `scan: false, revisionOnly: true` read `hasSomethingToCommit` uses, and it is that
 * combination that makes this callable from a status bar at all. A scanning status is not a pure
 * read - discovering a new directory records it into staged state, so a surface that asked on its
 * own would eventually report deletions the author never made (§4.17) - and `revisionOnly` drops
 * the per-file events, which are the only expensive part of the answer.
 *
 * The branch is the whole reason this exists: it is the one thing the revision graph does not
 * carry, so reading it used to mean either scanning or walking every revision in the project.
 */
export async function readBranchIdentity(globals: LoreGlobals): Promise<{
    branch: string;
    head?: string;
    headNumber: number;
}> {
    const { revision } = await repositoryStatus(globals, { scan: false, revisionOnly: true });
    return {
        branch: revision?.branchName ?? "",
        head: revision?.revision,
        headNumber: revision?.revisionNumber ?? 0,
    };
}

/**
 * Where the working tree stands relative to the last commit.
 *
 * `scan` walks the tree; without it the answer describes only what is already staged,
 * which is never what a caller asking "what changed" means. `checkDirty` is
 * deliberately left off: it exists to compare content rather than metadata, and a
 * rewritten-but-identical file is measured NOT to be reported as modified without it.
 * Since Studio's atomic writer replaces a file wholesale on every save, that would
 * otherwise have been a constant source of phantom changes - it is not, so the extra
 * content pass over every asset in the project buys nothing.
 *
 * The result includes directory entries, because Lore reports them and counts them
 * in its own summary. Filtering them here would leave `files` and `counts` describing
 * different lists; `VcsFileChange.directory` lets a caller drop them instead.
 *
 * NOT a pure read, and nothing in its name says so: a scan that discovers a NEW
 * DIRECTORY records it in the repository's staged state, so removing that directory
 * afterwards is reported as a deletion for the rest of the session even though it was
 * never committed. Established by controlled comparison - the same sequence without an
 * intervening status reports nothing, and a new file inside an already tracked
 * directory does not stick either. Pinned in repository.integration.test.ts.
 */
export async function getStatus(globals: LoreGlobals): Promise<VcsStatus> {
    const status = await repositoryStatus(globals, { scan: true });
    const revision = status.revision;
    const files = status.files.map(toFileChange);
    const summary = status.summary;

    return {
        branch: revision?.branchName ?? "",
        head: revision?.revision,
        revisionNumber: revision?.revisionNumber ?? 0,
        stagedRevision: revision?.revisionStaged,
        clean: files.length === 0,
        files,
        counts: {
            added: summary?.adds ?? 0,
            modified: summary?.modifies ?? 0,
            deleted: summary?.deletes ?? 0,
            moved: summary?.moves ?? 0,
            copied: summary?.copies ?? 0,
        },
        sync: {
            remoteAvailable: revision?.remoteAvailable ?? false,
            remoteAuthorized: revision?.remoteAuthorized ?? false,
            remoteBranchExists: revision?.remoteBranchExist ?? false,
            localAhead: revision?.isLocalAhead ?? false,
            remoteAhead: revision?.isRemoteAhead ?? false,
            remoteRevision: revision?.revisionRemote,
        },
    };
}

/**
 * Lore's `LoreFileAction`, which has no "modified" member.
 *
 * KEEP means the node is where it was; status only reports a file at all when it has
 * a pending change, so a reported KEEP is a content change and the summary counts it
 * under `modifies`. Measured, because reading it as "unchanged" would drop every
 * edit in the project from the list.
 *
 * A rename arrives as a delete plus an add, not as MOVE - also measured. MOVE and
 * COPY are reachable through the explicit move verbs, so they are mapped rather than
 * assumed absent.
 */
const CHANGE_KINDS: Readonly<Record<number, VcsChangeKind>> = {
    0: "modified",
    1: "added",
    2: "deleted",
    3: "moved",
    4: "copied",
};

/** `LoreNodeType.DIRECTORY`. FILE is 1 and LINK is 2, and Studio treats both as files. */
const NODE_TYPE_DIRECTORY = 0;

function toFileChange(file: LoreStatusFilePayload): VcsFileChange {
    return {
        path: file.path,
        directory: file.type === NODE_TYPE_DIRECTORY,
        // An action this version of Studio does not know is still a change the author
        // made. Reporting it as a modification is wrong in the label; dropping it
        // would be wrong about whether anything happened at all.
        kind: CHANGE_KINDS[file.action] ?? "modified",
        size: file.size,
        staged: file.staged,
        dirty: file.dirty,
        conflicted: file.conflict,
        conflictUnresolved: file.conflictUnresolved,
        // Carried rather than dropped, and honestly labelled where they are declared:
        // measured, status reports NO files at all while a merge is open (§4.24), so
        // none of these three has ever been seen set. The paths a merge left open come
        // from `merge.ts`, not from here.
        conflictAutomerged: file.conflictAutomerged,
        conflictMine: file.conflictMine,
        conflictTheirs: file.conflictTheirs,
        fromPath: file.fromPath || undefined,
    };
}
