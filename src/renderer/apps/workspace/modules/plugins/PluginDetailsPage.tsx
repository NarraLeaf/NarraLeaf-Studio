import { ArrowLeft } from "lucide-react";
import { Button } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import { PluginDetailsBody } from "@/lib/plugins/ui/PluginDetailsBody";
import { hasUpdate, isCompatible } from "@/lib/plugins/ui/pluginPresentation";
import type { PluginListItem } from "@shared/types/plugins";
import type { PluginRegistryEntry } from "@shared/types/pluginRegistry";
import type { PluginCatalogTask } from "@/lib/plugins/ui/usePluginCatalog";
import { PluginRestartHint } from "./PluginRestartHint";
import { PluginTaskLine } from "./PluginTaskLine";
import type { PluginActivity } from "./useWorkspacePluginActivity";

export interface PluginDetailsPageProps {
    installed: PluginListItem | null;
    registryEntry: PluginRegistryEntry | null;
    /** What it is doing in this window; null for a plugin that is not installed at all. */
    activity: PluginActivity | null;
    /** Why its last load attempt here failed, when one did. */
    loadError: string | null;
    busy: boolean;
    /** What the panel is doing; shown here too, since the page covers the list's own line. */
    task: PluginCatalogTask;
    /** Whether the session's restart banner is up; shown here for the same reason as `task`. */
    restartHint: boolean;
    onRestartWorkspace: () => void;
    /** False in a recovery window, where nothing is loaded and nothing can be. */
    canReload: boolean;
    /**
     * False in a recovery window. Not a capability limit - the record is writable there - but a
     * deliberate one: that mode exists to keep the evidence of a broken open intact, and which
     * plugin was installed at which version is part of it. Disabling still works.
     */
    canUninstall: boolean;
    onBack: () => void;
    onAuthorize: (pluginId: string) => void;
    onSetEnabled: (pluginId: string, enabled: boolean) => void;
    onUninstall: (pluginId: string) => void;
    onInstall: (pluginId: string) => void;
    onReload: (pluginId: string) => void;
}

/**
 * One plugin, as a sidebar sub-page: the shared details body plus what this workspace can say about
 * it, over an action row. The Launcher shows the same body in a modal instead.
 */
export function PluginDetailsPage({
    installed,
    registryEntry,
    activity,
    loadError,
    busy,
    task,
    restartHint,
    onRestartWorkspace,
    canReload,
    canUninstall,
    onBack,
    onAuthorize,
    onSetEnabled,
    onUninstall,
    onInstall,
    onReload,
}: PluginDetailsPageProps) {
    const { t } = useTranslation();

    const pluginId = installed?.pluginId ?? registryEntry?.id ?? "";
    const name = installed?.manifest.name ?? registryEntry?.name ?? pluginId;
    const updateAvailable = hasUpdate(installed, registryEntry);
    const compatible = isCompatible(registryEntry);
    const reloadable = canReload
        && Boolean(installed?.manifest.entries.studio)
        && activity !== null
        && activity !== "off"
        && activity !== "runtimeOnly";

    return (
        <div className="flex h-full min-h-0 flex-col bg-surface text-fg">
            <div className="flex shrink-0 items-center gap-2 border-b border-edge p-2">
                <button
                    type="button"
                    onClick={onBack}
                    className="grid h-7 w-7 shrink-0 cursor-default place-items-center rounded-md text-fg-muted transition-colors hover:bg-fill hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                    aria-label={t("common.back")}
                    title={t("common.back")}
                >
                    <ArrowLeft className="h-4 w-4" />
                </button>
                <div className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{name}</div>
            </div>

            <PluginTaskLine task={task} />

            {restartHint ? <PluginRestartHint onRestart={onRestartWorkspace} busy={busy} /> : null}

            <div className="min-h-0 flex-1 overflow-auto p-3">
                <PluginDetailsBody installed={installed} registryEntry={registryEntry}>
                    <WorkspaceActivityNote activity={activity} loadError={loadError} />
                </PluginDetailsBody>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-edge px-3 py-2">
                {installed && installed.status === "needsAuthorization" ? (
                    <Button size="sm" variant="primary" disabled={busy} onClick={() => onAuthorize(installed.pluginId)}>
                        {t("plugins.authorize")}
                    </Button>
                ) : installed && installed.status !== "error" ? (
                    <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => onSetEnabled(installed.pluginId, !installed.enabled)}
                    >
                        {installed.enabled ? t("common.disable") : t("common.enable")}
                    </Button>
                ) : null}
                {updateAvailable ? (
                    <Button size="sm" variant="primary" disabled={busy || !compatible} onClick={() => onInstall(pluginId)}>
                        {t("plugins.store.update")}
                    </Button>
                ) : !installed && registryEntry ? (
                    <Button size="sm" variant="primary" disabled={busy || !compatible} onClick={() => onInstall(pluginId)}>
                        {t("plugins.store.install")}
                    </Button>
                ) : null}
                {reloadable && installed ? (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => onReload(installed.pluginId)}>
                        {t("plugins.workspace.reload")}
                    </Button>
                ) : null}
                {installed && !installed.builtIn && canUninstall ? (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => onUninstall(installed.pluginId)}>
                        {t("plugins.uninstall")}
                    </Button>
                ) : null}
            </div>
        </div>
    );
}

/**
 * What this window is doing with the plugin, in the one place where the answer is worth a sentence
 * rather than the list's three words. Silent for the two states that need no explanation: running,
 * and switched off.
 */
function WorkspaceActivityNote({ activity, loadError }: { activity: PluginActivity | null; loadError: string | null }) {
    const { t } = useTranslation();

    if (activity === null || activity === "off") {
        return null;
    }
    if (activity === "running") {
        return (
            <div className="rounded-md border border-edge bg-fill-subtle px-3 py-2 text-xs text-fg-muted">
                {t("plugins.workspace.activity.running")}
            </div>
        );
    }
    if (activity === "runtimeOnly") {
        return (
            <div className="rounded-md border border-edge bg-fill-subtle px-3 py-2 text-xs text-fg-muted">
                {t("plugins.workspace.activity.runtimeOnlyHint")}
            </div>
        );
    }
    if (activity === "suppressed") {
        return (
            <div className="rounded-md border border-warning/25 bg-warning/10 px-3 py-2 text-xs leading-5 text-warning">
                {t("plugins.workspace.activity.suppressedHint")}
            </div>
        );
    }
    if (activity === "failed") {
        return (
            <div className="rounded-md border border-danger/25 bg-danger/10 px-3 py-2 text-xs leading-5 text-danger">
                <div>{t("plugins.workspace.activity.failed")}</div>
                {loadError ? <div className="mt-1 font-mono text-2xs opacity-80">{loadError}</div> : null}
            </div>
        );
    }
    return (
        <div className="rounded-md border border-edge bg-fill-subtle px-3 py-2 text-xs text-fg-muted">
            {t("plugins.workspace.pendingReopen")}
        </div>
    );
}
