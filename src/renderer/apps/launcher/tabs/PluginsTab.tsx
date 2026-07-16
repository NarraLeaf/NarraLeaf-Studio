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
import { useTranslation } from "@/lib/i18n";
import type { Translator } from "@shared/i18n";
import { describePluginInstallPermissions } from "@shared/utils/pluginInstallPermissions";
import type { PluginListItem, PluginStatus } from "@shared/types/plugins";

type TaskState =
    | { status: "idle"; message?: string }
    | { status: "working"; message: string }
    | { status: "success"; message: string }
    | { status: "error"; message: string };

export function PluginsTab() {
    const { t } = useTranslation();
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
            setTask({ status: "error", message: result.error ?? t("launcher.plugins.error.load") });
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

    const installLocal = () => runTask(t("launcher.plugins.task.installing"), async () => {
        const result = await getInterface().plugins.installLocal();
        if (!result.success) {
            throw new Error(result.error ?? t("launcher.plugins.error.install"));
        }
        if (result.data.canceled) {
            setTask({ status: "idle" });
            return;
        }
        await refresh();
        setSelectedId(result.data.plugin.pluginId);
        setTask({ status: "success", message: t("launcher.plugins.task.installed") });
    });

    const approve = (pluginId: string) => runTask(t("launcher.plugins.task.authorizing"), async () => {
        const result = await getInterface().plugins.approve(pluginId);
        if (!result.success) {
            throw new Error(result.error ?? t("launcher.plugins.error.approve"));
        }
        await refresh();
        setSelectedId(result.data.plugin.pluginId);
        setTask({
            status: result.data.approved ? "success" : "idle",
            message: result.data.approved ? t("launcher.plugins.task.authorized") : "",
        });
    });

    const setEnabled = (pluginId: string, enabled: boolean) => runTask(enabled ? t("launcher.plugins.task.enabling") : t("launcher.plugins.task.disabling"), async () => {
        const result = await getInterface().plugins.setEnabled(pluginId, enabled);
        if (!result.success) {
            throw new Error(result.error ?? t("launcher.plugins.error.update"));
        }
        await refresh();
        setSelectedId(result.data.pluginId);
        setTask({ status: "success", message: enabled ? t("launcher.plugins.task.enabled") : t("launcher.plugins.task.disabled") });
    });

    const uninstall = (pluginId: string) => runTask(t("launcher.plugins.task.uninstalling"), async () => {
        const result = await getInterface().plugins.uninstall(pluginId);
        if (!result.success) {
            throw new Error(result.error ?? t("launcher.plugins.error.uninstall"));
        }
        await refresh();
        setTask({ status: "success", message: t("launcher.plugins.task.uninstalled") });
    });

    return (
        <div className="flex h-full min-h-0 bg-surface text-fg">
            <div className="flex min-h-0 w-[320px] shrink-0 flex-col border-r border-edge">
                <div className="flex h-10 shrink-0 items-center justify-between border-b border-edge bg-surface-sunken px-3">
                    <div className="text-sm font-medium text-fg">{t("launcher.nav.plugins")}</div>
                    <div className="flex items-center gap-1">
                        <IconButton title={t("launcher.plugins.installLocal")} disabled={busy} onClick={installLocal}>
                            <Download className="h-4 w-4" />
                        </IconButton>
                        <IconButton title={t("common.refresh")} disabled={busy} onClick={() => void refresh()}>
                            <RefreshCw className="h-4 w-4" />
                        </IconButton>
                    </div>
                </div>

                <div className="min-h-0 flex-1 overflow-auto">
                    {plugins.length === 0 ? (
                        <div className="px-2 py-8 text-center text-xs text-fg-subtle">{t("launcher.plugins.emptyList")}</div>
                    ) : (
                        <div>
                            {plugins.map(plugin => {
                                const isSelected = selected?.pluginId === plugin.pluginId;

                                return (
                                    <button
                                        key={plugin.pluginId}
                                        type="button"
                                        onClick={() => setSelectedId(plugin.pluginId)}
                                        className={`no-drag w-full border-b border-l-2 border-b-edge px-3 py-2 text-left transition-colors ${
                                            isSelected
                                                ? "border-l-primary"
                                                : "border-l-transparent hover:bg-fill"
                                        }`}
                                    >
                                        <div className="flex min-w-0 items-center justify-between gap-2">
                                            <div className="truncate text-sm font-medium text-fg">{plugin.manifest.name}</div>
                                            <StatusBadge status={plugin.status} />
                                        </div>
                                        <div className="mt-1 truncate font-mono text-2xs text-fg-subtle">{plugin.pluginId}</div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <div className="flex h-10 shrink-0 items-center justify-between border-b border-edge bg-surface-sunken px-4">
                    <div className="min-w-0 truncate text-sm font-medium text-fg">
                        {selected?.manifest.name ?? t("launcher.nav.plugins")}
                    </div>
                    {selected ? (
                        <div className="flex items-center gap-1">
                            {selected.status === "needsAuthorization" ? (
                                <IconTextButton disabled={busy} onClick={() => void approve(selected.pluginId)} title={t("launcher.plugins.authorize")}>
                                    <ShieldCheck className="h-4 w-4" />
                                    <span>{t("launcher.plugins.authorize")}</span>
                                </IconTextButton>
                            ) : selected.enabled ? (
                                <IconButton title={t("common.disable")} disabled={busy} onClick={() => void setEnabled(selected.pluginId, false)}>
                                    <PowerOff className="h-4 w-4" />
                                </IconButton>
                            ) : (
                                <IconButton title={t("common.enable")} disabled={busy || selected.status === "error"} onClick={() => void setEnabled(selected.pluginId, true)}>
                                    <Power className="h-4 w-4" />
                                </IconButton>
                            )}
                            <IconButton title={t("launcher.plugins.uninstall")} disabled={busy || selected.builtIn} onClick={() => void uninstall(selected.pluginId)}>
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
                        <div className="flex h-full items-center justify-center text-sm text-fg-subtle">{t("launcher.plugins.noneSelected")}</div>
                    )}
                </div>
            </div>
        </div>
    );
}

function PluginDetails({ plugin }: { plugin: PluginListItem }) {
    const { t } = useTranslation();
    const permissions = describePluginInstallPermissions(plugin.manifest.permissions);

    return (
        <div className="space-y-4">
            <div>
                <div className="flex min-w-0 items-center gap-2">
                    <div className="truncate text-lg font-semibold text-fg">{plugin.manifest.name}</div>
                    <span className="shrink-0 rounded border border-edge px-1.5 py-0.5 text-2xs text-fg-muted">
                        {plugin.manifest.version}
                    </span>
                    {plugin.builtIn ? (
                        <span className="shrink-0 rounded border border-primary/20 px-1.5 py-0.5 text-2xs text-primary">
                            {t("launcher.plugins.builtIn")}
                        </span>
                    ) : null}
                </div>
                <div className="mt-1 font-mono text-xs text-fg-subtle">{plugin.pluginId}</div>
                {plugin.manifest.publisher ? (
                    <div className="mt-1 text-xs text-fg-muted">{plugin.manifest.publisher}</div>
                ) : null}
            </div>

            {plugin.manifest.description ? (
                <div className="text-sm leading-6 text-fg-muted">{plugin.manifest.description}</div>
            ) : null}

            <div className="space-y-1 text-sm text-fg-muted">
                <InfoLine label={t("launcher.plugins.field.status")} value={statusText(plugin.status, t)} />
                <InfoLine
                    label={t("launcher.plugins.field.entries")}
                    value={(["studio", "runtime"] as const)
                        .filter(target => plugin.manifest.entries[target])
                        .map(target => `${target}: ${plugin.manifest.entries[target]}`)
                        .join("  ·  ")}
                    mono
                />
                <InfoLine label={t("launcher.plugins.field.installed")} value={new Date(plugin.installedAt).toLocaleString()} />
                <InfoLine label={t("launcher.plugins.field.updated")} value={new Date(plugin.updatedAt).toLocaleString()} />
            </div>

            <div>
                <div className="mb-2 text-xs font-medium tracking-normal text-fg-subtle">{t("launcher.plugins.permissions")}</div>
                <div className="overflow-hidden rounded-md border border-edge bg-fill-subtle">
                    {permissions.map((permission, index) => (
                        <div key={`${permission}-${index}`} className="border-b border-edge px-3 py-2 text-sm text-fg last:border-b-0">
                            {permission}
                        </div>
                    ))}
                </div>
            </div>

            {plugin.lastError ? (
                <div className="rounded-md border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">
                    {plugin.lastError}
                </div>
            ) : null}
        </div>
    );
}

function InfoLine({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
    return (
        <div className="flex min-w-0 items-baseline gap-2">
            <span className="w-16 shrink-0 text-fg-subtle">{label}</span>
            <span className={`min-w-0 truncate text-fg ${mono ? "font-mono" : ""}`}>{value}</span>
        </div>
    );
}

function StatusBadge({ status }: { status: PluginStatus }) {
    const { t } = useTranslation();
    return (
        <span className={`shrink-0 border px-1.5 py-0.5 text-2xs ${statusClass(status)}`}>
            {statusText(status, t)}
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
            className="no-drag grid h-8 w-8 place-items-center rounded-md text-fg-muted hover:bg-fill hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
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

function statusText(status: PluginStatus, t: Translator["t"]): string {
    switch (status) {
        case "enabled":
            return t("launcher.plugins.status.enabled");
        case "disabled":
            return t("launcher.plugins.status.disabled");
        case "needsAuthorization":
            return t("launcher.plugins.status.needsAuthorization");
        case "error":
            return t("common.error");
        default:
            return status;
    }
}

function statusClass(status: PluginStatus): string {
    switch (status) {
        case "enabled":
            return "border-success/25 text-success";
        case "needsAuthorization":
            return "border-warning/25 text-warning";
        case "error":
            return "border-danger/25 text-danger";
        default:
            return "border-edge text-fg-muted";
    }
}

function taskClass(status: TaskState["status"]): string {
    switch (status) {
        case "success":
            return "border-success/25 bg-success/10 text-success";
        case "error":
            return "border-danger/25 bg-danger/10 text-danger";
        case "working":
            return "border-primary/25 bg-primary/10 text-primary";
        default:
            return "border-edge bg-fill-subtle text-fg-muted";
    }
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
