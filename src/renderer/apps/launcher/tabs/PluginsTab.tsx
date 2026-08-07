import { useMemo, useState } from "react";
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
import { useTranslation } from "@/lib/i18n";
import { Badge, Button, EmptyState, IconButton, Input } from "@/lib/components/elements";
import { cn } from "@/lib/utils/cn";
import { PluginAvatar, PluginStatusBadge, hasUpdate, isCompatible } from "@/lib/plugins/ui/pluginPresentation";
import { filterInstalled, filterStore, usePluginCatalog } from "@/lib/plugins/ui/usePluginCatalog";
import { useStoreIcon } from "@/lib/plugins/ui/useStoreIcon";
import type { PluginCatalogTask } from "@/lib/plugins/ui/usePluginCatalog";
import type { PluginListItem } from "@shared/types/plugins";
import type { PluginRegistryEntry } from "@shared/types/pluginRegistry";
import { PluginDetailsModal } from "./PluginDetailsModal";

type LauncherTab = "installed" | "store";

export function PluginsTab() {
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = useState<LauncherTab>("installed");
    const [query, setQuery] = useState("");
    const [detailId, setDetailId] = useState<string | null>(null);
    const catalog = usePluginCatalog({ onLocalInstalled: () => setActiveTab("installed") });

    const { plugins, registry, registryError, registryLoading, task, busy, installedById, registryById } = catalog;

    const visibleInstalled = useMemo(() => filterInstalled(plugins, query), [plugins, query]);
    const visibleStore = useMemo(() => filterStore(registry ?? [], query), [registry, query]);
    const q = query.trim();

    const uninstall = (pluginId: string) => {
        catalog.uninstall(pluginId);
        // Close the detail modal unless the plugin lives on as a store entry.
        setDetailId(current => (current && registry?.some(entry => entry.id === current) ? current : null));
    };

    const detailInstalled = detailId ? installedById.get(detailId) ?? null : null;
    const detailEntry = detailId ? registryById.get(detailId) ?? null : null;

    return (
        <div className="flex h-full w-full flex-col px-6 pb-6 pt-4 text-fg">
            <div className="mb-3 flex items-center gap-2">
                <Segmented
                    value={activeTab}
                    onChange={setActiveTab}
                    options={[
                        { value: "installed", label: t("plugins.tab.installed") },
                        { value: "store", label: t("plugins.tab.store") },
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
                        placeholder={t("plugins.search.placeholder")}
                        aria-label={t("plugins.search.placeholder")}
                        leftIcon={<Search className="h-4 w-4" />}
                        rightIcon={query ? <X className="h-4 w-4" /> : undefined}
                        rightIconLabel={t("plugins.search.clear")}
                        onRightIconClick={query ? () => setQuery("") : undefined}
                        className="border-transparent bg-transparent focus:border-edge-strong"
                    />
                </div>
                <IconButton
                    variant="ghost"
                    size="sm"
                    onClick={catalog.installLocal}
                    disabled={busy}
                    title={t("plugins.installLocal")}
                    aria-label={t("plugins.installLocal")}
                >
                    <FolderPlus className="h-4 w-4" />
                </IconButton>
                <IconButton
                    variant="ghost"
                    size="sm"
                    onClick={catalog.refreshAll}
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
                            title={t("plugins.emptyList")}
                        />
                    ) : visibleInstalled.length === 0 ? (
                        <EmptyState title={t("plugins.emptyFiltered", { query: q })} />
                    ) : (
                        <div className="flex flex-col gap-0.5">
                            {visibleInstalled.map(plugin => (
                                <InstalledRow
                                    key={plugin.pluginId}
                                    plugin={plugin}
                                    entry={registryById.get(plugin.pluginId) ?? null}
                                    busy={busy}
                                    onOpen={() => setDetailId(plugin.pluginId)}
                                    onAuthorize={() => catalog.approve(plugin.pluginId)}
                                    onToggle={() => catalog.setEnabled(plugin.pluginId, !plugin.enabled)}
                                    onUninstall={() => uninstall(plugin.pluginId)}
                                    onUpdate={() => catalog.installFromStore(plugin.pluginId)}
                                />
                            ))}
                        </div>
                    )
                ) : registryError ? (
                    <EmptyState
                        icon={<AlertTriangle className="h-6 w-6" />}
                        title={t("plugins.store.offline")}
                        description={registryError}
                        action={(
                            <Button size="sm" variant="secondary" onClick={catalog.refreshAll}>
                                {t("plugins.store.retry")}
                            </Button>
                        )}
                    />
                ) : registry === null ? (
                    <EmptyState icon={<RefreshCw className="h-6 w-6 animate-spin" />} />
                ) : visibleStore.length === 0 ? (
                    <EmptyState
                        icon={<Puzzle className="h-6 w-6" />}
                        title={q ? t("plugins.emptyFiltered", { query: q }) : t("plugins.store.emptyList")}
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
                                onInstall={() => catalog.installFromStore(entry.id)}
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
                    onAuthorize={catalog.approve}
                    onSetEnabled={catalog.setEnabled}
                    onUninstall={uninstall}
                    onInstall={catalog.installFromStore}
                />
            ) : null}
        </div>
    );
}

function InstalledRow({
    plugin,
    entry,
    busy,
    onOpen,
    onAuthorize,
    onToggle,
    onUninstall,
    onUpdate,
}: {
    plugin: PluginListItem;
    entry: PluginRegistryEntry | null;
    busy: boolean;
    onOpen: () => void;
    onAuthorize: () => void;
    onToggle: () => void;
    onUninstall: () => void;
    onUpdate: () => void;
}) {
    const { t } = useTranslation();
    const needsAuth = plugin.status === "needsAuthorization";
    const updateAvailable = hasUpdate(plugin, entry);
    // An update this build cannot take is still announced, but as a fact rather
    // than a button — the main process would refuse the install anyway.
    const updatable = updateAvailable && isCompatible(entry);

    return (
        <div className="group relative">
            <button
                type="button"
                onClick={onOpen}
                className="flex w-full cursor-default items-center gap-3 rounded-md px-3 py-2.5 pr-36 text-left transition-colors hover:bg-fill"
            >
                <PluginAvatar name={plugin.manifest.name} src={plugin.iconUrl} />
                <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-sm text-fg">{plugin.manifest.name}</span>
                        {plugin.builtIn ? <Badge tone="primary">{t("plugins.builtIn")}</Badge> : null}
                        <PluginStatusBadge status={plugin.status} />
                        {updateAvailable ? <Badge tone="warning">{t("plugins.updateAvailable")}</Badge> : null}
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
                        {t("plugins.authorize")}
                    </Button>
                ) : (
                    <>
                        {updatable ? (
                            <Button size="sm" variant="primary" onClick={onUpdate} disabled={busy}>
                                {t("plugins.store.update")}
                            </Button>
                        ) : null}
                        {plugin.status !== "error" ? (
                            <RowIconButton
                                title={plugin.enabled ? t("common.disable") : t("common.enable")}
                                disabled={busy}
                                onClick={onToggle}
                            >
                                {plugin.enabled ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
                            </RowIconButton>
                        ) : null}
                    </>
                )}
                {!plugin.builtIn ? (
                    <RowIconButton title={t("plugins.uninstall")} disabled={busy} onClick={onUninstall}>
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
    // A plugin this build is too old for shows what it needs instead of a button
    // the main process would reject.
    const compatible = isCompatible(entry);
    // An installed copy already has its icon on disk, checked at install time —
    // prefer it over asking main to go and fetch the registry's.
    const storeIcon = useStoreIcon(entry.id, Boolean(entry.icon) && !installed?.iconUrl);

    return (
        <div className="group relative">
            <button
                type="button"
                onClick={onOpen}
                className="flex w-full cursor-default items-center gap-3 rounded-md px-3 py-2.5 pr-40 text-left transition-colors hover:bg-fill"
            >
                <PluginAvatar name={entry.name} src={installed?.iconUrl ?? storeIcon} />
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
                {!compatible ? (
                    <Badge tone="warning">
                        {t("plugins.store.needsStudio", { range: entry.studioVersion ?? "" })}
                    </Badge>
                ) : updateAvailable ? (
                    <Button size="sm" variant="primary" onClick={onInstall} disabled={busy}>
                        {t("plugins.store.update")}
                    </Button>
                ) : installed ? (
                    <Badge tone="neutral">{t("plugins.store.installed")}</Badge>
                ) : (
                    <Button size="sm" variant="primary" onClick={onInstall} disabled={busy} className="gap-1">
                        <Download className="h-3.5 w-3.5" />
                        {t("plugins.store.install")}
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
                        "no-drag cursor-default rounded-md px-3 py-1 text-xs font-medium transition-colors",
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

function taskClass(status: PluginCatalogTask["status"]): string {
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
