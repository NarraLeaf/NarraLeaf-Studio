import { useMemo, useState } from "react";
import { CheckCircle2, FileText, Play, Trash2, XCircle } from "lucide-react";
import { appPrivilegedFacade } from "@/lib/app/privilegedFacade";
import {
    desktopFileTestPlugin,
    requestDesktopFileTestPluginInstall,
    runDesktopFileTestPlugin,
    type DesktopFileTestResult,
} from "../plugins/desktopFileTestPlugin";

const INSTALLED_TEST_PLUGINS_KEY = "nls.launcher.installedTestPlugins";

type PluginTaskState =
    | { status: "idle"; message: string }
    | { status: "working"; message: string }
    | { status: "success"; message: string; result?: DesktopFileTestResult }
    | { status: "error"; message: string };

export function PluginsTab() {
    const [installedPluginIds, setInstalledPluginIds] = useState<string[]>(loadInstalledPluginIds);
    const [task, setTask] = useState<PluginTaskState>({
        status: "idle",
        message: "",
    });

    const plugin = desktopFileTestPlugin.plugin;
    const installed = installedPluginIds.includes(plugin.id);
    const busy = task.status === "working";
    const statusClass = useMemo(() => {
        switch (task.status) {
            case "success":
                return "border-emerald-400/25 text-emerald-100";
            case "error":
                return "border-red-400/25 text-red-100";
            case "working":
                return "border-cyan-400/25 text-cyan-100";
            default:
                return "border-white/10 text-gray-400";
        }
    }, [task.status]);

    const installPlugin = async () => {
        if (busy) return;
        setTask({ status: "working", message: "Waiting for install authorization..." });
        try {
            const grant = await requestDesktopFileTestPluginInstall();
            const next = Array.from(new Set([...installedPluginIds, plugin.id]));
            setInstalledPluginIds(next);
            saveInstalledPluginIds(next);
            setTask({
                status: "success",
                message: `Installed. Grant: ${grant.persistence}.`,
            });
        } catch (error) {
            setTask({ status: "error", message: getErrorMessage(error) });
        }
    };

    const runPlugin = async () => {
        if (busy || !installed) return;
        setTask({ status: "working", message: "Waiting for desktop file authorization..." });
        try {
            const result = await runDesktopFileTestPlugin();
            setTask({
                status: "success",
                message: `Wrote and read ${result.bytes} bytes. Grant: ${result.permission.persistence}.`,
                result,
            });
        } catch (error) {
            setTask({ status: "error", message: getErrorMessage(error) });
        }
    };

    const uninstallPlugin = async () => {
        if (busy) return;
        setTask({ status: "working", message: "Removing plugin permissions..." });
        const revokeResult = await appPrivilegedFacade.permissions.revokePlugin(plugin.id);
        if (!revokeResult.success) {
            setTask({
                status: "error",
                message: revokeResult.error ?? "Failed to remove plugin permissions",
            });
            return;
        }

        const next = installedPluginIds.filter(id => id !== plugin.id);
        setInstalledPluginIds(next);
        saveInstalledPluginIds(next);
        setTask({
            status: "success",
            message: "Removed plugin and cleared saved permissions.",
        });
    };

    return (
        <div className="flex h-full min-h-0 flex-col bg-[#0f1115] text-gray-200">
            <div className="flex h-10 shrink-0 items-center justify-between border-b border-white/10 bg-[#0b0d12] px-4">
                <div className="text-sm font-medium text-white">Plugins</div>
                <div className="text-[11px] text-gray-500">Local registry</div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
                <div className="flex min-h-14 items-center gap-3 border-b border-white/10 px-4 py-2">
                    <div className="grid h-8 w-8 shrink-0 place-items-center rounded border border-white/10 bg-white/[0.04] text-gray-300">
                        <FileText className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                            <div className="truncate text-sm font-medium text-white">{plugin.name}</div>
                            <span className="shrink-0 text-[11px] text-gray-500">{plugin.version}</span>
                        </div>
                        <div className="mt-0.5 truncate font-mono text-[11px] text-gray-500">{plugin.id}</div>
                    </div>
                    <div className="hidden min-w-0 flex-1 text-xs text-gray-400 md:block">
                        Desktop file read/write
                    </div>
                    <div className={`shrink-0 text-xs ${installed ? "text-emerald-200" : "text-gray-500"}`}>
                        {installed ? "Installed" : "Not installed"}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                        {installed ? (
                            <button
                                type="button"
                                onClick={uninstallPlugin}
                                disabled={busy}
                                className="no-drag grid h-8 w-8 place-items-center rounded text-gray-400 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                                title="Remove"
                                aria-label="Remove test plugin"
                            >
                                <Trash2 className="h-4 w-4" />
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={installPlugin}
                                disabled={busy}
                                className="no-drag flex h-8 items-center gap-1.5 rounded bg-primary px-3 text-xs font-semibold text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Install
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={runPlugin}
                            disabled={!installed || busy}
                            className="no-drag flex h-8 items-center gap-1.5 rounded border border-white/10 bg-white/[0.04] px-3 text-xs font-medium text-gray-200 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <Play className="h-3.5 w-3.5" />
                            Run
                        </button>
                    </div>
                </div>

                {task.message ? (
                    <div className={`m-3 border bg-[#111318] px-3 py-2 text-xs leading-5 ${statusClass}`}>
                        <div className="flex items-start gap-2">
                            {task.status === "error" ? (
                                <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            ) : (
                                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            )}
                            <div className="min-w-0 flex-1">
                                <div>{task.message}</div>
                                {task.status === "success" && task.result ? (
                                    <div className="mt-2 space-y-1 text-gray-400">
                                        <div className="truncate">Path: {task.result.targetPath}</div>
                                        <div className="truncate">SHA-256: {task.result.hash}</div>
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    </div>
                ) : null}
            </div>
        </div>
    );
}

function loadInstalledPluginIds(): string[] {
    try {
        const raw = window.localStorage.getItem(INSTALLED_TEST_PLUGINS_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
    } catch {
        return [];
    }
}

function saveInstalledPluginIds(ids: string[]): void {
    window.localStorage.setItem(INSTALLED_TEST_PLUGINS_KEY, JSON.stringify(ids));
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
