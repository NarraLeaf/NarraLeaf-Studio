import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GitMerge, Loader2, RotateCcw } from "lucide-react";
import type { VcsMergeDecision, VcsMergeSideChoice, VcsMergeState } from "@shared/types/vcs";
import { cn } from "@/lib/utils/cn";
import { translate, useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { VersionControlService } from "@/lib/workspace/services/core/VersionControlService";
import { useWorkspace } from "../../context";
import { useFreezeGuard } from "../../components/ui/freezeGuard";
import { splitChangePath } from "../../components/layout/versionRailModel";

/**
 * Finishing a merge by taking one side of each file, whole.
 *
 * **This is tier one and it is the whole pass mark** (plan 2026-07-31-004 §4.2): it works for any
 * file - binaries, documents with no spec, anything over the comparison budget - because it never
 * looks inside one. Taking changes one at a time is a later milestone and an improvement, not the
 * thing that makes a merge usable.
 *
 * Three properties of the backend shape everything here, and none of them is a preference:
 *
 * **Nothing readable says which conflicts the author has already settled.** The three sides the
 * merge left on disk survive a resolve, the status call reports nothing for the whole of a merge,
 * and two of the three settle verbs emit no events (docs §4.24, §4.25). The only observation that
 * separates settled from unsettled is the commit refusing itself, which is a write. So the
 * decisions below live in THIS COMPONENT for the life of the window, they are never presented as
 * repository state, and the panel says so in words rather than implying a progress that is not
 * saved anywhere.
 *
 * **Which is why nothing is applied until the author finishes.** `mine` and `theirs` overwrite the
 * working tree the moment they are called, so a panel that applied each click would rewrite the
 * author's files a file at a time, re-read every editor between clicks, and leave a merge whose
 * half-settled state nothing could read back. Choosing is local; one press then settles everything
 * and commits, as one operation in the main process. A window closed before that press leaves the
 * merge exactly as the sync left it - no bytes written, nothing to recover from - and the author
 * starts the choosing again.
 *
 * **Neither side is selected by default.** Two hundred conflicts is tedious to click through, and
 * that was weighed (plan §6, decision 4): one mis-aimed press that silently discarded a
 * collaborator's work is worse. The two "take all" links are the concession, and they are safe for
 * the same reason the rows are - they select, they do not apply.
 */

/** How many rows this draws before it says how many it left out. */
const RESOLVE_ROW_LIMIT = 200;

export function VcsResolvePanel() {
    const { t, tn } = useTranslation();
    const { context } = useWorkspace();
    // A resolve WRITES the author's files, so unlike everything else in this tab it is gated. The
    // read half - the file list, which side is which, the fact that a merge is open - is not: a
    // frozen workspace is exactly the state an author browsing a past revision is in, and taking
    // away their view of the merge would tell them nothing about why they cannot act on it.
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
    const undecided = conflicts.filter(path => decisions[path] === undefined).length;

    const chooseAll = (choice: VcsMergeSideChoice) => {
        setDecisions(Object.fromEntries(conflicts.map(path => [path, choice])));
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
            const choice = decisions[path];
            if (choice) chosen.push({ path, choice });
        }
        setRunning("finish");
        setError(null);
        void service.completeMerge(chosen)
            .then(() => {
                if (!alive.current) return;
                // The decisions described a merge that is over; keeping them would pre-select rows
                // of the NEXT one, which is the worst possible default for a control this
                // consequential.
                setDecisions({});
            })
            .catch(thrown => {
                if (alive.current) setError(messageOf(thrown));
            })
            .finally(() => {
                if (alive.current) setRunning(null);
            });
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
                    if (alive.current) setDecisions({});
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
                                disabled={running !== null}
                                onChoose={choice => setDecisions(current => ({ ...current, [path]: choice }))}
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
 * One conflicted file and the side chosen for it.
 *
 * The path is split the way every other version surface splits it - the file name identifies the
 * document and the directory merely locates it - so the same file reads the same in the rail, in a
 * comparison and here.
 *
 * The two choices are a pair of buttons rather than a menu or a checkbox: three states have to be
 * visible at a glance (mine, theirs, and NEITHER YET), and the third is the one that has to be
 * unmistakable, because it is what stops the author finishing.
 */
function ConflictRow({
    path,
    choice,
    disabled,
    onChoose,
}: {
    path: string;
    choice: VcsMergeSideChoice | undefined;
    disabled: boolean;
    onChoose: (choice: VcsMergeSideChoice) => void;
}) {
    const { t } = useTranslation();
    const { directory, name } = splitChangePath(path);

    return (
        <div className="flex items-center gap-2 border-b border-edge py-1.5 last:border-b-0">
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
            </div>
        </div>
    );
}

function messageOf(thrown: unknown): string {
    return thrown instanceof Error ? thrown.message : String(thrown);
}
