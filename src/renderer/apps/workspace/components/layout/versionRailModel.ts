import type {
    RevisionId,
    VcsAvailability,
    VcsFileChange,
    VcsHistoryEntry,
    VcsUnavailableReason,
} from "@shared/types/vcs";
import { VCS_DEFAULT_BRANCH } from "@shared/types/vcs";
import type { TranslationKey, Translator } from "@shared/i18n";
import { RAIL_SELECTOR_WIDTH } from "./dockLayoutModel";

/**
 * Every decision the version rail makes that is not a pixel: which of the six surface states the
 * author is in, what a linear history looks like when the real thing is a DAG, and which revisions a
 * collapsed list shows.
 *
 * Pure, and separate from the components, for the reason `dockLayoutModel` is: these are the parts
 * that can be wrong in a way a screenshot does not reveal. There are no component-render tests in
 * this codebase, so anything that decides behaviour has to be reachable without mounting a rail.
 */

/**
 * Strip width. The same 48px as the sidebar selector rail, and that is a product decision rather
 * than a coincidence: the strip IS the persistent "you are looking at a historical version"
 * indicator, and it reads as part of the window's left edge only if it lines up with the rail beside
 * it (plan 2026-07-28-002 §1). Derived from {@link RAIL_SELECTOR_WIDTH} so the two cannot drift.
 */
export const VERSION_RAIL_COLLAPSED_WIDTH = RAIL_SELECTOR_WIDTH;

/** Expanded width, from the plan's layout diagram (§3). */
export const VERSION_RAIL_EXPANDED_WIDTH = 320;

/**
 * How much of the window's left edge the version rail is occupying.
 *
 * Three answers rather than two, because a rail that is *reachable* and a rail that is *always
 * there* are different things and the difference is the whole of the owner's second correction:
 *
 * - `absent` - no column, and **0 in the dock account**. The rail is still openable from the status
 *   cell and the top-bar widget, which is what keeps the commit form (`data-vcs-seam="commit-form"`,
 *   inside the panel) reachable at HEAD - a preview is read-only by construction, so if the panel
 *   were reachable only from a preview, commit would have no home at all.
 * - `strip` - the persistent 48px indicator. It exists only while project data is frozen, because
 *   what it expresses is control over a temporary state, and it is the way back out of it.
 * - `panel` - the 320px panel the author asked for.
 */
export type VersionRailPresence = "absent" | "strip" | "panel";

/**
 * The width the dock solver has to be told about. Feeding this straight into
 * `DockEnv.versionRailWidth` is the whole contract.
 */
export function versionRailWidth(presence: VersionRailPresence): number {
    switch (presence) {
        case "absent":
            return 0;
        case "strip":
            return VERSION_RAIL_COLLAPSED_WIDTH;
        case "panel":
            return VERSION_RAIL_EXPANDED_WIDTH;
    }
}

export interface VersionRailPresenceInputs {
    /** Which of the six surface states this window is in. */
    state: VersionSurfaceState;
    /** The author has the panel open - the persisted `ui.versionRail.expanded` preference. */
    expanded: boolean;
    /**
     * Project data is frozen right now, for ANY reason.
     *
     * A revision preview and the palette's manual freeze are treated alike deliberately. Both are a
     * temporary state the author is standing in and has to be able to leave, and a manually frozen
     * workspace with no visible way out is strictly worse than a strip nobody asked for: the author
     * would be left with a project that silently refuses to save. Reading the freeze rather than
     * `state.kind === "revision"` is what makes the manual case reachable at all - a manual freeze
     * leaves the surface state on `current`.
     */
    frozen: boolean;
}

/**
 * Whether the rail is a column right now, and which one.
 *
 * The ordering is the argument:
 *
 * 1. An unavailable backend wins over everything, `expanded` included. Version control is an
 *    OPTIONAL capability, so there is no state in which a stale preference may conjure a column for
 *    a feature this build never shipped (see {@link isVersionSurfaceVisible}).
 * 2. `expanded` beats `frozen`: the panel supersedes the strip rather than sitting beside it.
 * 3. `frozen` is the ONLY thing that makes the rail persistent. At HEAD, in a project with no
 *    repository, and on a host with no backend, closing the panel therefore leaves nothing behind -
 *    which is the correction, and the reason this returns `absent` in the ordinary case.
 */
export function resolveVersionRailPresence(inputs: VersionRailPresenceInputs): VersionRailPresence {
    if (!isVersionSurfaceVisible(inputs.state)) {
        return "absent";
    }
    if (inputs.expanded) {
        return "panel";
    }
    return inputs.frozen ? "strip" : "absent";
}

/**
 * What the author is looking at, and therefore what every version-control surface renders.
 *
 * One resolver for the rail, the top-bar widget and the status-bar cell, because three surfaces that
 * each decided for themselves would eventually disagree - and "the top bar says this project has no
 * repository while the rail shows its history" is the kind of contradiction that makes an author
 * distrust the whole feature.
 */
export type VersionSurfaceState =
    /** Nothing has answered yet. Availability is one IPC round trip, and it dlopens ~29MB. */
    | { kind: "probing" }
    /**
     * This host cannot do version control. Every surface must render NOTHING in this state - not a
     * disabled button, not an explanation. See {@link isVersionSurfaceVisible}.
     */
    | { kind: "unavailable"; reason: VcsUnavailableReason; detail?: string }
    /** The backend works but this project has no repository. The surface offers to make one. */
    | { kind: "not-a-repository" }
    /** A repository with no revisions in it yet. */
    | { kind: "empty" }
    /** The working tree, which is the ordinary state. `number` is null until info has been read. */
    | { kind: "current"; head: RevisionId; number: number | null }
    /** A past revision is on screen and project data is frozen. `label` is usually `#4`. */
    | { kind: "revision"; revision: RevisionId; label?: string };

export interface VersionSurfaceInputs {
    /** Null until `getAvailability` has answered. */
    availability: VcsAvailability | null;
    /** Null until `isRepository` has answered. */
    isRepository: boolean | null;
    /** Head of the current branch, null in a repository with no revisions. */
    head: RevisionId | null;
    /** Head's revision number, null when info has not been read (or there is no head). */
    headNumber: number | null;
    /** The revision the editors are showing, from `VersionControlService.getShownRevision`. */
    shownRevision: RevisionId | null;
    /** How to name the shown revision; the freeze reason's own label. */
    shownLabel?: string;
}

/**
 * Which of the six states the surfaces are in.
 *
 * The ordering is the argument. A shown revision beats "empty" and beats a missing head, because
 * while a revision is on screen the workspace is frozen on it and saying anything else would leave
 * the author frozen with no visible cause. And availability is asked before everything, because
 * "this directory is not a repository" and "this machine has no backend" need opposite things said
 * (docs/version-control.md; `VcsUnavailableReason`) and only one of them is worth offering a fix for.
 */
export function resolveVersionSurfaceState(inputs: VersionSurfaceInputs): VersionSurfaceState {
    const { availability } = inputs;
    if (!availability) {
        return { kind: "probing" };
    }
    if (!availability.available) {
        return { kind: "unavailable", reason: availability.reason, detail: availability.detail };
    }
    if (inputs.shownRevision) {
        return { kind: "revision", revision: inputs.shownRevision, label: inputs.shownLabel };
    }
    if (inputs.isRepository === null) {
        return { kind: "probing" };
    }
    if (!inputs.isRepository) {
        return { kind: "not-a-repository" };
    }
    if (!inputs.head) {
        return { kind: "empty" };
    }
    return { kind: "current", head: inputs.head, number: inputs.headNumber };
}

/**
 * Whether the version-control surfaces exist at all: the top-bar widget, the status-bar cell, and
 * whether the rail can be OPENED (see {@link resolveVersionRailPresence}, which decides separately
 * whether it is also a persistent column).
 *
 * False for exactly one state, and the rule is stronger than "disabled": version control is an
 * OPTIONAL capability (no native build for macOS Intel or Windows ARM64), so on those machines it is
 * not a feature that is off, it is a feature that was never shipped. A greyed rail with a tooltip
 * would tell an author their installation is broken when nothing is.
 *
 * This is the opposite of the freeze convention next door (`freezeActionPolicy`: disabled, never
 * hidden), and deliberately: a freeze is a state the author put themselves in and can leave, so there
 * has to be something to hover. An unsupported platform is neither.
 *
 * True while PROBING, so the widget and the cell do not appear a beat after every project open. The
 * cost is bounded: the unsupported-platform answer short-circuits on an OS/arch comparison before
 * anything is dlopened (`loadVcsBackend`), so it is one IPC round trip rather than a 29MB library
 * load. It costs no layout reflow at all now that probing produces no column.
 */
export function isVersionSurfaceVisible(state: VersionSurfaceState): boolean {
    return state.kind !== "unavailable";
}

export interface CommitFormInputs {
    /** Which of the six surface states this window is in. */
    state: VersionSurfaceState;
    /**
     * Project data is frozen right now, for ANY reason - a revision preview or the palette's manual
     * freeze. Read from the freeze latch rather than from {@link state}, for the reason
     * {@link VersionRailPresenceInputs.frozen} gives: a manual freeze leaves the state on `current`.
     */
    frozen: boolean;
    /** A long operation is in flight. */
    busy: boolean;
}

/**
 * Whether the commit form exists at all.
 *
 * Frozen means it is not rendered rather than rendered inert, which is the same rule
 * {@link isVersionSurfaceVisible} follows for an unsupported host and the one `freezeGuard` states:
 * never offer an action the workspace cannot perform. An inert Commit button on a frozen workspace
 * is precisely that, and it is why this seam was left empty until now.
 *
 * `not-a-repository` is excluded for a different reason - there is already an offer there (Enable),
 * and two calls to action in one panel is one too many.
 *
 * **Deliberately does not consider whether anything has changed.** `VersionSurface.status` is null
 * until someone looks, and looking is a scan that writes staged state (docs §4.17) - so gating the
 * form on a change count would mean scanning to decide whether to draw a button. The backend answers
 * "nothing has changed since the last version" as an error, and for someone who pressed Commit that
 * IS the answer.
 */
export function isCommitFormPresent(inputs: Pick<CommitFormInputs, "state" | "frozen">): boolean {
    if (inputs.frozen) {
        return false;
    }
    return inputs.state.kind === "current" || inputs.state.kind === "empty";
}

/**
 * Whether pressing Commit right now would do anything.
 *
 * Presence plus "nothing else is running": a commit settles this window's save debt, stages the whole
 * project and waits for the backend's stores to reach disk (docs §4.22), so a second one started on
 * top of the first would be a second full pipeline over the same tree.
 */
export function canCommit(inputs: CommitFormInputs): boolean {
    return isCommitFormPresent(inputs) && !inputs.busy;
}

/**
 * What to tell the author when the backend is missing.
 *
 * Three reasons, two messages, because there are two different things wrong and the author can only
 * act on one of them: an unsupported OS/arch is their MACHINE and nothing they do to Studio will
 * change it, while a missing or unloadable native library is their INSTALLATION - a reinstall is the
 * fix. Collapsing them into one string would send half the users to reinstall for nothing.
 */
export function unavailableReasonKey(reason: VcsUnavailableReason): TranslationKey {
    return (reason === "unsupported-platform"
        ? "workspace.shell.versionControl.unavailable.platform"
        : "workspace.shell.versionControl.unavailable.installation") as TranslationKey;
}

/** One row of the rail's linear history. */
export interface FlatHistoryEntry {
    revision: RevisionId;
    number: number;
    /** Only present when the caller asked for details. Absent is normal - see {@link isCheckpoint}. */
    kind?: VcsHistoryEntry["kind"];
    /**
     * What the revision says it is. Absent when nobody wrote one, which is a real answer: the
     * repository's first commit is written by `initRepository` and carries no message at all.
     */
    message?: VcsHistoryEntry["message"];
    /** Epoch milliseconds, UTC. Absent when the revision records no time. */
    timestamp?: VcsHistoryEntry["timestamp"];
    /** Whatever identity the committing client was configured with. Absent when it had none. */
    author?: VcsHistoryEntry["author"];
    /**
     * This revision has more than one parent, so the line the rail draws through it hides a second
     * ancestry. Marked rather than expanded: the rail is a linear list by decision, and an
     * unmarked merge would be a linear list that quietly lies.
     */
    merge: boolean;
}

/**
 * The first-parent walk: the linear history the rail shows, out of the DAG the service returns.
 *
 * `VcsHistoryEntry.parents` is an array and stays one - the flattening lives HERE, in the view
 * model, and never in the service, because collaboration (V5) makes side branches real and a data
 * layer that had assumed a chain would have to be rebuilt rather than extended (plan §5.6).
 *
 * Starts at the newest entry and follows `parents[0]`. Revisions reachable only through a second
 * parent are dropped: they belong to the branch that was merged IN, and showing them inline would
 * interleave two timelines into one list with no way to tell which row came from where. The merge
 * revision itself carries {@link FlatHistoryEntry.merge}, which is the marker that says so.
 *
 * Stops when the next first parent is not in `entries` - a page read with `limit` ends mid-history,
 * and walking off the end is the ordinary case rather than an error.
 */
export function flattenFirstParent(entries: readonly VcsHistoryEntry[]): FlatHistoryEntry[] {
    if (entries.length === 0) {
        return [];
    }
    const byRevision = new Map(entries.map(entry => [entry.revision, entry]));
    // The newest entry: `getHistory` answers newest-first, but the walk asks for the highest revision
    // number rather than trusting position, so a caller that sorted differently still gets a tip.
    let cursor: VcsHistoryEntry | undefined = entries.reduce(
        (best, entry) => (entry.number > best.number ? entry : best),
        entries[0],
    );
    const out: FlatHistoryEntry[] = [];
    const seen = new Set<RevisionId>();
    while (cursor && !seen.has(cursor.revision)) {
        seen.add(cursor.revision);
        out.push({
            revision: cursor.revision,
            number: cursor.number,
            kind: cursor.kind,
            // Spread rather than four assignments, for the reason `VcsManager.getHistory` spreads:
            // a key the revision does not carry has to stay ABSENT. Assigning `message: undefined`
            // makes the key present, and a present-but-undefined author renders as a blank line
            // where the honest answer is nothing at all.
            ...pickMetadata(cursor),
            merge: cursor.parents.length > 1,
        });
        const parent: RevisionId | undefined = cursor.parents[0];
        cursor = parent ? byRevision.get(parent) : undefined;
    }
    return out;
}

/**
 * What a revision says about itself: its message, when it was made, and who made it.
 *
 * All three optional, and that is not defensiveness - the repository's first commit is written by
 * `initRepository` and carries none of them, and another client may write any subset. A missing key
 * has to render as ABSENT rather than as an empty line.
 */
export type RevisionMetadata = Pick<FlatHistoryEntry, "message" | "timestamp" | "author">;

function pickMetadata(entry: VcsHistoryEntry): RevisionMetadata {
    const out: RevisionMetadata = {};
    if (entry.message !== undefined) out.message = entry.message;
    if (entry.timestamp !== undefined) out.timestamp = entry.timestamp;
    if (entry.author !== undefined) out.author = entry.author;
    return out;
}

/**
 * The revision the surfaces are focused on: the one being previewed, else the head.
 *
 * The two states that have no revision at all - a repository with nothing in it, a project with no
 * repository - answer null, which is what stops the focused block from looking one up.
 */
export function focusedRevision(state: VersionSurfaceState): RevisionId | null {
    if (state.kind === "revision") {
        return state.revision;
    }
    if (state.kind === "current") {
        return state.head;
    }
    return null;
}

/**
 * That revision's row in a history page.
 *
 * Null when the page does not reach it, which is ordinary rather than exceptional: the page is
 * bounded (`VERSION_HISTORY_PAGE`) and nothing has been read at all until the panel is opened. The
 * caller renders the identity it already has and leaves the metadata out - the alternative would be
 * a per-revision backend call from a render.
 */
export function findRevisionRow(
    rows: readonly FlatHistoryEntry[] | null,
    revision: RevisionId | null,
): FlatHistoryEntry | null {
    if (!rows || !revision) {
        return null;
    }
    return rows.find(row => row.revision === revision) ?? null;
}

/**
 * Whether a revision is one Studio recorded on its own initiative.
 *
 * **Absent is not a checkpoint.** The repository's first commit is written by `initRepository`, which
 * predates kinds, and anything committed by the author's own `lore` CLI records none either - so
 * "no kind" has to mean "show it", never "default to one of the two" (`VCS_REVISION_KIND_KEY`).
 * Getting this backwards hides the author's oldest revision, which is the one they would look for
 * first when something went wrong.
 */
export function isCheckpoint(entry: Pick<FlatHistoryEntry, "kind">): boolean {
    return entry.kind === "checkpoint";
}

export interface CollapseCheckpointsOptions {
    /** Default false: a checkpoint is not a commit, and an interval timer makes many of them. */
    showCheckpoints?: boolean;
    /**
     * Revisions that stay in the list whatever their kind - the one on screen, above all.
     *
     * Without it, an author viewing a checkpoint who collapses the list watches the row they are
     * standing on disappear, leaving a rail that says they are nowhere.
     */
    keep?: ReadonlySet<RevisionId>;
}

/**
 * The rows the rail lists: the linear history with checkpoints folded away unless asked for.
 *
 * Collapsed by default because the two kinds answer different questions. A commit is a thing the
 * author decided to record; a checkpoint is the 15-minute timer catching their work, and on a
 * writing day there are dozens. A list where those are interleaved is a list nobody reads.
 */
export function collapseCheckpoints(
    entries: readonly FlatHistoryEntry[],
    options: CollapseCheckpointsOptions = {},
): FlatHistoryEntry[] {
    if (options.showCheckpoints) {
        return [...entries];
    }
    return entries.filter(entry => !isCheckpoint(entry) || options.keep?.has(entry.revision));
}

/** How many rows the collapse is hiding, for the "show N checkpoints" affordance. */
export function hiddenCheckpointCount(
    entries: readonly FlatHistoryEntry[],
    options: CollapseCheckpointsOptions = {},
): number {
    return entries.length - collapseCheckpoints(entries, options).length;
}

/** One read of the history, described by what it asked for and what came back. */
export interface HistoryPageRead {
    /**
     * How many revisions the read asked the service for. 0 means "all of them"
     * (`VersionControlService.getHistory`), which is by definition the whole history.
     */
    limit: number;
    /**
     * How many entries came back - the RAW graph entries, counted before
     * {@link flattenFirstParent} and {@link collapseCheckpoints} have touched them.
     */
    received: number;
}

/**
 * Whether reading further back could find anything, and therefore whether the rail offers to.
 *
 * The judgement is "did this read fill its limit", and it has to be made on the RAW entry count
 * rather than on the rows the author can see. Both steps between the two throw entries away:
 * {@link flattenFirstParent} drops every revision reachable only through a second parent, and
 * {@link collapseCheckpoints} hides the checkpoints - so a project whose history is mostly the
 * 15-minute timer's work reads a full page of fifty and draws three rows. Counting rows would tell
 * that author they had reached the beginning of their project with hundreds of revisions unread.
 *
 * `>=` rather than `===` because a limit is a ceiling, not a promise: nothing in the backend's
 * contract stops a graph read from answering with more than was asked for, and being wrong in that
 * direction would hide the affordance outright.
 *
 * A false positive is possible - a history that is exactly a whole number of pages long offers one
 * more read that finds nothing - and it is the right way round. The next press answers a short page,
 * the offer goes away, and nothing was lost but one read; the opposite mistake is unreachable
 * history with no way to say so.
 */
export function hasMoreHistory(read: HistoryPageRead): boolean {
    if (read.limit <= 0) {
        return false;
    }
    return read.received >= read.limit;
}

/**
 * The limit the next page asks for.
 *
 * Paging here is "read again with a bigger limit" rather than a cursor, because the backend has no
 * cursor to offer - `readRevisionGraph(globals, limit)` is the whole of its history surface. The
 * cost of re-reading what is already in hand is paid off in the main process, where revision
 * metadata is cached per session (`VcsManager`); without that, the fifth page would cost 250
 * per-revision calls to gain fifty rows.
 *
 * Grown from the limit that was REQUESTED and not from what came back, so a read that answered
 * short - which is every read at the end of a history - cannot shrink the window on the next press.
 */
export function nextHistoryLimit(limit: number, step: number): number {
    return Math.max(limit, 0) + step;
}

/**
 * How many changed files the rail draws, at most.
 *
 * There has to be a bound: a first commit, a bulk asset import or a restore can put thousands of
 * entries in one scan, and a 320px column has no business rendering thousands of rows into the same
 * scroll container the commit form and the history live in.
 *
 * 50 rather than a rounder number, because it is `VERSION_HISTORY_PAGE`: the panel's two lists
 * are bounded alike so neither can bury the other, and 50 rows is already more than a panel-height of
 * scrolling. Past that, the per-file list has stopped being how anyone understands the change - the
 * count above it is - and reading the rest is what the diff milestone is for.
 *
 * What is NOT allowed is cutting silently; {@link ChangeListView.hidden} exists so the list can say
 * how many it left out. A list that showed the first 50 of 3000 with no remark would be read as "that
 * is all of it", and the author would commit believing they had seen what they were recording.
 */
export const VERSION_CHANGE_LIST_LIMIT = 50;

/** A changed path, cut where the rail cuts it. */
export interface ChangePathParts {
    /**
     * Everything above the file, with no trailing separator - `null` for a file at the repository
     * root, which is a real case (`nl.config.json`) and not a degenerate one.
     */
    directory: string | null;
    /** The last segment. Empty only for an empty or separator-only input. */
    name: string;
}

/**
 * Split a changed path into the part that identifies the file and the part that merely locates it.
 *
 * The rail renders these differently and truncates only the directory, because in this project the
 * distinguishing end of a path is its TAIL: `editor/story/chapter-01.json` and
 * `editor/story/chapter-02.json` share everything a head-first ellipsis would keep.
 *
 * Both separators are accepted. `repositoryStatus` answers repository-relative paths (docs §4.16) and
 * the backend is not uniform about which slash Windows produces - §4.20 records it handing back
 * forward slashes where `path.join` would have produced backslashes - so treating either as the
 * separator is cheaper than being wrong about one of them in the one place a path is read by eye.
 */
export function splitChangePath(path: string): ChangePathParts {
    const normalized = path.replace(/[\\/]+/g, "/").replace(/\/+$/, "");
    const cut = normalized.lastIndexOf("/");
    if (cut < 0) {
        return { directory: null, name: normalized };
    }
    return { directory: normalized.slice(0, cut), name: normalized.slice(cut + 1) };
}

/**
 * The order the rail lists changes in.
 *
 * Unresolved conflicts first, and they are the only kind singled out: `conflictUnresolved` is the one
 * flag that BLOCKS a commit (`VcsFileChange`), so it is the only row whose position is functional
 * rather than aesthetic. Anything else at the top of a capped list would be a preference; a conflict
 * scrolled out of sight is a Commit button that refuses with no visible cause.
 *
 * Everything else by path, ascending, because an author recognises their own project as a tree - one
 * chapter's files land together, and a folder they did not expect to have touched is visible as a
 * block. Grouping by KIND instead would scatter that folder across five groups to communicate
 * something each row already carries in its own marker.
 *
 * Compared with `<` on the lower-cased path rather than with `localeCompare`, so the order is a
 * property of the repository and not of the app's language: switching Studio to Chinese must not
 * reshuffle the list. The raw path breaks ties, which makes the order total - two paths differing
 * only in case would otherwise come out in whatever order the scan happened to produce.
 */
export function sortFileChanges(files: readonly VcsFileChange[]): VcsFileChange[] {
    return [...files].sort((a, b) => {
        if (a.conflictUnresolved !== b.conflictUnresolved) {
            return a.conflictUnresolved ? -1 : 1;
        }
        const left = a.path.toLowerCase();
        const right = b.path.toLowerCase();
        if (left !== right) {
            return left < right ? -1 : 1;
        }
        if (a.path !== b.path) {
            return a.path < b.path ? -1 : 1;
        }
        return 0;
    });
}

export interface ChangeListView {
    /** The rows to draw: sorted, directories dropped, capped. */
    rows: VcsFileChange[];
    /** Sorted rows the cap left out. Zero when the list is complete; never hidden from the author. */
    hidden: number;
    /**
     * Files in the scan, directories excluded - the one number this surface shows.
     *
     * Deliberately NOT `VcsStatus.counts`. Those are the backend's own totals and they COUNT
     * DIRECTORIES (one new folder with one file in it is two), so the two disagree on purpose
     * (`VersionControlService.getChangedFiles`). Showing both would make the panel argue with itself
     * about a project's size, so it shows this one and nothing re-derives the other.
     */
    total: number;
}

/**
 * The change list the rail draws, out of one scan's file list.
 *
 * Directories are dropped here rather than by the caller because the cap has to be applied to the
 * rows an author actually sees: leaving them in would let a deep new folder spend the whole budget on
 * entries that name nothing the author wrote (`VcsFileChange.directory`).
 *
 * Sorting happens BEFORE the cap, which is the whole reason the two live in one function. Capping a
 * scan-ordered list and sorting the survivors would be a list that can hide the conflict that is
 * blocking the commit.
 */
export function buildChangeList(
    files: readonly VcsFileChange[],
    limit: number = VERSION_CHANGE_LIST_LIMIT,
): ChangeListView {
    const sorted = sortFileChanges(files.filter(file => !file.directory));
    const rows = sorted.slice(0, Math.max(0, limit));
    return { rows, hidden: sorted.length - rows.length, total: sorted.length };
}

/**
 * A revision id short enough to read. Hex at the transport layer, so the head is enough to tell two
 * apart by eye; the number is what the UI leads with, because `#4` means something to a person and
 * `a91f3c8` does not.
 */
export function shortRevision(revision: RevisionId, length = 7): string {
    return revision.slice(0, length);
}

/** How the rail and every other surface names one revision: `#4`. */
export function revisionLabel(number: number): string {
    return `#${number}`;
}

/**
 * What separates the branch from the version number. A middle dot rather than a slash, because a
 * slash is part of branch names (`feature/audio`) and would read as one more path segment.
 */
const BRANCH_SEPARATOR = " · ";

/** Shown while the first probe is out. One round trip long; a word would flash on every open. */
const PROBING_FACE = "—";

/**
 * How much of a branch name a surface will show before cutting it.
 *
 * There has to be a ceiling, and it has to be applied HERE rather than by CSS. The status-bar cell
 * truncates from the end, so letting a 60-character branch name run into a `truncate` class would
 * cut off `#12` - the one part of the line that says which version this is - and leave the author
 * reading a branch name with no version at all.
 */
export const VERSION_BRANCH_MAX_CHARS = 14;

export interface VersionFaceInputs {
    /** Which of the six surface states this window is in. */
    state: VersionSurfaceState;
    /**
     * The branch the repository is on, from `VcsRepositoryInfo.branch`.
     *
     * Shown only when it is NOT {@link VCS_DEFAULT_BRANCH}. An author who never left it would
     * otherwise pay width on every surface for a fact that is always true, while an author who
     * branched with their own `lore` CLI is exactly the person a bare `#12` misleads.
     */
    branch?: string | null;
    /**
     * The focused history row's number, for the states that carry no number of their own - the beat
     * between opening the panel and the page arriving, and a preview entered without a label.
     */
    rowNumber?: number | null;
    /**
     * What names the version when no NUMBER is known.
     *
     * `hash` for the two narrow surfaces: the short hash is all they have, and something that
     * identifies the revision beats nothing. `omit` for the rail, which prints the hash on its own
     * line right beside this one and would otherwise print it twice.
     */
    unnumbered?: "hash" | "omit";
}

export interface VersionFace {
    /** What to render. Empty only under `unnumbered: "omit"`, where the caller draws nothing. */
    text: string;
    /**
     * The same line with nothing cut, for the `title`. Equal to {@link text} when nothing was cut,
     * which is how a caller decides whether a tooltip is owed at all.
     */
    full: string;
}

/**
 * The one line every version surface shows: the status-bar cell, the top-bar widget, and the rail's
 * focused block.
 *
 * One function for all three because they answer the same question, and three copies of the answer
 * drift - which has already happened once in this feature's life (a commit left the rail on `#3`
 * beside a cell still reading `#2`). The branch is the reason it exists now: a rule spelled out in
 * three components is a rule that will be spelled out three ways.
 *
 * Takes the translator rather than handing back keys, because two of the six states are prose and
 * the other four are composed strings; a caller that had to switch on which kind it got back would
 * be re-implementing the decision this function exists to own. Tests pass an identity `t`.
 */
export function versionFace(inputs: VersionFaceInputs, t: Translator["t"]): VersionFace {
    const identity = versionIdentity(inputs, t);
    const branch = shownBranch(inputs);
    if (!branch || !identity) {
        return { text: identity, full: identity };
    }
    const cut = branch.length > VERSION_BRANCH_MAX_CHARS
        ? `${branch.slice(0, VERSION_BRANCH_MAX_CHARS - 1)}…`
        : branch;
    return {
        text: `${cut}${BRANCH_SEPARATOR}${identity}`,
        full: `${branch}${BRANCH_SEPARATOR}${identity}`,
    };
}

/**
 * The branch worth naming, or null.
 *
 * Null for the default branch AND for the empty string the backend reports when it did not say -
 * neither tells the author anything they can act on. Null too in every state that does not name a
 * version: "No versions yet" is about the repository, and prefixing a branch onto it would suggest
 * the emptiness were somehow local to that branch.
 */
function shownBranch(inputs: VersionFaceInputs): string | null {
    if (inputs.state.kind !== "current" && inputs.state.kind !== "revision") {
        return null;
    }
    const branch = inputs.branch?.trim();
    if (!branch || branch === VCS_DEFAULT_BRANCH) {
        return null;
    }
    return branch;
}

/** What names this version on its own, before the branch is considered. */
function versionIdentity(inputs: VersionFaceInputs, t: Translator["t"]): string {
    const { state } = inputs;
    const fromRow = inputs.rowNumber !== undefined && inputs.rowNumber !== null
        ? revisionLabel(inputs.rowNumber)
        : null;
    switch (state.kind) {
        case "revision":
            return state.label ?? fromRow ?? unnumbered(state.revision, inputs);
        case "current":
            return (state.number !== null ? revisionLabel(state.number) : null)
                ?? fromRow
                ?? unnumbered(state.head, inputs);
        case "not-a-repository":
            return t("workspace.shell.versionControl.notVersioned");
        case "empty":
            return t("workspace.shell.versionControl.noHistory");
        default:
            // Probing, and the unreachable `unavailable` - every surface renders nothing there.
            return PROBING_FACE;
    }
}

function unnumbered(revision: RevisionId, inputs: VersionFaceInputs): string {
    return inputs.unnumbered === "omit" ? "" : shortRevision(revision);
}
