import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, GitMerge, Loader2, RotateCcw } from "lucide-react";
import type { DocumentMergeDecision } from "@shared/documents/diff";
import { mergeDecisionKey } from "@shared/documents/mergeApply";
import type {
    VcsMergeDecision,
    VcsMergeDocument,
    VcsMergeSideChoice,
    VcsMergeState,
} from "@shared/types/vcs";
import { cn } from "@/lib/utils/cn";
import { translate, useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { VersionControlService } from "@/lib/workspace/services/core/VersionControlService";
import {
    countUndecidedChanges,
    describeMergeSide,
    effectiveMergeSide,
    mergeDocumentBlockedKey,
    resolveMergeDecisionLabel,
    type MergeChangeChoices,
    type MergeValueView,
} from "@/lib/vcs/mergeDecisionView";
import { useWorkspace } from "../../context";
import { useFreezeGuard } from "../../components/ui/freezeGuard";
import { splitChangePath } from "../../components/layout/versionRailModel";

/**
 * Finishing a merge: whole files from one side, and - where the format allows it - one change
 * at a time.
 *
 * **Tier one is the pass mark and it is still what every row offers** (plan 2026-07-31-004 §4.2).
 * It works for any file - binaries, documents with no spec, anything over the comparison budget -
 * because it never looks inside one. Tier two is an improvement layered on top of it, available
 * only for formats whose spec implements `merge3` AND can write itself back, and **a file that
 * cannot have it stays in this list saying why** rather than quietly losing a control: "Studio
 * cannot merge this format" and "there is nothing left to decide here" must not be the same blank
 * space.
 *
 * Three properties of the backend shape everything here, and none of them is a preference:
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
 * click through, and that was weighed (plan §6, decision 4): one mis-aimed press that silently
 * discarded a collaborator's work is worse. The two "take all" links are the concession, and they
 * are safe for the same reason the rows are - they select, they do not apply. Inside a file the
 * same rule holds one level down: a `conflict` row starts on neither side, while an `auto-*` row is
 * drawn as ALREADY DECIDED with the other side on hover, because there the merge had a right
 * answer and took it.
 */

/** How many rows this draws before it says how many it left out. */
const RESOLVE_ROW_LIMIT = 200;

/** What this window knows about one conflicted document's insides. */
type DocumentEntry =
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; document: VcsMergeDocument };

export function VcsResolvePanel() {
    const { t, tn } = useTranslation();
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
    const [expanded, setExpanded] = useState<Record<string, true>>({});
    const [documents, setDocuments] = useState<Record<string, DocumentEntry>>({});
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
    const rows = conflicts.slice(0, RESOLVE_ROW_LIMIT);

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

    const toggle = (path: string) => {
        setExpanded(current => {
            if (current[path]) {
                const { [path]: _removed, ...rest } = current;
                return rest;
            }
            return { ...current, [path]: true };
        });
        if (!documents[path]) {
            readDocument(path);
        }
    };

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
     * Whether this file has an answer the author gave.
     *
     * Per-change counts only when every `conflict` inside it has a side; an `auto-*` row needs
     * nothing, because the merge already had a right answer for it.
     */
    const settled = useCallback((path: string): boolean => {
        if (decisions[path]) {
            return true;
        }
        if (!perChange[path]) {
            return false;
        }
        const entry = documents[path];
        if (entry?.status !== "ready" || entry.document.blocked !== undefined) {
            return false;
        }
        return countUndecidedChanges(entry.document.decisions, changeChoices[path] ?? {}) === 0;
    }, [decisions, perChange, documents, changeChoices]);

    const undecided = conflicts.filter(path => !settled(path)).length;

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
     * commit and by an abandon (docs §4.23, §4.27), so anything kept here would be an expandable
     * row over files that no longer exist.
     */
    const resetChoices = () => {
        setDecisions({});
        setPerChange({});
        setChangeChoices({});
        setExpanded({});
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

    return (
        <div className="flex h-full min-h-0 flex-col bg-surface">
            <div className="flex shrink-0 items-center gap-2 border-b border-edge px-3 py-2">
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
                    title={t("documentDiff.tab.refresh")}
                    aria-label={t("documentDiff.tab.refresh")}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-fg-subtle transition-colors cursor-default hover:bg-fill hover:text-fg disabled:opacity-50"
                >
                    {loading
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <RotateCcw className="h-3.5 w-3.5" />}
                </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
                {loading && state === null && (
                    <p className="flex items-center gap-2 text-xs text-fg-subtle">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        {t("documentDiff.rows.loading")}
                    </p>
                )}

                {error && <p className="mb-2 text-xs text-danger">{error}</p>}

                {!loading && state !== null && !state.inProgress && (
                    <p className="text-xs text-fg-subtle">{t("documentDiff.resolve.none")}</p>
                )}

                {state?.inProgress && conflicts.length === 0 && (
                    // A merge with nothing left to a human: the automerge settled every path, and
                    // all that is missing is the commit that closes it. Not an error, and not an
                    // empty screen either - the button below is the whole of what is left to do.
                    <p className="text-xs text-fg-subtle">{t("documentDiff.resolve.automerged")}</p>
                )}

                {state?.inProgress && conflicts.length > 0 && (
                    <>
                        <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                            <p className="text-xs text-fg">
                                {tn("documentDiff.resolve.count", conflicts.length)}
                            </p>
                            {/* Two links rather than buttons, and they SELECT rather than apply -
                                which is what makes offering them at all defensible next to a
                                deliberately unselected default. */}
                            <button
                                type="button"
                                {...guard.writes(running !== null)}
                                onClick={() => chooseAll("mine")}
                                className="text-2xs text-fg-subtle transition-colors cursor-default hover:text-fg disabled:opacity-50"
                            >
                                {t("documentDiff.resolve.takeAllMine")}
                            </button>
                            <button
                                type="button"
                                {...guard.writes(running !== null)}
                                onClick={() => chooseAll("theirs")}
                                className="text-2xs text-fg-subtle transition-colors cursor-default hover:text-fg disabled:opacity-50"
                            >
                                {t("documentDiff.resolve.takeAllTheirs")}
                            </button>
                        </div>

                        {rows.map(path => (
                            <ConflictRow
                                key={path}
                                path={path}
                                choice={decisions[path]}
                                merging={Boolean(perChange[path])}
                                expanded={Boolean(expanded[path])}
                                entry={documents[path]}
                                choices={changeChoices[path] ?? {}}
                                disabled={running !== null}
                                onToggle={() => toggle(path)}
                                onChoose={choice => chooseWhole(path, choice)}
                                onChooseMerged={() => chooseMerged(path)}
                                onChooseChange={(decision, side) => chooseChange(path, decision, side)}
                            />
                        ))}

                        {conflicts.length > rows.length && (
                            <p className="pt-2 text-2xs text-fg-subtle">
                                {t("documentDiff.resolve.rowsOmitted", {
                                    count: String(conflicts.length - rows.length),
                                })}
                            </p>
                        )}
                    </>
                )}
            </div>

            {state?.inProgress && (
                <div className="shrink-0 border-t border-edge px-3 py-2">
                    {/* Said before the author invests in two hundred choices, not after: this
                        record is the window's, and closing the tab or the window loses it. The
                        merge itself is untouched, which is the half that makes it recoverable. */}
                    <p className="mb-2 text-2xs text-fg-subtle">
                        {t("documentDiff.resolve.notSaved")}
                    </p>
                    <div className="flex items-center gap-1.5">
                        <button
                            type="button"
                            {...guard.writes(running !== null || undecided > 0)}
                            onClick={finish}
                            className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-2 text-2xs text-on-primary transition-opacity cursor-default hover:opacity-90 disabled:opacity-50"
                        >
                            {running === "finish"
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : <GitMerge className="h-3 w-3" />}
                            {undecided > 0
                                ? tn("documentDiff.resolve.finishUndecided", undecided)
                                : t("documentDiff.resolve.finish")}
                        </button>
                        <button
                            type="button"
                            {...guard.writes(running !== null)}
                            onClick={abandon}
                            className="flex h-7 items-center justify-center rounded-md border border-edge px-2 text-2xs text-fg-muted transition-colors cursor-default hover:bg-fill hover:text-danger disabled:opacity-50"
                        >
                            {running === "abandon"
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : t("documentDiff.resolve.abandon")}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

/**
 * One conflicted file: the side chosen for it, and what is inside it.
 *
 * The path is split the way every other version surface splits it - the file name identifies the
 * document and the directory merely locates it - so the same file reads the same in the rail, in a
 * comparison and here.
 *
 * The two whole-file choices are a pair of buttons rather than a menu or a checkbox: three states
 * have to be visible at a glance (mine, theirs, and NEITHER YET), and the third is the one that has
 * to be unmistakable, because it is what stops the author finishing. The third button appears only
 * once the file has been opened and its format turns out to be mergeable - it is the one whose
 * availability is not a property of the interface but of the document, so it cannot be drawn before
 * anyone has looked.
 */
function ConflictRow({
    path,
    choice,
    merging,
    expanded,
    entry,
    choices,
    disabled,
    onToggle,
    onChoose,
    onChooseMerged,
    onChooseChange,
}: {
    path: string;
    choice: VcsMergeSideChoice | undefined;
    merging: boolean;
    expanded: boolean;
    entry: DocumentEntry | undefined;
    choices: MergeChangeChoices;
    disabled: boolean;
    onToggle: () => void;
    onChoose: (choice: VcsMergeSideChoice) => void;
    onChooseMerged: () => void;
    onChooseChange: (decision: DocumentMergeDecision, side: VcsMergeSideChoice) => void;
}) {
    const { t, tn } = useTranslation();
    const { directory, name } = splitChangePath(path);
    const mergeable = entry?.status === "ready" && entry.document.blocked === undefined;
    const undecided = entry?.status === "ready" && entry.document.blocked === undefined
        ? countUndecidedChanges(entry.document.decisions, choices)
        : 0;

    return (
        <div className="border-b border-edge py-1.5 last:border-b-0">
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={onToggle}
                    title={t(expanded ? "documentDiff.resolve.change.collapse" : "documentDiff.resolve.change.expand")}
                    aria-label={t(expanded ? "documentDiff.resolve.change.collapse" : "documentDiff.resolve.change.expand")}
                    aria-expanded={expanded}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg-subtle transition-colors cursor-default hover:bg-fill hover:text-fg"
                >
                    {expanded
                        ? <ChevronDown className="h-3 w-3" />
                        : <ChevronRight className="h-3 w-3" />}
                </button>
                <div className="flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden">
                    <span className="min-w-0 truncate text-xs text-fg" title={path}>{name}</span>
                    {directory !== null && (
                        <span className="min-w-0 shrink truncate text-2xs text-fg-subtle">{directory}</span>
                    )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    {(["mine", "theirs"] as const).map(side => (
                        <button
                            key={side}
                            type="button"
                            disabled={disabled}
                            aria-pressed={choice === side}
                            onClick={() => onChoose(side)}
                            className={cn(
                                "h-6 rounded-md border px-2 text-2xs transition-colors cursor-default disabled:opacity-50",
                                choice === side
                                    ? "border-primary bg-primary/15 text-primary"
                                    : "border-edge text-fg-muted hover:bg-fill hover:text-fg",
                            )}
                        >
                            {t(side === "mine" ? "documentDiff.resolve.takeMine" : "documentDiff.resolve.takeTheirs")}
                        </button>
                    ))}
                    {mergeable && (
                        <button
                            type="button"
                            disabled={disabled}
                            aria-pressed={merging}
                            onClick={onChooseMerged}
                            className={cn(
                                "h-6 rounded-md border px-2 text-2xs transition-colors cursor-default disabled:opacity-50",
                                merging && undecided === 0
                                    ? "border-primary bg-primary/15 text-primary"
                                    : merging
                                        ? "border-warning text-warning"
                                        : "border-edge text-fg-muted hover:bg-fill hover:text-fg",
                            )}
                        >
                            {merging && undecided > 0
                                ? tn("documentDiff.resolve.change.undecided", undecided)
                                : t("documentDiff.resolve.change.auto")}
                        </button>
                    )}
                </div>
            </div>

            {expanded && (
                <div className="mt-1.5 pl-7">
                    {entry === undefined || entry.status === "loading" ? (
                        <p className="flex items-center gap-2 text-2xs text-fg-subtle">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            {t("documentDiff.resolve.change.loading")}
                        </p>
                    ) : entry.status === "error" ? (
                        <p className="text-2xs text-danger">{entry.message}</p>
                    ) : entry.document.blocked !== undefined ? (
                        // Tier three: refuse, and say which wall was hit. The two whole-file
                        // buttons above are still the answer for this file, and they are still
                        // there - this is a sentence beside them, not a control taken away.
                        <div className="space-y-0.5">
                            <p className="text-2xs text-fg-muted">{t("documentDiff.resolve.change.blocked.title")}</p>
                            <p className="text-2xs text-fg-subtle">{t(mergeDocumentBlockedKey(entry.document.blocked))}</p>
                            {entry.document.detail && (
                                // The producer's own words, untranslated and marked as such by
                                // being quieter - never instead of the sentence above it.
                                <p className="text-2xs text-fg-subtle opacity-70">{entry.document.detail}</p>
                            )}
                        </div>
                    ) : entry.document.decisions.length === 0 ? (
                        <p className="text-2xs text-fg-subtle">{t("documentDiff.resolve.change.none")}</p>
                    ) : (
                        <>
                            <p className="mb-1 text-2xs text-fg-subtle">{t("documentDiff.resolve.change.heading")}</p>
                            {entry.document.decisions.map(decision => (
                                <MergeChangeRow
                                    key={mergeDecisionKey(decision.path)}
                                    decision={decision}
                                    side={effectiveMergeSide(decision, choices)}
                                    disabled={disabled}
                                    onChoose={side => onChooseChange(decision, side)}
                                />
                            ))}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

/**
 * One change inside a file, and the side it is on.
 *
 * **Two shapes, because two different questions are being asked.** An `auto-*` row was decided by
 * the merge - one side moved and the other did not, so there was a right answer - and it is drawn
 * as settled, showing only the value that won, with the other side offered on hover. A `conflict`
 * row was decided by nobody, so both sides are drawn as choices and neither is selected; there is
 * no hover affordance there because there is nothing yet to reveal an alternative to.
 *
 * Flipping an `auto-*` row and answering a `conflict` are the same operation underneath - both
 * record a side against this decision's path - which is why the merged document can be rebuilt from
 * the flips alone.
 */
function MergeChangeRow({
    decision,
    side,
    disabled,
    onChoose,
}: {
    decision: DocumentMergeDecision;
    side: "mine" | "theirs" | undefined;
    disabled: boolean;
    onChoose: (side: VcsMergeSideChoice) => void;
}) {
    const translator = useTranslation();
    const { t } = translator;
    const label = resolveMergeDecisionLabel(decision, translator);
    const conflict = decision.outcome === "conflict";
    const other = side === "mine" ? "theirs" : "mine";

    return (
        <div className="group/change border-t border-edge/60 py-1 first:border-t-0">
            <div className="flex items-baseline gap-1.5 overflow-hidden">
                <span
                    className={cn(
                        "min-w-0 truncate text-2xs",
                        label.untranslated ? "font-mono text-fg-muted" : "text-fg",
                    )}
                    title={decision.path.join(" / ")}
                >
                    {label.primary}
                </span>
                {label.detail && <span className="min-w-0 shrink truncate text-2xs text-fg-subtle">{label.detail}</span>}
                <span className="flex-1" />
                {!conflict && side !== undefined && (
                    // Hover-revealed rather than persistent: an automatic row is right almost every
                    // time, and a button on each of two hundred of them is two hundred invitations
                    // to change something that did not need changing.
                    <button
                        type="button"
                        disabled={disabled}
                        onClick={() => onChoose(other)}
                        className="shrink-0 rounded px-1 text-2xs text-fg-subtle opacity-0 transition-opacity cursor-default hover:text-fg group-hover/change:opacity-100 focus-visible:opacity-100 disabled:opacity-50"
                    >
                        {t(other === "mine" ? "documentDiff.resolve.change.useMine" : "documentDiff.resolve.change.useTheirs")}
                    </button>
                )}
            </div>

            {conflict || side === undefined ? (
                <div className="mt-0.5 grid grid-cols-2 gap-1">
                    {(["mine", "theirs"] as const).map(candidate => (
                        <button
                            key={candidate}
                            type="button"
                            disabled={disabled}
                            aria-pressed={side === candidate}
                            onClick={() => onChoose(candidate)}
                            className={cn(
                                "min-w-0 rounded-md border px-1.5 py-1 text-left transition-colors cursor-default disabled:opacity-50",
                                side === candidate
                                    ? "border-primary bg-primary/10"
                                    : "border-edge hover:bg-fill",
                            )}
                        >
                            <span className="mb-0.5 block truncate text-2xs text-fg-subtle">
                                {t(candidate === "mine"
                                    ? "documentDiff.resolve.takeMine"
                                    : "documentDiff.resolve.takeTheirs")}
                            </span>
                            <MergeValue view={describeMergeSide(candidate === "mine" ? decision.mine : decision.theirs)} />
                        </button>
                    ))}
                </div>
            ) : (
                <div className="mt-0.5 min-w-0 rounded-md border border-edge/60 px-1.5 py-1">
                    <MergeValue view={describeMergeSide(side === "mine" ? decision.mine : decision.theirs)} />
                </div>
            )}
        </div>
    );
}

/**
 * One side's value, field by field.
 *
 * Not JSON: the question a translation conflict asks is which of two sentences to keep, and putting
 * them inside braces and quotes makes the author read punctuation to find the answer. One line per
 * field puts the two `target` strings opposite each other, which IS the choice.
 */
function MergeValue({ view }: { view: MergeValueView }) {
    const { t } = useTranslation();
    if (view.absent) {
        return <span className="block truncate text-2xs italic text-fg-subtle">{t("documentDiff.resolve.change.absent")}</span>;
    }
    return (
        <span className="block min-w-0">
            {view.lines.map((line, index) => (
                <span key={line.name ?? index} className="flex min-w-0 items-baseline gap-1">
                    {line.name && <span className="shrink-0 text-2xs text-fg-subtle">{line.name}</span>}
                    <span className="min-w-0 truncate text-2xs text-fg">{line.text}</span>
                </span>
            ))}
            {view.hidden > 0 && (
                <span className="block text-2xs text-fg-subtle">
                    {t("documentDiff.resolve.change.moreFields", { count: String(view.hidden) })}
                </span>
            )}
        </span>
    );
}

function messageOf(thrown: unknown): string {
    return thrown instanceof Error ? thrown.message : String(thrown);
}
