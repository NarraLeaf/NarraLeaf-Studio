import React from "react";
import { Check, CircleAlert, CircleCheck, CircleX, Copy, FolderOpen, Loader2 } from "lucide-react";
import { Badge, Button, FieldLabel } from "@/lib/components";
import { HelpTrigger } from "@/lib/help";
import { useTranslation } from "@/lib/i18n";
import { getInterface } from "@/lib/app/bridge";
import { copyTextToClipboard } from "@shared/utils/copyText";
import { buildDiagnosticsFileName, buildDiagnosticsReport } from "@/lib/app/diagnostics/diagnosticsReport";
import { Services } from "@/lib/workspace/services/services";
import type { RecoveryService, RecoveryProbeState } from "@/lib/workspace/services/core/RecoveryService";
import type { WorkspaceAnomaly } from "@/lib/workspace/recovery/anomalyLog";
import { useWorkspace } from "../context";
import { useRecoveryProbes, useWorkspaceAnomalyList } from "./useRecoveryState";
import { RecoveryLoreSection } from "./RecoveryLoreSection";

const REPORT_SCOPE = "workspace-recovery";

type Feedback = { kind: "ok" | "bad"; text: string } | null;

/**
 * The recovery panel: what went wrong, what still loads, and how to put it back.
 *
 * An ordinary left-dock panel rather than a screen of its own, which is the point: the rest of the
 * sidebar keeps working, so a subsystem that loads can be browsed with the panels the author already
 * knows. This one is simply the first among them.
 *
 * The raw error text is the deliberate exception to how the rest of Studio talks. Everywhere else an
 * error becomes a sentence the author can act on, and that translation drops precisely what a
 * diagnosis runs on: the parse position, the fs code, the path. Those are shown untouched.
 */
export function RecoveryPanel() {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const anomalies = useWorkspaceAnomalyList();
    const { probes, running } = useRecoveryProbes(context);
    const [feedback, setFeedback] = React.useState<Feedback>(null);
    const [busy, setBusy] = React.useState(false);

    const recoveryService = React.useMemo(
        () => (context ? context.services.get<RecoveryService>(Services.Recovery) : null),
        [context],
    );
    const projectPath = context?.project.getConfig().projectPath ?? "";

    /**
     * The whole session as one block of text: every anomaly and every check.
     *
     * Built once and used by both the clipboard button and the log export, so what the author pastes
     * into an issue and what they attach to it are the same thing.
     */
    const buildReport = React.useCallback(() => {
        const lines: string[] = [`Anomalies: ${anomalies.length}`];
        for (const anomaly of anomalies) {
            lines.push("", `[${anomaly.severity}] ${anomaly.source} / ${anomaly.operationKey}`);
            if (anomaly.path) {
                lines.push(`Path: ${anomaly.path}`);
            }
            lines.push(anomaly.raw);
        }
        lines.push("", "Load checks:");
        for (const probe of probes) {
            lines.push(`  ${probe.id}: ${probe.status}`);
            if (probe.raw) {
                lines.push(probe.raw.split("\n").map(line => `    ${line}`).join("\n"));
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
            setFeedback({ kind: "ok", text: t("workspace.recovery.tools.copiedAll") });
        } catch (error) {
            setFeedback({ kind: "bad", text: t("workspace.shell.errorCopyFailed", { error: message(error) }) });
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
            if (!result.data.canceled) {
                setFeedback({ kind: "ok", text: t("workspace.shell.errorExported", { path: result.data.filePath ?? "" }) });
            }
        } catch (error) {
            setFeedback({ kind: "bad", text: t("workspace.shell.errorExportFailed", { error: message(error) }) });
        } finally {
            setBusy(false);
        }
    };

    const handleOpenFolder = async () => {
        setFeedback(null);
        try {
            const result = await getInterface().workspace.openProjectFolder();
            if (!result.success) {
                setFeedback({ kind: "bad", text: t("workspace.recovery.tools.openFolderFailed", { error: result.error ?? "" }) });
            }
        } catch (error) {
            setFeedback({ kind: "bad", text: t("workspace.recovery.tools.openFolderFailed", { error: message(error) }) });
        }
    };

    return (
        <div className="flex h-full min-h-0 flex-col overflow-y-auto">
            <section className="border-b border-edge-subtle px-3 py-3">
                <div className="group/help mb-2 flex items-center gap-2">
                    <FieldLabel as="div" className="mb-0">{t("workspace.recovery.problems.title")}</FieldLabel>
                    <Badge tone={anomalies.length > 0 ? "danger" : "neutral"}>{anomalies.length}</Badge>
                    {/* An author reaches this window from a failure, not from a menu, so the one
                        question that needs answering here is what this mode is. */}
                    <HelpTrigger topic="recovery" className="ml-auto" />
                </div>
                {anomalies.length === 0 ? (
                    <p className="text-xs text-fg-subtle">{t("workspace.recovery.problems.empty")}</p>
                ) : (
                    <ul className="flex flex-col gap-2">
                        {anomalies.map(anomaly => <AnomalyRow key={anomaly.id} anomaly={anomaly} />)}
                    </ul>
                )}
            </section>

            <section className="border-b border-edge-subtle px-3 py-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                    <FieldLabel as="div" className="mb-0">{t("workspace.recovery.probes.title")}</FieldLabel>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void recoveryService?.runAllProbes()}
                        disabled={running || !recoveryService}
                    >
                        {t("workspace.recovery.probes.runAll")}
                    </Button>
                </div>
                <p className="mb-2 text-xs text-fg-subtle">{t("workspace.recovery.intro")}</p>
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

            <section className="border-b border-edge-subtle px-3 py-3">
                <FieldLabel as="div">{t("workspace.recovery.tools.title")}</FieldLabel>
                <div className="flex flex-wrap gap-1.5">
                    <Button variant="secondary" size="sm" onClick={() => void handleExport()} disabled={busy}>
                        {t("workspace.shell.errorExportLogs")}
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => void handleOpenFolder()}>
                        <FolderOpen className="h-3.5 w-3.5" aria-hidden />
                        <span>{t("workspace.recovery.tools.openFolder")}</span>
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => void handleCopyAll()}>
                        <Copy className="h-3.5 w-3.5" aria-hidden />
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

/** One raw failure. Collapsed to its heading until asked: the raw text is long by design. */
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
            timer.current = window.setTimeout(() => setCopied(false), 2000);
        } catch {
            // The text is on screen and selectable; a failed clipboard is not worth a second error.
        }
    };

    return (
        <li className="group relative rounded-md border border-edge bg-fill-subtle px-2 py-1.5">
            <button
                type="button"
                onClick={() => void copy()}
                className="absolute right-1 top-1 rounded-md p-1 text-fg-subtle opacity-0 transition-colors duration-150 hover:bg-fill hover:text-fg focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50 group-hover:opacity-100"
                aria-label={t("workspace.recovery.problems.copy")}
                title={copied ? t("workspace.recovery.problems.copied") : t("workspace.recovery.problems.copy")}
            >
                {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
            <p className="flex items-start gap-1.5 pr-7 text-xs text-fg">
                <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" aria-hidden />
                <span>{t(anomaly.operationKey)}</span>
            </p>
            {anomaly.path && (
                <p className="nl-selectable-text mt-0.5 break-all pl-5 font-mono text-2xs text-fg-subtle">
                    {anomaly.path}
                </p>
            )}
            <details className="mt-1 pl-5">
                <summary className="text-2xs text-fg-muted transition-colors duration-150 hover:text-fg">
                    {t("workspace.recovery.problems.showRaw")}
                </summary>
                <pre className="nl-selectable-text mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-all font-mono text-2xs text-fg-muted">
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
        <li className="border-b border-edge-subtle py-1 last:border-b-0">
            <div className="flex items-center gap-2">
                <ProbeStatusIcon status={probe.status} />
                <span className="min-w-0 flex-1 truncate text-xs text-fg">{t(probe.labelKey)}</span>
                <button
                    type="button"
                    onClick={onRun}
                    disabled={busy}
                    className="rounded-md px-1.5 py-0.5 text-2xs text-fg-muted transition-colors duration-150 hover:bg-fill hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {probe.status === "untried"
                        ? t("workspace.recovery.probes.run")
                        : t("workspace.recovery.probes.rerun")}
                </button>
            </div>
            {probe.detail && (
                <p className="pl-5 text-2xs text-fg-subtle">{t(probe.detail.key, probe.detail.params)}</p>
            )}
            {probe.raw && (
                <pre className="nl-selectable-text mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md border border-danger/40 bg-danger/10 p-1.5 font-mono text-2xs text-danger">
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
            return <CircleCheck className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden />;
        case "failed":
            return <CircleX className="h-3.5 w-3.5 shrink-0 text-danger" aria-hidden />;
        default:
            return <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-edge-strong" aria-hidden />;
    }
}

function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
