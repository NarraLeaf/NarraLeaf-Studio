import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { translate } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import { VersionControlService } from "@/lib/workspace/services/core/VersionControlService";
import { WorkspaceFreezeService } from "@/lib/workspace/services/core/WorkspaceFreezeService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { NotificationType } from "@/lib/workspace/services/ui/types";
import { vcsSignInRequired } from "@shared/types/vcs";
import type { RevisionId, VcsAvailability, VcsMergeState, VcsServerSession, VcsSignInOutcome, VcsStatus, VcsSyncState } from "@shared/types/vcs";
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
    shortRevision,
    type FlatHistoryEntry,
    type HistoryPageRead,
    type VersionSurfaceState,
} from "../components/layout/versionRailModel";
import { useWorkspace } from "../context";

/**
 * The one data surface behind the version rail, the switcher menu and the status-bar cell.
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
 * menu shows a version and never a change count.
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
    | "return"
    /**
     * Putting the working tree back to a past version: a checkpoint, a full rewrite of the versioned
     * tree, a second commit, and then the same re-read a return does. The longest thing this surface
     * can start, and the only one that changes the author's files.
     */
    | "restore"
    /**
     * Reading where this branch stands against its server, or writing the server address.
     *
     * The read waits on a network and is measured at up to ~2s against a host that does
     * not answer, which is exactly why it has a spinner of its own rather than happening
     * quietly: two silent seconds reads as a dead button.
     */
    | "remote"
    /** Sending revisions to the server. Nothing local changes, so a failure is harmless. */
    | "push"
    /**
     * Bringing the server's revisions down. Writes the working tree and re-reads every
     * document, so it is in the same class as a restore rather than in the same class as
     * a push.
     */
    | "sync";

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
    /**
     * Put the working tree back to a past version, after asking.
     *
     * The confirmation is not the caller's to skip: this is the only thing on this surface that
     * overwrites the author's files, so the question - and the sentence explaining that a checkpoint
     * is recorded first - lives here rather than in whichever button happens to call it.
     *
     * Answers whether it ran, so a caller can tell "they said no" from "it failed"; failures also
     * arrive through {@link error}. A restore whose files landed but whose new version could not be
     * recorded answers TRUE and says so in a sticky notice: the files did change, and a caller that
     * read it as a failure would invite the author to do the one thing they must not do twice.
     */
    restoreRevision: (revision: RevisionId, label?: string) => Promise<boolean>;
    /** The escape hatch. A no-op when the workspace was not frozen, so any control may call it. */
    returnToCurrent: () => void;
    /** Put this project under version control. The author's explicit act, never ours. */
    enableVersionControl: () => void;

    // -- server ---------------------------------------------------------------

    /**
     * The server this project synchronises with, or null when it has none.
     *
     * Read on open, because reading it is LOCAL - it does not contact anything. That is
     * the whole reason it is a separate value from {@link syncState}: the panel can know
     * a server is configured, and draw the controls for it, without having waited on the
     * network to find out whether it answers.
     */
    remote: string | null;
    /**
     * How this branch stands against that server, or null when nobody has looked.
     *
     * **Null is not "no server" and not "unreachable"** - it is "not asked", and it is the
     * state the panel opens in. Finding out costs up to ~2s against a host that does not
     * answer (measured), so it happens when the author asks and after an operation that
     * changed the answer, never on open and never on a timer.
     */
    syncState: VcsSyncState | null;
    /**
     * The merge this project is in the middle of, or null when it is in none (and null before
     * anyone has looked, which is the same thing to draw).
     *
     * **Read from the repository rather than remembered from the sync that caused it**, because a
     * merge outlives the window: an author who closes Studio on a conflicted sync reopens onto the
     * same unfinished merge, and a surface that only knew about syncs it had watched would offer
     * them no way in at all.
     *
     * `conflicts` on it is "the merge left these to a human", NOT "these are still undecided" -
     * settling leaves no readable mark (see `VcsMergeState.conflicts`). Nothing here may present
     * it as progress.
     */
    merge: VcsMergeState | null;
    /** Ask the server where things stand. The only thing here that waits on a network by itself. */
    checkRemote: () => void;
    /**
     * Point the project at a server, or disconnect it with null.
     *
     * Does not contact it - see the service. Answers whether it was written, so the form
     * knows whether to close.
     */
    setRemote: (url: string | null) => Promise<boolean>;
    /**
     * Who this installation is signed in to that server as, or null for nobody.
     *
     * Read on open beside {@link remote}, and for the same reason: it is local. Null on
     * every project pointed at a server that does not ask who is calling, which is what
     * a bare one does - so an empty value here is the ordinary case, not a missing step.
     */
    serverSession: VcsServerSession | null;
    /**
     * How the last sign-in ended, or null when this window has not attempted one.
     *
     * Kept apart from {@link error} because a refusal is not a fault: each reason has a
     * different sentence and a different next act, and the string an error would carry
     * cannot tell four identical-looking transport failures apart.
     */
    signIn: VcsSignInOutcome | null;
    /**
     * Present a token to the server. Answers whether it ended signed in.
     *
     * `authUrl` is empty for the ordinary case: a token names its own endpoint, and a
     * sign-in that answers `address` is the one that asks for it.
     */
    signInToServer: (authUrl: string, token: string) => Promise<boolean>;
    /**
     * Tell this machine to trust a server's certificate authority. Answers whether it
     * took.
     *
     * **The only thing on this surface that changes a setting of the operating system.**
     * The rail offers it where the pasted token vouches for the authority that answered,
     * and behind a dialog naming what is being trusted.
     */
    trustAuthority: (certificatePath: string) => Promise<boolean>;
    /** Take the account back off this machine, stored token and all. */
    signOutOfServer: () => Promise<void>;
    /** Send local revisions up. Answers whether it happened. */
    pushToRemote: () => Promise<boolean>;
    /** Bring the server's revisions down; re-reads every document. Answers whether it happened. */
    syncFromRemote: () => Promise<boolean>;
    /**
     * Whether the last attempt to point this project at a server was refused for want
     * of a token.
     *
     * The rail offers a way to sign in when it is true. Without it there is none: the
     * row that offers one is drawn beside a configured server, and on a server that
     * demands a token there is no way to configure one until after signing in.
     */
    remoteNeedsSignIn: boolean;
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
    const [remote, setRemoteUrl] = useState<string | null>(null);
    const [remoteNeedsSignIn, setRemoteNeedsSignIn] = useState(false);
    const [syncState, setSyncState] = useState<VcsSyncState | null>(null);
    const [serverSession, setServerSession] = useState<VcsServerSession | null>(null);
    const [signIn, setSignIn] = useState<VcsSignInOutcome | null>(null);
    const [merge, setMerge] = useState<VcsMergeState | null>(null);
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
            ui: context.services.get<UIService>(Services.UI),
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
            setRemoteUrl(null);
            setServerSession(null);
            setMerge(null);
            return;
        }
        // Asked on every identity read - which is project open, and after any revision - because a
        // merge is repository state that outlives the window, and the alternative is an author who
        // reopened Studio mid-merge with nothing on screen offering them a way to finish it. Local
        // and non-scanning; the walk it does is the same one a restore pays for.
        const mergeState = await services.versionControl.getMergeState();
        if (!alive.current) return;
        setMerge(mergeState);
        // LOCAL, and that is the only reason it belongs in this function: it reads the
        // repository's own config and opens no socket. Whether that server answers is
        // `checkRemote`, which costs seconds and is never called from here.
        const configured = await services.versionControl.getRemote();
        if (!alive.current) return;
        setRemoteUrl(configured);
        // Local for the same reason and asked in the same breath: it is what decides whose
        // name goes on the next revision, and the settings panel says so.
        const signedIn = await services.versionControl.getServerSession();
        if (!alive.current) return;
        setServerSession(signedIn);
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
        // Cleared here rather than left to the read below: a host with no version control at all
        // returns from `readIdentity` before it reaches the merge, and the previous project's
        // unfinished merge would then be offered over this one.
        setMerge(null);
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
    // the rail and the switcher menu share one, the status-bar cell makes its own. Without this,
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

    // Abandoning a merge records NO revision, so the event above never fires for it - and the way
    // into resolving would sit in the rail pointing at a merge that is over. Completing one fires
    // both, and re-reading twice is a local read.
    useEffect(() => {
        if (!services) {
            return;
        }
        return services.versionControl.onMergeChanged(() => {
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
                // itself. The identity first: HEAD has moved, and the rail, the switcher menu and
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

    /**
     * Overwrite the working tree with a past version, once the author has said yes.
     *
     * **The confirmation is inside the operation, not beside it.** This is the one thing on the
     * surface that changes files on disk, and a caller that could reach the write without the
     * question would be one press away from replacing an afternoon's work.
     *
     * The dialog is the destructive shape - Cancel is the primary button and the action is a
     * danger-coloured secondary the author has to aim at - because it does overwrite what they have
     * now. What keeps that from being alarmism is the detail line: it says a checkpoint is recorded
     * first, which is the fact that makes this safe to press. Leaving that out would dress a
     * recoverable operation up as an irreversible one, and an author who believes it is
     * irreversible simply never uses it.
     *
     * No re-read afterwards, deliberately: the service leaves the version view before it resolves,
     * and that path already drops every in-memory document and reads the working tree again. The
     * only things re-read here are this hook's own answers, all three of which the new revision
     * invalidated - the same set a commit invalidates, for the same reason.
     */
    const restoreRevision = useCallback(async (revision: RevisionId, label?: string): Promise<boolean> => {
        if (!services || busy !== null) {
            return false;
        }
        const name = label ?? shortRevision(revision);
        const confirmed = await services.ui.showDestructiveConfirm(
            translate("workspace.shell.versionControl.restoreConfirm", { version: name }),
            translate("workspace.shell.versionControl.restoreConfirmDetail"),
            translate("workspace.shell.versionControl.restore"),
        );
        if (!confirmed || !alive.current) {
            return false;
        }

        setBusy("restore");
        setError(null);
        try {
            const restored = await services.versionControl.restoreRevision(revision, { label });
            if (!alive.current) return true;
            if (restored.recordFailure) {
                // The half of a restore that fails with the author's files ALREADY replaced. Said out
                // loud, because the assumption they would otherwise make - "it failed, so nothing
                // happened" - is the opposite of the truth, and they would go on working on a project
                // that quietly went back a week.
                //
                // A sticky notice rather than {@link error}: the restore leaves the revision view on
                // its way out, and the rail's own effect re-reads the history on that state change -
                // which clears `error` before anyone could read it. This is not a message to lose a
                // race with.
                services.ui.notifications.showSticky({
                    type: NotificationType.Error,
                    message: translate("workspace.shell.versionControl.restoreNotRecordedTitle"),
                    detail: translate("workspace.shell.versionControl.restoreNotRecordedDetail", {
                        version: name,
                        error: restored.recordFailure,
                        // The button's own label, read from the catalogue rather than repeated, so
                        // the sentence cannot end up naming a control that no longer says that.
                        action: translate("workspace.shell.versionControl.commit"),
                    }),
                });
            }
            // Past this line the revision EXISTS and the disk has already changed, which is why the
            // re-reads below have a catch of their own: reporting one of them as a failed restore
            // would tell the author to do again the one thing they must not do twice by accident.
            try {
                await readIdentity();
                if (!alive.current) return true;
                await readHistory(page.limit);
            } catch (thrown) {
                if (alive.current) setError(messageOf(thrown));
            }
            return true;
        } catch (thrown) {
            if (alive.current) setError(messageOf(thrown));
            return false;
        } finally {
            if (alive.current) setBusy(null);
        }
    }, [services, busy, readIdentity, readHistory, page.limit]);

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

    /**
     * Ask the server where things stand.
     *
     * The one call on this surface that waits on a network of its own accord, which is
     * why it always shows a spinner: it is measured at ~2s against a host that does not
     * answer, and two silent seconds look like a button that did nothing.
     *
     * A failure is left in `error` AND clears the snapshot, because a stale "up to date"
     * beside a failed check is the one thing this row must never show.
     */
    const checkRemote = useCallback(() => {
        if (!services || busy !== null) {
            return;
        }
        setBusy("remote");
        setError(null);
        void services.versionControl.getSyncState()
            .then(next => {
                if (alive.current) setSyncState(next);
            })
            .catch(thrown => {
                if (!alive.current) return;
                setSyncState(null);
                setError(messageOf(thrown));
            })
            .finally(() => {
                if (alive.current) setBusy(null);
            });
    }, [services, busy]);

    const setRemote = useCallback(async (url: string | null): Promise<boolean> => {
        if (!services) {
            return false;
        }
        setBusy("remote");
        setError(null);
        try {
            const written = await services.versionControl.setRemote(url);
            if (!alive.current) return true;
            setRemoteUrl(written);
            // Whatever was known about the OLD server describes a server this project is
            // no longer pointed at. Left in place, disconnecting would leave the row
            // reporting "2 versions ahead" of nothing.
            setSyncState(null);
            return true;
        } catch (thrown) {
            if (alive.current) {
                const message = messageOf(thrown);
                const needsSignIn = vcsSignInRequired(message);
                setRemoteNeedsSignIn(needsSignIn);
                setError(message);
                // The address survives this one refusal - see the manager - and the row
                // that offers a sign-in is the one drawn beside a configured server, so
                // the surface has to know it was kept or the way in is still not there.
                if (needsSignIn && url !== null) {
                    setRemoteUrl(url);
                }
            }
            return false;
        } finally {
            if (alive.current) setBusy(null);
        }
    }, [services]);

    /**
     * Present a token to the server.
     *
     * The outcome is kept whichever way it went. A refusal is the more useful of the two
     * to keep: it is what the form draws its sentence from, and clearing it on the next
     * keystroke would take the explanation away while the author is still reading it.
     */
    const signInToServer = useCallback(async (authUrl: string, token: string): Promise<boolean> => {
        if (!services || busy !== null) {
            return false;
        }
        setBusy("remote");
        setError(null);
        try {
            const outcome = await services.versionControl.signIn(authUrl, token);
            if (!alive.current) return outcome.ok;
            setSignIn(outcome);
            if (!outcome.ok) return false;
            // Only now. The section that reports how a sign-in went is the one this
            // marker draws, so clearing it on the way in would take the answer off the
            // screen at the moment there was one to read.
            setRemoteNeedsSignIn(false);
            setServerSession(outcome.session);
            // The sign-in already reached the server to decide whether the two ends can
            // work together, so the row can be right without a second two-second wait.
            setSyncState(await services.versionControl.getSyncState());
            return true;
        } catch (thrown) {
            if (alive.current) setError(messageOf(thrown));
            return false;
        } finally {
            if (alive.current) setBusy(null);
        }
    }, [services, busy]);

    /**
     * Put a server's authority into this account's trust store.
     *
     * Nothing is retried and the sign-in is not re-attempted here: the rail does that,
     * because whether to try again is a question about the form's contents - the token
     * is still in a box up there - rather than about the trust store.
     */
    const trustAuthority = useCallback(async (certificatePath: string): Promise<boolean> => {
        if (!services || busy !== null) {
            return false;
        }
        setBusy("remote");
        setError(null);
        try {
            const outcome = await services.versionControl.trustAuthority(certificatePath);
            if (!alive.current) return outcome.installed;
            // What the operating system printed when it refused. It says something
            // specific - a policy that forbids adding roots, a keychain left locked -
            // and the author has nowhere else to learn which of those it was.
            if (!outcome.installed) setError(outcome.output || null);
            return outcome.installed;
        } catch (thrown) {
            if (alive.current) setError(messageOf(thrown));
            return false;
        } finally {
            if (alive.current) setBusy(null);
        }
    }, [services, busy]);

    const signOutOfServer = useCallback(async (): Promise<void> => {
        if (!services) {
            return;
        }
        setBusy("remote");
        setError(null);
        try {
            await services.versionControl.signOut();
            if (!alive.current) return;
            setServerSession(null);
            setSignIn(null);
            // Everything known about the server was learned as somebody who is no longer
            // signed in, so it describes a connection that no longer exists.
            setSyncState(null);
        } catch (thrown) {
            if (alive.current) setError(messageOf(thrown));
        } finally {
            if (alive.current) setBusy(null);
        }
    }, [services]);

    const pushToRemote = useCallback(async (): Promise<boolean> => {
        if (!services || busy !== null) {
            return false;
        }
        setBusy("push");
        setError(null);
        try {
            await services.versionControl.push();
            if (!alive.current) return true;
            // The push moved what the server holds, so the snapshot beside the button is
            // now wrong in the direction that matters - it would still offer to push.
            setSyncState(await services.versionControl.getSyncState());
            return true;
        } catch (thrown) {
            if (alive.current) setError(messageOf(thrown));
            return false;
        } finally {
            if (alive.current) setBusy(null);
        }
    }, [services, busy]);

    /**
     * Bring the server's revisions down.
     *
     * The service re-reads every document, so nothing here needs to - what this owns is
     * the two answers a sync can give that a caller must not confuse: nothing arrived,
     * and something arrived that Studio cannot merge. The second is a SUCCESS with a file
     * list, and it is reported as a sticky notice for the same reason a failed restore
     * record is: the sync leaves the revision view on its way out, and the rail's own
     * effect clears `error` before anyone could read it.
     */
    const syncFromRemote = useCallback(async (): Promise<boolean> => {
        if (!services || busy !== null) {
            return false;
        }
        setBusy("sync");
        setError(null);
        try {
            const result = await services.versionControl.sync();
            if (!alive.current) return true;
            // Re-read rather than kept from the result: the sync's own list comes out of an event
            // stream that is gone by the next call (docs §4.24), and the repository's answer is
            // recovered from disk - so it is the one that survives the window closing, and the one
            // the resolve surface will be working from.
            setMerge(await services.versionControl.getMergeState());
            if (!alive.current) return true;
            if (result.conflicts.length > 0) {
                services.ui.notifications.showSticky({
                    type: NotificationType.Error,
                    message: translate("workspace.shell.versionControl.syncConflictTitle"),
                    detail: translate(
                        result.conflicts.length === 1
                            ? "workspace.shell.versionControl.syncConflictDetailOne"
                            : "workspace.shell.versionControl.syncConflictDetailMany",
                        {
                            count: String(result.conflicts.length),
                            files: result.conflicts.slice(0, 5).join("\n"),
                        },
                    ),
                });
            }
            setSyncState(await services.versionControl.getSyncState());
            return true;
        } catch (thrown) {
            if (alive.current) setError(messageOf(thrown));
            return false;
        } finally {
            if (alive.current) setBusy(null);
        }
    }, [services, busy]);

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
        restoreRevision,
        returnToCurrent,
        enableVersionControl,
        remote,
        syncState,
        merge,
        checkRemote,
        setRemote,
        remoteNeedsSignIn,
        serverSession,
        signIn,
        signInToServer,
        trustAuthority,
        signOutOfServer,
        pushToRemote,
        syncFromRemote,
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
