import { ExternalLink } from "lucide-react";
import { Badge, Modal, dialogFooterButtonClass } from "@/lib/components/elements";
import { getInterface } from "@/lib/app/bridge";
import { useTranslation } from "@/lib/i18n";
import type { Translator } from "@shared/i18n";
import { compareSemver } from "@shared/utils/semver";
import { describePluginInstallPermissions } from "@shared/utils/pluginInstallPermissions";
import type { PluginListItem, PluginStatus } from "@shared/types/plugins";
import type { PluginRegistryEntry } from "@shared/types/pluginRegistry";
import { projectAvatarColor, projectInitials } from "../projectAvatar";

/** Whether a registry entry offers a newer version than what is installed. */
export function hasUpdate(installed: PluginListItem | null | undefined, entry: PluginRegistryEntry | null | undefined): boolean {
    if (!installed || !entry) return false;
    return compareSemver(entry.version, installed.manifest.version) > 0;
}

export function statusText(status: PluginStatus, t: Translator["t"]): string {
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

/** Status pill, only rendered for states worth flagging (enabled is the quiet default). */
export function PluginStatusBadge({ status }: { status: PluginStatus }) {
    const { t } = useTranslation();
    if (status === "enabled") return null;
    const tone = status === "error" ? "danger" : status === "needsAuthorization" ? "warning" : "neutral";
    return <Badge tone={tone}>{statusText(status, t)}</Badge>;
}

/** A round monogram tile, colored from the plugin name — same language as the projects list. */
export function PluginAvatar({ name, size = 36 }: { name: string; size?: number }) {
    return (
        <span
            aria-hidden
            className="flex shrink-0 items-center justify-center rounded-lg text-xs font-medium text-white/90"
            style={{ width: size, height: size, backgroundColor: projectAvatarColor(name) }}
        >
            {projectInitials(name)}
        </span>
    );
}

export interface PluginDetailsModalProps {
    installed: PluginListItem | null;
    registryEntry: PluginRegistryEntry | null;
    busy: boolean;
    onClose: () => void;
    onAuthorize: (pluginId: string) => void;
    onSetEnabled: (pluginId: string, enabled: boolean) => void;
    onUninstall: (pluginId: string) => void;
    onInstall: (pluginId: string) => void;
}

/**
 * One modal for both faces of a plugin: an installed record and/or its registry
 * entry. It reads whatever is present, so it covers an installed-only plugin
 * (built-in, local), a store-only plugin (not yet installed), and the overlap
 * (installed *and* listed, possibly with an update).
 */
export function PluginDetailsModal({
    installed,
    registryEntry,
    busy,
    onClose,
    onAuthorize,
    onSetEnabled,
    onUninstall,
    onInstall,
}: PluginDetailsModalProps) {
    const { t } = useTranslation();

    const manifest = installed?.manifest;
    const pluginId = installed?.pluginId ?? registryEntry?.id ?? "";
    const name = manifest?.name ?? registryEntry?.name ?? pluginId;
    const version = manifest?.version ?? registryEntry?.version ?? "";
    const publisher = manifest?.publisher ?? registryEntry?.publisher;
    const description = manifest?.description ?? registryEntry?.description;
    const permissions = describePluginInstallPermissions(manifest?.permissions ?? registryEntry?.permissions);
    const entries = manifest
        ? (["studio", "runtime"] as const).filter(target => manifest.entries[target])
        : registryEntry?.targets ?? [];
    const categories = registryEntry?.categories ?? [];
    const updateAvailable = hasUpdate(installed, registryEntry);
    const link = registryEntry?.homepage || registryEntry?.release.page;

    const footer = (
        <div className="flex items-center gap-2">
            {installed && !installed.builtIn ? (
                <button
                    type="button"
                    className={dialogFooterButtonClass({ variant: "secondary", disabled: busy })}
                    onClick={() => onUninstall(installed.pluginId)}
                    disabled={busy}
                >
                    {t("launcher.plugins.uninstall")}
                </button>
            ) : null}
            {installed && installed.status === "needsAuthorization" ? (
                <button
                    type="button"
                    className={dialogFooterButtonClass({ variant: "primary", disabled: busy })}
                    onClick={() => onAuthorize(installed.pluginId)}
                    disabled={busy}
                >
                    {t("launcher.plugins.authorize")}
                </button>
            ) : installed && installed.status !== "error" ? (
                <button
                    type="button"
                    className={dialogFooterButtonClass({ variant: "secondary", disabled: busy })}
                    onClick={() => onSetEnabled(installed.pluginId, !installed.enabled)}
                    disabled={busy}
                >
                    {installed.enabled ? t("common.disable") : t("common.enable")}
                </button>
            ) : null}
            {updateAvailable ? (
                <button
                    type="button"
                    className={dialogFooterButtonClass({ variant: "primary", disabled: busy })}
                    onClick={() => onInstall(pluginId)}
                    disabled={busy}
                >
                    {t("launcher.plugins.store.update")}
                </button>
            ) : !installed && registryEntry ? (
                <button
                    type="button"
                    className={dialogFooterButtonClass({ variant: "primary", disabled: busy })}
                    onClick={() => onInstall(pluginId)}
                    disabled={busy}
                >
                    {t("launcher.plugins.store.install")}
                </button>
            ) : null}
        </div>
    );

    return (
        <Modal isOpen onClose={onClose} title={name} size="md" footer={footer} fullWindowOverlay>
            <div className="space-y-4">
                <div className="flex items-start gap-3">
                    <PluginAvatar name={name} size={44} />
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                            {version ? <Badge tone="neutral">v{version}</Badge> : null}
                            {installed?.builtIn ? <Badge tone="primary">{t("launcher.plugins.builtIn")}</Badge> : null}
                            {installed ? <PluginStatusBadge status={installed.status} /> : null}
                            {updateAvailable ? <Badge tone="warning">{t("launcher.plugins.updateAvailable")}</Badge> : null}
                        </div>
                        <div className="mt-1 font-mono text-xs text-fg-subtle">{pluginId}</div>
                        {publisher ? <div className="mt-0.5 text-xs text-fg-muted">{publisher}</div> : null}
                    </div>
                </div>

                {description ? (
                    <p className="text-sm leading-6 text-fg-muted">{description}</p>
                ) : null}

                {categories.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                        {categories.map(category => (
                            <Badge key={category} tone="neutral">{category}</Badge>
                        ))}
                    </div>
                ) : null}

                <div>
                    <div className="mb-2 text-xs font-medium text-fg-subtle">{t("launcher.plugins.permissions")}</div>
                    {permissions.length > 0 ? (
                        <div className="overflow-hidden rounded-md border border-edge bg-fill-subtle">
                            {permissions.map((permission, index) => (
                                <div
                                    key={`${permission}-${index}`}
                                    className="border-b border-edge px-3 py-2 text-sm text-fg last:border-b-0"
                                >
                                    {permission}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="rounded-md border border-edge bg-fill-subtle px-3 py-2 text-sm text-fg-subtle">
                            {t("launcher.plugins.noPermissions")}
                        </div>
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-subtle">
                    {entries.length > 0 ? (
                        <span>
                            {t("launcher.plugins.field.entries")}
                            {": "}
                            <span className="font-mono text-fg-muted">{entries.join(" · ")}</span>
                        </span>
                    ) : null}
                    {installed ? (
                        <span>
                            {t("launcher.plugins.field.installed")}
                            {": "}
                            {new Date(installed.installedAt).toLocaleDateString()}
                        </span>
                    ) : null}
                    {link ? (
                        <button
                            type="button"
                            onClick={() => void getInterface().app.openExternal(link)}
                            className="no-drag inline-flex cursor-default items-center gap-1 text-primary hover:underline"
                        >
                            <ExternalLink className="h-3 w-3" />
                            {registryEntry?.homepage ? t("launcher.plugins.homepage") : t("launcher.plugins.openReleasePage")}
                        </button>
                    ) : null}
                </div>

                {installed?.lastError ? (
                    <div className="rounded-md border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">
                        {installed.lastError}
                    </div>
                ) : null}
            </div>
        </Modal>
    );
}
