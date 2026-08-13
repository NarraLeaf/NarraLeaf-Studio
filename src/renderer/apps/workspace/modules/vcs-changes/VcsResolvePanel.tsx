import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GitMerge, Loader2, RotateCcw } from "lucide-react";
import type { DocumentMergeDecision } from "@shared/documents/diff";
import { mergeDecisionKey } from "@shared/documents/mergeApply";
import type {
    VcsMergeDecision,
    VcsMergeSideChoice,
    VcsMergeState,
} from "@shared/types/vcs";
import { HelpTrigger } from "@/lib/help";
import { translate, useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { VersionControlService } from "@/lib/workspace/services/core/VersionControlService";
import { ConflictFooter, ConflictResolveView } from "@/lib/vcs/ConflictResolveView";
import {
    buildConflictRows,
    countUndecidedFiles,
    type MergeChangeChoices,
    type MergeDocumentEntry,
} from "@/lib/vcs/mergeDecisionView";
import { useWorkspace } from "../../context";
import { useFreezeGuard } from "../../components/ui/freezeGuard";

/**
 * Finishing a merge: whole files from one side, and - where the format allows it - one change
 * at a time.
 *
 * **Tier one is the pass mark and it is still what every row offers**.
 * It works for any file - binaries, documents with no spec, anything over the comparison budget -
 * because it never looks inside one. Tier two is an improvement layered on top of it, available
 * only for formats whose spec implements `merge3` AND can write itself back, and **a file that
 * cannot have it stays in this list saying why** rather than quietly losing a control: "Studio
 * cannot merge this format" and "there is nothing left to decide here" must not be the same blank
 * space.
 *
 * **Two panes, the same two a comparison has.** The index carries one line per conflicted file with
 * that file's decision on it; the detail carries the changes inside whichever file is selected,
 * with both sides' values side by side. Everything drawn is in `lib/vcs` and takes plain props, so
 * this file is the wiring - the service, the choices, and what a press means - and nothing else.
 *
 * Three properties of the backend shape all of it, and none of them is a preference:
 *
 * **Nothing readable says which conflicts the author has already settled.** The three sides the
 * merge left on disk survive a resolve, the status call reports nothing for the whole of a merge,
 * and two of the three settle verbs emit no events (docs §4.24, §4.25). The only observation that
 * separates settled from unsettled is the commit refusing itself, which is a write. So the
 * decisions below - whole-file and per-change alike - live in THIS COMPONENT for the life of the
 * window, they are never presented as repository state, and the panel says so in words rather than
 * implying a progress that is not saved anywhere.
 *
 * **Which is why nothing is applied until the author finishes.** `mine` and `theirs` overwrite the
 * working tree the moment they are called, so a panel that applied each click would rewrite the
 * author's files a file at a time, re-read every editor between clicks, and leave a merge whose
 * half-settled state nothing could read back. Choosing is local; one press then settles everything
 * and commits, as one operation in the main process. A window closed before that press leaves the
 * merge exactly as the sync left it - no bytes written, nothing to recover from - and the author
 * starts the choosing again.
 *
 * **Neither side is selected by default, at either tier.** Two hundred conflicts is tedious to
 * click through, and that was weighed: one mis-aimed press that silently
 * discarded a collaborator's work is worse. The two "take all" links are the concession, and they
 * are safe for the same reason the rows are - they select, they do not apply. Inside a file the
 * same rule holds one level down: a `conflict` row starts on neither side, while an `auto-*` row is
 * drawn as ALREADY DECIDED with the other side on hover, because there the merge had a right
 * answer and took it.
 */

/** How many conflicts the index lists before it says how many it left out. */
const RESOLVE_ROW_LIMIT = 200;

export function VcsResolvePanel() {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    // A resolve WRITES the author's files, so unlike everything else in this tab it is gated. The
    // read half - the file list, which side is which, what changed inside, the fact that a merge is
    // open - is not: a frozen workspace is exactly the state an author browsing a past revision is
    // in, and taking away their view of the merge would tell them nothing about why they cannot act
    // on it.
    const guard = useFreezeGuard();
    const [state, setState] = useState<VcsMergeState | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    /**
     * The author's choices so far - **this window's memory, and nowhere else's.**
     *
     * Keyed by repository-relative path. A path that is not a key is undecided, which is the state
     * every row starts in.
     */
    const [decisions, setDecisions] = useState<Record<string, VcsMergeSideChoice>>({});
    /**
     * Paths the author is settling change by change, and what they chose inside each.
     *
     * Two records rather than one, because "this file is being merged" and "this change goes to
     * theirs" are different facts: a document whose every inner change merged automatically has
     * nothing to choose and still has to be marked as merged, or the finish button would wait
     * forever on a file with no question in it.
     */
    const [perChange, setPerChange] = useState<Record<string, true>>({});
    const [changeChoices, setChangeChoices] = useState<Record<string, MergeChangeChoices>>({});
    const [selectedPath, setSelectedPath] = useState<string | null>(null);
    const [documents, setDocuments] = useState<Record<string, MergeDocumentEntry>>({});
    const [running, setRunning] = useState<"finish" | "abandon" | null>(null);
    const alive = useRef(true);
    useEffect(() => {
        alive.current = true;
        return () => {
            alive.current = false;
        };
    }, []);

    const service = useMemo(
        () => (context ? context.services.get<VersionControlService>(Services.VersionControl) : null),
        [context],
    );

    const read = useCallback(async () => {
        if (!service) {
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const answer = await service.getMergeState();
            if (!alive.current) return;
            setState(answer);
        } catch (thrown) {
            if (!alive.current) return;
            setState(null);
            setError(messageOf(thrown));
        } finally {
            if (alive.current) setLoading(false);
        }
    }, [service]);

    // Once when the tab opens, and then only when something changed the merge - never on a timer.
    // The read is local and non-scanning, but "cheap" has never been the reason this feature
    // refuses to poll (docs §4.17).
    useEffect(() => {
        void read();
    }, [read]);
    useEffect(() => {
        if (!service) {
            return;
        }
        // Completing or abandoning a merge happens from THIS panel, so this is mostly the tab
        // agreeing with itself - and it is also what keeps a second window's abandon from leaving
        // this one offering decisions on a merge that is gone.
        return service.onMergeChanged(() => void read());
    }, [service, read]);

    const conflicts = useMemo(
        () => (state?.inProgress ? state.conflicts : []),
        [state],
    );
    const listed = conflicts.slice(0, RESOLVE_ROW_LIMIT);
    /**
     * The selected file, resolved against the current merge rather than stored as truth.
     *
     * A re-read can drop the file that was selected - a second window's abandon, or a merge that
     * finished - and a selection kept in state would then point at a conflict that no longer
     * exists. The fallback is the first conflict, so the detail is never blank on arrival.
     */
    const selectedPathInList = selectedPath !== null && listed.includes(selectedPath);
    const selected = selectedPathInList ? selectedPath : (listed[0] ?? null);

    /**
     * Read one file's insides, once, when the author asks to see them.
     *
     * On demand rather than for the whole merge, because a decision carries BOTH sides' values
     * verbatim - a merge with two hundred conflicted files fetched up front would be a message
     * almost none of which is ever looked at.
     */
    const readDocument = useCallback((path: string) => {
        if (!service) {
            return;
        }
        setDocuments(current => (current[path] ? current : { ...current, [path]: { status: "loading" } }));
        void service.getMergeDocument(path)
            .then(document => {
                if (!alive.current) return;
                setDocuments(current => ({
                    ...current,
                    [path]: document
                        ? { status: "ready", document }
                        : { status: "error", message: translate("documentDiff.tab.unavailable") },
                }));
            })
            .catch(thrown => {
                if (!alive.current) return;
                setDocuments(current => ({ ...current, [path]: { status: "error", message: messageOf(thrown) } }));
            });
    }, [service]);

    // Selecting a file IS asking to see inside it, so the read follows the selection rather than a
    // second gesture. Which is also what makes the per-change control honest: it appears once the
    // document has answered and its format turns out to be mergeable, and never before anyone has
    // looked.
    useEffect(() => {
        if (selected !== null && documents[selected] === undefined) {
            readDocument(selected);
        }
    }, [selected, documents, readDocument]);

    /** Take a whole file from one side. Drops any per-change work on it - the two are exclusive. */
    const chooseWhole = (path: string, choice: VcsMergeSideChoice) => {
        setDecisions(current => ({ ...current, [path]: choice }));
        setPerChange(current => {
            const { [path]: _removed, ...rest } = current;
            return rest;
        });
    };

    /** Settle this file change by change, keeping whatever the merge already decided inside it. */
    const chooseMerged = (path: string) => {
        setPerChange(current => ({ ...current, [path]: true }));
        setDecisions(current => {
            const { [path]: _removed, ...rest } = current;
            return rest;
        });
    };

    const chooseChange = (path: string, decision: DocumentMergeDecision, side: VcsMergeSideChoice) => {
        // Choosing inside a file IS choosing to merge it: making the author press a mode button
        // first would be a control whose only job is to permit the control beside it.
        chooseMerged(path);
        setChangeChoices(current => ({
            ...current,
            [path]: { ...(current[path] ?? {}), [mergeDecisionKey(decision.path)]: side },
        }));
    };

    /**
     * Every conflict as a row, decisions included.
     *
     * Built over the whole conflict list rather than over the rows the index draws: a file past the
     * cap that nobody answered still holds the merge open, and a finish button counting only what
     * is on screen would offer to close a merge that the backend then refuses.
     */
    const rows = useMemo(
        () => buildConflictRows(conflicts, { decisions, perChange, changeChoices, documents }),
        [conflicts, decisions, perChange, changeChoices, documents],
    );
    const undecided = countUndecidedFiles(rows);

    const chooseAll = (choice: VcsMergeSideChoice) => {
        setDecisions(Object.fromEntries(conflicts.map(path => [path, choice])));
        setPerChange({});
    };

    const finish = () => {
        // No floor on `conflicts.length`: a merge whose automerge settled everything has nothing to
        // decide and still needs the commit that closes it, which is exactly this press.
        if (!service || running !== null || guard.frozen || undecided > 0) {
            return;
        }
        // Built by filtering rather than by asserting the map is complete: the button is disabled
        // while anything is undecided, and if that ever fails the backend refuses the commit and
        // names the path - which is a sentence the author can act on, unlike a crash here.
        const chosen: VcsMergeDecision[] = [];
        for (const path of conflicts) {
            const whole = decisions[path];
            if (whole) {
                chosen.push({ path, choice: whole });
                continue;
            }
            if (perChange[path]) {
                // Only the flips travel. Everything the merge decided on its own is recomputed in
                // the main process from the same three files, so an `auto-*` row the author left
                // alone needs no entry - see `VcsMergePerChangeDecision`.
                chosen.push({ path, choice: "per-change", changes: { ...(changeChoices[path] ?? {}) } });
            }
        }
        setRunning("finish");
        setError(null);
        void service.completeMerge(chosen)
            .then(() => {
                if (!alive.current) return;
                // The decisions described a merge that is over; keeping them would pre-select rows
                // of the NEXT one, which is the worst possible default for a control this
                // consequential.
                resetChoices();
            })
            .catch(thrown => {
                if (alive.current) setError(messageOf(thrown));
            })
            .finally(() => {
                if (alive.current) setRunning(null);
            });
    };

    /**
     * Forget every choice, and every side read to make them.
     *
     * The documents go too, not only the choices: the merge's three copies are deleted by the
     * commit and by an abandon (docs §4.23, §4.27), so anything kept here would be a detail pane
     * over files that no longer exist.
     */
    const resetChoices = () => {
        setDecisions({});
        setPerChange({});
        setChangeChoices({});
        setSelectedPath(null);
        setDocuments({});
    };

    /**
     * Abandon the merge, after asking.
     *
     * Offered at all only because the rollback is measured to be complete (docs §4.27): every file
     * back to its pre-merge content and the merge's leftovers removed. The question is here rather
     * than in the button because this throws away everything that arrived in the sync - which is
     * recoverable (sync again) and still not something to do by accident.
     */
    const abandon = () => {
        if (!service || !context || running !== null || guard.frozen) {
            return;
        }
        const ui = context.services.get<UIService>(Services.UI);
        void ui.showDestructiveConfirm(
            translate("documentDiff.resolve.abandonConfirm"),
            translate("documentDiff.resolve.abandonConfirmDetail"),
            translate("documentDiff.resolve.abandon"),
        ).then(confirmed => {
            if (!confirmed || !alive.current) {
                return;
            }
            setRunning("abandon");
            setError(null);
            void service.abortMerge()
                .then(() => {
                    if (alive.current) resetChoices();
                })
                .catch(thrown => {
                    if (alive.current) setError(messageOf(thrown));
                })
                .finally(() => {
                    if (alive.current) setRunning(null);
                });
        });
    };

    const hasConflicts = state?.inProgress === true && conflicts.length > 0;

    return (
        // One of the two places an author meets a state they did not ask for and cannot leave by
        // undoing, so the `?` is drawn here rather than left to `F1` alone. The other is the rail.
        <div className="flex h-full min-h-0 flex-col bg-surface" data-help-topic="versionConflicts">
            <div className="group/help flex shrink-0 items-center gap-2 border-b border-edge px-3 py-2">
                <GitMerge className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-xs text-fg-subtle">
                    {/* **No revision is named here, and that is a measured decision.**
                        `VcsMergeState.incoming` comes from `revisionMerged`, and after a sync that
                        field holds the AUTHOR'S own tip rather than what came down from the server
                        (docs §4.31) - so putting it beside "the version you got" would attribute
                        the merge to the wrong side. The sides are named per row, where they are
                        read from the merge's own copies and are right in both origins. */}
                    {t("documentDiff.resolve.merging")}
                </span>
                <button
                    type="button"
                    onClick={() => void read()}
                    disabled={loading || running !== null}
                    data-tip={t("documentDiff.tab.refresh")}
                    aria-label={t("documentDiff.tab.refresh")}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-fg-subtle transition-colors cursor-default hover:bg-fill hover:text-fg disabled:opacity-50"
                >
                    {loading
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <RotateCcw className="h-3.5 w-3.5" />}
                </button>
                <HelpTrigger topic="versionConflicts" />
            </div>

            {/* Above both panes, because it is a fact about the merge rather than about any one
                file - and a failed finish must not be scrolled past inside a list. */}
            {error && <p className="shrink-0 px-3 pt-2 text-xs text-danger">{error}</p>}

            {hasConflicts ? (
                <ConflictResolveView
                    rows={rows.slice(0, RESOLVE_ROW_LIMIT)}
                    conflictCount={conflicts.length}
                    omitted={conflicts.length - listed.length}
                    selectedPath={selected}
                    onSelect={setSelectedPath}
                    documents={documents}
                    changeChoices={changeChoices}
                    running={running !== null}
                    guard={guard}
                    onChooseWhole={chooseWhole}
                    onChooseMerged={chooseMerged}
                    onChooseChange={chooseChange}
                    onChooseAll={chooseAll}
                />
            ) : (
                <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
                    {loading && state === null && (
                        <p className="flex items-center gap-2 text-xs text-fg-subtle">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            {t("documentDiff.rows.loading")}
                        </p>
                    )}

                    {!loading && state !== null && !state.inProgress && (
                        <p className="text-xs text-fg-subtle">{t("documentDiff.resolve.none")}</p>
                    )}

                    {state?.inProgress && (
                        // A merge with nothing left to a human: the automerge settled every path,
                        // and all that is missing is the commit that closes it. Not an error, and
                        // not an empty screen either - the button below is the whole of what is
                        // left to do.
                        <p className="text-xs text-fg-subtle">{t("documentDiff.resolve.automerged")}</p>
                    )}
                </div>
            )}

            {state?.inProgress && (
                <ConflictFooter
                    rows={rows}
                    running={running}
                    guard={guard}
                    onFinish={finish}
                    onAbandon={abandon}
                />
            )}
        </div>
    );
}

function messageOf(thrown: unknown): string {
    return thrown instanceof Error ? thrown.message : String(thrown);
}
