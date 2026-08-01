import { LORE_METADATA_TYPES } from "./abi/definitions";
import { invoke, type InvokeOptions, type LoreGlobals } from "./call";
import {
    LoreTag,
    type LoreAuthIdentityPayload,
    type LoreBranchCreatePayload,
    type LoreBranchEntryPayload,
    type LoreBranchInfoPayload,
    type LoreBranchPushPayload,
    type LoreCloneBeginPayload,
    type LoreCloneCountPayload,
    type LoreCloneEndPayload,
    type LoreCloneProgressPayload,
    type LoreConfigPayload,
    type LoreSyncProgressPayload,
    type LoreSyncRevisionPayload,
    type LoreSyncTargetPayload,
    type LoreCommitRevisionPayload,
    type LoreDiffFilePayload,
    type LoreHistoryEntryPayload,
    type LoreHistoryPayload,
    type LoreMergeAbortBeginPayload,
    type LoreMergeConflictFilePayload,
    type LoreMergeResolveFilePayload,
    type LoreMergeResolveRevisionPayload,
    type LoreMergeStartBeginPayload,
    type LoreMergeStartEndPayload,
    type LoreMergeUnresolveFilePayload,
    type LoreMetadataPayload,
    type LoreRepositoryCreatePayload,
    type LoreRevisionInfoPayload,
    type LoreStageEndPayload,
    type LoreStageFilePayload,
    type LoreStatusFilePayload,
    type LoreStatusRevisionPayload,
    type LoreStatusSummaryPayload,
    type LoreStorageDataPayload,
    type LoreStorageOpenedPayload,
    type LoreTreeChildPayload,
    type LoreTreeLoadedPayload,
    type LoreTreeNodeInfoPayload,
    type LoreTreeResolvePayload,
} from "./events";
import {
    contextBytes,
    loreMetadataTypeArray,
    loreString,
    loreStringArray,
    partitionBytes,
    revisionBytes,
    type LoreHex,
} from "./values";

/**
 * The typed operations Studio calls. The only surface above this layer.
 *
 * Each wrapper fills in every field of its args struct rather than relying on koffi
 * to zero what is omitted - a struct literal that names all its fields is also the
 * documentation of what the verb accepts, and it makes an ABI change that adds a
 * field a compile-time question rather than a silent default.
 *
 * Handles (`StoreHandle`, `TreeHandle`) stay nominal-ish wrappers around Lore's
 * `uint64` ids so a store handle cannot be passed where a tree handle belongs.
 */

export interface StoreHandle { readonly handleId: number }
export interface TreeHandle { readonly handleId: number }

/** Lore fills unset hash fields with zeroes; that is "absent", not a revision. */
const ZERO_HASH = "0".repeat(64);

// -- repository -------------------------------------------------------------

export interface CreateRepositoryOptions {
    /**
     * Mandatory even for a fully offline repository - `repository_create` fails
     * without it (`lore-revision/src/repository/create.rs`). Nothing dials it until
     * a remote is actually configured, so a placeholder is fine for a local project.
     */
    repositoryUrl: string;
    description?: string;
    /** Explicit repository id; Lore generates one when empty. */
    id?: string;
}

export async function createRepository(
    globals: LoreGlobals,
    options: CreateRepositoryOptions,
): Promise<LoreRepositoryCreatePayload> {
    const result = await invoke("repositoryCreate", globals, {
        repositoryUrl: scopeString(options.repositoryUrl),
        description: scopeString(options.description),
        id: scopeString(options.id),
        useSharedStore: 0,
        sharedStorePath: scopeString(undefined),
    });
    return result.one<LoreRepositoryCreatePayload>(LoreTag.REPOSITORY_CREATE);
}

/**
 * Force Lore's stores to disk.
 *
 * NOT optional after a write. The mutable store that holds branch tips is flushed
 * lazily, so a process that commits and exits promptly can lose the commit outright:
 * the revision is returned to the caller, the working tree looks right, and a later
 * process sees only the previous revision. Verified by experiment - two commits and
 * no flush, second one gone; same sequence with a flush, both present. It is a race,
 * not a stable failure, which makes it worse.
 */
export async function flushRepository(globals: LoreGlobals): Promise<void> {
    await invoke("repositoryFlush", globals, { unused: 0 });
}

/** Release Lore's exclusive repository lock. Other processes BLOCK on it, not fail. */
export async function releaseRepository(globals: LoreGlobals): Promise<void> {
    await invoke("repositoryRelease", globals, { unused: 0 });
}

export interface RepositoryStatus {
    revision: LoreStatusRevisionPayload | undefined;
    files: LoreStatusFilePayload[];
    summary: LoreStatusSummaryPayload | undefined;
}

export interface StatusOptions {
    /** Walk the working tree for changes. Off means "report staged state only". */
    scan?: boolean;
    /** Compare content, not just metadata. Slower, and the only way to catch a touched-but-identical file. */
    checkDirty?: boolean;
    /** Limit to these repository-absolute paths. */
    paths?: readonly string[];
    /** Skip the per-file events; just the branch/revision header. */
    revisionOnly?: boolean;
}

export async function repositoryStatus(
    globals: LoreGlobals,
    options: StatusOptions = {},
): Promise<RepositoryStatus> {
    const result = await invoke("repositoryStatus", globals, {
        staged: 0,
        scan: options.scan === false ? 0 : 1,
        checkDirty: options.checkDirty ? 1 : 0,
        reset: 0,
        syncPoint: 0,
        revisionOnly: options.revisionOnly ? 1 : 0,
        count: 0,
        paths: scopeStringArray(options.paths),
    }, { allowIgnoredPaths: true });

    return {
        revision: result.first<LoreStatusRevisionPayload>(LoreTag.REPOSITORY_STATUS_REVISION),
        files: result.of<LoreStatusFilePayload>(LoreTag.REPOSITORY_STATUS_FILE),
        summary: result.first<LoreStatusSummaryPayload>(LoreTag.REPOSITORY_STATUS_SUMMARY),
    };
}

// -- staging and commit -----------------------------------------------------

export interface StageResult {
    files: LoreStageFilePayload[];
    counts: LoreStageEndPayload | undefined;
}

/**
 * Stage paths for the next commit.
 *
 * Paths must be ABSOLUTE and inside the repository. Lore resolves a relative path
 * against the process CWD, and answers an outside path with success plus a
 * PATH_IGNORE event - `invoke` turns that into an error, which is the only reason a
 * mistyped path does not silently drop an asset out of version control.
 */
export async function stage(
    globals: LoreGlobals,
    paths: readonly string[],
    options: InvokeOptions = {},
): Promise<StageResult> {
    const result = await invoke("fileStage", globals, {
        paths: scopeStringArray(paths),
        caseChange: 0,
        // Recurse into directories rather than requiring a fully expanded file list.
        scan: 1,
    }, options);
    return {
        files: result.of<LoreStageFilePayload>(LoreTag.FILE_STAGE_FILE),
        counts: result.first<LoreStageEndPayload>(LoreTag.FILE_STAGE_END),
    };
}

export async function unstage(globals: LoreGlobals, paths: readonly string[]): Promise<void> {
    await invoke("fileUnstage", globals, { paths: scopeStringArray(paths) });
}

/**
 * Commit what is staged.
 *
 * The caller MUST flush afterwards - see {@link flushRepository}. This deliberately
 * does not flush on its own: a batch that commits several times should pay for one
 * flush, and hiding it here would make the requirement invisible at the call sites
 * that actually decide when a write is durable.
 */
export async function commit(globals: LoreGlobals, message: string): Promise<LoreCommitRevisionPayload> {
    const result = await invoke("revisionCommit", globals, {
        message: scopeString(message),
        link: scopeString(undefined),
        linkPaths: scopeStringArray(undefined),
        linkMessages: scopeStringArray(undefined),
        layer: scopeString(undefined),
        layerPaths: scopeStringArray(undefined),
        layerMessages: scopeStringArray(undefined),
        stats: 0,
    });
    return result.one<LoreCommitRevisionPayload>(LoreTag.REVISION_COMMIT_REVISION);
}

// -- history ----------------------------------------------------------------

export interface RevisionNode {
    revision: LoreHex;
    /** Monotonic per repository; a cheap topological rank. */
    number: number;
    /** Direct parent first, the second parent of a merge second. */
    parents: LoreHex[];
}

export interface HistoryResult {
    /** Repository and branch the history belongs to, from the header event. */
    header: LoreHistoryPayload | undefined;
    nodes: Map<LoreHex, RevisionNode>;
}

/**
 * Read the revision DAG.
 *
 * Also the cheapest way to learn the repository id: the header event carries it, and
 * `repositoryInfo` - the obvious alternative - dials the remote even under
 * `offline: true` and blocks until the socket times out.
 */
export async function history(
    globals: LoreGlobals,
    options: { revision?: LoreHex; branch?: string; limit?: number } = {},
): Promise<HistoryResult> {
    const result = await invoke("revisionHistory", globals, {
        revision: scopeString(options.revision),
        branch: scopeString(options.branch),
        date: 0,
        length: options.limit ?? 0,
        onlyBranch: 0,
    });

    const nodes = new Map<LoreHex, RevisionNode>();
    for (const entry of result.of<LoreHistoryEntryPayload>(LoreTag.REVISION_HISTORY_ENTRY)) {
        nodes.set(entry.revision, {
            revision: entry.revision,
            number: entry.revisionNumber,
            parents: entry.parents,
        });
    }
    return { header: result.first<LoreHistoryPayload>(LoreTag.REVISION_HISTORY), nodes };
}

export async function revisionInfo(globals: LoreGlobals, revision: LoreHex): Promise<LoreRevisionInfoPayload> {
    const result = await invoke("revisionInfo", globals, {
        revision: scopeString(revision),
        delta: 0,
        metadata: 0,
    });
    return result.one<LoreRevisionInfoPayload>(LoreTag.REVISION_INFO);
}

/**
 * Which paths differ between two revisions.
 *
 * The filter to run before reading blobs - never walk the whole tree. Lore's own
 * file diff is line-oriented and no use for Studio's content, but knowing *which*
 * files moved is exactly what the diff engine needs as input.
 */
export async function changedPaths(
    globals: LoreGlobals,
    from: LoreHex,
    to: LoreHex,
    paths?: readonly string[],
): Promise<LoreDiffFilePayload[]> {
    const result = await invoke("revisionDiff", globals, {
        revisionSource: scopeString(from),
        revisionTarget: scopeString(to),
        paths: scopeStringArray(paths),
    }, { allowIgnoredPaths: true });
    return result.of<LoreDiffFilePayload>(LoreTag.REVISION_DIFF_FILE);
}

// -- revision metadata ------------------------------------------------------

/**
 * Attach string metadata to the CURRENT revision.
 *
 * There is no revision argument - the args struct does not have one - so this only
 * ever writes to wherever the repository is now. A caller labelling a commit has to
 * run it AFTER the commit, and like every other write it is not durable until
 * {@link flushRepository}.
 *
 * Everything is written as `STRING`. The format array is what tells Lore how to parse
 * the text it is handed, and the alternatives (`NUMERIC`, `BINARY`) would make the
 * value unreadable to a client that expected the text back verbatim.
 */
export async function setRevisionMetadata(
    globals: LoreGlobals,
    entries: Readonly<Record<string, string>>,
): Promise<void> {
    const keys = Object.keys(entries);
    if (keys.length === 0) return;
    await invoke("revisionMetadataSet", globals, {
        keys: scopeStringArray(keys),
        values: scopeStringArray(keys.map((key) => entries[key])),
        // One format per entry, read by index. Same length as the other two arrays by
        // construction rather than by agreement between call sites.
        formats: loreMetadataTypeArray(keys.map(() => LORE_METADATA_TYPES.STRING)),
    });
}

/**
 * One metadata key on one revision, or undefined when the revision does not carry it.
 *
 * Absent is a normal answer, not a failure: nothing obliges a revision to have any
 * metadata, and every revision written before Studio started labelling them has none.
 */
export async function getRevisionMetadata(
    globals: LoreGlobals,
    revision: LoreHex,
    key: string,
): Promise<LoreMetadataPayload | undefined> {
    const result = await invoke("revisionMetadataGet", globals, {
        key: scopeString(key),
        revision: scopeString(revision),
    });
    return result.of<LoreMetadataPayload>(LoreTag.METADATA).find((entry) => entry.key === key);
}

/** Every metadata key on one revision. */
export async function listRevisionMetadata(
    globals: LoreGlobals,
    revision: LoreHex,
): Promise<LoreMetadataPayload[]> {
    const result = await invoke("revisionMetadataList", globals, { revision: scopeString(revision) });
    return result.of<LoreMetadataPayload>(LoreTag.METADATA);
}

// -- content ----------------------------------------------------------------

export async function openStore(globals: LoreGlobals, repositoryPath: string): Promise<StoreHandle> {
    const result = await invoke("storageOpen", globals, {
        repositoryPath: scopeString(repositoryPath),
        inMemory: 0,
        remoteConfig: { remoteUrl: scopeString(undefined) },
        hasRemoteConfig: 0,
        cacheTargetBytes: 0,
        cacheTargetFragments: 0,
    });
    return { handleId: result.one<LoreStorageOpenedPayload>(LoreTag.STORAGE_OPENED).handleId };
}

export async function closeStore(globals: LoreGlobals, handle: StoreHandle): Promise<void> {
    await invoke("storageClose", globals, { handle: { handleId: handle.handleId } });
}

/**
 * Load one revision's tree.
 *
 * Note the argument types: `repository` and `revisionHash` are fixed-width binary
 * fields, not hex strings. That is what the header says, and passing the wrong one
 * is the failure this whole binding exists to make impossible - the SDK's converter
 * turns an unexpected hex string into a ZERO-FILLED partition and the call succeeds
 * against a repository that does not exist.
 */
export async function loadTree(
    globals: LoreGlobals,
    store: StoreHandle,
    repository: LoreHex,
    revision: LoreHex,
): Promise<TreeHandle> {
    const result = await invoke("revisionTreeLoad", globals, {
        store: { handleId: store.handleId },
        repository: partitionBytes(repository),
        revisionHash: revisionBytes(revision),
    });
    return { handleId: result.one<LoreTreeLoadedPayload>(LoreTag.REVISION_TREE_LOADED).handleId };
}

export async function closeTree(globals: LoreGlobals, handle: TreeHandle): Promise<void> {
    await invoke("revisionTreeClose", globals, { id: 1, handle: { handleId: handle.handleId } });
}

/** Resolve a repository-relative path in a loaded tree to its node metadata. */
export async function treeNode(
    globals: LoreGlobals,
    handle: TreeHandle,
    repositoryRelativePath: string,
): Promise<LoreTreeNodeInfoPayload> {
    const resolved = await invoke("revisionTreeResolvePath", globals, {
        id: 1,
        handle: { handleId: handle.handleId },
        path: scopeString(repositoryRelativePath),
    });
    const node = resolved.one<LoreTreeResolvePayload>(LoreTag.REVISION_TREE_RESOLVE_PATH_COMPLETE);

    const info = await invoke("revisionTreeNodeInfo", globals, {
        id: 1,
        handle: { handleId: handle.handleId },
        nodeId: node.nodeId,
    });
    return info.one<LoreTreeNodeInfoPayload>(LoreTag.REVISION_TREE_NODE_INFO);
}

/**
 * The entries directly under one node of a loaded tree.
 *
 * `ROOT_NODE_ID` is where a walk starts. Each entry already carries its content
 * address, so enumerating a revision and reading its files needs no
 * `revisionTreeResolvePath` round trip per path.
 *
 * This is the verb the old comment in `revisionReader.ts` was missing. It is NOT one
 * of the three the SDK declares and the library does not export: `lore_revision_tree_
 * list_children` is in the DLL's export table (checked against all 263 symbols of the
 * win32 build), and this binding is exercised against a real repository in
 * `revisionReader.integration.test.ts`.
 */
export async function listTreeChildren(
    globals: LoreGlobals,
    handle: TreeHandle,
    parentNodeId: number,
): Promise<LoreTreeChildPayload[]> {
    const result = await invoke("revisionTreeListChildren", globals, {
        id: 1,
        handle: { handleId: handle.handleId },
        parentNodeId,
    });
    return result.of<LoreTreeChildPayload>(LoreTag.REVISION_TREE_CHILD);
}

/** The node id of a tree's root, which is where {@link listTreeChildren} starts. */
export const ROOT_NODE_ID = 0;

/** `LoreNodeType`. A walk has to know which entries it may descend into. */
export const LORE_NODE_TYPE = { DIRECTORY: 0, FILE: 1, LINK: 2 } as const;

/**
 * Read content by address.
 *
 * `localCache: 1` is deliberate: Lore retains only state fragments by default, so
 * repeatedly diffing the same two revisions would re-fetch the payload bytes from
 * the remote every single time.
 */
export async function readAddress(
    globals: LoreGlobals,
    store: StoreHandle,
    repository: LoreHex,
    address: { hash: LoreHex; context: LoreHex },
): Promise<Buffer> {
    if (!address.hash || address.hash === ZERO_HASH) return Buffer.alloc(0);

    const result = await invoke("storageGet", globals, {
        handle: { handleId: store.handleId },
        items: {
            ptr: [{
                id: 1,
                partition: partitionBytes(repository),
                address: {
                    hash: revisionBytes(address.hash, "address.hash"),
                    context: contextBytes(address.context, "address.context"),
                },
                streaming: 0,
                localCache: 1,
            }],
            count: 1,
        },
    });

    const chunks = result.of<LoreStorageDataPayload>(LoreTag.STORAGE_GET_DATA);
    // Non-streaming reads arrive in order today, but ordering by offset costs
    // nothing and makes the result independent of that.
    return Buffer.concat(chunks.slice().sort((a, b) => a.offset - b.offset).map((chunk) => chunk.bytes));
}

// -- branches ---------------------------------------------------------------

export async function listBranches(
    globals: LoreGlobals,
    options: { archived?: boolean } = {},
): Promise<LoreBranchEntryPayload[]> {
    const result = await invoke("branchList", globals, { archived: options.archived ? 1 : 0 });
    return result.of<LoreBranchEntryPayload>(LoreTag.BRANCH_LIST_ENTRY);
}

export async function branchInfo(globals: LoreGlobals, branch: string): Promise<LoreBranchInfoPayload> {
    const result = await invoke("branchInfo", globals, { branch: scopeString(branch) });
    return result.one<LoreBranchInfoPayload>(LoreTag.BRANCH_INFO);
}

export async function createBranch(
    globals: LoreGlobals,
    branch: string,
    options: { category?: string; id?: string } = {},
): Promise<LoreBranchCreatePayload> {
    const result = await invoke("branchCreate", globals, {
        branch: scopeString(branch),
        category: scopeString(options.category),
        id: scopeString(options.id),
    });
    return result.one<LoreBranchCreatePayload>(LoreTag.BRANCH_CREATE);
}

/**
 * Switch the working tree to a branch or revision.
 *
 * This WRITES the working tree. Studio's history browsing must not use it - reading
 * a past revision goes through {@link loadTree} and {@link readAddress}, which touch
 * nothing on disk. See docs/plans/2026-07-27-001, §4.4.
 */
export async function switchBranch(
    globals: LoreGlobals,
    options: { branch?: string; revision?: LoreHex; reset?: boolean },
): Promise<void> {
    await invoke("branchSwitch", globals, {
        branch: scopeString(options.branch),
        revision: scopeString(options.revision),
        reset: options.reset ? 1 : 0,
        bare: 0,
    });
}

// -- merge ------------------------------------------------------------------

/**
 * The verbs that produce and settle a two-sided write.
 *
 * Everything else on this surface only ever adds a revision on top of one history, so
 * nothing above it has ever had to describe "both sides changed this". These are the
 * exception, and three properties of them shape every wrapper below:
 *
 *  - **The merge state lives in the repository, not in Studio.** Between a start and a
 *    commit the repository is in an in-progress merge that outlives the process. A
 *    caller cannot hold the progress in memory and must be able to re-read it.
 *  - **Every `paths` argument is ABSOLUTE** (§4.4/§4.16), like `fileStage` and unlike
 *    everything `repositoryStatus` reports back. A relative path resolves against the
 *    process CWD and is then ignored for being outside the repository.
 *  - **What the automerge does to Studio's own content is not known here.** These
 *    wrappers transcribe the ABI and nothing more; the behavioural questions are the
 *    subject of `mergeSpike.integration.test.ts`, and no answer to them is encoded in
 *    this file.
 */

export interface MergeStartResult {
    begin: LoreMergeStartBeginPayload | undefined;
    /** Absent when the call reported no end event, which is not the same as "no conflicts". */
    end: LoreMergeStartEndPayload | undefined;
    /** Repository-relative paths, one per conflict event. */
    conflicts: string[];
}

/**
 * Merge another branch into the current one, writing the working tree.
 *
 * `noCommit` is exposed because the two modes are different products: committing
 * immediately is only defensible when nothing conflicted, and stopping short of a
 * commit is what leaves the author a tree to resolve. The caller decides which it is
 * asking for rather than discovering it from the result.
 */
export async function branchMergeStart(
    globals: LoreGlobals,
    options: { branch: string; message?: string; noCommit?: boolean },
): Promise<MergeStartResult> {
    const result = await invoke("branchMergeStart", globals, {
        branch: scopeString(options.branch),
        message: scopeString(options.message),
        noCommit: options.noCommit ? 1 : 0,
        // Links are Lore's cross-repository composition feature. Studio has no interface
        // for them, so a merge is never asked to reason about one.
        link: scopeString(undefined),
        ignoreLinks: 0,
    });
    return {
        begin: result.first<LoreMergeStartBeginPayload>(LoreTag.BRANCH_MERGE_START_BEGIN),
        end: result.first<LoreMergeStartEndPayload>(LoreTag.BRANCH_MERGE_START_END),
        conflicts: result.of<LoreMergeConflictFilePayload>(LoreTag.BRANCH_MERGE_CONFLICT_FILE)
            .map((event) => event.path),
    };
}

export interface MergeResolveResult {
    /** Paths Lore acknowledged as resolved. */
    files: string[];
    /** Present when settling these paths finished the merge and produced a revision. */
    revision: LoreMergeResolveRevisionPayload | undefined;
}

/**
 * Mark paths resolved, taking whatever bytes are in the working tree.
 *
 * The only resolve verb that can express an answer neither side wrote, which is what a
 * per-change merge produces - and the reason this whole path can exist despite Lore
 * having no in-memory revision write API (§4.10): the caller writes the file, then says
 * it is settled.
 */
export async function branchMergeResolve(
    globals: LoreGlobals,
    absolutePaths: readonly string[],
): Promise<MergeResolveResult> {
    return collectResolve(await invoke("branchMergeResolve", globals, {
        paths: scopeStringArray(absolutePaths),
    }));
}

/** Settle paths by taking this side's bytes wholesale. */
export async function branchMergeResolveMine(
    globals: LoreGlobals,
    absolutePaths: readonly string[],
): Promise<MergeResolveResult> {
    return collectResolve(await invoke("branchMergeResolveMine", globals, {
        paths: scopeStringArray(absolutePaths),
    }));
}

/** Settle paths by taking the incoming side's bytes wholesale. */
export async function branchMergeResolveTheirs(
    globals: LoreGlobals,
    absolutePaths: readonly string[],
): Promise<MergeResolveResult> {
    return collectResolve(await invoke("branchMergeResolveTheirs", globals, {
        paths: scopeStringArray(absolutePaths),
    }));
}

function collectResolve(result: Awaited<ReturnType<typeof invoke>>): MergeResolveResult {
    return {
        files: result.of<LoreMergeResolveFilePayload>(LoreTag.BRANCH_MERGE_RESOLVE_FILE)
            .map((event) => event.path),
        revision: result.first<LoreMergeResolveRevisionPayload>(LoreTag.BRANCH_MERGE_RESOLVE_REVISION),
    };
}

/** Put paths back into the unresolved state, undoing a resolve decision. */
export async function branchMergeUnresolve(
    globals: LoreGlobals,
    absolutePaths: readonly string[],
): Promise<string[]> {
    const result = await invoke("branchMergeUnresolve", globals, {
        paths: scopeStringArray(absolutePaths),
    });
    return result.of<LoreMergeUnresolveFilePayload>(LoreTag.BRANCH_MERGE_UNRESOLVE_FILE).map((event) => event.path);
}

/** Redo the automatic merge for paths, discarding whatever is in the working tree for them. */
export async function branchMergeRestart(
    globals: LoreGlobals,
    absolutePaths: readonly string[],
): Promise<void> {
    await invoke("branchMergeRestart", globals, { paths: scopeStringArray(absolutePaths) });
}

/**
 * Abandon the merge.
 *
 * Whether this leaves the working tree exactly as it was before the merge started is
 * NOT established - it is E5 of the spike - and until it is, nothing above this may
 * offer it as a "cancel" the author can trust.
 */
export async function branchMergeAbort(globals: LoreGlobals): Promise<LoreMergeAbortBeginPayload | undefined> {
    const result = await invoke("branchMergeAbort", globals, {
        link: scopeString(undefined),
        ignoreLinks: 0,
    });
    return result.first<LoreMergeAbortBeginPayload>(LoreTag.BRANCH_MERGE_ABORT_BEGIN);
}

/**
 * Stage merge results for the commit that closes a merge.
 *
 * Separate from {@link stage}, and it is an open question whether a merge commit needs
 * it, needs the ordinary stage, or needs neither - see E3 of the spike. The result is
 * read through the same tolerant accessors as {@link stage} so that a verb which
 * reports nothing is an empty answer rather than a throw.
 */
export async function stageMerge(
    globals: LoreGlobals,
    absolutePaths: readonly string[],
): Promise<StageResult> {
    const result = await invoke("fileStageMerge", globals, { paths: scopeStringArray(absolutePaths) });
    return {
        files: result.of<LoreStageFilePayload>(LoreTag.FILE_STAGE_FILE),
        counts: result.first<LoreStageEndPayload>(LoreTag.FILE_STAGE_END),
    };
}

// -- remote -----------------------------------------------------------------

/**
 * The four verbs that touch the network, plus the config read that says whether
 * there is a network to touch.
 *
 * **Every one of them needs `offline: false` on its globals.** Studio's globals are
 * offline everywhere else on purpose (see `VcsManager.globalsFor`), and an offline
 * push does not fail loudly - it simply has nothing to talk to. The flag is left to
 * the caller rather than forced here so that this layer stays a transcription of the
 * ABI and the policy stays in one place above it.
 */

/** One repository config value, or undefined when the key is not set. */
export async function repositoryConfig(globals: LoreGlobals, key: string): Promise<string | undefined> {
    const result = await invoke("repositoryConfigGet", globals, { key: scopeString(key) });
    return result.first<LoreConfigPayload>(LoreTag.REPOSITORY_CONFIG_GET)?.value || undefined;
}

/** The config key Lore stores a repository's remote under. Its spelling is Lore's, not ours. */
export const LORE_REMOTE_URL_KEY = "remote_url";

export interface PushResult {
    remote: string;
    branch: string;
    /**
     * The remote already had this branch tip, so nothing was transferred.
     *
     * A SUCCESS, not a failure. Pressing push twice is an ordinary thing to do and the
     * second press has to read as "already there" rather than as an error.
     */
    alreadyPushed: boolean;
    localRevision?: LoreHex;
    remoteRevision?: LoreHex;
}

/**
 * Send this branch's revisions to the remote.
 *
 * `fastForwardMerge` is deliberately NOT exposed. It lets the remote take a push that
 * is not a fast-forward by merging on the server, and a merge Studio cannot see, review
 * or undo is not something a Push button should be able to cause. Divergence is
 * refused above this layer instead, with a sentence the author can act on.
 */
export async function pushBranch(
    globals: LoreGlobals,
    options: { branch?: string } = {},
): Promise<PushResult> {
    const result = await invoke("branchPush", globals, {
        branch: scopeString(options.branch),
        fastForwardMerge: 0,
    });
    const pushed = result.one<LoreBranchPushPayload>(LoreTag.BRANCH_PUSH);
    return {
        remote: pushed.remote,
        branch: pushed.branchName,
        alreadyPushed: pushed.alreadyPushed,
        localRevision: pushed.localRevision,
        remoteRevision: pushed.remoteRevision,
    };
}

export interface SyncResult {
    target: LoreSyncTargetPayload | undefined;
    /** Files the sync wrote or removed in the working tree. */
    files: LoreStatusFilePayload[];
    revisions: LoreSyncRevisionPayload[];
    /** The last progress report, which carries the automerge and conflict counters. */
    progress: LoreSyncProgressPayload | undefined;
}

/**
 * Bring the working tree up to a revision fetched from the remote.
 *
 * **This WRITES the working tree**, which is why nothing above it may call it while
 * the author has uncommitted work: the merge it would then perform is one Studio has
 * no interface to resolve.
 *
 * `forwardChanges` carries local edits onto the new revision. Left off, for the same
 * reason: it is the flag that turns this into a merge.
 */
export async function syncRevision(
    globals: LoreGlobals,
    options: { revision?: string; onProgress?: (progress: LoreSyncProgressPayload) => void } = {},
): Promise<SyncResult> {
    const result = await invoke("revisionSync", globals, {
        revision: scopeString(options.revision),
        forwardChanges: 0,
        reset: 0,
        rootFiles: scopeStringArray(undefined),
        dependencyTags: scopeStringArray(undefined),
        dependencyRecursive: 0,
        dependencyDepthLimit: 0,
    }, {
        onEvent: options.onProgress
            ? (event) => {
                if (event.tag === LoreTag.REVISION_SYNC_PROGRESS) {
                    options.onProgress?.(event.data as LoreSyncProgressPayload);
                }
            }
            : undefined,
    });

    return {
        target: result.first<LoreSyncTargetPayload>(LoreTag.REVISION_SYNC_TARGET),
        files: result.of<LoreStatusFilePayload>(LoreTag.REVISION_SYNC_FILE),
        revisions: result.of<LoreSyncRevisionPayload>(LoreTag.REVISION_SYNC_REVISION),
        progress: result.of<LoreSyncProgressPayload>(LoreTag.REVISION_SYNC_PROGRESS).at(-1),
    };
}

export interface CloneResult {
    branch: string;
    revision?: LoreHex;
    fileCount: number;
    bytesTransferred: number;
}

/**
 * Fetch a repository from a remote into `globals.repositoryPath`.
 *
 * The destination must be an EMPTY directory that already exists - Lore writes
 * `.lore/` plus the working tree into it, and it does not ask before overwriting.
 * Guarding that is the caller's job.
 */
export async function cloneRepository(
    globals: LoreGlobals,
    options: { repositoryUrl: string; onProgress?: (count: LoreCloneCountPayload) => void },
): Promise<CloneResult> {
    const result = await invoke("repositoryClone", globals, {
        repositoryUrl: scopeString(options.repositoryUrl),
        revision: scopeString(undefined),
        view: scopeString(undefined),
        bare: 0,
        virtually: 0,
        directFileWrite: 0,
        directFileIo: 0,
        layer: scopeString(undefined),
        layerMetadata: scopeString(undefined),
        prefetch: scopeString(undefined),
        useSharedStore: 0,
        sharedStorePath: scopeString(undefined),
        noTracking: 0,
        rootFiles: scopeStringArray(undefined),
        dependencyTags: scopeStringArray(undefined),
        dependencyRecursive: 0,
        dependencyDepthLimit: 0,
    }, {
        onEvent: options.onProgress
            ? (event) => {
                if (event.tag === LoreTag.REPOSITORY_CLONE_PROGRESS) {
                    options.onProgress?.((event.data as LoreCloneProgressPayload).count);
                }
            }
            : undefined,
    });

    const end = result.first<LoreCloneEndPayload>(LoreTag.REPOSITORY_CLONE_END);
    const begin = result.first<LoreCloneBeginPayload>(LoreTag.REPOSITORY_CLONE_BEGIN);
    return {
        branch: end?.branch || begin?.branch || "",
        revision: end?.revision ?? begin?.revision,
        fileCount: end?.count.fileCount ?? 0,
        bytesTransferred: end?.count.bytesTransferred ?? 0,
    };
}

/**
 * Present a bearer token to a remote and keep the resulting session.
 *
 * Lore persists the session in its own per-user auth store, NOT in the repository, so
 * this is a machine-level act rather than a project-level one - which is also why the
 * token itself never needs to be written into anything Studio ships to a collaborator.
 *
 * A bare loreserver has no `[server.auth]` section and therefore accepts anyone; this
 * call is what makes Studio work against a server that DOES verify, and it is harmless
 * against one that does not.
 */
export async function loginWithToken(
    globals: LoreGlobals,
    options: { remoteUrl: string; token: string; tokenType?: string; authUrl?: string },
): Promise<LoreAuthIdentityPayload | undefined> {
    const result = await invoke("authLoginWithToken", globals, {
        remoteUrl: scopeString(options.remoteUrl),
        token: scopeString(options.token),
        tokenType: scopeString(options.tokenType),
        authUrl: scopeString(options.authUrl),
    });
    return result.first<LoreAuthIdentityPayload>(LoreTag.AUTH_IDENTITY);
}

// -- argument helpers -------------------------------------------------------

/** Local aliases; the lifetime contract is documented on the originals in values.ts. */
const scopeString = loreString;
const scopeStringArray = loreStringArray;
