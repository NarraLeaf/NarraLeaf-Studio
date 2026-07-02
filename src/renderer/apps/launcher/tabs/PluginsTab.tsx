import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
    AlertTriangle,
    CheckCircle2,
    Download,
    Power,
    PowerOff,
    RefreshCw,
    ShieldCheck,
    Trash2,
} from "lucide-react";
import { getInterface } from "@/lib/app/bridge";
import { describePluginInstallPermissions } from "@shared/utils/pluginInstallPermissions";
import type { PluginListItem, PluginStatus } from "@shared/types/plugins";

type TaskState =
    | { status: "idle"; message?: string }
    | { status: "working"; message: string }
    | { status: "success"; message: string }
    | { status: "error"; message: string };

export function PluginsTab() {
    const [plugins, setPlugins] = useState<PluginListItem[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [task, setTask] = useState<TaskState>({ status: "idle" });

    const selected = useMemo(
        () => plugins.find(plugin => plugin.pluginId === selectedId) ?? plugins[0] ?? null,
        [plugins, selectedId],
    );
    const busy = task.status === "working";

    const refresh = async () => {
        const result = await getInterface().plugins.list();
        if (!result.success) {
            setTask({ status: "error", message: result.error ?? "Failed to load plugins" });
            return;
        }
        setPlugins(result.data.plugins);
        setSelectedId(current => current && result.data.plugins.some(plugin => plugin.pluginId === current)
            ? current
            : result.data.plugins[0]?.pluginId ?? null);
    };

    useEffect(() => {
        void refresh();
    }, []);

    const runTask = async (message: string, action: () => Promise<void>) => {
        if (busy) return;
        setTask({ status: "working", message });
        try {
            await action();
        } catch (error) {
            setTask({ status: "error", message: getErrorMessage(error) });
        }
    };

    const installLocal = () => runTask("Installing plugin...", async () => {
        const result = await getInterface().plugins.installLocal();
        if (!result.success) {
            throw new Error(result.error ?? "Failed to install plugin");
        }
        if (result.data.canceled) {
            setTask({ status: "idle" });
            return;
        }
        await refresh();
        setSelectedId(result.data.plugin.pluginId);
        setTask({ status: "success", message: "Plugin installed." });
    });

    const approve = (pluginId: string) => runTask("Waiting for authorization...", async () => {
        const result = await getInterface().plugins.approve(pluginId);
        if (!result.success) {
            throw new Error(result.error ?? "Failed to approve plugin");
        }
        await refresh();
        setSelectedId(result.data.plugin.pluginId);
        setTask({
            status: result.data.approved ? "success" : "idle",
            message: result.data.approved ? "Plugin authorized." : "",
        });
    });

    const setEnabled = (pluginId: string, enabled: boolean) => runTask(enabled ? "Enabling plugin..." : "Disabling plugin...", async () => {
        const result = await getInterface().plugins.setEnabled(pluginId, enabled);
        if (!result.success) {
            throw new Error(result.error ?? "Failed to update plugin");
        }
        await refresh();
        setSelectedId(result.data.pluginId);
        setTask({ status: "success", message: enabled ? "Plugin enabled." : "Plugin disabled." });
    });

    const uninstall = (pluginId: string) => runTask("Uninstalling plugin...", async () => {
        const result = await getInterface().plugins.uninstall(pluginId);
        if (!result.success) {
            throw new Error(result.error ?? "Failed to uninstall plugin");
        }
        await refresh();
        setTask({ status: "success", message: "Plugin uninstalled." });
    });

    return (
        <div className="flex h-full min-h-0 bg-[#0f1115] text-gray-200">
            <div className="flex min-h-0 w-[320px] shrink-0 flex-col border-r border-white/10">
                <div className="flex h-10 shrink-0 items-center justify-between border-b border-white/10 bg-[#0b0d12] px-3">
                    <div className="text-sm font-medium text-white">Plugins</div>
                    <div className="flex items-center gap-1">
                        <IconButton title="Install local plugin" disabled={busy} onClick={installLocal}>
                            <Download className="h-4 w-4" />
                        </IconButton>
                        <IconButton title="Refresh" disabled={busy} onClick={() => void refresh()}>
                            <RefreshCw className="h-4 w-4" />
                        </IconButton>
                    </div>
                </div>

                <div className="min-h-0 flex-1 overflow-auto">
                    {plugins.length === 0 ? (
                        <div className="px-2 py-8 text-center text-xs text-gray-500">No plugins installed</div>
                    ) : (
                        <div>
                            {plugins.map(plugin => {
                                const isSelected = selected?.pluginId === plugin.pluginId;

                                return (
                                    <button
                                        key={plugin.pluginId}
                                        type="button"
                                        onClick={() => setSelectedId(plugin.pluginId)}
                                        className={`no-drag w-full border-b border-l-2 border-b-white/10 px-3 py-2 text-left transition-colors ${
                                            isSelected
                                                ? "border-l-primary"
                                                : "border-l-transparent hover:bg-white/10"
                                        }`}
                                    >
                                        <div className="flex min-w-0 items-center justify-between gap-2">
                                            <div className="truncate text-sm font-medium text-white">{plugin.manifest.name}</div>
                                            <StatusBadge status={plugin.status} />
                                        </div>
                                        <div className="mt-1 truncate font-mono text-[11px] text-gray-500">{plugin.pluginId}</div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <div className="flex h-10 shrink-0 items-center justify-between border-b border-white/10 bg-[#0b0d12] px-4">
                    <div className="min-w-0 truncate text-sm font-medium text-white">
                        {selected?.manifest.name ?? "Plugins"}
                    </div>
                    {selected ? (
                        <div className="flex items-center gap-1">
                            {selected.status === "needsAuthorization" ? (
                                <IconTextButton disabled={busy} onClick={() => void approve(selected.pluginId)} title="Authorize">
                                    <ShieldCheck className="h-4 w-4" />
                                    <span>Authorize</span>
                                </IconTextButton>
                            ) : selected.enabled ? (
                                <IconButton title="Disable" disabled={busy} onClick={() => void setEnabled(selected.pluginId, false)}>
                                    <PowerOff className="h-4 w-4" />
                                </IconButton>
                            ) : (
                                <IconButton title="Enable" disabled={busy || selected.status === "error"} onClick={() => void setEnabled(selected.pluginId, true)}>
                                    <Power className="h-4 w-4" />
                                </IconButton>
                            )}
                            <IconButton title="Uninstall" disabled={busy || selected.builtIn} onClick={() => void uninstall(selected.pluginId)}>
                                <Trash2 className="h-4 w-4" />
                            </IconButton>
                        </div>
                    ) : null}
                </div>

                <div className="min-h-0 flex-1 overflow-auto p-4">
                    {task.status !== "idle" && task.message ? (
                        <div className={`mb-3 flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${taskClass(task.status)}`}>
                            {task.status === "error" ? (
                                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            ) : (
                                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            )}
                            <span>{task.message}</span>
                        </div>
                    ) : null}

                    {selected ? (
                        <PluginDetails plugin={selected} />
                    ) : (
                        <div className="flex h-full items-center justify-center text-sm text-gray-500">No plugin selected</div>
                    )}
                </div>
            </div>
        </div>
    );
}

function PluginDetails({ plugin }: { plugin: PluginListItem }) {
    const permissions = describePluginInstallPermissions(plugin.manifest.permissions);

    return (
        <div className="space-y-4">
            <div>
                <div className="flex min-w-0 items-center gap-2">
                    <div className="truncate text-lg font-semibold text-white">{plugin.manifest.name}</div>
                    <span className="shrink-0 rounded border border-white/10 px-1.5 py-0.5 text-[11px] text-gray-400">
                        {plugin.manifest.version}
                    </span>
                    {plugin.builtIn ? (
                        <span className="shrink-0 rounded border border-cyan-400/20 px-1.5 py-0.5 text-[11px] text-cyan-200">
                            Built-in
                        </span>
                    ) : null}
                </div>
                <div className="mt-1 font-mono text-xs text-gray-500">{plugin.pluginId}</div>
                {plugin.manifest.publisher ? (
                    <div className="mt-1 text-xs text-gray-400">{plugin.manifest.publisher}</div>
                ) : null}
            </div>

            {plugin.manifest.description ? (
                <div className="text-sm leading-6 text-gray-300">{plugin.manifest.description}</div>
            ) : null}

            <div className="space-y-1 text-sm text-gray-300">
                <InfoLine label="Status" value={statusText(plugin.status)} />
                <InfoLine label="Entry" value={plugin.manifest.entry} mono />
                <InfoLine label="Installed" value={new Date(plugin.installedAt).toLocaleString()} />
                <InfoLine label="Updated" value={new Date(plugin.updatedAt).toLocaleString()} />
            </div>

            <div>
                <div className="mb-2 text-xs font-medium uppercase tracking-normal text-gray-500">Permissions</div>
                <div className="overflow-hidden rounded-md border border-white/10 bg-white/[0.03]">
                    {permissions.map((permission, index) => (
                        <div key={`${permission}-${index}`} className="border-b border-white/10 px-3 py-2 text-sm text-gray-200 last:border-b-0">
                            {permission}
                        </div>
                    ))}
                </div>
            </div>

            {plugin.lastError ? (
                <div className="rounded-md border border-red-400/25 bg-red-500/10 px-3 py-2 text-sm text-red-100">
                    {plugin.lastError}
                </div>
            ) : null}
        </div>
    );
}

function InfoLine({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
    return (
        <div className="flex min-w-0 items-baseline gap-2">
            <span className="w-16 shrink-0 text-gray-500">{label}</span>
            <span className={`min-w-0 truncate text-gray-200 ${mono ? "font-mono" : ""}`}>{value}</span>
        </div>
    );
}

function StatusBadge({ status }: { status: PluginStatus }) {
    return (
        <span className={`shrink-0 border px-1.5 py-0.5 text-[11px] ${statusClass(status)}`}>
            {statusText(status)}
        </span>
    );
}

function IconButton({ title, disabled, onClick, children }: {
    title: string;
    disabled?: boolean;
    onClick: () => void;
    children: ReactNode;
}) {
    return (
        <button
            type="button"
            title={title}
            aria-label={title}
            disabled={disabled}
            onClick={onClick}
            className="no-drag grid h-8 w-8 place-items-center rounded-md text-gray-400 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
            {children}
        </button>
    );
}

function IconTextButton({ title, disabled, onClick, children }: {
    title: string;
    disabled?: boolean;
    onClick: () => void;
    children: ReactNode;
}) {
    return (
        <button
            type="button"
            title={title}
            disabled={disabled}
            onClick={onClick}
            className="no-drag flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
            {children}
        </button>
    );
}

function statusText(status: PluginStatus): string {
    switch (status) {
        case "enabled":
            return "Enabled";
        case "disabled":
            return "Disabled";
        case "needsAuthorization":
            return "Needs authorization";
        case "error":
            return "Error";
        default:
            return status;
    }
}

function statusClass(status: PluginStatus): string {
    switch (status) {
        case "enabled":
            return "border-emerald-400/25 text-emerald-200";
        case "needsAuthorization":
            return "border-amber-400/25 text-amber-200";
        case "error":
            return "border-red-400/25 text-red-200";
        default:
            return "border-white/10 text-gray-400";
    }
}

function taskClass(status: TaskState["status"]): string {
    switch (status) {
        case "success":
            return "border-emerald-400/25 bg-emerald-500/10 text-emerald-100";
        case "error":
            return "border-red-400/25 bg-red-500/10 text-red-100";
        case "working":
            return "border-cyan-400/25 bg-cyan-500/10 text-cyan-100";
        default:
            return "border-white/10 bg-white/[0.03] text-gray-400";
    }
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
