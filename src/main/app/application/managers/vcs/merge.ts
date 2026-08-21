import fs from "fs";
import path from "path";
import {
    documentSetAt,
    type DocumentSetLookup,
} from "@shared/documents/documentSet";
import type {
    VcsConflictChoice,
    VcsMergeResolveResult,
    VcsMergeSideChoice,
    VcsMergeState,
} from "@shared/types/vcs";
import {
    branchMergeAbort,
    branchMergeResolve,
    branchMergeRestart,
    branchMergeUnresolve,
    flushRepository,
    repositoryPath,
    repositoryStatus,
    type LoreGlobals,
} from "./lore";
import { collectWorkingSet } from "./workingSet";

/**
 * The merge surface, in Studio's vocabulary.
 *
 * Everything else in `vcs/` extends one history: a commit, a checkpoint, a restore all
 * add a revision on top of what was there. A merge is the one state where the
 * repository holds TWO sides at once, and three properties of it shape this module.
 *
 * **A merge outlives the process.** It is repository state, not session state, so
 * Studio cannot remember it - it has to be able to re-read it after a restart. That is
 * what {@link readMergeState} is for and why it takes no cached anything.
 *
 * **Paths are absolute going in and repository-relative coming out** (§4.16). Every
 * verb below takes the repository-relative paths a surface has in hand and converts,
 * through the same guard the rest of the backend uses, because a relative path handed
 * to the library resolves against the PROCESS working directory and is then silently
 * ignored for being outside the repository - success, and nothing settled.
 *
 * **Nothing here commits.** Settling a path does not record it; a plain commit does,
 * and it is measured that no separate merge-staging step is needed
 * (docs/version-control.md §4.25). The pipeline that writes merged bytes and commits
 * them is deliberately elsewhere - and when it is written it must commit through
 * OFFLINE globals, because a commit made through online globals on a repository that
 * is registered with a server cannot have its new content read back by the process
 * that wrote it (§4.29). A merge is an online act; the commit that closes it is not.
 */

/**
 * What the backend writes beside a file it could not settle.
 *
 * Measured (§4.23): a conflicted merge writes the conflicted file with diff3 markers in
 * it - which makes a JSON document unparseable - and drops three clean, complete copies
 * next to it. `~mine` and `~theirs` are byte-identical to the two sides' recorded
 * content, `~base` is their common ancestor.
 *
 * They are the backend's spelling, not Studio's, and they do two jobs here. They are the
 * only thing on disk that names a conflicted path after a restart, and they are what
 * "take one side" actually copies - see {@link resolveConflicts} for why the two verbs
 * named after the sides cannot be trusted to mean them. The backend excludes them from a
 * commit itself, so a resolved merge does not carry them into the author's history
 * (§4.23).
 *
 * Keyed so that a {@link VcsMergeSideChoice} indexes it directly, which is what keeps the
 * two spellings of "mine" from drifting apart.
 */
const SIDECAR_SUFFIXES = { base: "~base", mine: "~mine", theirs: "~theirs" } as const;

/**
 * Whether a merge is open, and which paths are still unsettled.
 *
 * **How "a merge is in progress" is established, and what it rests on.** There is no
 * verb that answers it, so this reads two independent signals and takes either:
 *
 *  1. **The status revision header**, `revisionMerged` AND `revisionStaged` both set.
 *     Measured, in that order of importance:
 *     - during a conflicted merge both are set, and they stay set across a
 *       `releaseRepository` and a re-read on fresh globals - so this survives closing
 *       and reopening the project;
 *     - `revisionMerged` ALONE is not the signal: it is still set after the merge is
 *       committed, and after a clean merge that committed itself. Paired with
 *       `revisionStaged`, which the commit clears, it is;
 *     - neither a status scan nor a `stage` DURING the merge disturbs either field,
 *       which matters because Studio scans on every status read (§4.17);
 *     - after the merge is committed, the first scan or stage clears `revisionMerged`,
 *       so ordinary work on top of a finished merge does not read as one;
 *     - `branchMergeAbort` clears both.
 *     Recorded in `merge.integration.test.ts`, which fails if any of that changes.
 *  2. **The sidecars on disk**, which is the half that is not an inference at all -
 *     `<path>~mine` and `<path>~theirs` beside a file mean the backend could not settle
 *     it. They survive a restart because they are files, and they survive a resolve
 *     (measured: the resolve verbs do not delete them; the commit does).
 *
 * The paths come only from (2). They CANNOT come from the status file list: measured,
 * every form of status reports an empty file list while a conflicted merge is open,
 * because the merge already recorded its result as the staged revision and the working
 * tree matches it (§4.24). During the merge itself the backend names them in its event
 * stream, and those are the paths {@link import("./remote").syncFromRemote} reports -
 * but an event stream is gone by the next process, and this has to work then too.
 *
 * **What this deliberately does NOT answer is which of those paths are still undecided.**
 * The sidecars survive a resolve - measured - and no readable state anywhere records that
 * the author chose. The backend does track it: committing with something unsettled fails
 * with `Unable to commit when <path> is still in conflict`, naming it. But that is a
 * write, so it is a backstop and not a probe, and nothing here may attempt it to answer a
 * question. A surface that wants to show progress keeps its own record for the life of
 * the window and must not claim it is the repository's.
 *
 * The walk is unconditional rather than gated on (1) so that the two signals can
 * disagree out loud rather than one silently masking the other. It is a `readdir` walk
 * over the versioned working set - no backend call - and only ever runs because someone
 * asked.
 */
export async function readMergeState(globals: LoreGlobals, root: string): Promise<VcsMergeState> {
    const { revision } = await repositoryStatus(globals, { scan: false, revisionOnly: true });
    // Both, not either. See the note above: `revisionMerged` outlives the merge commit
    // and would report a finished merge as an open one.
    const headerSaysMerge = Boolean(revision?.revisionMerged && revision?.revisionStaged);
    const conflicts = await findConflictedPaths(root);
    const inProgress = headerSaysMerge || conflicts.length > 0;
    return {
        inProgress,
        // Gated on the whole answer rather than on the header alone: the field keeps its
        // value after the merge is recorded, and naming an incoming revision for a merge
        // that is over is worse than not naming one.
        incoming: inProgress ? revision?.revisionMerged : undefined,
        conflicts,
    };
}

/**
 * Repository-relative paths that still have their merge inputs beside them.
 *
 * `~mine` and `~theirs` are required, `~base` is not: a path added on both sides has no
 * common ancestor, and whether the backend writes a `~base` for that case has NOT been
 * measured. Requiring it would make an add/add conflict invisible, which is the failure
 * that costs the author their work rather than merely a wrong label.
 *
 * The conflicted file itself must exist too, so a stray `~mine` left behind by
 * something else cannot invent a conflict on a path that is not there.
 *
 * A settled path is still on this list; see the note on {@link readMergeState}.
 */
async function findConflictedPaths(root: string): Promise<string[]> {
    const present = new Set(await collectWorkingSet(root));
    const conflicts: string[] = [];
    for (const absolute of present) {
        if (!absolute.endsWith(SIDECAR_SUFFIXES.mine)) continue;
        const subject = absolute.slice(0, -SIDECAR_SUFFIXES.mine.length);
        if (!present.has(`${subject}${SIDECAR_SUFFIXES.theirs}`)) continue;
        if (!fs.existsSync(subject)) continue;
        conflicts.push(toRepositoryRelative(root, subject));
    }
    return conflicts.sort();
}

/** Forward slashes, because that is the spelling every other output path uses. */
function toRepositoryRelative(root: string, absolute: string): string {
    return path.relative(root, absolute).split(path.sep).join("/");
}

/**
 * Settle these paths by taking one side, or by taking whatever is in the working tree.
 *
 * **A side is taken from the merge's own copy of it - the sidecar - and NOT from
 * `branch_merge_resolve_mine` / `_theirs`. That is measured, and it is the single most
 * consequential measurement in this milestone.**
 *
 * Those two verbs follow the BRANCH POINTER, and a sync has already moved it. Same
 * repository, same conflicted file, driven through a real server:
 *
 * ```
 * doc.json           <<<<<<< ours / AUTHOR-SIDE / ||||||| original / ======= / SERVER-SIDE / >>>>>>> theirs
 * doc.json~mine      AUTHOR-SIDE          doc.json~theirs    SERVER-SIDE
 * branch_merge_resolve_mine    -> SERVER-SIDE      <- the OPPOSITE of ~mine and of `ours`
 * branch_merge_resolve_theirs  -> AUTHOR-SIDE
 * ```
 *
 * After a LOCAL `branch_merge_start` the same two verbs agree with the sidecars, which
 * is why §4.25 - measured on a local merge only - records them as "mine" and "theirs"
 * and why this is worth stating at length: a merge that Studio produces is ALWAYS a
 * sync, so following those verbs would have made every "keep mine" discard the author's
 * work and every "keep theirs" discard their collaborator's, with nothing on screen
 * saying so and a green test suite either way.
 *
 * The sidecars do not have that problem: in both origins `~mine` holds the side the
 * conflict markers call `ours` and `~theirs` the incoming one, and they are byte-exact
 * copies of the two recorded sides (§4.23). So a side is taken by copying that file over
 * the conflicted one and settling with the plain verb, which commits the working tree's
 * bytes verbatim (§4.25). "Take one side, whole" is still exactly that - nothing here
 * looks inside a document, so it holds for binaries and for documents with no spec.
 *
 * `working-tree` writes nothing and accepts the bytes on disk as they are; it is what a
 * per-change merge will use once it can compose an answer neither side wrote.
 *
 * Flushed before returning. The decision is repository state and an unflushed write can
 * be lost outright, and it is a race rather than a stable failure (§4.11) - a resolve
 * the author made and Studio then forgot is indistinguishable to them from Studio
 * ignoring the click.
 *
 * Does NOT commit. See the note at the top of this module.
 */
export async function resolveConflicts(
    globals: LoreGlobals,
    root: string,
    relativePaths: readonly string[],
    choice: VcsConflictChoice,
    sets: DocumentSetLookup = documentSetAt,
): Promise<VcsMergeResolveResult> {
    const expanded = await expandDocumentSets(root, relativePaths, sets);
    const absolute = expanded.map((relative) => repositoryPath(root, relative));
    if (choice !== "working-tree") {
        // Every path first, then one settle call: a copy that fails must not leave half the
        // selection settled and the other half not, which is a state nothing can read back.
        for (const file of absolute) takeSide(file, choice);
    }
    const result = await branchMergeResolve(globals, absolute);
    await flushRepository(globals);
    return { files: result.files, state: await readMergeState(globals, root) };
}

/**
 * Add to any path that belongs to a multi-file document every OTHER conflicted path of that
 * document.
 *
 * **"Take one side" is a decision about a DOCUMENT, not about a file.** Half a story taken from
 * one author and half from the other is a script neither of them wrote, which nevertheless
 * compiles - the silent, late failure `DocumentMergeRefusal` exists to name. So a set is settled
 * whole, and this is where "whole" is worked out.
 *
 * It changes nothing about how a side is taken: the copy is still `~mine`/`~theirs` over the
 * conflicted file, and the settle is still the plain verb, for the reason set out above - the two
 * verbs named after the sides mean the opposite of their names on a merge that came from a sync
 * (§4.31), and Studio can only produce that kind.
 *
 * **It ADDS rather than replaces, and that is a fix for a data-losing defect rather than a
 * refinement.** The first version dropped every incoming set path and re-derived the list from
 * {@link findConflictedPaths}, which requires the conflicted file itself to be on disk. But a
 * per-change settle DELETES a member the author decided against keeping (`writeDocumentSet`), so
 * exactly the path that most needs settling is the one the walk can no longer see. It was never
 * handed to the resolve verb, the commit was refused naming it, and by then the members that did
 * settle had already lost their sidecars to the failed commit's stage (§4.32) - the unrecoverable
 * state `writeDocumentSet` promises to avoid.
 *
 * An incoming set path is kept when **the merge's own copies are still beside it**, which is the
 * question that actually matters and is true for a deleted member. It is not simply kept
 * unconditionally: a folded surface names a set by its MANIFEST, and a manifest that automerged
 * cleanly has no sidecars - {@link takeSide} would throw on it and "keep mine" would fail on every
 * set whose manifest was not itself in conflict.
 *
 * Costs a walk only when a path really belongs to a set. No set is registered today, so this is
 * `relativePaths` unchanged and no `readdir` happens at all.
 *
 * Exported for its own test: it reaches no backend, and driving it through `resolveConflicts`
 * would need a repository just to observe which paths a settle was given.
 */
export async function expandDocumentSets(
    root: string,
    relativePaths: readonly string[],
    sets: DocumentSetLookup,
): Promise<readonly string[]> {
    const manifests = new Set<string>();
    for (const relative of relativePaths) {
        try {
            const location = sets(relative);
            if (location) manifests.add(location.manifestPath);
        } catch {
            // A lookup is asked about paths the backend chose; one odd path must not stop a settle.
        }
    }
    if (manifests.size === 0) {
        return relativePaths;
    }

    const expanded = new Set<string>();
    for (const relative of relativePaths) {
        const manifest = setOf(sets, relative);
        if (manifest === undefined || !manifests.has(manifest)) {
            expanded.add(relative);
            continue;
        }
        if (hasMergeSides(root, relative)) {
            expanded.add(relative);
        }
    }

    // Then every other conflicted path of the same documents - the same walk `readMergeState`
    // reports from, so the expansion cannot name a path the surface never saw.
    for (const relative of await findConflictedPaths(root)) {
        const manifest = setOf(sets, relative);
        if (manifest && manifests.has(manifest)) {
            expanded.add(relative);
        }
    }
    return [...expanded];
}

/**
 * Whether the merge's two recorded sides are still beside this path.
 *
 * The half of {@link findConflictedPaths} that does NOT ask whether the conflicted file itself is
 * there. A per-change settle can delete the file and leaves the sidecars alone (the commit removes
 * them), so this is what still identifies such a path as one of the merge's own.
 */
function hasMergeSides(root: string, relativePath: string): boolean {
    const absolute = repositoryPath(root, relativePath);
    return fs.existsSync(`${absolute}${SIDECAR_SUFFIXES.mine}`)
        && fs.existsSync(`${absolute}${SIDECAR_SUFFIXES.theirs}`);
}

function setOf(sets: DocumentSetLookup, relativePath: string): string | undefined {
    try {
        return sets(relativePath)?.manifestPath;
    } catch {
        return undefined;
    }
}

/**
 * A conflicted path with one side of the merge missing from disk.
 *
 * Named and thrown rather than skipped: the paths this runs on come from
 * {@link findConflictedPaths}, which only lists a path when BOTH sides are beside it, so
 * reaching this means something removed one between the two - and settling the path
 * anyway would record the file with the conflict markers still in it.
 */
export class MergeSideMissingError extends Error {
    constructor(readonly file: string) {
        super(`The merge's copy of this side is missing: ${file}`);
        this.name = "MergeSideMissingError";
    }
}

/** Copy one recorded side over the conflicted file. See {@link resolveConflicts}. */
function takeSide(absolute: string, choice: VcsMergeSideChoice): void {
    const source = `${absolute}${SIDECAR_SUFFIXES[choice]}`;
    if (!fs.existsSync(source)) {
        throw new MergeSideMissingError(source);
    }
    // A plain copy rather than Studio's atomic writer, for `revisionRestore`'s reason: the
    // operation as a whole is not atomic (it is one file per conflict), so per-file atomicity
    // buys nothing the merge's own three copies on disk do not already provide.
    fs.copyFileSync(source, absolute);
}

/**
 * Put settled paths back into the unresolved state.
 *
 * The undo for a choice made too fast, and the reason the resolve verbs do not need a
 * confirmation of their own: `mine` and `theirs` overwrite the working tree, but the
 * three sides are still on disk beside the file, so the decision is recoverable.
 */
export async function unresolveConflicts(
    globals: LoreGlobals,
    root: string,
    relativePaths: readonly string[],
): Promise<VcsMergeResolveResult> {
    const files = await branchMergeUnresolve(
        globals,
        relativePaths.map((relative) => repositoryPath(root, relative)),
    );
    await flushRepository(globals);
    return { files, state: await readMergeState(globals, root) };
}

/**
 * Redo the automatic merge for these paths, discarding what is in the working tree.
 *
 * Different from {@link unresolveConflicts}: that one takes a decision back, this one
 * throws away the bytes as well and asks the backend to try again from the two sides.
 * The one way back from a half-edited merge result.
 */
export async function restartConflicts(
    globals: LoreGlobals,
    root: string,
    relativePaths: readonly string[],
): Promise<VcsMergeState> {
    await branchMergeRestart(globals, relativePaths.map((relative) => repositoryPath(root, relative)));
    await flushRepository(globals);
    return readMergeState(globals, root);
}

/**
 * Abandon the merge and put the working tree back.
 *
 * **Safe to offer as a button, and that is measured rather than assumed** (§4.27): the
 * whole working tree is compared by content hash before the merge, after it, and after
 * the abort - and after the abort every file is identical to before, the sidecars are
 * gone, and the status header is back to what it was. Without that measurement this
 * would have to be a verb nothing in the interface could reach, because "cancel" that
 * leaves a half-merged tree behind is worse than no cancel at all.
 *
 * The caller must re-read every document afterwards: the bytes under its editors were
 * written by the merge and have just been written over again.
 */
export async function abortMerge(globals: LoreGlobals, root: string): Promise<VcsMergeState> {
    await branchMergeAbort(globals);
    await flushRepository(globals);
    return readMergeState(globals, root);
}
