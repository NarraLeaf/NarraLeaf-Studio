/**
 * Studio-facing version control types.
 *
 * Deliberately vendor-neutral: no `Lore` prefix appears here or anywhere above
 * the manager. Lore is pre-1.0 with no semver guarantee and its JS SDK is
 * code-generated from a C header, so the backend is treated as replaceable.
 * See docs/version-control.md.
 */

/** A revision identifier. Opaque to the renderer; hex at the transport layer. */
export type RevisionId = string;

/**
 * Version control is an OPTIONAL capability.
 *
 * The backend is a Rust shared library that Epic only ships for a subset of
 * platforms - notably there is no macOS x64 (Intel) build and no Windows ARM64
 * build. Studio still ships everywhere; on an unsupported host the VCS surface
 * reports itself unavailable and callers hide the feature.
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

export interface VcsRepositoryInfo {
    /** Repository root on disk. */
    root: string;
    /** Stable repository identifier. */
    repositoryId: string;
    /** Newest revision on the current branch, if any. */
    head?: RevisionId;
    revisionCount: number;
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
