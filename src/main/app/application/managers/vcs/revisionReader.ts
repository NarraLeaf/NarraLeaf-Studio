import {
    invoke,
    invokeFor,
    invokeOne,
    sdk,
    LoreEventTag,
    type LoreGlobals,
    type LoreHex,
    type StoreHandle,
    type TreeHandle,
} from "./loreClient";

/**
 * Reading historical content out of Lore without a working tree.
 *
 * This is the input side of Studio's diff engine. Lore's own diff verbs
 * (`fileDiff`, `revisionDiff`) are line-oriented and useless for binary
 * assets — but `revisionDiff` is still the cheapest way to learn *which*
 * files changed, so it is exposed here as a filter step.
 *
 * The read path is:
 *
 *   storageOpen -> revisionTreeLoad(rev) -> resolvePath -> nodeInfo(address)
 *                                                       -> storageGet(address)
 *
 * `lore_revision_tree_*` is read-only in v0.8.5: the SDK exports TypeScript
 * types for add/modify/move/commit, but the functions are absent from both the
 * C header and the shipped library's export table. Writing back still has to go
 * through the working tree (fileWrite -> fileStage -> revisionCommit).
 */

export interface NodeInfo {
    nodeId: number;
    name: string;
    parentId: number;
    kind: number;
    size: number;
    address: { hash: LoreHex; context: LoreHex };
    fileId: LoreHex;
}

export interface RevisionNode {
    revision: LoreHex;
    /** Monotonic per repository; usable as a cheap topological rank. */
    number: number;
    /** parent[0] is the direct parent, parent[1] the second parent of a merge. */
    parents: LoreHex[];
}

const ZERO_HASH = "0".repeat(64);

export async function openStore(globals: LoreGlobals, repositoryPath: string): Promise<StoreHandle> {
    const opened = await invokeOne<{ handleId: number }>(
        (g, a) => sdk.storageOpen(g, a),
        "storageOpen",
        globals,
        { repositoryPath },
        LoreEventTag.STORAGE_OPENED,
    );
    return { handleId: opened.handleId };
}

export async function closeStore(globals: LoreGlobals, handle: StoreHandle): Promise<void> {
    await invoke((g, a) => sdk.storageClose(g, a), "storageClose", globals, { handle });
}

/**
 * Read one file's bytes as of one revision.
 *
 * `repository` and the address travel as hex; only `revisionHash` is declared
 * `loreHash` and therefore subject to the encoding defect handled in
 * loreClient — hence the explicit `hashArgs`.
 */
export async function blobAt(
    globals: LoreGlobals,
    store: StoreHandle,
    repository: LoreHex,
    revision: LoreHex,
    repositoryRelativePath: string,
): Promise<Buffer> {
    const tree = await loadTree(globals, store, repository, revision);
    try {
        const node = await resolveNode(globals, tree, repositoryRelativePath);
        return await readAddress(globals, store, repository, node.address);
    } finally {
        await closeTree(globals, tree);
    }
}

/** Same as blobAt, but reuses one tree handle across many paths in one revision. */
export async function blobsAt(
    globals: LoreGlobals,
    store: StoreHandle,
    repository: LoreHex,
    revision: LoreHex,
    repositoryRelativePaths: readonly string[],
): Promise<Map<string, Buffer>> {
    const out = new Map<string, Buffer>();
    const tree = await loadTree(globals, store, repository, revision);
    try {
        for (const relative of repositoryRelativePaths) {
            const node = await resolveNode(globals, tree, relative);
            out.set(relative, await readAddress(globals, store, repository, node.address));
        }
    } finally {
        await closeTree(globals, tree);
    }
    return out;
}

async function loadTree(
    globals: LoreGlobals,
    store: StoreHandle,
    repository: LoreHex,
    revision: LoreHex,
): Promise<TreeHandle> {
    const loaded = await invokeOne<{ handleId: number }>(
        (g, a) => sdk.revisionTreeLoad(g, a),
        "revisionTreeLoad",
        globals,
        { store, repository, revisionHash: revision },
        LoreEventTag.REVISION_TREE_LOADED,
        { hashArgs: ["revisionHash"] },
    );
    return { handleId: loaded.handleId };
}

async function closeTree(globals: LoreGlobals, handle: TreeHandle): Promise<void> {
    await invoke((g, a) => sdk.revisionTreeClose(g, a), "revisionTreeClose", globals, { handle });
}

async function resolveNode(globals: LoreGlobals, handle: TreeHandle, relative: string): Promise<NodeInfo> {
    const resolved = await invokeOne<{ nodeId: number }>(
        (g, a) => sdk.revisionTreeResolvePath(g, a),
        "revisionTreeResolvePath",
        globals,
        { handle, path: relative },
        LoreEventTag.REVISION_TREE_RESOLVE_PATH_COMPLETE,
    );
    return invokeOne<NodeInfo>(
        (g, a) => sdk.revisionTreeNodeInfo(g, a),
        "revisionTreeNodeInfo",
        globals,
        { handle, nodeId: resolved.nodeId },
        LoreEventTag.REVISION_TREE_NODE_INFO,
    );
}

/**
 * Fetch content by address. `localCache: true` is deliberate: without it Lore
 * retains only state fragments, so repeatedly diffing the same two revisions
 * would re-fetch payload bytes from the remote every time.
 */
async function readAddress(
    globals: LoreGlobals,
    store: StoreHandle,
    repository: LoreHex,
    address: { hash: LoreHex; context: LoreHex },
): Promise<Buffer> {
    if (address.hash === ZERO_HASH) return Buffer.alloc(0);

    // Payload arrives on STORAGE_GET_DATA as `.bytes` (not `.data`).
    const chunks = await invokeFor<{ offset: number; bytes: Uint8Array }>(
        (g, a) => sdk.storageGet(g, a),
        "storageGet",
        globals,
        {
            handle: store,
            items: [{ id: 1, partition: repository, address, streaming: false, localCache: true }],
        },
        LoreEventTag.STORAGE_GET_DATA,
    );
    // Non-streaming still emits in offset order, but do not rely on arrival order.
    return Buffer.concat(
        chunks.slice().sort((a, b) => a.offset - b.offset).map((c) => Buffer.from(c.bytes)),
    );
}

/** Load the revision DAG for the current branch. */
export async function readRevisionGraph(
    globals: LoreGlobals,
    limit = 0,
): Promise<Map<LoreHex, RevisionNode>> {
    const entries = await invokeFor<{ revision: LoreHex; revisionNumber: number; parent: LoreHex[] }>(
        (g, a) => sdk.revisionHistory(g, a),
        "revisionHistory",
        globals,
        { length: limit },
        LoreEventTag.REVISION_HISTORY_ENTRY,
    );

    const graph = new Map<LoreHex, RevisionNode>();
    for (const entry of entries) {
        graph.set(entry.revision, {
            revision: entry.revision,
            number: entry.revisionNumber,
            parents: (entry.parent ?? []).filter((p) => p && p !== ZERO_HASH),
        });
    }
    return graph;
}

/**
 * Repository (partition) id and current branch.
 *
 * Read from the REVISION_HISTORY *header* event — the per-revision entries do
 * not carry it. This is deliberately not `repositoryInfo`, which dials the
 * remote even under `offline: true` and blocks until the connection times out.
 */
export async function readRepositoryIdentity(
    globals: LoreGlobals,
): Promise<{ repository: LoreHex; branch: LoreHex } | undefined> {
    const headers = await invokeFor<{ repository: LoreHex; branch: LoreHex }>(
        (g, a) => sdk.revisionHistory(g, a),
        "revisionHistory",
        globals,
        { length: 1 },
        LoreEventTag.REVISION_HISTORY,
    );
    return headers[0];
}

/**
 * Lowest common ancestor of two revisions.
 *
 * Lore exposes no merge-base API — there is no `lore_*` entry point that
 * returns a common ancestor, and the merge conflict event carries only a path.
 * But `parent[2]` plus the monotonic `revisionNumber` is a complete DAG, so the
 * base is computable here.
 *
 * LIMITATION: with criss-cross history (two branches that have merged each
 * other) there can be several minimal common ancestors, and Git resolves that
 * by recursively merging them. This returns the highest-numbered candidate
 * instead. That is correct for linear and simple-branch history — which is what
 * Studio projects produce — and degrades to "a slightly worse base, so more
 * conflicts surface for the user" rather than to a wrong merge. Revisit if real
 * projects start showing criss-cross topologies.
 */
export function mergeBase(
    graph: ReadonlyMap<LoreHex, RevisionNode>,
    a: LoreHex,
    b: LoreHex,
): LoreHex | undefined {
    const ancestorsOfA = ancestors(graph, a);
    let best: RevisionNode | undefined;
    for (const revision of ancestors(graph, b)) {
        if (!ancestorsOfA.has(revision)) continue;
        const node = graph.get(revision);
        if (node && (!best || node.number > best.number)) best = node;
    }
    return best?.revision;
}

function ancestors(graph: ReadonlyMap<LoreHex, RevisionNode>, start: LoreHex): Set<LoreHex> {
    const seen = new Set<LoreHex>();
    const stack: LoreHex[] = [start];
    while (stack.length > 0) {
        const revision = stack.pop();
        if (!revision || seen.has(revision)) continue;
        seen.add(revision);
        for (const parent of graph.get(revision)?.parents ?? []) stack.push(parent);
    }
    return seen;
}

export interface ThreeWay {
    base: Buffer | undefined;
    mine: Buffer;
    theirs: Buffer;
    baseRevision: LoreHex | undefined;
}

/**
 * The three inputs a custom merge needs. `base` is undefined when the two sides
 * share no ancestor (unrelated histories) or when the file did not exist in the
 * base revision — the caller must treat that as an add/add conflict rather than
 * assuming an empty base.
 */
export async function threeWay(
    globals: LoreGlobals,
    store: StoreHandle,
    repository: LoreHex,
    mine: LoreHex,
    theirs: LoreHex,
    repositoryRelativePath: string,
): Promise<ThreeWay> {
    const graph = await readRevisionGraph(globals);
    const baseRevision = mergeBase(graph, mine, theirs);

    const [mineBytes, theirsBytes] = await Promise.all([
        blobAt(globals, store, repository, mine, repositoryRelativePath),
        blobAt(globals, store, repository, theirs, repositoryRelativePath),
    ]);

    let base: Buffer | undefined;
    if (baseRevision) {
        try {
            base = await blobAt(globals, store, repository, baseRevision, repositoryRelativePath);
        } catch {
            // Absent from the base revision: an add/add, not an empty file.
            base = undefined;
        }
    }
    return { base, mine: mineBytes, theirs: theirsBytes, baseRevision };
}

/**
 * Force Lore's stores to disk.
 *
 * NOT optional after a write. Lore's mutable store (which holds branch tips) is
 * flushed lazily, so a process that commits and exits promptly can lose the
 * commit outright: the revision is returned to the caller, the working tree
 * looks right, and a later process sees only the previous revision. Verified —
 * two commits, no flush, second one gone; same sequence with a flush, both
 * present. Any future write path must flush before it reports success.
 */
export async function flushRepository(globals: LoreGlobals): Promise<void> {
    await invoke((g, a) => sdk.repositoryFlush(g, a), "repositoryFlush", globals, {});
}

/** Paths that differ between two revisions — the cheap filter before diffing. */
export async function changedPaths(
    globals: LoreGlobals,
    from: LoreHex,
    to: LoreHex,
): Promise<string[]> {
    const entries = await invokeFor<{ path?: string }>(
        (g, a) => sdk.revisionDiff(g, a),
        "revisionDiff",
        globals,
        { revisionSource: from, revisionTarget: to },
        LoreEventTag.REVISION_DIFF_FILE,
        { allowIgnoredPaths: true },
    );
    return entries.map((e) => e.path).filter((p): p is string => Boolean(p));
}
