import React from "react";
import {
    AlertTriangle,
    CheckCircle2,
    ClipboardCheck,
    ClipboardCopy,
    FolderOpen,
    LifeBuoy,
    Loader2,
    Play,
    XCircle,
} from "lucide-react";
import { Button } from "@/lib/components";
import { useTranslation } from "@/lib/i18n";
import { getInterface } from "@/lib/app/bridge";
import { copyTextToClipboard } from "@/lib/app/diagnostics/copyText";
import { buildDiagnosticsFileName, buildDiagnosticsReport } from "@/lib/app/diagnostics/diagnosticsReport";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import type { RecoveryService, RecoveryProbeState } from "@/lib/workspace/services/core/RecoveryService";
import type { WorkspaceAnomaly } from "@/lib/workspace/recovery/anomalyLog";
import { useRecoveryProbes, useWorkspaceAnomalyList } from "./useRecoveryState";
import { RecoveryLoreSection } from "./RecoveryLoreSection";

const REPORT_SCOPE = "workspace-recovery";

type Feedback = { kind: "ok" | "bad"; text: string } | null;

/**
 * The recovery sidebar.
 *
 * Four things, in the order somebody standing in a broken project actually wants them: what went
 * wrong (verbatim), what still works (the probes), how to get the evidence out of Studio, and how to
 * put the project back from history.
 *
 * The raw text is the deliberate part. Everywhere else Studio turns an error into a sentence an
 * author can act on, which is right - but that translation is lossy, and the loss is precisely the
 * information a *diagnosis* runs on. "This project's characters could not be read" is a good
 * notification and a useless clue; the parse position, the fs error code and the file path are the
 * clue. So this panel does the opposite of the rest of the application on purpose.
 */
export function RecoveryPanel({
    context,
    projectPath,
}: {
    context: WorkspaceContext | null;
    projectPath: string;
}) {
    const { t } = useTranslation();
    const anomalies = useWorkspaceAnomalyList();
    const { probes, running } = useRecoveryProbes(context);
    const [feedback, setFeedback] = React.useState<Feedback>(null);
    const [busy, setBusy] = React.useState(false);

    const recoveryService = React.useMemo(
        () => (context ? context.services.get<RecoveryService>(Services.Recovery) : null),
        [context],
    );

    /**
     * The whole session as one block of text: every anomaly and every probe result.
     *
     * Built once and used by both the clipboard button and the log export, so what the author pastes
     * into an issue and what they attach to it are the same thing. `buildDiagnosticsReport` adds the
     * environment header and the export adds the main-process log on top.
     */
    const buildReport = React.useCallback(() => {
        const lines: string[] = [];
        lines.push(`Anomalies: ${anomalies.length}`);
        for (const anomaly of anomalies) {
            lines.push("");
            lines.push(`--- [${anomaly.severity}] ${anomaly.source} / ${anomaly.operationKey}`);
            if (anomaly.path) {
                lines.push(`Path: ${anomaly.path}`);
            }
            lines.push(anomaly.raw);
        }
        lines.push("");
        lines.push("Load checks:");
        for (const probe of probes) {
            lines.push(`  ${probe.id}: ${probe.status}`);
            if (probe.raw) {
                lines.push(indent(probe.raw));
            }
        }
        return buildDiagnosticsReport({
            scope: REPORT_SCOPE,
            facts: { "Project path": projectPath },
            details: lines.join("\n"),
        });
    }, [anomalies, probes, projectPath]);

    const handleCopyAll = async () => {
        try {
            await copyTextToClipboard(buildReport());
            setFeedback({ kind: "ok", text: t("workspace.recovery.copied") });
        } catch (error) {
            setFeedback({
                kind: "bad",
                text: t("workspace.shell.errorCopyFailed", {
                    error: error instanceof Error ? error.message : String(error),
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
        } catch (error) {
            setFeedback({
                kind: "bad",
                text: t("workspace.shell.errorExportFailed", {
                    error: error instanceof Error ? error.message : String(error),
                }),
            });
        } finally {
            setBusy(false);
        }
    };

    const handleOpenFolder = async () => {
        setFeedback(null);
        try {
            const result = await getInterface().workspace.openProjectFolder();
            if (!result.success) {
                setFeedback({ kind: "bad", text: t("workspace.recovery.openFolderFailed", { error: result.error ?? "" }) });
            }
        } catch (error) {
            setFeedback({
                kind: "bad",
                text: t("workspace.recovery.openFolderFailed", {
                    error: error instanceof Error ? error.message : String(error),
                }),
            });
        }
    };

    return (
        <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-surface">
            <header className="border-b border-edge px-3 py-3">
                <h1 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
                    <LifeBuoy className="h-4 w-4 text-warning" aria-hidden />
                    {t("workspace.recovery.title")}
                </h1>
                <p className="mt-1 text-xs text-fg-subtle">{t("workspace.recovery.subtitle")}</p>
                <p className="nl-selectable-text mt-2 break-all font-mono text-[11px] text-fg-subtle">
                    {projectPath}
                </p>
            </header>

            <section className="border-b border-edge px-3 py-3">
                <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                    {t("workspace.recovery.anomalies.title", { count: anomalies.length })}
                </h2>
                {anomalies.length === 0 ? (
                    <p className="text-xs text-fg-subtle">{t("workspace.recovery.anomalies.empty")}</p>
                ) : (
                    <ul className="flex flex-col gap-2">
                        {anomalies.map(anomaly => (
                            <AnomalyRow key={anomaly.id} anomaly={anomaly} />
                        ))}
                    </ul>
                )}
            </section>

            <section className="border-b border-edge px-3 py-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
                        {t("workspace.recovery.probes.title")}
                    </h2>
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void recoveryService?.runAllProbes()}
                        disabled={running || !recoveryService}
                    >
                        <Play className="h-3.5 w-3.5" aria-hidden />
                        <span>{t("workspace.recovery.probes.runAll")}</span>
                    </Button>
                </div>
                {/* Said once, above the list, rather than as a tooltip on ten buttons: it is the one
                    thing about this section that is not obvious from looking at it - and it retires
                    as soon as a row has an answer, because a line insisting nothing has been loaded
                    over a list of ticks and crosses reads as the panel not knowing its own state. */}
                {probes.some(probe => probe.status === "untried") && (
                    <p className="mb-2 text-xs text-fg-subtle">{t("workspace.recovery.probes.hint")}</p>
                )}
                <ul className="flex flex-col">
                    {probes.map(probe => (
                        <ProbeRow
                            key={probe.id}
                            probe={probe}
                            busy={running}
                            onRun={() => void recoveryService?.runProbe(probe.id)}
                        />
                    ))}
                </ul>
            </section>

            <section className="border-b border-edge px-3 py-3">
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
                    {t("workspace.recovery.tools.title")}
                </h2>
                <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" size="sm" onClick={() => void handleExport()} disabled={busy}>
                        <span>{t("workspace.shell.errorExportLogs")}</span>
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => void handleOpenFolder()}>
                        <FolderOpen className="h-3.5 w-3.5" aria-hidden />
                        <span>{t("workspace.recovery.tools.openFolder")}</span>
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => void handleCopyAll()}>
                        <ClipboardCopy className="h-3.5 w-3.5" aria-hidden />
                        <span>{t("workspace.recovery.tools.copyAll")}</span>
                    </Button>
                </div>
                {feedback && (
                    <p
                        className={`nl-selectable-text mt-2 break-all text-xs ${feedback.kind === "ok" ? "text-fg-muted" : "text-danger"}`}
                        role="status"
                    >
                        {feedback.text}
                    </p>
                )}
            </section>

            <RecoveryLoreSection context={context} />
        </div>
    );
}

/** One raw failure. Collapsed to its heading until asked, because the raw text is long by design. */
function AnomalyRow({ anomaly }: { anomaly: WorkspaceAnomaly }) {
    const { t } = useTranslation();
    const [copied, setCopied] = React.useState(false);
    const timer = React.useRef<number | null>(null);
    React.useEffect(() => () => {
        if (timer.current !== null) {
            window.clearTimeout(timer.current);
        }
    }, []);

    const copy = async () => {
        const text = [
            `[${anomaly.severity}] ${anomaly.source}`,
            anomaly.path ? `Path: ${anomaly.path}` : null,
            anomaly.raw,
        ].filter(Boolean).join("\n");
        try {
            await copyTextToClipboard(text);
            setCopied(true);
            if (timer.current !== null) {
                window.clearTimeout(timer.current);
            }
            timer.current = window.setTimeout(() => setCopied(false), 2500);
        } catch {
            // The text is on screen and selectable; a failed clipboard is not worth a second error.
        }
    };

    return (
        <li className="group relative rounded-md border border-danger/30 bg-danger/5 px-2 py-1.5">
            <button
                type="button"
                onClick={() => void copy()}
                className="absolute right-1 top-1 cursor-default rounded p-1 text-danger/70 opacity-0 transition-opacity hover:bg-danger/10 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                aria-label={t("workspace.shell.errorCopyDetails")}
                title={t("workspace.shell.errorCopyDetails")}
            >
                {copied ? <ClipboardCheck className="h-3.5 w-3.5" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
            </button>
            <p className="pr-7 text-xs font-medium text-fg">{t(anomaly.operationKey)}</p>
            {anomaly.path && (
                <p className="nl-selectable-text mt-0.5 break-all font-mono text-[11px] text-fg-subtle">
                    {anomaly.path}
                </p>
            )}
            <details className="mt-1">
                <summary className="cursor-default text-[11px] text-danger hover:text-danger/80">
                    {t("workspace.recovery.anomalies.showRaw")}
                </summary>
                <pre className="nl-selectable-text mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-all text-[11px] text-danger">
                    {anomaly.raw}
                </pre>
            </details>
        </li>
    );
}

function ProbeRow({
    probe,
    busy,
    onRun,
}: {
    probe: RecoveryProbeState;
    busy: boolean;
    onRun: () => void;
}) {
    const { t } = useTranslation();
    return (
        <li className="border-b border-edge/60 py-1.5 last:border-b-0">
            <div className="flex items-center gap-2">
                <ProbeStatusIcon status={probe.status} />
                <span className="min-w-0 flex-1 truncate text-xs text-fg">{t(probe.labelKey)}</span>
                <button
                    type="button"
                    onClick={onRun}
                    disabled={busy}
                    className="cursor-default rounded px-1.5 py-0.5 text-[11px] text-fg-subtle hover:bg-fill hover:text-fg disabled:opacity-40"
                >
                    {probe.status === "untried"
                        ? t("workspace.recovery.probes.run")
                        : t("workspace.recovery.probes.rerun")}
                </button>
            </div>
            {probe.detail && (
                <p className="ml-6 mt-0.5 text-[11px] text-fg-subtle">{t(probe.detail.key, probe.detail.params)}</p>
            )}
            {probe.raw && (
                <pre className="nl-selectable-text ml-6 mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded border border-danger/30 bg-danger/5 p-1.5 text-[11px] text-danger">
                    {probe.raw}
                </pre>
            )}
        </li>
    );
}

function ProbeStatusIcon({ status }: { status: RecoveryProbeState["status"] }) {
    switch (status) {
        case "running":
            return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-fg-subtle" aria-hidden />;
        case "ok":
            return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden />;
        case "failed":
            return <XCircle className="h-3.5 w-3.5 shrink-0 text-danger" aria-hidden />;
        default:
            return <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-edge-strong" aria-hidden />;
    }
}

function indent(text: string): string {
    return text.split("\n").map(line => `    ${line}`).join("\n");
}
