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
    hiddenCheckpointCount,
    resolveVersionSurfaceState,
    revisionLabel,
    type FlatHistoryEntry,
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
 * identity reads below (`getAvailability`, `isRepository`, `getHistory`) do not scan, which is why the
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
    /** Coming back to the working tree, which re-reads every document. */
    | "return";

/** How many revisions the rail reads at once. Paging is the next pass; see {@link VersionSurface}. */
export const VERSION_HISTORY_PAGE = 50;

export interface VersionSurface {
    /** Which of the six states every surface renders. */
    state: VersionSurfaceState;
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
    showCheckpoints: boolean;
    setShowCheckpoints: (show: boolean) => void;
    /** The last scan's snapshot. Null until {@link refreshChanges} - never scanned on our own. */
    status: VcsStatus | null;
    /** Read the history page. Cheap to call again: `VersionControlService` caches revisions. */
    loadHistory: () => void;
    /** The ONLY scan. An explicit act: opening the rail, or a refresh the author asked for. */
    refreshChanges: () => void;
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
    const [shown, setShown] = useState<{ revision: RevisionId; label?: string } | null>(null);
    const [frozen, setFrozen] = useState<WorkspaceFreezeReason["kind"] | null>(null);
    const [rawHistory, setRawHistory] = useState<FlatHistoryEntry[] | null>(null);
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
            return;
        }
        // One entry is enough for the identity, and it carries both halves of it - the revision and
        // its number - so the widget does not need `getInfo` as well. `#4` is what a person reads.
        const tip = await services.versionControl.getHistory(1);
        if (!alive.current) return;
        setHead(tip[0]?.revision ?? null);
        setHeadNumber(tip[0]?.number ?? null);
    }, [services]);

    useEffect(() => {
        if (!services) {
            setAvailability(null);
            setIsRepository(null);
            return;
        }
        // A stale project's answers must not survive into the next one: this hook is remounted per
        // window, but a project switch reuses the workspace context object.
        setRawHistory(null);
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

    const loadHistory = useCallback(() => {
        if (!services) {
            return;
        }
        setBusy("history");
        setError(null);
        void (async () => {
            try {
                // Details are what makes collapsing possible (the kind) and what the focused block
                // shows (message / time / author), and they cost one backend call PER revision -
                // there is no batch verb - which is why the page is bounded rather than asking for
                // all of them.
                const entries = await services.versionControl.getHistory(
                    VERSION_HISTORY_PAGE,
                    { includeDetails: true },
                );
                if (!alive.current) return;
                setRawHistory(flattenFirstParent(entries));
            } catch (thrown) {
                if (!alive.current) return;
                setError(messageOf(thrown));
            } finally {
                if (alive.current) setBusy(null);
            }
        })();
    }, [services]);

    const refreshChanges = useCallback(() => {
        if (!services) {
            return;
        }
        void services.versionControl.refreshStatus().catch(thrown => {
            if (alive.current) setError(messageOf(thrown));
        });
    }, [services]);

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

    return {
        state,
        frozen,
        busy,
        error,
        history,
        focused,
        hiddenCheckpoints,
        showCheckpoints,
        setShowCheckpoints,
        status,
        loadHistory,
        refreshChanges,
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
