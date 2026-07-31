import React from "react";
import { AlertCircle, ClipboardCheck, ClipboardCopy, FileDown, FolderOpen, LogOut, RefreshCw } from "lucide-react";
import { getInterface } from "@/lib/app/bridge";
import { Button, TitleBar } from "@/lib/components";
import { useTranslation } from "@/lib/i18n";
import { WindowAppType } from "@shared/types/window";
import { copyTextToClipboard } from "@/lib/app/diagnostics/copyText";
import { buildDiagnosticsFileName, buildDiagnosticsReport } from "@/lib/app/diagnostics/diagnosticsReport";

interface ErrorScreenProps {
    error: Error;
    onRetry?: () => void;
}

const REPORT_SCOPE = "workspace-init";

type Feedback = { kind: "ok" | "bad"; text: string } | null;

/**
 * What the workspace shows when it could not start.
 *
 * This screen used to be a dead end: the error text, a disclosure triangle, and nothing else - no
 * way out of the window, no way to try again, and (because Studio turns text selection off
 * globally) no way to even copy the message it was showing. Whoever hit it could read the failure
 * and do nothing about it.
 *
 * So it now carries the three ways out that always apply - try again, open a different project, go
 * back to the launcher - plus the two ways to take the failure with you: the message and stack on
 * the clipboard, or a full support bundle (this window's console plus the main-process log) in a
 * file. Everything here goes through the base app bridge rather than a workspace service, because
 * by definition no workspace service came up.
 */
export function ErrorScreen({ error, onRetry }: ErrorScreenProps) {
    const { t } = useTranslation();
    const [projectPath, setProjectPath] = React.useState<string | null>(null);
    const [feedback, setFeedback] = React.useState<Feedback>(null);
    const [busy, setBusy] = React.useState(false);

    // The project path is the single most useful fact about this failure, and it does NOT come from
    // the workspace context - that is what failed to build. It is read straight off the window's
    // own props, which exist before any service does.
    React.useEffect(() => {
        let alive = true;
        void (async () => {
            try {
                const props = await getInterface().getWindowProps<WindowAppType.Workspace>();
                if (alive && props.success) {
                    setProjectPath(props.data.projectPath ?? null);
                }
            } catch {
                // A window that cannot even answer what it was opened with still shows the error.
            }
        })();
        return () => {
            alive = false;
        };
    }, []);

    const buildReport = React.useCallback(() => buildDiagnosticsReport({
        scope: REPORT_SCOPE,
        error,
        facts: {
            "Project path": projectPath,
            "Window": WindowAppType.Workspace,
        },
    }), [error, projectPath]);

    const handleCopy = async () => {
        try {
            await copyTextToClipboard(buildReport());
            setFeedback({ kind: "ok", text: t("workspace.shell.errorCopied") });
        } catch (copyError) {
            setFeedback({
                kind: "bad",
                text: t("workspace.shell.errorCopyFailed", {
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
                setFeedback({ kind: "bad", text: t("workspace.shell.errorExportFailed", { error: result.error ?? "" }) });
                return;
            }
            if (result.data.canceled) {
                return;
            }
            setFeedback({ kind: "ok", text: t("workspace.shell.errorExported", { path: result.data.filePath ?? "" }) });
        } catch (exportError) {
            setFeedback({
                kind: "bad",
                text: t("workspace.shell.errorExportFailed", {
                    error: exportError instanceof Error ? exportError.message : String(exportError),
                }),
            });
        } finally {
            setBusy(false);
        }
    };

    // Replaces this window rather than opening beside it: the user is standing in a window that
    // holds nothing, and leaving it behind would only make them close it afterwards.
    const handleOpenOther = async () => {
        setBusy(true);
        setFeedback(null);
        try {
            const picked = await getInterface().selectFolder();
            if (!picked.success || !picked.data.path) {
                return;
            }
            await getInterface().workspace.openRecent(picked.data.path, true);
        } catch (openError) {
            setFeedback({
                kind: "bad",
                text: t("workspace.shell.errorOpenFailed", {
                    error: openError instanceof Error ? openError.message : String(openError),
                }),
            });
        } finally {
            setBusy(false);
        }
    };

    const handleOpenLauncher = () => {
        void getInterface().workspace.close();
    };

    return (
        <div className="h-screen w-screen flex flex-col bg-surface text-fg">
            <TitleBar title="NarraLeaf Studio" iconSrc="/favicon.ico" />
            <div className="min-h-0 flex-1 overflow-auto flex items-center justify-center bg-surface p-6">
                <div className="w-full max-w-2xl">
                    <div className="flex items-center gap-3 mb-4">
                        <AlertCircle className="w-8 h-8 text-danger flex-shrink-0" />
                        <h1 className="text-2xl font-bold text-fg">{t("workspace.shell.errorTitle")}</h1>
                    </div>

                    {projectPath && (
                        <p className="nl-selectable-text mb-3 break-all font-mono text-xs text-fg-subtle">
                            {projectPath}
                        </p>
                    )}

                    {/* Selectable on purpose. The app sets `user-select: none` globally, which is
                        right for an editor chrome and wrong for the one screen whose entire content
                        is a message the user has to pass on. */}
                    <div className="nl-selectable-text bg-danger/10 border border-danger/30 rounded-lg p-4 mb-4">
                        <p className="text-sm text-danger font-mono whitespace-pre-wrap break-all">{error.message}</p>
                        {error.stack && (
                            <details className="mt-3">
                                <summary className="text-xs text-danger cursor-default hover:text-danger/80">
                                    {t("workspace.shell.showStackTrace")}
                                </summary>
                                <pre className="text-xs text-danger mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all">
                                    {error.stack}
                                </pre>
                            </details>
                        )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                        {onRetry && (
                            <Button variant="primary" size="md" onClick={onRetry} disabled={busy}>
                                <RefreshCw className="w-4 h-4" />
                                <span>{t("workspace.shell.retry")}</span>
                            </Button>
                        )}
                        <Button variant="secondary" size="md" onClick={() => void handleOpenOther()} disabled={busy}>
                            <FolderOpen className="w-4 h-4" />
                            <span>{t("workspace.shell.openOtherProject")}</span>
                        </Button>
                        <Button variant="secondary" size="md" onClick={handleOpenLauncher} disabled={busy}>
                            <LogOut className="w-4 h-4" />
                            <span>{t("workspace.shell.openLauncher")}</span>
                        </Button>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2">
                        <Button variant="ghost" size="md" onClick={() => void handleCopy()} disabled={busy}>
                            {feedback?.kind === "ok" ? <ClipboardCheck className="w-4 h-4" /> : <ClipboardCopy className="w-4 h-4" />}
                            <span>{t("workspace.shell.errorCopyDetails")}</span>
                        </Button>
                        <Button variant="ghost" size="md" onClick={() => void handleExport()} disabled={busy}>
                            <FileDown className="w-4 h-4" />
                            <span>{t("workspace.shell.errorExportLogs")}</span>
                        </Button>
                    </div>

                    {feedback && (
                        <p
                            className={`nl-selectable-text mt-3 break-all text-xs ${feedback.kind === "ok" ? "text-fg-muted" : "text-danger"}`}
                            role="status"
                        >
                            {feedback.text}
                        </p>
                    )}

                    <p className="mt-4 text-xs text-fg-subtle">
                        {t("workspace.shell.errorConsoleHint")}
                    </p>
                </div>
            </div>
        </div>
    );
}
