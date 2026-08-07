/**
 * Studio-facing version control types.
 *
 * Deliberately vendor-neutral: no `Lore` prefix appears here or anywhere above
 * the manager. Lore is pre-1.0 with no semver guarantee and its JS SDK is
 * code-generated from a C header, so the backend is treated as replaceable.
 * See docs/version-control.md.
 */

// Type-only: the document model is where a change is defined, and a diff result is that
// model with two revisions named around it. Re-declaring the shape here would be a second
// definition of a change for the same renderer to draw.
import type { DocumentDiffEntry, DocumentMergeDecision } from "../documents/diff";
import type { DocumentKind } from "../documents/types";

/** A revision identifier. Opaque to the renderer; hex at the transport layer. */
export type RevisionId = string;

/**
 * Version control is an OPTIONAL capability.
 *
 * The backend is a Rust shared library that Epic only ships for a subset of
 * platforms - notably there is no Windows ARM64 build and no macOS x64 (Intel)
 * one. On an unsupported host the VCS surface reports itself unavailable and
 * callers hide the feature.
 *
 * Of those two, only Windows ARM64 is a host Studio ships on: the absent
 * darwin-x64 backend is why Studio dropped Intel Macs entirely, version control
 * being core rather than optional. The row below stays because the gate is keyed
 * on platform/arch and a self-built library via LORE_LIB_PATH bypasses it.
 *
 * Never assume availability. Call `getAvailability` once per project view and
 * branch on it; every other VCS call fails on an unsupported host.
 */
export type VcsUnavailableReason =
    /** No native build exists for this OS/arch combination. */
    | "unsupported-platform"
    /** Platform is supported, but the native package is not installed in this build. */
    | "backend-missing"
    /** The native library exists but failed to load (corrupt install, missing CRT, blocked by policy). */
    | "backend-load-failed";

export type VcsAvailability =
    | { available: true }
    | { available: false; reason: VcsUnavailableReason; detail?: string };

/** OS/arch pairs Epic ships a Lore native build for, as of Lore v0.8.5. */
export const VCS_SUPPORTED_PLATFORMS: ReadonlyArray<{ platform: NodeJS.Platform; arch: string }> = [
    { platform: "win32", arch: "x64" },
    { platform: "darwin", arch: "arm64" },
    { platform: "linux", arch: "x64" },
    // linux arm64 is a Graviton/Neoverse (SVE) build; it will not run on generic ARM.
    { platform: "linux", arch: "arm64" },
];

/**
 * Whether a native Lore build exists for this host.
 *
 * Pure and dependency-free so the renderer can use it too. A `true` here means
 * "a build should exist", not "it loaded" - only the main process knows that.
 */
export function isVcsPlatformSupported(
    platform: NodeJS.Platform = process.platform,
    arch: string = process.arch,
): boolean {
    return VCS_SUPPORTED_PLATFORMS.some((p) => p.platform === platform && p.arch === arch);
}

/**
 * Fold a configured name and email into the one string Lore stores.
 *
 * Lore's `identity` is a single per-call global recorded verbatim (see `LoreGlobals`), so an
 * email is not a second field it knows about - it is part of that string or it is nowhere. The
 * `Name <email>` shape is the one every other version-control tool writes and every reader of a
 * history already parses, which is the whole reason to compose rather than invent a separator.
 *
 * Pure and dependency-free, next to {@link isVcsPlatformSupported}, so main can record with it and
 * the renderer can show what will be recorded without either owning the rule.
 *
 * Four cases, and none of them is a defensive branch - all four are reachable from the two Sync
 * settings being independently empty:
 *
 * - both set     -> `Ada Lovelace <ada@example.com>`
 * - name only    -> `Ada Lovelace`
 * - email only   -> `<ada@example.com>`, because dropping the one thing they configured to print
 *                   a name they did not would attribute their revisions to a stranger. Angle
 *                   brackets with nothing before them is exactly how git records the same case.
 * - neither      -> `""`, left for the CALLER to replace with its own unconfigured identity. This
 *                   function does not know what that should be and must not guess: it is the
 *                   difference between "nobody said" and a name.
 */
export function composeVcsIdentity(name: string | undefined, email: string | undefined): string {
    const cleanName = (name ?? "").trim();
    // Angle brackets would nest inside the ones added below and produce an identity no reader can
    // split. Stripped rather than rejected: this runs on every write, and refusing to record
    // because of a stray character in a setting would block committing rather than fix anything.
    const cleanEmail = (email ?? "").trim().replace(/[<>]/g, "");
    if (!cleanEmail) {
        return cleanName;
    }
    return cleanName ? `${cleanName} <${cleanEmail}>` : `<${cleanEmail}>`;
}

/**
 * The branch a repository created by Studio starts on.
 *
 * The backend's choice, not Studio's - nothing here asks for a branch name at init - which is why
 * it is pinned by an integration test against a real repository
 * (`repository.integration.test.ts`) rather than merely written down. It exists because the version
 * surfaces name the branch ONLY when it is not this one: an author who never left it should pay no
 * pixels for a fact that is always true, and an author who used their own `lore` CLI to branch must
 * not be shown a version number that silently belongs to somewhere else. Should upstream rename it,
 * the failure is a red test rather than every install suddenly growing a branch name in its status
 * bar.
 */
export const VCS_DEFAULT_BRANCH = "main";

export interface VcsRepositoryInfo {
    /** Repository root on disk. */
    root: string;
    /** Stable repository identifier. */
    repositoryId: string;
    /** Newest revision on the current branch, if any. */
    head?: RevisionId;
    /**
     * {@link head}'s revision number - monotonic per repository, and what `#12` is made of.
     *
     * Zero in a repository with no revisions, which is the same state {@link head} reports by being
     * absent.
     */
    headNumber: number;
    /**
     * Branch the working tree is on, e.g. `main`.
     *
     * Empty string when the backend did not report one, matching {@link VcsStatus.branch}. A
     * surface deciding whether to SHOW it compares against {@link VCS_DEFAULT_BRANCH}, so "" and
     * the default are treated alike: neither is worth saying.
     */
    branch: string;
}

/**
 * What the author gets to decide when they put a project under version control.
 *
 * Shared rather than main-only because enabling version control is a renderer-driven
 * act - it is the one write that cannot wait for the resolve UI, since without it a
 * project has no repository for anything else to read. Every field is optional; the
 * defaults are what "just turn it on" means.
 */
export interface VcsInitOptions {
    /** Author recorded on the first commit, and persisted into the repository config. */
    identity?: string;
    description?: string;
    message?: string;
    /** Only for a repository created against a known remote; a placeholder is used otherwise. */
    repositoryUrl?: string;
}

/**
 * Why a revision exists: the author asked for it, or the clock did.
 *
 * Both are ORDINARY revisions on the ordinary branch, told apart only by the metadata
 * key below. Deliberately not a separate branch for checkpoints: switching branches
 * moves the working tree, and a checkpoint that touched the author's files would be a
 * background task editing their project.
 */
export type VcsRevisionKind = "commit" | "checkpoint";

/**
 * The repository metadata key that records a {@link VcsRevisionKind}.
 *
 * Namespaced because the repository is not Studio's private store - the author's own
 * `lore` CLI and any future collaborator's client see the same metadata, and an
 * unprefixed `kind` would be a land grab on a shared namespace.
 *
 * A revision with no value here is not a checkpoint. That covers the repository's
 * first commit (written by `initRepository`, which predates kinds) and anything
 * committed by another client, so the history UI must treat "absent" as "show it"
 * rather than as a default of either kind.
 */
export const VCS_REVISION_KIND_KEY = "narraleaf.kind";

/**
 * When Studio takes a checkpoint on its own initiative.
 *
 * `interval` is the timer; the other three are the unconditional ones, taken at the
 * moments where the next thing that happens can make the current working tree
 * unrecoverable. Every one of them still refuses to make an empty revision - a
 * checkpoint of a tree that has not changed is a lie about the author's history.
 */
export type VcsCheckpointReason =
    /** The `versionControl.checkpointIntervalMinutes` timer, after a versioned write. */
    | "interval"
    /** The author is closing the project; nothing will be watching the tree afterwards. */
    | "project-close"
    /** A production build is about to run. */
    | "build"
    /**
     * A restore is about to overwrite the working tree.
     *
     * The only one taken BEFORE the act rather than around it, because it is the only act
     * that writes over files the author has not seen recorded anywhere. It is also the
     * reason a restore is safe to offer at all, which is why the confirmation says so.
     */
    | "restore";

export interface VcsCommitOptions {
    /** Recorded verbatim on the revision. Empty means the default for the kind. */
    message?: string;
    /**
     * Who to record as the author. The seam for a logged-in identity; left unset,
     * the main process resolves it from settings.
     */
    identity?: string;
}

export interface VcsCommitResult {
    revision: RevisionId;
    /** Monotonic per repository. */
    number: number;
    kind: VcsRevisionKind;
    /** Files the commit added or changed, as the backend counted them. */
    fileCount: number;
}

/**
 * What the author gets to decide when they put the working tree back to a past revision.
 *
 * There is deliberately no "which files" here. A partial restore is a different feature with a
 * different failure mode (a tree that is half one version and half another, with nothing on screen
 * saying which half), and it is a later milestone.
 */
export interface VcsRestoreOptions {
    /**
     * How the surface that asked names the source revision - `#12`, as the rail spells it.
     *
     * Folded into the recorded message, which is why it must NOT be a translated string: a commit
     * message is permanent repository content that travels to collaborators and outlives the
     * interface language it was written under. A revision number is not language; a sentence is.
     * Absent, the main process names the revision by its short hash instead.
     */
    label?: string;
    identity?: string;
}

/**
 * What a restore did.
 *
 * The shape says the thing the feature is built around: restoring **adds** a revision and never
 * removes one. Nothing between the target revision and the head disappears - the working tree is
 * written to match an older version and that state is then recorded as the newest one.
 */
export interface VcsRestoreResult {
    /** The revision the working tree was put back to. */
    from: RevisionId;
    /**
     * The checkpoint taken before a single byte was written, or null when there was nothing to
     * protect.
     *
     * Null is the ordinary case for a clean tree, and it is not a failure: with nothing uncommitted,
     * the head already IS the pre-restore state, so there is nothing a checkpoint could add.
     */
    checkpoint: VcsCommitResult | null;
    /**
     * The revision the restore recorded, or null when the working tree already matched the target.
     *
     * Also not a failure: restoring to what is already on disk changes nothing, and an empty
     * revision would be a lie about the author's history (see `NothingToCommitError`).
     */
    revision: VcsCommitResult | null;
    /**
     * Why {@link revision} is null, when the reason is a failure rather than an unchanged tree.
     *
     * The two are not interchangeable and a surface must tell them apart: with `revision: null` and
     * no failure, nothing happened because nothing needed to. With a failure, **the author's files
     * have already been replaced** and only the record of it is missing - which is a sentence they
     * have to read, because "the restore failed" is what they would otherwise assume, and the fix
     * (submit a version) is one they can do themselves.
     *
     * Reported here rather than thrown for the same reason: past the write step there is no honest
     * way to answer "it did not happen".
     */
    recordFailure: string | null;
    filesWritten: number;
    /** Files that existed only because they were added after {@link from}. */
    filesRemoved: number;
}

export interface VcsHistoryEntry {
    revision: RevisionId;
    /** Monotonic per repository; usable as a cheap topological rank. */
    number: number;
    /**
     * Direct parent first, second parent of a merge (when present) second.
     * Root revisions have none.
     */
    parents: RevisionId[];
    /**
     * What kind of revision this is, when the caller asked for kinds.
     *
     * Absent both when the caller did not ask and when the revision records no kind,
     * because reading it costs one backend call PER REVISION - there is no batch verb -
     * and a history list that paid for it unconditionally would make opening the panel
     * on a long-lived project a few hundred round trips.
     */
    kind?: VcsRevisionKind;
    /**
     * What the revision says it is, as its author wrote it.
     *
     * Read from the same per-revision metadata call as {@link kind} and gated by the
     * same flag, so it costs nothing extra once kinds are asked for.
     *
     * Optional because it genuinely can be missing: nothing in the backend obliges a
     * revision to carry a message, and one written by another client carries whatever
     * that client wrote. Absent must render as absent - an empty string here would show
     * as a commit with a blank title rather than as one that did not say.
     */
    message?: string;
    /**
     * When the revision was made, in **epoch milliseconds** (UTC).
     *
     * Milliseconds is measured, not assumed: the backend records this key as its
     * numeric metadata type and the value read back off a fresh commit falls inside the
     * wall-clock window around it in ms. Reading it as seconds dates every revision to
     * January 1970; reading a seconds value as ms lands it in the year 56000. Either
     * looks like a UI defect forever.
     */
    timestamp?: number;
    /**
     * Who the backend recorded as the committer.
     *
     * A free-form identity string, not an account: it is whatever the committing client
     * was configured with, so it can be a name, an email, or Studio's own fallback for
     * a project whose author name is unset.
     */
    author?: string;
}

export interface VcsBlobRequest {
    projectPath: string;
    revision: RevisionId;
    /** Repository-relative path. Absolute or escaping paths are rejected. */
    path: string;
}

/**
 * How one path differs from the last commit.
 *
 * A string union rather than the backend's numeric enum: those numbers are ABI, and
 * a renumbering upstream would silently relabel every change in the UI.
 */
export type VcsChangeKind = "added" | "modified" | "deleted" | "moved" | "copied";

export interface VcsFileChange {
    /**
     * REPOSITORY-RELATIVE, which is the opposite of what the write side wants.
     * Anything that feeds a status result back into a stage or restore call has to
     * make it absolute first; both are `string` and the compiler will not object.
     */
    path: string;
    kind: VcsChangeKind;
    /**
     * A directory rather than a file.
     *
     * Directories are reported as changes in their own right - creating one folder
     * with one file in it produces two entries - and the counts include them. Kept
     * rather than filtered out because a directory can change with no file under it
     * changing at all, and because dropping them would leave `counts` describing a
     * different list than `files`. A change list shown to an author usually wants
     * only the entries where this is false.
     *
     * Symbolic links are reported here as files; Studio treats them as ordinary
     * entries everywhere else too.
     */
    directory: boolean;
    /** Working-tree size in bytes; zero for a deletion or a directory. */
    size: number;
    /** Already recorded in the staged revision, so the next commit will include it. */
    staged: boolean;
    /** The working tree differs from the recorded state. */
    dirty: boolean;
    conflicted: boolean;
    /** A conflict nobody has resolved yet - the only kind that blocks a commit. */
    conflictUnresolved: boolean;
    /**
     * The backend reconciled this path on its own, without anyone choosing.
     *
     * The first of three flags that say HOW a conflict was settled, as opposed to the two
     * above, which say whether there is one. They were being decoded and thrown away, and
     * dropping them is how a surface ends up unable to tell "merged automatically" from
     * "the author decided".
     *
     * **Optional because no producer has ever set one.** Measured: a status read taken
     * while a conflicted merge is open reports NO FILES AT ALL - the merge has already
     * recorded its result as the staged revision, so nothing is pending
     * (docs/version-control.md §4.24, pinned in `merge.integration.test.ts`). So `false`
     * and absent mean the same thing here, which is "nobody said", and a caller must not
     * read either as "not settled that way". The paths a merge left open come from
     * {@link VcsMergeState.conflicts}, which is rebuilt from disk rather than from this.
     */
    conflictAutomerged?: boolean;
    /** Settled by taking this project's side. See {@link conflictAutomerged} for the caveat. */
    conflictMine?: boolean;
    /** Settled by taking the incoming side. See {@link conflictAutomerged} for the caveat. */
    conflictTheirs?: boolean;
    /** Where a move or copy came from. Absent for every other kind. */
    fromPath?: string;
}

export interface VcsChangeCounts {
    added: number;
    modified: number;
    deleted: number;
    moved: number;
    copied: number;
}

/**
 * How this branch stands against its remote.
 *
 * Present from the first milestone even though Studio is single-machine until
 * collaboration lands: the same status call already returns all of it, and retrofitting
 * a shape the UI has grown around costs more than carrying it. Every field is false or
 * absent while no remote is configured, which is what "purely local" looks like.
 */
export interface VcsSyncState {
    /** A remote is configured and answered. */
    remoteAvailable: boolean;
    /** The remote accepted this identity. False also means "never asked". */
    remoteAuthorized: boolean;
    /** This branch exists on the remote. */
    remoteBranchExists: boolean;
    /** Local commits the remote does not have. */
    localAhead: boolean;
    /** Remote commits this machine does not have. */
    remoteAhead: boolean;
    remoteRevision?: RevisionId;
}

/**
 * The server a project synchronises with, as the author configured it.
 *
 * **A server address, not a per-project URL.** Measured: the backend records only the
 * ORIGIN of whatever URL it is given (`lore://host:41337/anything` is stored as
 * `lore://host:41337`), and identifies the repository by the id in `.lore/id`. So there
 * is exactly one thing for an author to type, which is the whole reason the setup form
 * is one field.
 */
export interface VcsRemote {
    /** Server origin, e.g. `lore://vcs.example.lan:41337`. */
    url: string;
}

/**
 * The URL handed to the backend when creating a repository that has no server.
 *
 * The backend REFUSES to create a repository without a URL, even one that will never see
 * a network (docs §4.7), so "no remote" cannot be represented by absence - something has
 * to be in the file. `.invalid` is reserved by RFC 2606 and can never resolve, which is
 * the point: if a bug ever lets an online call through on an unconfigured project, it
 * fails to look up a name rather than talking to whoever answers.
 *
 * **The `/none` is not decoration.** Measured: the backend rejects a repository URL with
 * no path segment outright - `lore://unconfigured.invalid` and `lore://unconfigured.invalid/`
 * both fail with `parsing repository URL: Invalid URL`, while `lore://unconfigured.invalid/none`
 * is accepted. It then discards the segment and stores only the origin, which is why what
 * is written here and what comes back out are two different strings - see
 * {@link VCS_UNCONFIGURED_REMOTE}.
 */
export const VCS_UNCONFIGURED_REMOTE_URL = "lore://unconfigured.invalid/none";

/**
 * What {@link VCS_UNCONFIGURED_REMOTE_URL} looks like once the backend has stored it.
 *
 * The path segment is dropped on the way in (measured), so this - not the URL above - is
 * what a read of the config answers and what "no server" has to be recognised by.
 */
export const VCS_UNCONFIGURED_REMOTE = "lore://unconfigured.invalid";

/**
 * The placeholder Studio wrote before {@link VCS_UNCONFIGURED_REMOTE} existed.
 *
 * **This is the default loreserver address**, and it is in the config of every project
 * Studio has ever created: the backend stripped the `/local` path segment off
 * `lore://127.0.0.1:41337/local` and kept the origin. Nothing dialled it because every
 * call was offline - but the moment any call is not, a machine running a local server
 * would find its projects talking to it. Recognised here so those projects read as
 * unconfigured rather than as connected to whatever answers on that port.
 */
export const VCS_LEGACY_PLACEHOLDER_REMOTE = "lore://127.0.0.1:41337";

/**
 * Whether this URL names a server the author chose.
 *
 * Both placeholders answer false, so an existing project needs no migration to be
 * correctly reported as having no server.
 */
export function isVcsRemoteConfigured(url: string | null | undefined): boolean {
    const trimmed = (url ?? "").trim().replace(/\/+$/, "");
    if (!trimmed) return false;
    return trimmed !== VCS_UNCONFIGURED_REMOTE.replace(/\/+$/, "")
        && trimmed !== VCS_LEGACY_PLACEHOLDER_REMOTE;
}

/**
 * A server address split into the two things it names, or null when it is not one.
 *
 * **The path segment is required and is not decoration.** Measured: it becomes the repository's
 * name on the server, it is the name a collaborator clones by, and the backend rejects an address
 * without one outright (`parsing repository URL: Invalid URL`).
 *
 * Shared rather than kept beside the backend, because both ends now need the same verdict: the
 * main process refuses a bad address as it writes one into a repository config, and the wizard has
 * to refuse the same one while the author is still looking at the field. Two spellings of this
 * rule would be a wizard that accepts an address the backend later rejects - and it would reject
 * it after the destination folder had already been written into.
 */
export function parseVcsRemoteUrl(url: string): { origin: string; name: string } | null {
    const match = /^(lore:\/\/[^/?#\s]+)\/([^/?#\s]+)\/*$/i.exec(url.trim());
    return match ? { origin: match[1], name: match[2] } : null;
}

/** What a push did. */
export interface VcsPushResult {
    branch: string;
    /**
     * The server already had this branch tip, so nothing was transferred.
     *
     * A SUCCESS. Pressing Push twice is ordinary and the second press has to read as
     * "already there" rather than as a failure.
     */
    alreadyPushed: boolean;
}

/**
 * What a sync brought down - and whether it left conflicts behind.
 *
 * Measured: syncing a diverged branch MERGES automatically and records a new revision,
 * so divergence is not a dead end. Only edits to the same file produce {@link conflicts}.
 */
export interface VcsSyncResult {
    /** Files written or removed in the working tree. Non-zero means editors must re-read. */
    filesChanged: number;
    /** Revisions brought down from the server. */
    revisionsReceived: number;
    /**
     * Paths the merge could not settle, which the author must resolve before committing.
     *
     * Empty in the ordinary case. A non-empty list is REPORTED and the sync stops there: it does
     * not carry the author into the resolve surface, which they reach by pressing something. Same
     * discipline as never creating a repository on their behalf, and forced by the mechanism too -
     * these paths exist only in the sync's own event stream (docs §4.24), so handing them over has
     * to be deliberate.
     */
    conflicts: string[];
    /** True when nothing was behind: the working tree already matched the server. */
    alreadyCurrent: boolean;
}

/**
 * Whether this project is in the middle of a merge, and what is still open.
 *
 * **A merge outlives the process that started it.** It lives in the repository, not in
 * Studio, so the author can close the window on an unresolved sync and reopen it a day
 * later - which is the whole reason this is a question that can be ASKED rather than a
 * value handed back by the operation that caused it.
 *
 * Both fields below are reconstructed from what a merge leaves on disk. Neither comes
 * from the status file list: measured, a status read during a conflicted merge reports
 * no files at all, because the merge has already recorded its own result as the staged
 * revision and the working tree agrees with it (docs/version-control.md §4.24).
 */
export interface VcsMergeState {
    /**
     * A merge has begun here and has not been recorded as a revision yet.
     *
     * False the moment the merge is committed or abandoned, and false in the ordinary
     * life of a project. While it is true, the working tree holds two sides' work and a
     * plain commit is what closes it.
     */
    inProgress: boolean;
    /**
     * The revision being merged in, when the backend named one.
     *
     * Only ever present while {@link inProgress}: the field it comes from keeps its last
     * value after the merge is recorded, so reporting it afterwards would describe a
     * merge that is over as one that is happening.
     */
    incoming?: RevisionId;
    /**
     * Repository-relative paths the merge could not settle on its own.
     *
     * **This is "the merge left these to a human", not "these are still undecided", and
     * the difference is measured rather than a nicety.** A path stays on this list after
     * the author settles it: settling records no per-path mark anywhere Studio can read -
     * the file that says so is the backend's own, the status call reports nothing for the
     * whole of a merge, and two of the three settle verbs emit no events at all. The list
     * shrinks only when the merge is committed or abandoned.
     *
     * The one observation that DOES separate settled from unsettled is the commit itself:
     * committing with a path still unsettled fails with `Unable to commit when <path> is
     * still in conflict`. That is a write, so it is the backstop rather than a probe -
     * which is why a surface that wants to show progress must remember the author's own
     * decisions for the life of the window, and must not present that memory as the
     * repository's state after a restart.
     *
     * Ordered by path, so a list drawn from it does not reshuffle between two reads.
     */
    conflicts: string[];
}

/**
 * Which side a conflicted path is settled with.
 *
 * `working-tree` is the one that can express an answer neither side wrote: the caller
 * writes the bytes first and this says they are final. The other two overwrite the
 * working tree with one side wholesale and are the only ones available for content
 * Studio cannot merge - binaries, documents with no spec, anything over the size budget.
 *
 * **`mine` is always the author's own side and `theirs` the incoming one**, which is not
 * what the backend verbs of those names do after a sync - see `resolveConflicts` in
 * `vcs/merge.ts` for the measurement and for what Studio does instead.
 */
export type VcsConflictChoice = "working-tree" | "mine" | "theirs";

/**
 * The two choices that take a file WHOLE, which is the whole of tier one.
 *
 * Derived from {@link VcsConflictChoice} rather than written out again, so a fourth verb added
 * to the backend cannot appear here without someone deciding whether it takes a side whole.
 * `working-tree` is deliberately excluded: it means "the caller has already written the answer",
 * which is per-change resolution and a later milestone.
 */
export type VcsMergeSideChoice = Exclude<VcsConflictChoice, "working-tree">;

/**
 * One conflicted path taken WHOLE from one side - tier one.
 *
 * Per PATH rather than one choice for the whole merge, because taking every file from one side is
 * rarely what anyone means - and per file is still tier one, since each file is taken whole.
 */
export interface VcsMergeWholeDecision {
    /** Repository-relative, as {@link VcsMergeState.conflicts} reports it. */
    path: string;
    choice: VcsMergeSideChoice;
}

/**
 * One conflicted path settled change by change - tier two.
 *
 * Only reachable for a path {@link VcsMergeDocument} answered without a `blocked`, which is
 * exactly the set of documents whose spec can both merge three ways and write itself back. Every
 * other document stays at tier one in the same list, visibly, rather than being hidden.
 *
 * **The choices travel, the decisions do not.** `changes` is keyed by `mergeDecisionKey` over a
 * decision's own path, and the main process recomputes the decision list from the merge's three
 * copies on disk before applying them: `merge3` is pure and its inputs are files, so the two runs
 * agree by construction. Sending the decisions back instead would let a renderer settle a
 * conflict with a value the repository never held.
 *
 * A conflict with no entry here is refused by name rather than defaulted - see
 * `MergeChangeUndecidedError`. An `auto-*` row with no entry keeps the side the merge took, which
 * is what makes flipping one and answering a conflict the same act.
 */
export interface VcsMergePerChangeDecision {
    path: string;
    choice: "per-change";
    changes: Record<string, VcsMergeSideChoice>;
}

export type VcsMergeDecision = VcsMergeWholeDecision | VcsMergePerChangeDecision;

/**
 * Why one conflicted document cannot be settled change by change.
 *
 * **Falling back to tier one is a normal outcome and has to be visible**, which is what this type
 * is for: a surface that simply omitted the per-change control would present "we cannot" and "you
 * already have" as the same blank space. Per plan 2026-07-31-004 §4.2, tier three is "refuse and
 * say why", not a greyed-out button.
 *
 *  - `no-spec` - nothing in Studio claims this path. Most of a repository is like this.
 *  - `no-merge3` - a spec, but no three-way merge for this format yet.
 *  - `read-only` - the spec can merge but refuses to write itself back, so a per-change result
 *    could be composed and never saved. True today of the asset shards, whose `serialize` throws
 *    by design while `AssetsService` still owns writing them.
 *  - `too-large` - one of the three sides is over the parse ceiling.
 *  - `too-many` - more decisions than a list can honestly carry. Not truncated: a partial decision
 *    list cannot be applied, because the changes it left out would have to be settled by something
 *    other than the author.
 *  - `unreadable` - a side is missing, is not JSON, or the spec rejected it.
 */
export type VcsMergeDocumentBlocker =
    | "no-spec"
    | "no-merge3"
    | "read-only"
    | "too-large"
    | "too-many"
    | "unreadable";

/**
 * What a three-way merge of one conflicted document says, or why there is nothing to say.
 *
 * Rebuilt from the three copies the merge left beside the file (docs §4.23) every time it is
 * asked, and it holds NO record of what the author has decided - there is nowhere to put one. A
 * settled conflict and an unsettled one are indistinguishable in the repository (§4.24), so the
 * choices live in the window that is drawing them, exactly as tier one's do.
 */
export interface VcsMergeDocument {
    /** Repository-relative, as {@link VcsMergeState.conflicts} reports it. */
    path: string;
    /** The format, when a spec claims this path. */
    documentKind?: DocumentKind;
    /** Empty when {@link blocked} is set. */
    decisions: DocumentMergeDecision[];
    /** How many of {@link decisions} are still the author's. */
    conflicts: number;
    /** Set when this path stays at tier one. {@link detail} carries the producer's own sentence. */
    blocked?: VcsMergeDocumentBlocker;
    /** Untranslated, from whatever refused. Shown beside the translated reason, never instead. */
    detail?: string;
}

/**
 * What closing a merge did: the revision it recorded, and what the merge looks like afterwards.
 *
 * `state` is re-read rather than assumed empty. A merge that still lists conflicts here is a
 * defect worth seeing rather than one to hide - and the backend refuses the commit outright while
 * anything is genuinely unsettled, naming the path, so this resolving at all already means the
 * decisions covered everything.
 */
export interface VcsMergeCompletion {
    revision: VcsCommitResult;
    state: VcsMergeState;
}

/** What settling some paths did. */
export interface VcsMergeResolveResult {
    /**
     * Paths the backend acknowledged, repository-relative.
     *
     * **Empty is not a failure.** Measured, only the verb that accepts the working tree
     * reports per-file events at all (docs/version-control.md §4.25) - which is now the
     * verb every choice goes through, so this is usually populated, and a caller that
     * needs to know what is LEFT asks {@link VcsMergeState} again rather than reading this.
     */
    files: string[];
    /** What is still open afterwards, re-read rather than inferred. */
    state: VcsMergeState;
}

export interface VcsStatus {
    /** Branch name as the author sees it, e.g. `main`. */
    branch: string;
    /** Newest commit on this branch. Absent only in a repository with no commits. */
    head?: RevisionId;
    /** Monotonic per repository; a cheap topological rank. */
    revisionNumber: number;
    /** Set when changes are staged but not yet committed. */
    stagedRevision?: RevisionId;
    /** Nothing pending. Derived from `files` so the two can never disagree. */
    clean: boolean;
    files: VcsFileChange[];
    counts: VcsChangeCounts;
    sync: VcsSyncState;
}

/**
 * The three inputs a merge needs, base64-encoded for transport.
 *
 * `base` is undefined when the two sides share no common ancestor, or when the
 * file does not exist in the base revision. That is an add/add conflict and must
 * not be treated as an empty base - doing so would silently accept one side.
 */
export interface VcsThreeWayResult {
    baseRevision?: RevisionId;
    base?: string;
    mine: string;
    theirs: string;
}

/**
 * What one comparison found, whichever two sides it compared.
 *
 * The two results below differ only in what they are anchored to, and that is on purpose:
 * a revision comparison and a working-tree comparison are the same list rendered by the
 * same component, so anything that is true of one shape has to be true of the other.
 *
 * Three fields carry the honesty of the answer and none of them is optional:
 *
 *  - `pathCount` is what really differs, whether or not it is in `documents`;
 *  - `complete` is false the moment a budget stopped the comparison short, and a surface
 *    that ignores it shows a truncated list as a whole one;
 *  - `readFailure` separates "nothing changed" from "the bytes could not be fetched",
 *    which are the same empty list and opposite facts. It is not hypothetical: a revision
 *    can list a file, its size and its address and still refuse to hand over the bytes -
 *    measured for content written by an online commit, which the process that wrote it
 *    cannot read back (docs/version-control.md §4.29).
 */
export interface VcsRevisionDiffResult {
    from: RevisionId;
    to: RevisionId;
    documents: DocumentDiffEntry[];
    /**
     * Changed paths this result stands for, including any `documents` does not carry.
     *
     * Equal to `documents.length` whenever `complete` is true. Directories are excluded
     * where they can be told apart from files, which is everywhere except a comparison
     * that was cut short before anything was read.
     */
    pathCount: number;
    complete: boolean;
    readFailure: string | null;
}

export interface VcsWorkingTreeDiffResult {
    /**
     * The revision the working tree was compared against.
     *
     * Absent in a repository with no revisions yet, where every file is an addition and
     * nothing was read out of history.
     */
    head?: RevisionId;
    documents: DocumentDiffEntry[];
    /** Changed files this result stands for. Directories are never counted. */
    pathCount: number;
    complete: boolean;
    readFailure: string | null;
}
