import React from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { TitleBar } from "@/lib/components";
import { useTranslation } from "@/lib/i18n";

interface ErrorScreenProps {
    error: Error;
    onRetry?: () => void;
}

/**
 * Error screen component
 * Displayed when workspace fails to initialize
 */
export function ErrorScreen({ error, onRetry }: ErrorScreenProps) {
    const { t } = useTranslation();
    return (
        <div className="h-screen w-screen flex flex-col bg-surface text-fg">
            <TitleBar title="NarraLeaf Studio" iconSrc="/favicon.ico" />
            <div className="h-screen w-screen flex items-center justify-center bg-surface p-6">
                <div className="max-w-md">
                    <div className="flex items-center gap-3 mb-4">
                        <AlertCircle className="w-8 h-8 text-danger flex-shrink-0" />
                        <h1 className="text-2xl font-bold text-fg">{t("workspace.shell.errorTitle")}</h1>
                    </div>

                    <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 mb-6">
                        <p className="text-sm text-danger font-mono">{error.message}</p>
                        {error.stack && (
                            <details className="mt-3">
                                <summary className="text-xs text-danger cursor-default hover:text-danger/80">
                                    {t("workspace.shell.showStackTrace")}
                                </summary>
                                <pre className="text-xs text-danger mt-2 overflow-auto max-h-40">
                                    {error.stack}
                                </pre>
                            </details>
                        )}
                    </div>

                    {onRetry && (
                        <button
                            onClick={onRetry}
                            className="w-full h-10 flex items-center justify-center gap-2 bg-primary hover:bg-primary/80 text-white rounded-md transition-colors cursor-default"
                        >
                            <RefreshCw className="w-4 h-4" />
                            <span>{t("workspace.shell.retry")}</span>
                        </button>
                    )}

                    <p className="text-xs text-fg-subtle mt-4 text-center">
                        {t("workspace.shell.errorConsoleHint")}
                    </p>
                </div>
            </div>
        </div>
    );
}

