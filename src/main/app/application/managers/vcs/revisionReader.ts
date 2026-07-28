import {
    changedPaths as loreChangedPaths,
    closeStore,
    closeTree,
    flushRepository,
    history,
    loadTree,
    openStore,
    readAddress,
    releaseRepository,
    repositoryPath,
    treeNode,
    type LoreGlobals,
    type LoreHex,
    type RevisionNode,
    type StoreHandle,
    type TreeHandle,
} from "./lore";

/**
 * Reading historical content out of Lore without touching the working tree.
 *
 * This is the input side of Studio's diff engine. Lore's own diff verbs are
 * line-oriented and no use for binary assets - but `revisionDiff` is still the
 * cheapest way to learn *which* files changed, so it stays as a filter step.
 *
 * The read path is:
 *
 *   storageOpen -> revisionTreeLoad(rev) -> resolvePath -> nodeInfo(address)
 *                                                       -> storageGet(address)
 *
 * `lore_revision_tree_add/_commit/_modify` do not exist in v0.8.5 - the SDK ships
 * TypeScript types for them, but they are absent from both the C header and the
 * library's export table (263 symbols, checked). Writing back therefore goes through
 * the working tree: write the file, `fileStage`, `revisionCommit`.
 */

export type { RevisionNode, StoreHandle, TreeHandle };
export { closeStore, flushRepository, openStore, releaseRepository, repositoryPath };

/** Read one file's bytes as of one revision. */
export async function blobAt(
    globals: LoreGlobals,
    store: StoreHandle,
    repository: LoreHex,
    revision: LoreHex,
    repositoryRelativePath: string,
): Promise<Buffer> {
    const tree = await loadTree(globals, store, repository, revision);
    try {
        const node = await treeNode(globals, tree, repositoryRelativePath);
        return await readAddress(globals, store, repository, node);
    } finally {
        await closeTree(globals, tree);
    }
}

/** Same as {@link blobAt}, reusing one tree handle across many paths in one revision. */
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
            const node = await treeNode(globals, tree, relative);
            out.set(relative, await readAddress(globals, store, repository, node));
        }
    } finally {
        await closeTree(globals, tree);
    }
    return out;
}

/** Load the revision DAG for the current branch. */
export async function readRevisionGraph(
    globals: LoreGlobals,
    limit = 0,
): Promise<Map<LoreHex, RevisionNode>> {
    const { nodes } = await history(globals, { limit });
    return nodes;
}

/**
 * Repository (partition) id and current branch.
 *
 * Read from the revision-history *header* event - the per-revision entries do not
 * carry it. Deliberately not `repositoryInfo`, which dials the remote even under
 * `offline: true` and blocks until the connection times out.
 */
export async function readRepositoryIdentity(
    globals: LoreGlobals,
): Promise<{ repository: LoreHex; branch: LoreHex } | undefined> {
    const { header } = await history(globals, { limit: 1 });
    return header;
}

/** Paths that differ between two revisions - the cheap filter before diffing. */
export async function changedPaths(
    globals: LoreGlobals,
    from: LoreHex,
    to: LoreHex,
): Promise<string[]> {
    const entries = await loreChangedPaths(globals, from, to);
    return entries.map((entry) => entry.path).filter(Boolean);
}

/**
 * Lowest common ancestor of two revisions.
 *
 * Lore exposes no merge-base API - there is no entry point that returns a common
 * ancestor, and the merge conflict event carries only a path. But the two parent
 * slots plus the monotonic revision number are a complete DAG, so the base is
 * computable here.
 *
 * LIMITATION: with criss-cross history (two branches that have merged each other)
 * there can be several minimal common ancestors, and Git resolves that by
 * recursively merging them. This returns the highest-numbered candidate instead.
 * That is correct for linear and simple-branch history - which is what Studio
 * projects produce - and degrades to "a slightly worse base, so the user sees a few
 * more conflicts" rather than to a wrong merge. Revisit if real projects start
 * showing criss-cross topologies.
 *
 * The tie-break on equal revision numbers is by revision id, and that matters more
 * than it looks: a criss-cross genuinely has several equally-minimal ancestors, and
 * without a total order the winner would depend on traversal order. Two people
 * merging the same pair of branches would then be shown different conflict sets,
 * which is indistinguishable from a bug from where they are sitting.
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
        if (!node) continue;
        if (!best
            || node.number > best.number
            || (node.number === best.number && node.revision < best.revision)) {
            best = node;
        }
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
 * The three inputs a custom merge needs.
 *
 * `base` is undefined when the two sides share no ancestor (unrelated histories) or
 * when the file did not exist in the base revision. The caller must treat that as an
 * add/add conflict rather than assuming an empty base - assuming would silently
 * accept one side.
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
