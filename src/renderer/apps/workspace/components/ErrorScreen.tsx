import React from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { TitleBar } from "@/lib/components";

interface ErrorScreenProps {
    error: Error;
    onRetry?: () => void;
}

/**
 * Error screen component
 * Displayed when workspace fails to initialize
 */
export function ErrorScreen({ error, onRetry }: ErrorScreenProps) {
    return (
        <div className="h-screen w-screen flex flex-col bg-[#0f1115] text-gray-200">
            <TitleBar title="NarraLeaf Studio" iconSrc="/favicon.ico" />
            <div className="h-screen w-screen flex items-center justify-center bg-[#0f1115] p-6">
                <div className="max-w-md">
                    <div className="flex items-center gap-3 mb-4">
                        <AlertCircle className="w-8 h-8 text-red-400 flex-shrink-0" />
                        <h1 className="text-2xl font-bold text-white">Failed to Initialize Workspace</h1>
                    </div>

                    <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-6">
                        <p className="text-sm text-red-300 font-mono">{error.message}</p>
                        {error.stack && (
                            <details className="mt-3">
                                <summary className="text-xs text-red-400 cursor-default hover:text-red-300">
                                    Show stack trace
                                </summary>
                                <pre className="text-xs text-red-400 mt-2 overflow-auto max-h-40">
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
                            <span>Retry</span>
                        </button>
                    )}

                    <p className="text-xs text-gray-500 mt-4 text-center">
                        If the problem persists, please check the console for more details.
                    </p>
                </div>
            </div>
        </div>
    );
}

