import { getInterface } from "@/lib/app/bridge";
import { getConsoleBufferLines } from "@/lib/app/diagnostics/consoleBuffer";
import { translate } from "@/lib/i18n";
import { getWorkspaceAnomalies, type WorkspaceAnomaly } from "@/lib/workspace/recovery/anomalyLog";
import { ConsoleService } from "@/lib/workspace/services/core/ConsoleService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { buildConsoleExportContent } from "../console/consoleExport";

/** A text file this window contributes to the archive: a name main files under `workspace/`. */
export type WorkspaceLogFile = { name: string; content: string };

/** `narraleaf-studio-logs-20261002-142530.zip`, in local time. */
export function buildLogArchiveFileName(now: Date = new Date()): string {
    const pad = (value: number) => String(value).padStart(2, "0");
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    return `narraleaf-studio-logs-${stamp}.zip`;
}

function formatAnomaly(anomaly: WorkspaceAnomaly): string {
    return [
        `[${new Date(anomaly.at).toISOString()}] ${anomaly.severity.toUpperCase()} ${anomaly.source} ${anomaly.operationKey}`,
        ...(anomaly.path ? [`  path: ${anomaly.path}`] : []),
        ...anomaly.raw.split("\n").map(line => `  ${line}`),
    ].join("\n");
}

/**
 * The logs only this window holds: they live in memory and are gone when it closes, so main cannot
 * read them itself.
 *
 * - one file per Console channel, in the panel's own export format, empty channels included so the
 *   archive shows they were empty rather than missing;
 * - this window's console, the same buffer the error screen's report quotes;
 * - the problems the workspace recorded while loading the project.
 */
export function collectWorkspaceLogFiles(context: WorkspaceContext | null): WorkspaceLogFile[] {
    const files: WorkspaceLogFile[] = [];

    const consoleService = context?.services.get<ConsoleService>(Services.Console) ?? null;
    for (const channel of consoleService?.getChannels() ?? []) {
        const entries = consoleService?.getEntries(channel.id) ?? [];
        files.push({
            name: `console-${channel.id}.log`,
            content: buildConsoleExportContent(entries, channel.label),
        });
    }

    const consoleLines = getConsoleBufferLines();
    files.push({
        name: "window-console.log",
        content: consoleLines.length > 0 ? `${consoleLines.join("\n")}\n` : "<empty>\n",
    });

    const anomalies = getWorkspaceAnomalies();
    files.push({
        name: "workspace-problems.log",
        content: anomalies.length > 0 ? `${anomalies.map(formatAnomaly).join("\n\n")}\n` : "<none>\n",
    });

    return files;
}

/** Help > Export Logs: gather this window's logs, let main add the rest, and report where it went. */
export async function exportLogArchive(context: WorkspaceContext): Promise<void> {
    const uiService = context.services.get<UIService>(Services.UI);
    try {
        const result = await getInterface().app.exportLogArchive(
            buildLogArchiveFileName(),
            collectWorkspaceLogFiles(context),
        );
        if (!result.success) {
            console.warn("[logs] the log archive could not be written", result.error);
            uiService.showNotification(translate("actions.help.exportLogs.failed"), "error");
            return;
        }
        if (result.data.canceled) {
            return;
        }
        uiService.showNotification(
            translate("actions.help.exportLogs.done", { path: result.data.filePath ?? "" }),
            "success",
        );
    } catch (error) {
        console.warn("[logs] the log archive could not be written", error);
        uiService.showNotification(translate("actions.help.exportLogs.failed"), "error");
    }
}
