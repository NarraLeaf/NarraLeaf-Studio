import { RotateCcw, X } from "lucide-react";
import { basename } from "@shared/utils/path";
import { Progress } from "@/lib/components/elements/Progress";
import { useTranslation } from "@/lib/i18n";
import type { ImportQueueState } from "../state/useImportQueue";

/**
 * The import strip: how far a multi-file import has got while it runs, and which files it could not
 * read once it stops — each with the reason it was turned away, since a per-file refusal is reported
 * nowhere else (only a whole bucket falling over raises an alert).
 *
 * It is a row inside the panel, not a floating layer — a drop of twenty files is part of working in
 * the panel, and an overlay would cover the tree the author is dropping onto. It shows nothing at
 * all when there is nothing to report.
 */
export function ImportQueueStrip({
    state,
    onRetry,
    onDismiss,
}: {
    state: ImportQueueState;
    onRetry: () => void;
    onDismiss: () => void;
}) {
    const { t, tn } = useTranslation();

    if (!state.running && state.failures.length === 0) {
        return null;
    }

    const total = state.run?.total ?? 0;

    if (state.running) {
        return (
            <div className="px-3 py-2 border-b border-edge space-y-1">
                <div className="flex items-center justify-between gap-2 text-xs text-fg-muted">
                    <span className="truncate" title={state.current}>
                        {state.current ? basename(state.current) : ""}
                    </span>
                    <span className="shrink-0 tabular-nums">{state.completed} / {total}</span>
                </div>
                <Progress value={state.completed} max={Math.max(total, 1)} size="sm" animated={false} />
            </div>
        );
    }

    return (
        <div className="px-3 py-2 border-b border-edge flex items-start gap-2">
            <div className="min-w-0 flex-1">
                <span className="text-xs text-danger">
                    {tn("assets.import.failedCount", state.failures.length)}
                </span>
                {/*
                  * Two lines per failure, name over reason, with the gap between entries carrying
                  * the grouping. The reason used to live only in `title=`, which for a refusal the
                  * author can act on ("convert this to .mp4 first") is the same as not saying it:
                  * the list scrolls, so hovering is not a reading strategy. `title=` is kept for the
                  * full path, which is the part that does not fit.
                  */}
                <ul className="mt-1 max-h-32 overflow-y-auto space-y-1">
                    {state.failures.map(failure => (
                        <li
                            key={failure.path}
                            title={failure.error ? `${failure.path}\n${failure.error}` : failure.path}
                        >
                            <div className="text-xs text-fg-subtle truncate">
                                {basename(failure.path)}
                            </div>
                            {failure.error ? (
                                // Wraps rather than truncating — a reason cut off at the panel edge
                                // loses exactly the instruction at its end.
                                <div className="text-2xs text-fg-muted break-words">
                                    {failure.error}
                                </div>
                            ) : null}
                        </li>
                    ))}
                </ul>
            </div>
            <div className="flex items-center gap-1 shrink-0">
                <button
                    type="button"
                    onClick={onRetry}
                    title={t("assets.import.retry")}
                    className="h-7 px-2 flex items-center gap-1 rounded-md border border-edge-strong bg-fill-subtle text-xs text-fg-muted hover:bg-fill transition-colors"
                >
                    <RotateCcw className="w-3 h-3" />
                    <span>{t("assets.import.retry")}</span>
                </button>
                <button
                    type="button"
                    onClick={onDismiss}
                    title={t("common.close")}
                    className="h-7 w-7 flex items-center justify-center rounded-md text-fg-muted hover:bg-fill transition-colors"
                >
                    <X className="w-3.5 h-3.5" />
                </button>
            </div>
        </div>
    );
}
