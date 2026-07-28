import fs from "fs";
import path from "path";
import type {
    VcsChangeKind,
    VcsFileChange,
    VcsStatus,
} from "@shared/types/vcs";
import { renderWorkingSetIgnoreFile } from "./workingSet";
import {
    commit,
    createRepository,
    flushRepository,
    history,
    releaseRepository,
    repositoryStatus,
    stage,
    type LoreGlobals,
    type LoreStatusFilePayload,
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
 * never see a network (`lore-revision/src/repository/create.rs`). Nothing dials it
 * until a remote is actually configured, and collaboration rewrites it then.
 */
const PLACEHOLDER_REPOSITORY_URL = "lore://127.0.0.1:41337/local";

const DEFAULT_INITIAL_MESSAGE = "Enable version control";

export interface InitRepositoryOptions {
    /** Author recorded on the first commit, and persisted into the repository config. */
    identity?: string;
    description?: string;
    message?: string;
    /** Only for a repository created against a known remote; a placeholder is used otherwise. */
    repositoryUrl?: string;
}

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
        fromPath: file.fromPath || undefined,
    };
}
