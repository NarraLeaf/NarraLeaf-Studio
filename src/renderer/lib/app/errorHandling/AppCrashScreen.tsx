import React from "react";
import { AlertCircle, ClipboardCheck, ClipboardCopy, RefreshCw, X } from "lucide-react";
import { getInterface } from "../bridge";
import { Button } from "@/lib/components/elements/Button";
import { TitleBar } from "@/lib/components/layout/TitleBar";
import { useTranslation } from "@/lib/i18n";
import { copyTextToClipboard } from "@shared/utils/copyText";
import { buildDiagnosticsFileName, buildDiagnosticsReport } from "../diagnostics/diagnosticsReport";
import { runCrashRecoveryFlush, type CrashFlushOutcome } from "./crashRecovery";

const REPORT_SCOPE = "renderer-crash";

interface AppCrashScreenProps {
    error: Error;
}

/** `transient` messages retire themselves; the export's saved-to path stays until something replaces it. */
type Feedback = { kind: "ok" | "bad"; text: string; transient?: boolean } | null;

/**
 * What a window shows in place of its interface once a render has failed.
 *
 * A render error used to end the whole application: the boundary at the root of every window
 * reported the failure and asked the main process to terminate, so a bug in one panel of one
 * project closed every other window, unsaved work included, behind a native error box quoting a
 * minified stack. This screen is what replaced that. It belongs to no app in particular - it is
 * mounted by the root boundary of all six windows - so everything on it goes through the base
 * bridge and none of it assumes a workspace, a project, or a service.
 *
 * Three things happen when it appears, in this order: the failure is already in the log (the
 * boundary put it there before rendering this), pending saves are written out, and the two ways
 * forward are offered. Reload is primary because a window rebuilt from disk is usually working
 * again; closing is the honest second answer.
 */
export function AppCrashScreen({ error }: AppCrashScreenProps) {
    const { t } = useTranslation();
    const [feedback, setFeedback] = React.useState<Feedback>(null);
    const [busy, setBusy] = React.useState(false);
    const [copied, setCopied] = React.useState(false);
    const [flush, setFlush] = React.useState<CrashFlushOutcome | "running">("running");

    // Held so the reload can wait for the save rather than racing it. A reload during the write
    // would discard exactly the changes this screen is trying to keep.
    const flushPromise = React.useRef<Promise<CrashFlushOutcome> | null>(null);

    const copiedTimer = React.useRef<number | null>(null);
    React.useEffect(() => () => {
        if (copiedTimer.current !== null) {
            window.clearTimeout(copiedTimer.current);
        }
    }, []);

    // Runs by itself, and immediately: the alternative is unsaved work that survives only as long
    // as the author leaves this screen open.
    React.useEffect(() => {
        const pending = runCrashRecoveryFlush();
        flushPromise.current = pending;
        let alive = true;
        void pending.then(outcome => {
            if (alive) {
                setFlush(outcome);
            }
        });
        return () => {
            alive = false;
        };
    }, []);

    /**
     * Answer the close guard and the quit-time save request in place of the tree that used to.
     *
     * Both handlers were registered by the workspace and were taken down with it when this screen
     * replaced it. Main keeps the window open when the close guard does not answer, so without
     * this the window whose interface just failed would also be a window that cannot be closed.
     */
    React.useEffect(() => {
        const closeToken = getInterface().workspace.onConfirmClose(async () => {
            await flushPromise.current;
            return { success: true, data: { confirmed: true } };
        });
        const flushToken = getInterface().workspace.onFlushPendingSaves(async () => {
            const outcome = await (flushPromise.current ?? runCrashRecoveryFlush());
            return { success: true, data: { flushed: outcome !== "failed" } };
        });
        return () => {
            closeToken.cancel();
            flushToken.cancel();
        };
    }, []);

    const buildReport = React.useCallback(() => buildDiagnosticsReport({
        scope: REPORT_SCOPE,
        error,
    }), [error]);

    const handleCopy = async () => {
        try {
            await copyTextToClipboard(buildReport());
            setCopied(true);
            setFeedback({ kind: "ok", text: t("crash.screen.copied"), transient: true });
            if (copiedTimer.current !== null) {
                window.clearTimeout(copiedTimer.current);
            }
            copiedTimer.current = window.setTimeout(() => {
                setCopied(false);
                setFeedback(current => (current?.transient ? null : current));
            }, 2500);
        } catch (copyError) {
            setFeedback({
                kind: "bad",
                text: t("crash.screen.copyFailed", {
                    error: copyError instanceof Error ? copyError.message : String(copyError),
                }),
            });
        }
    };

    const handleExport = async () => {
        setBusy(true);
        setFeedback(null);
        try {
            const result = await getInterface().app.exportDiagnostics(
                buildDiagnosticsFileName(REPORT_SCOPE),
                buildReport(),
            );
            if (!result.success) {
                setFeedback({ kind: "bad", text: t("crash.screen.exportFailed", { error: result.error ?? "" }) });
                return;
            }
            if (result.data.canceled) {
                return;
            }
            setFeedback({ kind: "ok", text: t("crash.screen.exported", { path: result.data.filePath ?? "" }) });
        } catch (exportError) {
            setFeedback({
                kind: "bad",
                text: t("crash.screen.exportFailed", {
                    error: exportError instanceof Error ? exportError.message : String(exportError),
                }),
            });
        } finally {
            setBusy(false);
        }
    };

    const handleReload = async () => {
        setBusy(true);
        await flushPromise.current;
        window.location.reload();
    };

    const handleClose = () => {
        setBusy(true);
        getInterface().window.close();
    };

    const flushMessage = flush === "saved"
        ? t("crash.screen.saved")
        : flush === "failed"
            ? t("crash.screen.saveFailed")
            : null;

    return (
        <div className="h-screen w-screen flex flex-col bg-surface text-fg">
            <TitleBar title="NarraLeaf Studio" iconSrc="/favicon.ico" />
            <div className="min-h-0 flex-1 overflow-auto flex items-center justify-center bg-surface p-6">
                <div className="w-full max-w-2xl">
                    <div className="flex items-center gap-3 mb-4">
                        <AlertCircle className="w-8 h-8 text-danger flex-shrink-0" />
                        <h1 className="text-2xl font-bold text-fg">{t("crash.screen.title")}</h1>
                    </div>

                    <p className="mb-4 text-sm text-fg-muted">{t("crash.screen.detail")}</p>

                    {/* Selectable on purpose: the app sets `user-select: none` globally, which is
                        right for an editor chrome and wrong for a screen whose whole content is a
                        message that has to be passed on. Copy acts on this box, so it sits on the
                        box rather than in the row where the two real decisions live. */}
                    <div className="group relative nl-selectable-text bg-danger/10 border border-danger/30 rounded-md p-4 mb-4">
                        <button
                            type="button"
                            onClick={() => void handleCopy()}
                            className="nl-focus-ring absolute right-2 top-2 rounded-md p-1.5 text-danger/70 opacity-0 transition-opacity hover:bg-danger/10 hover:text-danger group-hover:opacity-100 cursor-default"
                            data-tip={t("crash.screen.copyDetails")}
                            aria-label={t("crash.screen.copyDetails")}
                        >
                            {copied ? <ClipboardCheck className="h-4 w-4" /> : <ClipboardCopy className="h-4 w-4" />}
                        </button>
                        <p className="pr-8 text-sm text-danger font-mono whitespace-pre-wrap break-all">{error.message}</p>
                        {error.stack && (
                            <details className="mt-3">
                                <summary className="text-xs text-danger cursor-default hover:text-danger/80">
                                    {t("crash.screen.showStackTrace")}
                                </summary>
                                <pre className="text-xs text-danger mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all">
                                    {error.stack}
                                </pre>
                            </details>
                        )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <Button variant="primary" size="md" onClick={() => void handleReload()} disabled={busy}>
                            <RefreshCw className="w-4 h-4" />
                            <span>{t("crash.screen.reload")}</span>
                        </Button>
                        <Button variant="secondary" size="md" onClick={handleClose} disabled={busy}>
                            <X className="w-4 h-4" />
                            <span>{t("crash.screen.close")}</span>
                        </Button>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-1 text-xs text-fg-subtle">
                        <button
                            type="button"
                            onClick={() => void handleExport()}
                            disabled={busy}
                            className="nl-focus-ring rounded-md px-1 py-0.5 underline-offset-2 hover:text-fg hover:underline disabled:opacity-50 cursor-default"
                        >
                            {t("crash.screen.exportLogs")}
                        </button>
                    </div>

                    {flushMessage && (
                        <p className={`mt-3 text-xs ${flush === "failed" ? "text-danger" : "text-fg-subtle"}`} role="status">
                            {flushMessage}
                        </p>
                    )}

                    {feedback && (
                        <p
                            className={`nl-selectable-text mt-1 break-all text-xs ${feedback.kind === "ok" ? "text-fg-muted" : "text-danger"}`}
                            role="status"
                        >
                            {feedback.text}
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
