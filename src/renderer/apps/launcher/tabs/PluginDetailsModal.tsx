import { Modal, dialogFooterButtonClass } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import { PluginDetailsBody } from "@/lib/plugins/ui/PluginDetailsBody";
import { hasUpdate, isCompatible } from "@/lib/plugins/ui/pluginPresentation";
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
  onInstall
}: PluginDetailsModalProps) {
  const { t } = useTranslation();

  const pluginId = installed?.pluginId ?? registryEntry?.id ?? "";
  const name = installed?.manifest.name ?? registryEntry?.name ?? pluginId;
  const updateAvailable = hasUpdate(installed, registryEntry);
  const compatible = isCompatible(registryEntry);

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
      {installed && installed.status === "needsAuthorization" ? (
        <button
          type="button"
          className={dialogFooterButtonClass({ variant: "primary", disabled: busy })}
          onClick={() => onAuthorize(installed.pluginId)}
          disabled={busy}
        >
          {t("plugins.authorize")}
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
