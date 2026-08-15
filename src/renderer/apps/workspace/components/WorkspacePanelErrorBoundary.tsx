import React, { useCallback, useMemo, useState } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { ErrorBoundary } from "@/lib/app/errorHandling/ErrorBoundary";
import { reportRendererError } from "@/lib/app/errorHandling/crashRecovery";
import type { ErrorFallbackProps } from "@/lib/app/errorHandling/errorHandling";
import { useTranslation } from "@/lib/i18n";

type WorkspacePanelErrorBoundaryProps = {
    children: React.ReactNode;
    /** Shown in the fallback to identify which region failed */
    regionLabel: string;
    /** When this changes (e.g. active tab id), error state is cleared via remount */
    isolationKey: string;
};

function createPanelErrorFallback(
    regionLabel: string,
    onRetry: () => void
): React.ComponentType<ErrorFallbackProps> {
    return function WorkspacePanelErrorFallback() {
        const { t } = useTranslation();
        return (
            <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-3 bg-surface p-4 text-center">
                <AlertCircle className="h-8 w-8 shrink-0 text-danger" aria-hidden />
                <div>
                    <p className="text-sm font-medium text-fg">{t("workspace.shell.panelRenderError")}</p>
                    <p className="mt-1 text-xs text-fg-subtle">{regionLabel}</p>
                </div>
                <button
                    type="button"
                    onClick={onRetry}
                    className="inline-flex h-9 cursor-default items-center gap-2 rounded-md bg-primary px-3 text-sm text-on-primary transition-colors hover:bg-primary/80"
                >
                    <RefreshCw className="h-4 w-4" aria-hidden />
                    {t("workspace.shell.retry")}
                </button>
            </div>
        );
    };
}

/**
 * Isolates workspace panel/editor render errors so one failing region does not replace the whole
 * window with the crash screen. Supports retry via remount.
 *
 * The failure is reported before the fallback draws. Without that it was recorded nowhere at all:
 * the panel showed its message, the author retried, and the only trace of what actually broke was
 * a component that had already been unmounted.
 */
export function WorkspacePanelErrorBoundary({
    children,
    regionLabel,
    isolationKey,
}: WorkspacePanelErrorBoundaryProps) {
    const [retryNonce, setRetryNonce] = useState(0);
    const remountKey = `${isolationKey}:${retryNonce}`;

    const handleRetry = useCallback(() => {
        setRetryNonce(n => n + 1);
    }, []);

    const handleError = useCallback((error: Error, info: { componentStack: string }) => {
        reportRendererError({
            source: "panel",
            label: regionLabel,
            error,
            componentStack: info.componentStack,
        });
    }, [regionLabel]);

    const Fallback = useMemo(
        () => createPanelErrorFallback(regionLabel, handleRetry),
        [regionLabel, handleRetry]
    );

    return (
        <ErrorBoundary key={remountKey} fallback={Fallback} onError={handleError}>
            {children}
        </ErrorBoundary>
    );
}
