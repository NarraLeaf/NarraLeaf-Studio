import type { RevisionId, VcsAvailability, VcsHistoryEntry, VcsUnavailableReason } from "@shared/types/vcs";
import type { TranslationKey } from "@shared/i18n";
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
