import React from "react";
import { RotateCcw, Save } from "lucide-react";
import { Button, FieldLabel } from "@/lib/components";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/lib/i18n";
import { getInterface } from "@/lib/app/bridge";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import type { VersionControlService } from "@/lib/workspace/services/core/VersionControlService";
import type { VcsHistoryEntry } from "@shared/types/vcs";

/**
 * The half of recovery mode that can actually put a broken project back.
 *
 * Everything else here explains what went wrong; this is the part that fixes it, and it works
 * because a restore does not need a single one of the services that failed - the whole rewrite
 * happens in the main process against the repository. So it stays available in a shell where nothing
 * else does.
 *
 * **Disabled, never hidden, when the project has no repository.** A project that was never put under
 * version control has nothing to restore from, and that is the single most useful thing an author in
 * this situation can learn - it is the difference between "roll back and carry on" and "this file is
 * the only copy, do not touch it". Hiding the controls would answer a question they did not get to
 * ask; greying them out with the reason attached answers it.
 */

type LoreState =
    | { kind: "loading" }
    /** Reachable but not usable: no native build for this host, or the folder is not a repository. */
    | { kind: "unavailable"; reason: string }
    | { kind: "ready"; head: number; branch: string; history: VcsHistoryEntry[] };

type Feedback = { kind: "ok" | "bad"; text: string } | null;

/** Enough revisions to find a good one, few enough to read without a scrollbar of its own. */
const HISTORY_LIMIT = 20;

export function RecoveryLoreSection({ context }: { context: WorkspaceContext | null }) {
    const { t, locale } = useTranslation();
    const [state, setState] = React.useState<LoreState>({ kind: "loading" });
    const [selected, setSelected] = React.useState<string | null>(null);
    const [busy, setBusy] = React.useState(false);
    const [feedback, setFeedback] = React.useState<Feedback>(null);
    /**
     * Restore asks twice, in place.
     *
     * It rewrites every file in the project, which is not something to do on a misclick - and this
     * shell has no dialog service to ask with (that is what a minimal boot costs). A second click on
     * a button that has changed what it says is the same guarantee with none of the machinery, and
     * it says which version it is about to write, which a generic confirm sheet would not.
     */
    const [confirming, setConfirming] = React.useState(false);

    // A different target is a different act; a confirmation aimed at the old one must not carry over.
    React.useEffect(() => {
        setConfirming(false);
    }, [selected]);

    const vcs = React.useMemo(
        () => (context ? context.services.get<VersionControlService>(Services.VersionControl) : null),
        [context],
    );

    const load = React.useCallback(async () => {
        if (!vcs) {
            setState({ kind: "unavailable", reason: t("workspace.recovery.lore.noService") });
            return;
        }
        setState({ kind: "loading" });
        try {
            const availability = await vcs.getAvailability();
            if (!availability.available) {
                setState({
                    kind: "unavailable",
                    reason: availability.detail
                        ? `${availability.reason}: ${availability.detail}`
                        : availability.reason,
                });
                return;
            }
            if (!(await vcs.isRepository())) {
                setState({ kind: "unavailable", reason: t("workspace.recovery.lore.notARepository") });
                return;
            }
            const info = await vcs.getInfo();
            // `includeDetails` costs a backend call per revision and is exactly what makes this list
            // usable: without the message and the date, twenty revisions are twenty hashes.
            const history = await vcs.getHistory(HISTORY_LIMIT, { includeDetails: true });
            setState({
                kind: "ready",
                head: info?.headNumber ?? 0,
                branch: info?.branch ?? "",
                history,
            });
            setSelected(current => current ?? history[0]?.revision ?? null);
        } catch (error) {
            setState({
                kind: "unavailable",
                reason: error instanceof Error ? error.message : String(error),
            });
        }
    }, [vcs, t]);

    React.useEffect(() => {
        void load();
    }, [load]);

    const handleCheckpoint = async () => {
        if (!vcs) {
            return;
        }
        setBusy(true);
        setFeedback(null);
        try {
            const result = await vcs.createCheckpoint("restore");
            setFeedback(result
                ? { kind: "ok", text: t("workspace.recovery.lore.checkpointDone", { revision: result.revision }) }
                // Null is not a failure: with nothing uncommitted the head already is this state, so
                // there is nothing a checkpoint could add. Saying so is better than a silent no-op
                // that reads as the button not working.
                : { kind: "ok", text: t("workspace.recovery.lore.checkpointNothing") });
            await load();
        } catch (error) {
            setFeedback({
                kind: "bad",
                text: t("workspace.recovery.lore.checkpointFailed", {
                    error: error instanceof Error ? error.message : String(error),
                }),
            });
        } finally {
            setBusy(false);
        }
    };

    const handleRestore = async () => {
        if (!vcs || !selected || state.kind !== "ready") {
            return;
        }
        const entry = state.history.find(item => item.revision === selected);
        const label = entry ? `#${entry.number}` : selected.slice(0, 8);

        setConfirming(false);
        setBusy(true);
        setFeedback(null);
        try {
            // Straight to the main process rather than through `VersionControlService.restoreRevision`,
            // and the difference matters. That method wraps the rewrite in a freeze/thaw and then a
            // workspace-wide re-read, because in a normal workspace there are a dozen services
            // holding documents that the rewrite has just invalidated. Here there are none - that is
            // what a recovery shell is - and the re-read would walk a participant table full of
            // services that never initialized, reporting a failure per entry for work that did not
            // need doing.
            const result = await getInterface().vcs.restoreRevision(
                context!.project.getConfig().projectPath,
                selected,
                { label },
            );
            if (!result.success) {
                throw new Error(result.error);
            }
            if (result.data.recordFailure) {
                // The files ARE already replaced. Saying "restore failed" here would be false and
                // would send the author looking for their old files, which are now the new ones.
                setFeedback({
                    kind: "bad",
                    text: t("workspace.recovery.lore.restoreUnrecorded", { error: result.data.recordFailure }),
                });
                return;
            }
            setFeedback({ kind: "ok", text: t("workspace.recovery.lore.restoreDone", { version: label }) });
            // Back to an ordinary workspace: the project on disk is now a version that worked, and
            // leaving the author in a diagnostic shell in front of a healthy project would make them
            // find the way out themselves.
            await getInterface().workspace.setRecoveryMode(false);
        } catch (error) {
            setFeedback({
                kind: "bad",
                text: t("workspace.recovery.lore.restoreFailed", {
                    error: error instanceof Error ? error.message : String(error),
                }),
            });
        } finally {
            setBusy(false);
        }
    };

    const ready = state.kind === "ready";
    const disabled = busy || !ready;
    const selectedLabel = React.useMemo(() => {
        if (state.kind !== "ready" || !selected) {
            return "";
        }
        const entry = state.history.find(item => item.revision === selected);
        return entry ? `#${entry.number}` : selected.slice(0, 8);
    }, [state, selected]);

    return (
        <section className="px-3 py-3">
            <FieldLabel as="div">{t("workspace.recovery.lore.title")}</FieldLabel>

            {state.kind === "loading" && (
                <p className="text-xs text-fg-subtle">{t("workspace.recovery.lore.loading")}</p>
            )}

            {state.kind === "unavailable" && (
                <p className="nl-selectable-text mb-2 text-xs text-fg-subtle">
                    {t("workspace.recovery.lore.unavailable", { reason: state.reason })}
                </p>
            )}

            {ready && (
                <>
                    <p className="mb-2 text-xs text-fg-subtle">
                        {t("workspace.recovery.lore.head", {
                            version: state.head,
                            branch: state.branch || "-",
                        })}
                    </p>
                    <div className="mb-2 max-h-56 overflow-y-auto rounded-md border border-edge">
                        {state.history.length === 0 && (
                            <p className="px-2 py-2 text-xs text-fg-subtle">
                                {t("workspace.recovery.lore.emptyHistory")}
                            </p>
                        )}
                        {state.history.map(entry => (
                            <button
                                key={entry.revision}
                                type="button"
                                onClick={() => setSelected(entry.revision)}
                                className={cn(
                                    "flex w-full flex-col items-start gap-0.5 border-b border-edge-subtle px-2 py-1.5 text-left transition-colors duration-150 last:border-b-0 hover:bg-fill focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50",
                                    selected === entry.revision && "bg-primary/15",
                                )}
                            >
                                <span className="flex w-full items-baseline gap-2">
                                    <span className="font-mono text-xs text-fg">#{entry.number}</span>
                                    <span className="truncate text-xs text-fg-muted">
                                        {entry.message || t("workspace.recovery.lore.noMessage")}
                                    </span>
                                </span>
                                {entry.timestamp !== undefined && (
                                    <span className="text-2xs text-fg-subtle">
                                        {new Date(entry.timestamp).toLocaleString(locale)}
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                </>
            )}

            <div className="flex flex-wrap gap-2">
                <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleCheckpoint()}
                    disabled={disabled}
                    title={ready ? undefined : t("workspace.recovery.lore.disabledHint")}
                >
                    <Save className="h-3.5 w-3.5" aria-hidden />
                    <span>{t("workspace.recovery.lore.checkpoint")}</span>
                </Button>
                {confirming ? (
                    <>
                        <Button variant="danger" size="sm" onClick={() => void handleRestore()} disabled={busy}>
                            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                            <span>{t("workspace.recovery.lore.restoreConfirm", { version: selectedLabel })}</span>
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={busy}>
                            <span>{t("workspace.recovery.lore.cancel")}</span>
                        </Button>
                    </>
                ) : (
                    // Secondary until it is armed. `danger` is for the click that actually rewrites
                    // the project, and a permanently red button in a sidebar - louder still when
                    // greyed out, which is how most authors will first meet it - spends that signal
                    // on a control that so far does nothing.
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setConfirming(true)}
                        disabled={disabled || !selected}
                        title={ready ? undefined : t("workspace.recovery.lore.disabledHint")}
                    >
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                        <span>{t("workspace.recovery.lore.restore")}</span>
                    </Button>
                )}
            </div>

            {confirming && (
                <p className="mt-2 text-xs text-fg-subtle">
                    {t("workspace.recovery.lore.restoreExplain")}
                </p>
            )}

            {feedback && (
                <p
                    className={`nl-selectable-text mt-2 break-all text-xs ${feedback.kind === "ok" ? "text-fg-muted" : "text-danger"}`}
                    role="status"
                >
                    {feedback.text}
                </p>
            )}
        </section>
    );
}
