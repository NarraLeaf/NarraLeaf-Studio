import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Services } from "@/lib/workspace/services/services";
import { VersionControlService } from "@/lib/workspace/services/core/VersionControlService";
import { WorkspaceFreezeService } from "@/lib/workspace/services/core/WorkspaceFreezeService";
import type { RevisionId, VcsAvailability, VcsStatus } from "@shared/types/vcs";
import type { WorkspaceFreezeReason } from "@/lib/app/writeFreeze";
import {
    collapseCheckpoints,
    findRevisionRow,
    flattenFirstParent,
    focusedRevision,
    hasMoreHistory,
    hiddenCheckpointCount,
    nextHistoryLimit,
    resolveVersionSurfaceState,
    revisionLabel,
    type FlatHistoryEntry,
    type HistoryPageRead,
    type VersionSurfaceState,
} from "../components/layout/versionRailModel";
import { useWorkspace } from "../context";

/**
 * The one data surface behind the version rail, the top-bar widget and the status-bar cell.
 *
 * Shared rather than three readers, because all three answer the same question ("which version is
 * this?") and three independent probes would each dlopen the backend, each cache their own answer, and
 * eventually disagree with each other on screen.
 *
 * **Nothing here is on a timer, and the one call that scans is only reachable through
 * {@link VersionSurface.refreshChanges}.** A status scan is not a pure read - discovering a new
 * directory records it into the repository's staged state, so a poll would report deletions the author
 * never made (docs/version-control.md §4.17, and the class comment on `VersionControlService`). The
 * identity reads below (`getAvailability`, `isRepository`, `getInfo`) do not scan, which is why the
 * widget shows a version and never a change count.
 */

/** What a long operation currently in flight is, for the label beside the spinner. */
export type VersionBusyKind =
    /** Reading history. The first read on a project with a remote goes to the network (docs §6). */
    | "history"
    /** Loading a revision into the editors, which re-reads every document. */
    | "revision"
    /** Creating the repository. Writes `.lore/` and stages the whole project. */
    | "init"
    /**
     * Recording a revision. Never instant: the pipeline settles this window's save debt, stages the
     * whole project and then waits out the backend's store keep-alive window (~1s, docs §4.22).
     */
    | "commit"
    /** Coming back to the working tree, which re-reads every document. */
    | "return";

/**
 * How much further back each read of the history reaches.
 *
 * A STEP rather than a page size, because there are no pages: the backend has no cursor verb, so
 * {@link VersionSurface.loadMoreHistory} re-reads the whole history with a larger limit
 * (`nextHistoryLimit`). The first read asks for this many; the second asks for twice it.
 */
export const VERSION_HISTORY_PAGE = 50;

export interface VersionSurface {
    /** Which of the six states every surface renders. */
    state: VersionSurfaceState;
    /**
     * The branch the repository is on, or null when there is none to report.
     *
     * Feed it to `versionFace`, which is what decides whether it is worth showing - on the default
     * branch it is not, and no surface may make that judgement for itself.
     */
    branch: string | null;
    /**
     * Why project data is frozen, or null when it is writable.
     *
     * Separate from {@link state} because the two answer different questions and one of them is not
     * derivable from the other: a MANUAL freeze (the palette command) leaves the state on `current`,
     * yet it is exactly as much a temporary state the author has to be able to leave as a revision
     * preview is. This is what decides whether the rail is a persistent strip
     * (`resolveVersionRailPresence`) and what its escape hatch is called.
     */
    frozen: WorkspaceFreezeReason["kind"] | null;
    /** A long operation is running; show progress rather than pretending it was instant. */
    busy: VersionBusyKind | null;
    /** The last operation's failure, already stringified for display. Cleared by the next attempt. */
    error: string | null;
    /**
     * The linear history, checkpoints collapsed - null until {@link loadHistory} has been asked for
     * one. Null and empty are different answers: null is "nobody has read it", `[]` is "there is
     * nothing".
     */
    history: FlatHistoryEntry[] | null;
    /**
     * The row for the revision on screen - the previewed one, else the head - out of the page that
     * has been read, and the only place the message / time / author come from.
     *
     * Null until {@link loadHistory} has answered, and null for a revision beyond the page: both are
     * "not read", and the alternative would be a per-revision backend call from a render. The
     * identity (number, short hash) does not come from here, so the block still names its revision.
     */
    focused: FlatHistoryEntry | null;
    /** Rows the collapse is hiding, so the list can offer to show them. */
    hiddenCheckpoints: number;
    /**
     * The last read filled its limit, so reading further back may find more.
     *
     * Answered from the RAW entry count rather than from {@link history}'s length - see
     * `hasMoreHistory` for why the two are nowhere near each other on a project full of
     * checkpoints. False until something has been read.
     */
    canLoadMoreHistory: boolean;
    showCheckpoints: boolean;
    setShowCheckpoints: (show: boolean) => void;
    /** The last scan's snapshot. Null until {@link refreshChanges} - never scanned on our own. */
    status: VcsStatus | null;
    /** Read the history. Cheap to call again: `VersionControlService` caches revisions. */
    loadHistory: () => void;
    /**
     * Reach further back, by {@link VERSION_HISTORY_PAGE} revisions.
     *
     * Only ever because the author pressed something. Nothing here reaches the end of a list, or a
     * scroll position, or a timer - the rail loads what was asked for and stops, which is the same
     * rule every other read on this surface follows.
     */
    loadMoreHistory: () => void;
    /** The ONLY scan. An explicit act: opening the rail, or a refresh the author asked for. */
    refreshChanges: () => void;
    /**
     * Record the working tree as a new revision, then re-read everything the new revision made
     * wrong. Slow; sets `busy`.
     *
     * Answers whether it happened, because the caller owns the message box and a draft may only be
     * discarded once it is recorded somewhere - a failed commit that cleared the author's words
     * would lose the only copy of them. Failures are reported through {@link error} as well.
     */
    commit: (message: string) => Promise<boolean>;
    /** Show a past revision in the real editors, freezing project data. Slow; sets `busy`. */
    showRevision: (revision: RevisionId, label?: string) => void;
    /** The escape hatch. A no-op when the workspace was not frozen, so any control may call it. */
    returnToCurrent: () => void;
    /** Put this project under version control. The author's explicit act, never ours. */
    enableVersionControl: () => void;
}

export function useVersionSurface(): VersionSurface {
    const { context } = useWorkspace();
    const [availability, setAvailability] = useState<VcsAvailability | null>(null);
    const [isRepository, setIsRepository] = useState<boolean | null>(null);
    const [head, setHead] = useState<RevisionId | null>(null);
    const [headNumber, setHeadNumber] = useState<number | null>(null);
    const [branch, setBranch] = useState<string | null>(null);
    const [shown, setShown] = useState<{ revision: RevisionId; label?: string } | null>(null);
    const [frozen, setFrozen] = useState<WorkspaceFreezeReason["kind"] | null>(null);
    const [rawHistory, setRawHistory] = useState<FlatHistoryEntry[] | null>(null);
    // What the last read asked for and what it got back, kept together because neither half answers
    // "is there more" alone. `received` is the RAW entry count: `rawHistory` has already lost it to
    // the first-parent walk, and the rendered list loses more of it to the checkpoint collapse.
    const [page, setPage] = useState<HistoryPageRead>({ limit: VERSION_HISTORY_PAGE, received: 0 });
    const [showCheckpoints, setShowCheckpoints] = useState(false);
    const [status, setStatus] = useState<VcsStatus | null>(null);
    const [busy, setBusy] = useState<VersionBusyKind | null>(null);
    const [error, setError] = useState<string | null>(null);
    // Guards every setState behind an await: a project switch unmounts this while reads are still in
    // flight, and the slowest of them (a revision load over the network) can land long afterwards.
    const alive = useRef(true);
    useEffect(() => {
        alive.current = true;
        return () => {
            alive.current = false;
        };
    }, []);

    const services = useMemo(() => {
        if (!context) {
            return null;
        }
        return {
            versionControl: context.services.get<VersionControlService>(Services.VersionControl),
            freeze: context.services.get<WorkspaceFreezeService>(Services.WorkspaceFreeze),
        };
    }, [context]);

    /**
     * The identity reads, in the order the answers gate each other: availability first (it is the
     * supported way to find out, and every call below fails without it), then whether this directory
     * is a repository, then the head. None of them scans.
     */
    const readIdentity = useCallback(async () => {
        if (!services) {
            return;
        }
        const answer = await services.versionControl.getAvailability();
        if (!alive.current) return;
        setAvailability(answer);
        if (!answer.available) {
            return;
        }
        const repository = await services.versionControl.isRepository();
        if (!alive.current) return;
        setIsRepository(repository);
        if (!repository) {
            setHead(null);
            setHeadNumber(null);
            setBranch(null);
            return;
        }
        // The whole identity in one pure read: the revision, the number `#4` is made of, and the
        // branch. A one-entry history read answered the first two just as cheaply and cannot answer
        // the third at all - the revision graph does not carry a branch name.
        const info = await services.versionControl.getInfo();
        if (!alive.current) return;
        setHead(info?.head ?? null);
        // Zero is the backend's "no revisions", which is the same thing an absent head says.
        setHeadNumber(info?.head && info.headNumber > 0 ? info.headNumber : null);
        setBranch(info?.branch.trim() || null);
    }, [services]);

    useEffect(() => {
        if (!services) {
            setAvailability(null);
            setIsRepository(null);
            return;
        }
        // A stale project's answers must not survive into the next one: this hook is remounted per
        // window, but a project switch reuses the workspace context object. The limit is reset with
        // them - carrying one project's paging into the next would open the panel on a read the
        // author never asked for, at whatever depth they had reached somewhere else.
        setRawHistory(null);
        setPage({ limit: VERSION_HISTORY_PAGE, received: 0 });
        setStatus(null);
        void readIdentity();
    }, [services, readIdentity]);

    // The shown revision comes from the freeze latch rather than from our own bookkeeping, because the
    // command palette can enter and leave a revision view too - and a rail that only knew about its
    // own clicks would show the working tree while the editors showed 1.4. The reason's KIND is read
    // alongside it, because a manual freeze has no revision and still has to raise the strip.
    useEffect(() => {
        if (!services) {
            setShown(null);
            setFrozen(null);
            return;
        }
        const read = () => {
            const reason = services.freeze.getReason();
            setShown(reason?.kind === "revision" ? { revision: reason.revision, label: reason.label } : null);
            setFrozen(reason?.kind ?? null);
        };
        read();
        return services.freeze.onChanged(read);
    }, [services]);

    useEffect(() => {
        if (!services) {
            return;
        }
        return services.versionControl.onStatusChanged(setStatus);
    }, [services]);

    // A revision recorded ANYWHERE moves the head, and there is more than one of this hook alive:
    // the rail and the top-bar widget share one, the status-bar cell makes its own. Without this,
    // committing from the rail leaves the cell naming the version before it - measured on a real
    // app, rail `#3` beside cell `#2` - and an automatic checkpoint leaves every surface stale with
    // nobody having pressed anything to notice.
    //
    // Not a poll: it fires once per revision, which is a discrete act, and the re-read below does
    // not scan.
    useEffect(() => {
        if (!services) {
            return;
        }
        return services.versionControl.onRevisionRecorded(() => {
            void readIdentity();
        });
    }, [services, readIdentity]);

    /**
     * The read itself, without the spinner around it, so a commit can re-read the history
     * inside its OWN busy state - `busy` names one operation, and a nested read that cleared it
     * would take the spinner down while the commit was still running.
     *
     * The limit is an argument rather than read from state, because paging has to read at the NEW
     * limit in the same tick it decides to grow: a callback that closed over the state would ask
     * for the depth it already had.
     */
    const readHistory = useCallback(async (limit: number) => {
        if (!services) {
            return;
        }
        try {
            // Details are what makes collapsing possible (the kind) and what the focused block
            // shows (message / time / author), and they cost one backend call PER revision -
            // there is no batch verb - which is why the read is bounded rather than asking for
            // all of them. Re-reading at a larger limit does not re-pay for the revisions already
            // read: the main process caches metadata per revision, which is immutable.
            const entries = await services.versionControl.getHistory(limit, { includeDetails: true });
            if (!alive.current) return;
            setRawHistory(flattenFirstParent(entries));
            setPage({ limit, received: entries.length });
        } catch (thrown) {
            if (!alive.current) return;
            setError(messageOf(thrown));
        }
    }, [services]);

    const loadHistory = useCallback(() => {
        if (!services) {
            return;
        }
        setBusy("history");
        setError(null);
        // At whatever depth the author has already paged to, so reopening the panel shows them the
        // history they had rather than snapping back to the first fifty. The service caches by
        // limit, so this second read of the same depth costs nothing.
        void readHistory(page.limit).finally(() => {
            if (alive.current) setBusy(null);
        });
    }, [services, readHistory, page.limit]);

    const loadMoreHistory = useCallback(() => {
        // Refused rather than queued while anything is running: this re-reads the whole history, so
        // a second one started on top of the first would be two overlapping reads of the same
        // revisions, and the later to answer would win regardless of which asked for more.
        if (!services || busy !== null) {
            return;
        }
        setBusy("history");
        setError(null);
        void readHistory(nextHistoryLimit(page.limit, VERSION_HISTORY_PAGE)).finally(() => {
            if (alive.current) setBusy(null);
        });
    }, [services, busy, readHistory, page.limit]);

    const refreshChanges = useCallback(() => {
        if (!services) {
            return;
        }
        void services.versionControl.refreshStatus().catch(thrown => {
            if (alive.current) setError(messageOf(thrown));
        });
    }, [services]);

    const commit = useCallback(async (message: string): Promise<boolean> => {
        if (!services) {
            return false;
        }
        setBusy("commit");
        setError(null);
        try {
            try {
                await services.versionControl.commit({ message });
            } catch (thrown) {
                if (alive.current) setError(messageOf(thrown));
                return false;
            }
            if (!alive.current) return true;
            // Past that line the revision EXISTS, which is why the re-reads below have a catch of
            // their own: reporting one of them as a failed commit would send the author to write
            // their message again, and the backend would answer that nothing has changed.
            try {
                // A commit invalidates all three of this hook's answers and none of them refreshes
                // itself. The identity first: HEAD has moved, and the rail, the top-bar widget and
                // the status cell all read it from here - without this they would keep naming `#12`
                // while the repository is on `#13`. Then the page, which the service dropped from
                // its cache but which is still in `rawHistory` one entry short of the truth.
                await readIdentity();
                if (!alive.current) return true;
                await readHistory(page.limit);
                if (!alive.current) return true;
                // And the scan, which is allowed here for the one reason the service's class comment
                // gives: it follows an operation this surface itself performed. It is also the
                // confirmation the author is owed - that the commit really did take everything.
                refreshChanges();
            } catch (thrown) {
                if (alive.current) setError(messageOf(thrown));
            }
            return true;
        } finally {
            if (alive.current) setBusy(null);
        }
    }, [services, readIdentity, readHistory, refreshChanges, page.limit]);

    const showRevision = useCallback((revision: RevisionId, label?: string) => {
        if (!services) {
            return;
        }
        setBusy("revision");
        setError(null);
        void (async () => {
            try {
                await services.versionControl.showRevision(revision, label);
            } catch (thrown) {
                if (!alive.current) return;
                setError(messageOf(thrown));
            } finally {
                if (alive.current) setBusy(null);
            }
        })();
    }, [services]);

    const returnToCurrent = useCallback(() => {
        if (!services) {
            return;
        }
        setError(null);
        // `showWorkingTree` is synchronous by design (it is called straight from click handlers and a
        // click has nothing to await), but the re-read it starts is not - so the spinner is cleared on
        // the freeze change rather than by awaiting anything.
        setBusy("return");
        services.versionControl.showWorkingTree();
    }, [services]);

    // The freeze going away IS the end of the return; nothing else reports it.
    useEffect(() => {
        if (busy === "return" && shown === null) {
            setBusy(null);
        }
    }, [busy, shown]);

    const enableVersionControl = useCallback(() => {
        if (!services) {
            return;
        }
        setBusy("init");
        setError(null);
        void (async () => {
            try {
                await services.versionControl.initRepository();
                if (!alive.current) return;
                // Everything read before this described a project with no repository.
                setRawHistory(null);
                setPage({ limit: VERSION_HISTORY_PAGE, received: 0 });
                await readIdentity();
            } catch (thrown) {
                if (!alive.current) return;
                setError(messageOf(thrown));
            } finally {
                if (alive.current) setBusy(null);
            }
        })();
    }, [services, readIdentity]);

    const state = useMemo(
        () => resolveVersionSurfaceState({
            availability,
            isRepository,
            head,
            headNumber,
            shownRevision: shown?.revision ?? null,
            shownLabel: shown?.label,
        }),
        [availability, isRepository, head, headNumber, shown],
    );

    // The row the author is standing on is kept whatever its kind: collapsing checkpoints while
    // viewing one must not make the focused row disappear out of the list.
    const keep = useMemo(
        () => new Set(shown ? [shown.revision] : []),
        [shown],
    );
    const history = useMemo(
        () => (rawHistory ? collapseCheckpoints(rawHistory, { showCheckpoints, keep }) : null),
        [rawHistory, showCheckpoints, keep],
    );
    const hiddenCheckpoints = useMemo(
        () => (rawHistory ? hiddenCheckpointCount(rawHistory, { showCheckpoints, keep }) : 0),
        [rawHistory, showCheckpoints, keep],
    );
    // Looked up in the UNCOLLAPSED page: an author previewing a checkpoint with checkpoints hidden
    // would otherwise have their own revision's metadata filtered out from under them.
    const focused = useMemo(
        () => findRevisionRow(rawHistory, focusedRevision(state)),
        [rawHistory, state],
    );
    // `rawHistory` gates it only to keep the offer from appearing before anything has been read;
    // what decides is the raw count, never the row count (`hasMoreHistory`).
    const canLoadMoreHistory = rawHistory !== null && hasMoreHistory(page);

    return {
        state,
        branch,
        frozen,
        busy,
        error,
        history,
        focused,
        hiddenCheckpoints,
        canLoadMoreHistory,
        showCheckpoints,
        setShowCheckpoints,
        status,
        loadHistory,
        loadMoreHistory,
        refreshChanges,
        commit,
        showRevision,
        returnToCurrent,
        enableVersionControl,
    };
}

/** The name a surface shows for one revision, with the label the freeze recorded preferred. */
export function describeShownVersion(state: VersionSurfaceState): string | null {
    if (state.kind === "revision") {
        return state.label ?? null;
    }
    if (state.kind === "current" && state.number !== null) {
        return revisionLabel(state.number);
    }
    return null;
}

function messageOf(thrown: unknown): string {
    return thrown instanceof Error ? thrown.message : String(thrown);
}
