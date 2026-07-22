import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
    AlertTriangle,
    CheckCircle2,
    Download,
    FolderPlus,
    Power,
    PowerOff,
    Puzzle,
    RefreshCw,
    Search,
    ShieldCheck,
    Trash2,
    X,
} from "lucide-react";
import { getInterface } from "@/lib/app/bridge";
import { useTranslation } from "@/lib/i18n";
import { Badge, Button, EmptyState, IconButton, Input } from "@/lib/components/elements";
import { cn } from "@/lib/utils/cn";
import type { PluginListItem } from "@shared/types/plugins";
import type { PluginRegistryEntry } from "@shared/types/pluginRegistry";
import { PluginAvatar, PluginDetailsModal, PluginStatusBadge, hasUpdate } from "./PluginDetailsModal";

type LauncherTab = "installed" | "store";

type TaskState =
    | { status: "idle"; message?: string }
    | { status: "working"; message: string }
    | { status: "success"; message: string }
    | { status: "error"; message: string };

export function PluginsTab() {
    const { t } = useTranslation();
    const [plugins, setPlugins] = useState<PluginListItem[]>([]);
    const [activeTab, setActiveTab] = useState<LauncherTab>("installed");
    const [query, setQuery] = useState("");
    const [task, setTask] = useState<TaskState>({ status: "idle" });
    const [registry, setRegistry] = useState<PluginRegistryEntry[] | null>(null);
    const [registryError, setRegistryError] = useState<string | null>(null);
    const [registryLoading, setRegistryLoading] = useState(false);
    const [detailId, setDetailId] = useState<string | null>(null);

    const busy = task.status === "working";

    const refresh = async () => {
        const result = await getInterface().plugins.list();
        if (!result.success) {
            setTask({ status: "error", message: result.error ?? t("launcher.plugins.error.load") });
            return;
        }
        setPlugins(result.data.plugins);
    };

    const refreshRegistry = async () => {
        setRegistryLoading(true);
        setRegistryError(null);
        try {
            const result = await getInterface().plugins.registryFetch();
            if (!result.success) {
                setRegistry(null);
                setRegistryError(result.error ?? t("launcher.plugins.error.registry"));
                return;
            }
            setRegistry(result.data.index.plugins);
        } finally {
            setRegistryLoading(false);
        }
    };

    useEffect(() => {
        void refresh();
    }, []);

    // Fetch the store index the first time it is opened; a manual refresh or retry
    // clears `registry`/`registryError` to trigger this again.
    useEffect(() => {
        if (activeTab === "store" && registry === null && !registryError && !registryLoading) {
            void refreshRegistry();
        }
    }, [activeTab, registry, registryError, registryLoading]);

    const runTask = async (message: string, action: () => Promise<void>) => {
        if (busy) return;
        setTask({ status: "working", message });
        try {
            await action();
        } catch (error) {
            setTask({ status: "error", message: getErrorMessage(error) });
        }
    };

    const handleRefresh = () => {
        void refresh();
        if (activeTab === "store") {
            setRegistry(null);
            setRegistryError(null);
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
        setActiveTab("installed");
        setTask({ status: "success", message: t("launcher.plugins.task.installed") });
    });

    const approve = (pluginId: string) => runTask(t("launcher.plugins.task.authorizing"), async () => {
        const result = await getInterface().plugins.approve(pluginId);
        if (!result.success) {
            throw new Error(result.error ?? t("launcher.plugins.error.approve"));
        }
        await refresh();
        setTask({
            status: result.data.approved ? "success" : "idle",
            message: result.data.approved ? t("launcher.plugins.task.authorized") : "",
        });
    });

    const setEnabled = (pluginId: string, enabled: boolean) => runTask(
        enabled ? t("launcher.plugins.task.enabling") : t("launcher.plugins.task.disabling"),
        async () => {
            const result = await getInterface().plugins.setEnabled(pluginId, enabled);
            if (!result.success) {
                throw new Error(result.error ?? t("launcher.plugins.error.update"));
            }
            await refresh();
            setTask({
                status: "success",
                message: enabled ? t("launcher.plugins.task.enabled") : t("launcher.plugins.task.disabled"),
            });
        },
    );

    const uninstall = (pluginId: string) => runTask(t("launcher.plugins.task.uninstalling"), async () => {
        const result = await getInterface().plugins.uninstall(pluginId);
        if (!result.success) {
            throw new Error(result.error ?? t("launcher.plugins.error.uninstall"));
        }
        await refresh();
        // Close the detail modal unless the plugin lives on as a store entry.
        setDetailId(current => (current && registry?.some(entry => entry.id === current) ? current : null));
        setTask({ status: "success", message: t("launcher.plugins.task.uninstalled") });
    });

    // Install (or update) from the store, then chain straight into the permission
    // prompt so browse → install → authorize is one gesture.
    const installFromStore = (pluginId: string) => runTask(t("launcher.plugins.task.downloading"), async () => {
        const result = await getInterface().plugins.installFromRegistry(pluginId);
        if (!result.success) {
            throw new Error(result.error ?? t("launcher.plugins.error.download"));
        }
        if (result.data.canceled) {
            setTask({ status: "idle" });
            return;
        }
        await refresh();
        const approval = await getInterface().plugins.approve(pluginId);
        if (!approval.success) {
            throw new Error(approval.error ?? t("launcher.plugins.error.approve"));
        }
        await refresh();
        setTask({
            status: approval.data.approved ? "success" : "idle",
            message: approval.data.approved ? t("launcher.plugins.task.installed") : "",
        });
    });

    const registryById = useMemo(() => {
        const map = new Map<string, PluginRegistryEntry>();
        (registry ?? []).forEach(entry => map.set(entry.id, entry));
        return map;
    }, [registry]);
    const installedById = useMemo(() => {
        const map = new Map<string, PluginListItem>();
        plugins.forEach(plugin => map.set(plugin.pluginId, plugin));
        return map;
    }, [plugins]);

    const q = query.trim().toLowerCase();
    const visibleInstalled = useMemo(() => plugins.filter(plugin =>
        !q
        || plugin.manifest.name.toLowerCase().includes(q)
        || plugin.pluginId.toLowerCase().includes(q)
        || (plugin.manifest.publisher ?? "").toLowerCase().includes(q),
    ), [plugins, q]);
    const visibleStore = useMemo(() => (registry ?? []).filter(entry =>
        !q
        || entry.name.toLowerCase().includes(q)
        || entry.id.toLowerCase().includes(q)
        || entry.publisher.toLowerCase().includes(q)
        || entry.description.toLowerCase().includes(q),
    ), [registry, q]);

    const detailInstalled = detailId ? installedById.get(detailId) ?? null : null;
    const detailEntry = detailId ? registryById.get(detailId) ?? null : null;

    return (
        <div className="flex h-full w-full flex-col px-6 pb-6 pt-4 text-fg">
            <div className="mb-3 flex items-center gap-2">
                <Segmented
                    value={activeTab}
                    onChange={setActiveTab}
                    options={[
                        { value: "installed", label: t("launcher.plugins.tab.installed") },
                        { value: "store", label: t("launcher.plugins.tab.store") },
                    ]}
                />
                <div className="min-w-0 flex-1">
                    <Input
                        fullWidth
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Escape") {
                                e.preventDefault();
                                setQuery("");
                            }
                        }}
                        placeholder={t("launcher.plugins.search.placeholder")}
                        aria-label={t("launcher.plugins.search.placeholder")}
                        leftIcon={<Search className="h-4 w-4" />}
                        rightIcon={query ? <X className="h-4 w-4" /> : undefined}
                        rightIconLabel={t("launcher.plugins.search.clear")}
                        onRightIconClick={query ? () => setQuery("") : undefined}
                        className="border-transparent bg-transparent focus:border-edge-strong"
                    />
                </div>
                <IconButton
                    variant="ghost"
                    size="sm"
                    onClick={installLocal}
                    disabled={busy}
                    title={t("launcher.plugins.installLocal")}
                    aria-label={t("launcher.plugins.installLocal")}
                >
                    <FolderPlus className="h-4 w-4" />
                </IconButton>
                <IconButton
                    variant="ghost"
                    size="sm"
                    onClick={handleRefresh}
                    disabled={busy}
                    title={t("common.refresh")}
                    aria-label={t("common.refresh")}
                >
                    <RefreshCw className={cn("h-4 w-4", registryLoading && "animate-spin")} />
                </IconButton>
            </div>

            {task.status !== "idle" && task.message ? (
                <div className={cn("mb-3 flex items-start gap-2 rounded-md border px-3 py-2 text-xs", taskClass(task.status))}>
                    {task.status === "error" ? (
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    ) : (
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    )}
                    <span>{task.message}</span>
                </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto">
                {activeTab === "installed" ? (
                    plugins.length === 0 ? (
                        <EmptyState
                            icon={<Puzzle className="h-6 w-6" />}
                            title={t("launcher.plugins.emptyList")}
                        />
                    ) : visibleInstalled.length === 0 ? (
                        <EmptyState title={t("launcher.plugins.emptyFiltered", { query: query.trim() })} />
                    ) : (
                        <div className="flex flex-col gap-0.5">
                            {visibleInstalled.map(plugin => (
                                <InstalledRow
                                    key={plugin.pluginId}
                                    plugin={plugin}
                                    hasUpdate={hasUpdate(plugin, registryById.get(plugin.pluginId))}
                                    busy={busy}
                                    onOpen={() => setDetailId(plugin.pluginId)}
                                    onAuthorize={() => approve(plugin.pluginId)}
                                    onToggle={() => setEnabled(plugin.pluginId, !plugin.enabled)}
                                    onUninstall={() => uninstall(plugin.pluginId)}
                                />
                            ))}
                        </div>
                    )
                ) : registryError ? (
                    <EmptyState
                        icon={<AlertTriangle className="h-6 w-6" />}
                        title={t("launcher.plugins.store.offline")}
                        description={registryError}
                        action={(
                            <Button size="sm" variant="secondary" onClick={handleRefresh}>
                                {t("launcher.plugins.store.retry")}
                            </Button>
                        )}
                    />
                ) : registry === null ? (
                    <EmptyState icon={<RefreshCw className="h-6 w-6 animate-spin" />} />
                ) : visibleStore.length === 0 ? (
                    <EmptyState
                        icon={<Puzzle className="h-6 w-6" />}
                        title={q ? t("launcher.plugins.emptyFiltered", { query: query.trim() }) : t("launcher.plugins.store.emptyList")}
                    />
                ) : (
                    <div className="flex flex-col gap-0.5">
                        {visibleStore.map(entry => (
                            <StoreRow
                                key={entry.id}
                                entry={entry}
                                installed={installedById.get(entry.id) ?? null}
                                busy={busy}
                                onOpen={() => setDetailId(entry.id)}
                                onInstall={() => installFromStore(entry.id)}
                            />
                        ))}
                    </div>
                )}
            </div>

            {detailId && (detailInstalled || detailEntry) ? (
                <PluginDetailsModal
                    installed={detailInstalled}
                    registryEntry={detailEntry}
                    busy={busy}
                    onClose={() => setDetailId(null)}
                    onAuthorize={approve}
                    onSetEnabled={setEnabled}
                    onUninstall={uninstall}
                    onInstall={installFromStore}
                />
            ) : null}
        </div>
    );
}

function InstalledRow({
    plugin,
    hasUpdate: updateAvailable,
    busy,
    onOpen,
    onAuthorize,
    onToggle,
    onUninstall,
}: {
    plugin: PluginListItem;
    hasUpdate: boolean;
    busy: boolean;
    onOpen: () => void;
    onAuthorize: () => void;
    onToggle: () => void;
    onUninstall: () => void;
}) {
    const { t } = useTranslation();
    const needsAuth = plugin.status === "needsAuthorization";

    return (
        <div className="group relative">
            <button
                type="button"
                onClick={onOpen}
                className="flex w-full cursor-default items-center gap-3 rounded-md px-3 py-2.5 pr-28 text-left transition-colors hover:bg-fill"
            >
                <PluginAvatar name={plugin.manifest.name} />
                <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-sm text-fg">{plugin.manifest.name}</span>
                        {plugin.builtIn ? <Badge tone="primary">{t("launcher.plugins.builtIn")}</Badge> : null}
                        <PluginStatusBadge status={plugin.status} />
                        {updateAvailable ? <Badge tone="warning">{t("launcher.plugins.updateAvailable")}</Badge> : null}
                    </span>
                    <span className="block truncate text-xs text-fg-subtle">
                        {plugin.manifest.publisher || plugin.pluginId}
                    </span>
                </span>
            </button>
            <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
                {needsAuth ? (
                    <Button size="sm" variant="primary" onClick={onAuthorize} disabled={busy} className="gap-1">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        {t("launcher.plugins.authorize")}
                    </Button>
                ) : plugin.status !== "error" ? (
                    <RowIconButton
                        title={plugin.enabled ? t("common.disable") : t("common.enable")}
                        disabled={busy}
                        onClick={onToggle}
                    >
                        {plugin.enabled ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
                    </RowIconButton>
                ) : null}
                {!plugin.builtIn ? (
                    <RowIconButton title={t("launcher.plugins.uninstall")} disabled={busy} onClick={onUninstall}>
                        <Trash2 className="h-4 w-4" />
                    </RowIconButton>
                ) : null}
            </div>
        </div>
    );
}

function StoreRow({
    entry,
    installed,
    busy,
    onOpen,
    onInstall,
}: {
    entry: PluginRegistryEntry;
    installed: PluginListItem | null;
    busy: boolean;
    onOpen: () => void;
    onInstall: () => void;
}) {
    const { t } = useTranslation();
    const updateAvailable = hasUpdate(installed, entry);

    return (
        <div className="group relative">
            <button
                type="button"
                onClick={onOpen}
                className="flex w-full cursor-default items-center gap-3 rounded-md px-3 py-2.5 pr-28 text-left transition-colors hover:bg-fill"
            >
                <PluginAvatar name={entry.name} />
                <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-sm text-fg">{entry.name}</span>
                        <span className="shrink-0 text-2xs text-fg-subtle">{entry.publisher}</span>
                    </span>
                    <span className="block truncate text-xs text-fg-subtle">
                        {entry.description || entry.id}
                    </span>
                </span>
            </button>
            <div className="absolute right-2 top-1/2 -translate-y-1/2">
                {updateAvailable ? (
                    <Button size="sm" variant="primary" onClick={onInstall} disabled={busy}>
                        {t("launcher.plugins.store.update")}
                    </Button>
                ) : installed ? (
                    <Badge tone="neutral">{t("launcher.plugins.store.installed")}</Badge>
                ) : (
                    <Button size="sm" variant="primary" onClick={onInstall} disabled={busy} className="gap-1">
                        <Download className="h-3.5 w-3.5" />
                        {t("launcher.plugins.store.install")}
                    </Button>
                )}
            </div>
        </div>
    );
}

/** Hover-revealed icon action on a row; visible on hover, focus, or while disabled-busy. */
function RowIconButton({
    title,
    disabled,
    onClick,
    children,
}: {
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
            className="no-drag grid h-8 w-8 cursor-default place-items-center rounded-md text-fg-muted opacity-0 transition hover:bg-fill-strong hover:text-fg focus-visible:opacity-100 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
            {children}
        </button>
    );
}

function Segmented<T extends string>({
    value,
    onChange,
    options,
}: {
    value: T;
    onChange: (value: T) => void;
    options: { value: T; label: string }[];
}) {
    return (
        <div className="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-fill-subtle p-0.5">
            {options.map(option => (
                <button
                    key={option.value}
                    type="button"
                    onClick={() => onChange(option.value)}
                    className={cn(
                        "no-drag cursor-default rounded px-3 py-1 text-xs font-medium transition-colors",
                        value === option.value
                            ? "bg-fill-strong text-fg shadow-sm"
                            : "text-fg-muted hover:text-fg",
                    )}
                >
                    {option.label}
                </button>
            ))}
        </div>
    );
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
