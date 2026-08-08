import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Download, MoreVertical, Puzzle, RefreshCw } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { Badge } from "@/lib/components/elements";
import { ContextMenu, type ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import { PluginAvatar, PluginStatusBadge, hasUpdate, isCompatible } from "@/lib/plugins/ui/pluginPresentation";
import { useStoreIcon } from "@/lib/plugins/ui/useStoreIcon";
import { filterInstalled, filterStore, usePluginCatalog } from "@/lib/plugins/ui/usePluginCatalog";
import { activateWorkspacePlugin, deactivateWorkspacePlugin } from "@/lib/plugins/pluginRuntime";
import { flushPendingSaves } from "@/lib/workspace/services/autosave/flushPendingSaves";
import type { PluginListItem } from "@shared/types/plugins";
import type { PluginRegistryEntry } from "@shared/types/pluginRegistry";
import { useWorkspace } from "../../context";
import { useWorkspaceFrozen } from "../../hooks/useWorkspaceFrozen";
import { SearchBox } from "../assets/components/SearchBox";
import type { PanelComponentProps } from "../types";
import type { PluginsPanelPayload } from "./openPluginsPanel";
import { PluginDetailsPage } from "./PluginDetailsPage";
import { PluginRestartHint } from "./PluginRestartHint";
import { PluginTaskLine } from "./PluginTaskLine";
import { ACTIVITY_LABEL_KEYS, ACTIVITY_TONES } from "./pluginActivityLabels";
import { useWorkspacePluginActivity, type PluginActivity } from "./useWorkspacePluginActivity";

type PluginsTab = "installed" | "store";

/**
 * Plugin management inside the workspace: the same installed list and store the Launcher shows,
 * plus the half only a window with a project open can answer - whether each plugin is actually
 * running here, and why not when it is not.
 *
 * Changes apply to the open workspace immediately. Switching a plugin off unloads its code and
 * reclaims its panels, nodes and widgets; switching one on loads it. That is the whole reason this
 * panel exists rather than a link back to the Launcher: managing plugins used to mean closing the
 * project, and a plugin you have to reopen a project to try is a plugin nobody tries.
 */
export function PluginsPanel({ panelId, payload }: PanelComponentProps<PluginsPanelPayload | undefined>) {
    const { t } = useTranslation();
    const { context, recovery } = useWorkspace();
    const [tab, setTab] = useState<PluginsTab>("installed");
    const [query, setQuery] = useState("");
    const [detailId, setDetailId] = useState<string | null>(null);
    const [menu, setMenu] = useState<{ items: ContextMenuDef; position: { x: number; y: number } } | null>(null);
    // Raised by the first change of the session; it goes away when the restart it offers happens.
    const [restartHint, setRestartHint] = useState(false);

    const activity = useWorkspacePluginActivity();

    // Whether a change may also start or stop the plugin *in this window*, as opposed to only
    // writing the record every window shares.
    //
    // A recovery window loads no plugins at all, so it must not pretend to. A frozen one is the
    // subtler case: the record is global and stays perfectly writable - freezing a project does not
    // make the author's plugin list read-only - but mounting a plugin's code fresh would run its
    // `setup()` against a document that is a past revision or an unresolved merge, and a plugin's
    // own store is versioned, so a plugin that writes on startup would write there. Deferring the
    // mount costs nothing: `onChanged` raises the restart banner either way, and the restart is
    // where it comes up honestly.
    const frozen = useWorkspaceFrozen();
    const live = Boolean(context) && !recovery && !frozen;

    const catalog = usePluginCatalog({
        beforeDeactivate: async pluginId => {
            if (!live || !context) return;
            await deactivateWorkspacePlugin(context, pluginId);
        },
        afterActivate: async pluginId => {
            if (!live || !context) return;
            const result = await activateWorkspacePlugin(context, pluginId);
            if (result && !result.ok) {
                throw new Error(result.error);
            }
        },
        onLocalInstalled: () => setTab("installed"),
        onChanged: () => setRestartHint(true),
    });

    const { plugins, registry, registryError, registryLoading, task, busy, installedById, registryById } = catalog;

    // Deep link. Depends on the payload OBJECT rather than payload.pluginId: the panel is keep-alive,
    // so asking twice for the same plugin after backing out would otherwise change nothing.
    useEffect(() => {
        if (payload?.pluginId) {
            setTab("installed");
            setDetailId(payload.pluginId);
        }
    }, [payload]);

    // Escape returns to the list when a plugin's page is open.
    useEffect(() => {
        if (!detailId) {
            return;
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.stopPropagation();
                setDetailId(null);
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [detailId]);

    const visibleInstalled = useMemo(() => filterInstalled(plugins, query), [plugins, query]);
    const visibleStore = useMemo(() => filterStore(registry ?? [], query), [registry, query]);

    const reload = useCallback((pluginId: string) => {
        if (!live || !context) return;
        void catalog.runTask(t("plugins.task.reloading"), async () => {
            await deactivateWorkspacePlugin(context, pluginId);
            const result = await activateWorkspacePlugin(context, pluginId);
            if (result && !result.ok) {
                throw new Error(result.error);
            }
            catalog.setTask({ status: "success", message: t("plugins.task.reloaded") });
        });
    }, [catalog, context, live, t]);

    /**
     * Restart the workspace: flush every pending save, then reload this window.
     *
     * A reload rather than reopening the project through `workspace.openRecent`, which would find
     * the window already holding this project and merely focus it. The flush is not optional -
     * auto-save is debounced, so a reload 300ms after the last keystroke would take that keystroke
     * with it - and it is the same helper the main process runs before it closes a workspace.
     */
    const restartWorkspace = useCallback(() => {
        if (!context) return;
        void catalog.runTask(t("plugins.workspace.restarting"), async () => {
            await flushPendingSaves(context);
            window.location.reload();
        });
    }, [catalog, context, t]);

    const uninstall = useCallback((pluginId: string) => {
        catalog.uninstall(pluginId);
        // Leave the page open only if the plugin still exists as a store entry to install again.
        setDetailId(current => (current && registry?.some(entry => entry.id === current) ? current : null));
    }, [catalog, registry]);

    const openRowMenu = useCallback((event: React.MouseEvent, plugin: PluginListItem) => {
        event.preventDefault();
        event.stopPropagation();
        const entry = registryById.get(plugin.pluginId) ?? null;
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        const items: ContextMenuDef = [];

        if (plugin.status === "needsAuthorization") {
            items.push({ id: "authorize", label: t("plugins.authorize"), onClick: () => catalog.approve(plugin.pluginId) });
        } else if (plugin.status !== "error") {
            items.push({
                id: "toggle",
                label: plugin.enabled ? t("common.disable") : t("common.enable"),
                onClick: () => catalog.setEnabled(plugin.pluginId, !plugin.enabled),
            });
        }
        if (hasUpdate(plugin, entry) && isCompatible(entry)) {
            items.push({ id: "update", label: t("plugins.store.update"), onClick: () => catalog.installFromStore(plugin.pluginId) });
        }
        // Reloading a plugin that is not running here would be a no-op dressed as an action.
        if (live && activity.activityOf(plugin) !== "off" && plugin.manifest.entries.studio) {
            items.push({ id: "reload", label: t("plugins.workspace.reload"), onClick: () => reload(plugin.pluginId) });
        }
        // Uninstall is the one action a recovery window may not offer. That mode exists because
        // opening a broken project can destroy the evidence of why it broke, and "which plugin, at
        // which version, was installed when this started" is exactly that kind of evidence -
        // deleting it answers the question the author came here to ask. Disable is right there and
        // stops the plugin loading next time without taking the bytes with it.
        if (!plugin.builtIn && !recovery) {
            items.push({ separator: true, id: "sep-uninstall" });
            items.push({ id: "uninstall", label: t("plugins.uninstall"), onClick: () => uninstall(plugin.pluginId) });
        }

        const disabled = busy ? items.map(item => ("separator" in item ? item : { ...item, disabled: true })) : items;
        setMenu({ items: disabled, position: { x: rect.right, y: rect.bottom } });
    }, [activity, busy, catalog, live, registryById, reload, t, uninstall]);

    const openPanelMenu = useCallback((event: React.MouseEvent) => {
        event.preventDefault();
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        setMenu({
            items: [
                { id: "install-local", label: t("plugins.installLocal"), disabled: busy, onClick: catalog.installLocal },
                { id: "refresh", label: t("common.refresh"), disabled: busy, onClick: catalog.refreshAll },
            ],
            position: { x: rect.right, y: rect.bottom },
        });
    }, [busy, catalog, t]);

    const detailInstalled = detailId ? installedById.get(detailId) ?? null : null;
    const detailEntry = detailId ? registryById.get(detailId) ?? null : null;

    return (
        <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-surface" data-panel-id={panelId}>
            <div className="shrink-0 space-y-2 border-b border-edge px-3 py-2">
                <div className="flex items-center gap-2">
                    <Segmented
                        value={tab}
                        onChange={setTab}
                        options={[
                            { value: "installed", label: t("plugins.tab.installed") },
                            { value: "store", label: t("plugins.tab.store") },
                        ]}
                    />
                    <div className="flex-1" />
                    <button
                        type="button"
                        onClick={openPanelMenu}
                        title={t("plugins.moreActions")}
                        aria-label={t("plugins.moreActions")}
                        className="grid h-7 w-7 shrink-0 cursor-default place-items-center rounded-md text-fg-muted transition-colors hover:bg-fill hover:text-fg"
                    >
                        {registryLoading || busy
                            ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                            : <MoreVertical className="h-4 w-4" />}
                    </button>
                </div>
                <SearchBox value={query} onChange={setQuery} placeholder={t("plugins.search.placeholder")} className="w-full" />
            </div>

            <PluginTaskLine task={task} />

            {restartHint ? <PluginRestartHint onRestart={restartWorkspace} busy={busy} /> : null}

            {recovery ? (
                <div className="shrink-0 border-b border-edge-subtle bg-warning/5 px-3 py-2 text-2xs leading-5 text-warning">
                    {t("plugins.workspace.recoveryNotice")}
                </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto">
                {tab === "installed" ? (
                    visibleInstalled.length === 0 ? (
                        <PanelEmpty message={plugins.length === 0
                            ? t("plugins.emptyList")
                            : t("plugins.emptyFiltered", { query: query.trim() })} />
                    ) : (
                        visibleInstalled.map(plugin => (
                            <InstalledRow
                                key={plugin.pluginId}
                                plugin={plugin}
                                entry={registryById.get(plugin.pluginId) ?? null}
                                activity={activity.activityOf(plugin)}
                                onOpen={() => setDetailId(plugin.pluginId)}
                                onMenu={event => openRowMenu(event, plugin)}
                            />
                        ))
                    )
                ) : registryError ? (
                    <PanelEmpty message={t("plugins.store.offline")} detail={registryError} onRetry={catalog.refreshAll} retryLabel={t("plugins.store.retry")} />
                ) : registry === null ? (
                    <div className="flex h-24 items-center justify-center text-fg-subtle">
                        <RefreshCw className="h-4 w-4 animate-spin" />
                    </div>
                ) : visibleStore.length === 0 ? (
                    <PanelEmpty message={query.trim()
                        ? t("plugins.emptyFiltered", { query: query.trim() })
                        : t("plugins.store.emptyList")} />
                ) : (
                    visibleStore.map(entry => (
                        <StoreRow
                            key={entry.id}
                            entry={entry}
                            installed={installedById.get(entry.id) ?? null}
                            busy={busy}
                            onOpen={() => setDetailId(entry.id)}
                            onInstall={() => catalog.installFromStore(entry.id)}
                        />
                    ))
                )}
            </div>

            <AnimatePresence>
                {detailId && (detailInstalled || detailEntry) ? (
                    <motion.div
                        key={detailId}
                        // `.nl-opaque-surface` rather than `bg-surface`: this slides over the list,
                        // which stays mounted underneath, so its fill has to survive the wallpaper
                        // rule that clears every base surface (see styles.css).
                        className="absolute inset-0 z-10 nl-opaque-surface shadow-[-8px_0_24px_rgba(0,0,0,0.35)]"
                        initial={{ x: "100%" }}
                        animate={{ x: 0 }}
                        exit={{ x: "100%" }}
                        transition={{ type: "tween", duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                    >
                        <PluginDetailsPage
                            installed={detailInstalled}
                            registryEntry={detailEntry}
                            activity={detailInstalled ? activity.activityOf(detailInstalled) : null}
                            task={task}
                            restartHint={restartHint}
                            onRestartWorkspace={restartWorkspace}
                            loadError={detailInstalled ? activity.session.failed[detailInstalled.pluginId] ?? null : null}
                            busy={busy}
                            canReload={live}
                            canUninstall={!recovery}
                            onBack={() => setDetailId(null)}
                            onAuthorize={catalog.approve}
                            onSetEnabled={catalog.setEnabled}
                            onUninstall={uninstall}
                            onInstall={catalog.installFromStore}
                            onReload={reload}
                        />
                    </motion.div>
                ) : null}
            </AnimatePresence>

            {menu ? (
                <ContextMenu items={menu.items} position={menu.position} visible onClose={() => setMenu(null)} />
            ) : null}
        </div>
    );
}

function InstalledRow({
    plugin,
    entry,
    activity,
    onOpen,
    onMenu,
}: {
    plugin: PluginListItem;
    entry: PluginRegistryEntry | null;
    activity: PluginActivity;
    onOpen: () => void;
    onMenu: (event: React.MouseEvent) => void;
}) {
    const { t } = useTranslation();
    const updateAvailable = hasUpdate(plugin, entry);
    // `running` is the quiet default: a row that says "working correctly" on every plugin turns the
    // list into a status dashboard and buries the two rows that need reading.
    const activityKey = ACTIVITY_LABEL_KEYS[activity];

    return (
        <div
            className="group flex cursor-default items-center gap-2.5 border-b border-edge-subtle px-3 py-2 transition-colors last:border-b-0 hover:bg-fill"
            onClick={onOpen}
            onContextMenu={onMenu}
        >
            <PluginAvatar name={plugin.manifest.name} src={plugin.iconUrl} size={28} />
            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-sm text-fg">{plugin.manifest.name}</span>
                    {plugin.builtIn ? <Badge tone="primary">{t("plugins.builtIn")}</Badge> : null}
                    <PluginStatusBadge status={plugin.status} />
                    {updateAvailable ? <Badge tone="warning">{t("plugins.updateAvailable")}</Badge> : null}
                </div>
                <div className="truncate text-2xs text-fg-subtle">
                    {activityKey ? (
                        <span className={ACTIVITY_TONES[activity]}>{t(activityKey)}</span>
                    ) : (
                        plugin.manifest.publisher || plugin.pluginId
                    )}
                </div>
            </div>
            <button
                type="button"
                onClick={onMenu}
                title={t("plugins.moreActionsNamed", { name: plugin.manifest.name })}
                aria-label={t("plugins.moreActionsNamed", { name: plugin.manifest.name })}
                className="grid h-6 w-6 shrink-0 cursor-default place-items-center rounded-md text-fg-muted opacity-0 transition hover:bg-fill-strong hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
            >
                <MoreVertical className="h-3.5 w-3.5" />
            </button>
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
    const compatible = isCompatible(entry);
    // An installed copy already has its icon on disk, checked at install time.
    const storeIcon = useStoreIcon(entry.id, Boolean(entry.icon) && !installed?.iconUrl);

    return (
        <div
            className="group flex cursor-default items-center gap-2.5 border-b border-edge-subtle px-3 py-2 transition-colors last:border-b-0 hover:bg-fill"
            onClick={onOpen}
        >
            <PluginAvatar name={entry.name} src={installed?.iconUrl ?? storeIcon} size={28} />
            <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-fg">{entry.name}</div>
                <div className="truncate text-2xs text-fg-subtle">{entry.description || entry.publisher}</div>
            </div>
            {!compatible ? (
                <Badge tone="warning">{t("plugins.store.needsStudio", { range: entry.studioVersion ?? "" })}</Badge>
            ) : installed && !updateAvailable ? (
                <span className="shrink-0 text-2xs text-fg-subtle">{t("plugins.store.installed")}</span>
            ) : (
                <button
                    type="button"
                    disabled={busy}
                    onClick={event => { event.stopPropagation(); onInstall(); }}
                    title={updateAvailable ? t("plugins.store.update") : t("plugins.store.install")}
                    aria-label={updateAvailable ? t("plugins.store.update") : t("plugins.store.install")}
                    className="grid h-6 w-6 shrink-0 cursor-default place-items-center rounded-md text-fg-muted transition hover:bg-fill-strong hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
                >
                    <Download className="h-3.5 w-3.5" />
                </button>
            )}
        </div>
    );
}

function PanelEmpty({
    message,
    detail,
    onRetry,
    retryLabel,
}: {
    message: string;
    detail?: string;
    onRetry?: () => void;
    retryLabel?: string;
}) {
    return (
        <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <Puzzle className="h-5 w-5 text-fg-subtle" />
            <div className="text-xs text-fg-muted">{message}</div>
            {detail ? <div className="text-2xs text-fg-subtle">{detail}</div> : null}
            {onRetry ? (
                <button
                    type="button"
                    onClick={onRetry}
                    className="cursor-default rounded-md px-2 py-1 text-2xs text-primary hover:bg-fill"
                >
                    {retryLabel}
                </button>
            ) : null}
        </div>
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
                        "cursor-default rounded-md px-2 py-0.5 text-2xs font-medium transition-colors",
                        value === option.value ? "bg-fill-strong text-fg shadow-sm" : "text-fg-muted hover:text-fg",
                    )}
                >
                    {option.label}
                </button>
            ))}
        </div>
    );
}
