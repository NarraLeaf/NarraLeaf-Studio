import {
    changedPaths as loreChangedPaths,
    closeStore,
    closeTree,
    flushRepository,
    history,
    listBranches,
    listTreeChildren,
    loadTree,
    LORE_NODE_TYPE,
    openStore,
    readAddress,
    releaseRepository,
    repositoryPath,
    ROOT_NODE_ID,
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
 *
 * `lore_revision_tree_list_children` IS exported (same 263-symbol check), so a
 * revision's whole file list is enumerable without touching the working tree - see
 * {@link listFilesAt}. That matters for showing a past revision in the real editors:
 * the alternative was guessing the paths from the document registry, and the registry
 * only knows the four kinds migrated to specs so far.
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

/**
 * The bytes of one already-enumerated entry.
 *
 * The pair to {@link listFilesAt}: the walk hands back content addresses, so a caller that means to
 * read many files - materialising a whole revision onto disk - reads them one at a time without a
 * tree handle and without holding every buffer at once, which is what {@link documentsAt} does.
 */
export async function readEntryBytes(
    globals: LoreGlobals,
    store: StoreHandle,
    repository: LoreHex,
    entry: Pick<RevisionFileEntry, "hash" | "context">,
): Promise<Buffer> {
    return readAddress(globals, store, repository, entry);
}

/** One file as it existed at a revision, with the address its bytes live at. */
export interface RevisionFileEntry {
    /** Repository-relative, forward slashes. */
    path: string;
    size: number;
    hash: LoreHex;
    context: LoreHex;
}

/**
 * Depth cap on the walk below.
 *
 * Not a real project shape - the deepest thing Studio writes is about six levels - but
 * a tree read out of a repository is untrusted input, and a cycle in it would otherwise
 * be an unbounded loop inside the main process.
 */
const MAX_TREE_DEPTH = 32;

/**
 * Every file at one revision, enumerated by walking the tree.
 *
 * One `revisionTreeListChildren` call per directory and none per file: each child event
 * already carries name, kind, size and content address, so the paths and the addresses
 * come out of the same walk. Symlinks are skipped rather than followed - a link's
 * target is a path in a tree that may not contain it, and resolving one would be the
 * only place here that could escape the revision.
 */
export async function listFilesAt(
    globals: LoreGlobals,
    store: StoreHandle,
    repository: LoreHex,
    revision: LoreHex,
): Promise<RevisionFileEntry[]> {
    const tree = await loadTree(globals, store, repository, revision);
    try {
        return await walkTree(globals, tree);
    } finally {
        await closeTree(globals, tree);
    }
}

async function walkTree(globals: LoreGlobals, tree: TreeHandle): Promise<RevisionFileEntry[]> {
    const files: RevisionFileEntry[] = [];
    const seen = new Set<number>([ROOT_NODE_ID]);
    let level: { nodeId: number; prefix: string }[] = [{ nodeId: ROOT_NODE_ID, prefix: "" }];

    for (let depth = 0; depth < MAX_TREE_DEPTH && level.length > 0; depth += 1) {
        const next: typeof level = [];
        for (const directory of level) {
            for (const child of await listTreeChildren(globals, tree, directory.nodeId)) {
                // An entry with no name cannot be addressed by path, so it cannot be
                // asked for either; including it would put an unusable key in the map.
                if (!child.name) continue;
                const path = directory.prefix ? `${directory.prefix}/${child.name}` : child.name;
                if (child.kind === LORE_NODE_TYPE.DIRECTORY) {
                    // A tree that names a node twice would otherwise be walked twice, and
                    // a tree that names its own ancestor forever.
                    if (seen.has(child.nodeId)) continue;
                    seen.add(child.nodeId);
                    next.push({ nodeId: child.nodeId, prefix: path });
                    continue;
                }
                if (child.kind !== LORE_NODE_TYPE.FILE) continue;
                files.push({ path, size: child.size, hash: child.hash, context: child.context });
            }
        }
        level = next;
    }
    return files;
}

/**
 * Read many documents at one revision, answering `null` for a path the revision does
 * not contain.
 *
 * Two properties the per-path reader ({@link blobsAt}) cannot give, both required by
 * "show a past revision in the real editors":
 *
 *  - **Absent is an answer, not a failure.** A document added after the revision has to
 *    land the editor in its "missing, use defaults" state - the same one as at project
 *    open - and `revisionTreeResolvePath` reports a missing path by failing the call,
 *    which is indistinguishable from a backend fault. Deciding it from the enumerated
 *    tree instead means a genuine fault still propagates.
 *  - **One tree walk, one batch.** On a project with a remote the first read of a
 *    revision fetches fragments over the network (docs/version-control.md §6), so the
 *    reads have to be issued together rather than one per document service.
 *
 * `select.paths` asks for named paths; `select.accept` asks for whatever the revision
 * happens to hold, which is what a caller with no path list of its own wants - it gets
 * to filter on size and name because the tree also holds the author's assets. Given
 * neither, every file is read.
 */
export async function documentsAt(
    globals: LoreGlobals,
    store: StoreHandle,
    repository: LoreHex,
    revision: LoreHex,
    select: {
        paths?: readonly string[];
        accept?: (entry: RevisionFileEntry) => boolean;
    } = {},
): Promise<Map<string, Buffer | null>> {
    const out = new Map<string, Buffer | null>();
    const tree = await loadTree(globals, store, repository, revision);
    let entries: RevisionFileEntry[];
    try {
        entries = await walkTree(globals, tree);
    } finally {
        await closeTree(globals, tree);
    }

    const index = new Map(entries.map((entry) => [entry.path, entry]));
    const wanted = select.paths
        ?? entries.filter((entry) => select.accept?.(entry) ?? true).map((entry) => entry.path);
    for (const requested of wanted) {
        const entry = index.get(normalizeRepositoryRelative(requested));
        out.set(requested, entry ? await readAddress(globals, store, repository, entry) : null);
    }
    return out;
}

/**
 * Windows separators folded to `/`, because that is what the walk builds paths with and
 * a caller holding a path from `path.join` would otherwise miss every entry.
 */
function normalizeRepositoryRelative(path: string): string {
    return path.replace(/\\/g, "/").replace(/^\.?\//, "");
}

/**
 * Load the revision DAG for the CURRENT branch.
 *
 * `history` with no `branch` is scoped to the branch the working tree is on, which is what
 * the history list wants and is NOT enough to reason about a merge - see
 * {@link readMergeGraph}.
 */
export async function readRevisionGraph(
    globals: LoreGlobals,
    limit = 0,
): Promise<Map<LoreHex, RevisionNode>> {
    const { nodes } = await history(globals, { limit });
    return nodes;
}

/**
 * Whether `graph` holds `tip` and every revision reachable from it.
 *
 * The precondition {@link mergeBase} silently needs: it walks parent links through the map,
 * so a parent that is not in the map simply ends the walk, and a graph missing one side of a
 * fork answers "no common ancestor" for two revisions that plainly have one. Checking it is
 * what separates "there is no base" from "we could not see far enough to find one".
 */
export function graphCoversAncestry(
    graph: ReadonlyMap<LoreHex, RevisionNode>,
    tip: LoreHex,
): boolean {
    const seen = new Set<LoreHex>();
    const stack: LoreHex[] = [tip];
    while (stack.length > 0) {
        const revision = stack.pop();
        if (!revision || seen.has(revision)) continue;
        seen.add(revision);
        const node = graph.get(revision);
        if (!node) return false;
        for (const parent of node.parents) stack.push(parent);
    }
    return true;
}

/**
 * The DAG covering every side of a merge, not just the branch the working tree happens to be on.
 *
 * **This is the fix for docs/version-control.md §4.30.** `readRevisionGraph` reads
 * `history(globals)` with no branch, so on a main/feature merge it held only main's revisions:
 * the incoming tip was absent, `mergeBase` found no common ancestor, and `threeWay` therefore
 * answered `base: undefined`. Since an absent base is defined to mean add/add, EVERY ordinary
 * cross-branch conflict would have been classified add/add and tier two would have refused or
 * mis-merged all of them - measured in `mergeSpike2.integration.test.ts` (L0).
 *
 * The LCA is recomputed rather than read off the `~base` sidecar §4.23 found on disk, and the
 * choice is deliberate. The sidecar is the better source for D6's write-back, which runs
 * inside an open merge and already knows the conflicted path; this function is addressed by
 * two REVISIONS and answers for any pair - a comparison between two arbitrary points in
 * history, a merge that has not been started, a path Lore automerged and wrote no sidecar for.
 * A sidecar read would answer none of those, and it cannot tell an add/add from a path Lore
 * merged cleanly, which is the distinction the whole contract rests on.
 *
 * Widened in three steps, cheapest first, because each one is a backend round trip:
 * the current branch; then each uncovered tip's own ancestry; then, only if that still leaves
 * a hole, every branch in the repository. A scope that fails to read is skipped rather than
 * thrown from - the caller decides what an incomplete graph means, and
 * {@link graphCoversAncestry} is how it finds out.
 */
export async function readMergeGraph(
    globals: LoreGlobals,
    tips: readonly LoreHex[],
): Promise<Map<LoreHex, RevisionNode>> {
    const graph = new Map(await readRevisionGraph(globals));
    const covered = (): boolean => tips.every((tip) => graphCoversAncestry(graph, tip));

    const absorb = async (scope: { revision?: LoreHex; branch?: string }): Promise<void> => {
        try {
            const { nodes } = await history(globals, scope);
            for (const [revision, node] of nodes) {
                if (!graph.has(revision)) graph.set(revision, node);
            }
        } catch {
            // An unreadable scope is not a failure here: a repository with an archived or
            // half-written branch would otherwise take the whole merge down with it.
        }
    };

    for (const tip of tips) {
        if (graphCoversAncestry(graph, tip)) continue;
        await absorb({ revision: tip });
    }
    if (covered()) return graph;

    try {
        for (const branch of await listBranches(globals, { archived: true })) {
            await absorb({ branch: branch.name });
            if (covered()) break;
        }
    } catch {
        // Same reasoning: an incomplete graph is reported through the return value.
    }
    return graph;
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

/**
 * Why {@link ThreeWay.base} is what it is.
 *
 * Three of these four leave `base` undefined and they do NOT mean the same thing, which is
 * the whole reason this field exists. `absent-in-base` and `no-common-ancestor` are the two
 * genuine add/adds - the merge really has nothing to align on, and a caller taking a side is
 * taking a decision the author has to make. `indeterminate` is Studio failing to read far
 * enough (§4.30), and a caller that treats it as add/add reports a conflict that does not
 * exist, on every ordinary cross-branch merge. Collapsing them into "base is undefined" is
 * exactly the defect this layer shipped with.
 */
export type ThreeWayBaseStatus =
    /** A common ancestor was found and it holds this file. */
    | "found"
    /** A common ancestor was found and this file is not in it: add/add. */
    | "absent-in-base"
    /** The graph is complete and the two sides share no ancestor at all: add/add. */
    | "no-common-ancestor"
    /** The graph could not be completed, so no claim is made either way. NOT an add/add. */
    | "indeterminate";

export interface ThreeWay {
    base: Buffer | undefined;
    mine: Buffer;
    theirs: Buffer;
    baseRevision: LoreHex | undefined;
    baseStatus: ThreeWayBaseStatus;
}

/**
 * The three inputs a custom merge needs.
 *
 * `base` is undefined when the two sides share no ancestor (unrelated histories), when the
 * file did not exist in the base revision, or when the DAG could not be read completely. The
 * caller must treat the first two as an add/add conflict rather than assuming an empty base -
 * assuming would silently accept one side - and must treat the third as neither, which is
 * what {@link ThreeWay.baseStatus} is for.
 */
export async function threeWay(
    globals: LoreGlobals,
    store: StoreHandle,
    repository: LoreHex,
    mine: LoreHex,
    theirs: LoreHex,
    repositoryRelativePath: string,
): Promise<ThreeWay> {
    // Both sides' ancestries, not the current branch's: the incoming tip of a cross-branch
    // merge is not on the branch the working tree is on (§4.30).
    const graph = await readMergeGraph(globals, [mine, theirs]);
    const complete = graphCoversAncestry(graph, mine) && graphCoversAncestry(graph, theirs);
    const baseRevision = mergeBase(graph, mine, theirs);

    const [mineBytes, theirsBytes] = await Promise.all([
        blobAt(globals, store, repository, mine, repositoryRelativePath),
        blobAt(globals, store, repository, theirs, repositoryRelativePath),
    ]);

    let base: Buffer | undefined;
    let baseStatus: ThreeWayBaseStatus = complete ? "no-common-ancestor" : "indeterminate";
    if (baseRevision) {
        try {
            base = await blobAt(globals, store, repository, baseRevision, repositoryRelativePath);
            baseStatus = "found";
        } catch {
            // Absent from the base revision: an add/add, not an empty file.
            base = undefined;
            baseStatus = "absent-in-base";
        }
    }
    return { base, mine: mineBytes, theirs: theirsBytes, baseRevision, baseStatus };
}
