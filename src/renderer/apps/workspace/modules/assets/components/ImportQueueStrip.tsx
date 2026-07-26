import { RotateCcw, X } from "lucide-react";
import { basename } from "@shared/utils/path";
import { Progress } from "@/lib/components/elements/Progress";
import { useTranslation } from "@/lib/i18n";
import type { ImportQueueState } from "../state/useImportQueue";

/**
 * The import strip: how far a multi-file import has got while it runs, and which files it could not
 * read once it stops.
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
                <ul className="mt-1 max-h-24 overflow-y-auto space-y-0.5">
                    {state.failures.map(failure => (
                        <li
                            key={failure.path}
                            className="text-xs text-fg-subtle truncate"
                            title={failure.error ? `${failure.path}\n${failure.error}` : failure.path}
                        >
                            {basename(failure.path)}
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
