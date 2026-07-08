import React, { useCallback, useMemo, useState } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { ErrorBoundary } from "@/lib/app/errorHandling/ErrorBoundary";
import type { ErrorFallbackProps } from "@/lib/app/errorHandling/errorHandling";

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
        return (
            <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-3 bg-surface p-4 text-center">
                <AlertCircle className="h-8 w-8 shrink-0 text-red-400" aria-hidden />
                <div>
                    <p className="text-sm font-medium text-white">This panel hit a rendering error</p>
                    <p className="mt-1 text-xs text-fg-subtle">{regionLabel}</p>
                </div>
                <button
                    type="button"
                    onClick={onRetry}
                    className="inline-flex h-9 cursor-default items-center gap-2 rounded-md bg-primary px-3 text-sm text-white transition-colors hover:bg-primary/80"
                >
                    <RefreshCw className="h-4 w-4" aria-hidden />
                    Retry
                </button>
            </div>
        );
    };
}

/**
 * Isolates workspace panel/editor render errors so they do not reach CriticalErrorBoundary
 * (which terminates the renderer). Supports retry via remount.
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

    const Fallback = useMemo(
        () => createPanelErrorFallback(regionLabel, handleRetry),
        [regionLabel, handleRetry]
    );

    return (
        <ErrorBoundary key={remountKey} fallback={Fallback}>
            {children}
        </ErrorBoundary>
    );
}
