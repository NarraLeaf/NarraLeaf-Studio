import { Modal, dialogFooterButtonClass } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import { PluginDetailsBody } from "@/lib/plugins/ui/PluginDetailsBody";
import { hasUpdate, isCompatible } from "@/lib/plugins/ui/pluginPresentation";
import { pluginRecordActions } from "@/lib/plugins/ui/pluginRecordActions";
import type { PluginListItem } from "@shared/types/plugins";
import type { PluginRegistryEntry } from "@shared/types/pluginRegistry";

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
 * The Launcher's plugin details: the shared body in a modal, with this surface's actions in the
 * footer. The workspace shows the same body as a sidebar sub-page instead.
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

    const pluginId = installed?.pluginId ?? registryEntry?.id ?? "";
    const name = installed?.manifest.name ?? registryEntry?.name ?? pluginId;
    const updateAvailable = hasUpdate(installed, registryEntry);
    const compatible = isCompatible(registryEntry);
    // No window here runs a plugin, so writing the record is the whole change and there is nothing
    // to retry: Enable clears a recorded failure on its way past, and the next project to open is
    // what tries the plugin again.
    const actions = installed ? pluginRecordActions(installed, false) : null;

    const footer = (
        <div className="flex items-center gap-2">
            {installed && !installed.builtIn ? (
                <button
                    type="button"
                    className={dialogFooterButtonClass({ variant: "secondary", disabled: busy })}
                    onClick={() => onUninstall(installed.pluginId)}
                    disabled={busy}
                >
                    {t("plugins.uninstall")}
                </button>
            ) : null}
            {installed && actions?.authorize ? (
                <button
                    type="button"
                    className={dialogFooterButtonClass({ variant: "primary", disabled: busy })}
                    onClick={() => onAuthorize(installed.pluginId)}
                    disabled={busy}
                >
                    {t("plugins.authorize")}
                </button>
            ) : null}
            {installed && actions?.toggle ? (
                <button
                    type="button"
                    className={dialogFooterButtonClass({ variant: "secondary", disabled: busy })}
                    onClick={() => onSetEnabled(installed.pluginId, actions.toggle === "enable")}
                    disabled={busy}
                >
                    {actions.toggle === "enable" ? t("common.enable") : t("common.disable")}
                </button>
            ) : null}
            {updateAvailable ? (
                <button
                    type="button"
                    className={dialogFooterButtonClass({ variant: "primary", disabled: busy || !compatible })}
                    onClick={() => onInstall(pluginId)}
                    disabled={busy || !compatible}
                >
                    {t("plugins.store.update")}
                </button>
            ) : !installed && registryEntry ? (
                <button
                    type="button"
                    className={dialogFooterButtonClass({ variant: "primary", disabled: busy || !compatible })}
                    onClick={() => onInstall(pluginId)}
                    disabled={busy || !compatible}
                >
                    {t("plugins.store.install")}
                </button>
            ) : null}
        </div>
    );

    return (
        <Modal isOpen onClose={onClose} title={name} size="md" footer={footer}>
            <PluginDetailsBody installed={installed} registryEntry={registryEntry} />
        </Modal>
    );
}
