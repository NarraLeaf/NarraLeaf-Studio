import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/lib/components/elements";
import { getInterface } from "@/lib/app/bridge";
import { getAppInfo } from "@/lib/renderApp";
import { useTranslation } from "@/lib/i18n";
import { PluginInstallPermissionSections } from "@/lib/plugins/PluginInstallPermissions";
import type { PluginListItem } from "@shared/types/plugins";
import type { PluginRegistryEntry } from "@shared/types/pluginRegistry";
import { PluginAvatar, PluginStatusBadge, hasUpdate, isCompatible } from "./pluginPresentation";
import { useStoreIcon } from "./useStoreIcon";

export interface PluginDetailsBodyProps {
  installed: PluginListItem | null;
  registryEntry: PluginRegistryEntry | null;
  /**
   * Anything the hosting surface knows and the plugin record does not — the workspace panel puts
   * what the plugin is doing *in this window* here. Rendered under the description, above the
   * permissions.
   */
  children?: ReactNode;
}

/**
 * Everything there is to say about one plugin, from whichever half of it exists.
 *
 * It reads an installed record and/or a registry entry, so it covers an installed-only plugin
 * (built-in, local), a store-only plugin (not yet installed), and the overlap (installed *and*
 * listed, possibly with an update). Actions are NOT here: the Launcher offers them as modal footer
 * buttons and the workspace panel as a sidebar row, and only the words in between are the same.
 */
export function PluginDetailsBody({ installed, registryEntry, children }: PluginDetailsBodyProps) {
  const { t } = useTranslation();

  const manifest = installed?.manifest;
  const pluginId = installed?.pluginId ?? registryEntry?.id ?? "";
  const name = manifest?.name ?? registryEntry?.name ?? pluginId;
  const version = manifest?.version ?? registryEntry?.version ?? "";
  const publisher = manifest?.publisher ?? registryEntry?.publisher;
  const description = manifest?.description ?? registryEntry?.description;
  const permissions = manifest?.permissions ?? registryEntry?.permissions ?? [];
  const entries = manifest
    ? (["studio", "runtime"] as const).filter((target) => manifest.entries[target])
    : (registryEntry?.targets ?? []);
  const categories = registryEntry?.categories ?? [];
  const updateAvailable = hasUpdate(installed, registryEntry);
  const compatible = isCompatible(registryEntry);
  const link = registryEntry?.homepage || registryEntry?.release.page;
  // The installed copy's icon was checked at install time and is already on
  // disk; only fall back to asking main for the registry's.
  const storeIcon = useStoreIcon(pluginId, Boolean(registryEntry?.icon) && !installed?.iconUrl);

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <PluginAvatar name={name} src={installed?.iconUrl ?? storeIcon} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {version ? <Badge tone="neutral">v{version}</Badge> : null}
            {installed?.builtIn ? <Badge tone="primary">{t("plugins.builtIn")}</Badge> : null}
            {installed ? <PluginStatusBadge status={installed.status} /> : null}
            {updateAvailable ? <Badge tone="warning">{t("plugins.updateAvailable")}</Badge> : null}
          </div>
          <div className="mt-1 font-mono text-xs text-fg-subtle">{pluginId}</div>
          {publisher ? <div className="mt-0.5 text-xs text-fg-muted">{publisher}</div> : null}
        </div>
      </div>

      {description ? <p className="text-sm leading-6 text-fg-muted">{description}</p> : null}

      {children}

      {!compatible && registryEntry?.studioVersion ? (
        <div className="rounded-md border border-warning/25 bg-warning/10 px-3 py-2 text-sm text-warning">
          {t("plugins.requiresStudio", {
            range: registryEntry.studioVersion,
            version: getAppInfo().version
          })}
        </div>
      ) : null}

      {categories.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {categories.map((category) => (
            <Badge key={category} tone="neutral">
              {category}
            </Badge>
          ))}
        </div>
      ) : null}

      <div>
        <div className="mb-2 text-xs font-medium text-fg-subtle">{t("plugins.permissions")}</div>
        {permissions.length > 0 ? (
          <PluginInstallPermissionSections permissions={permissions} />
        ) : (
          <div className="rounded-md border border-edge bg-fill-subtle px-3 py-2 text-sm text-fg-subtle">
            {t("plugins.noPermissions")}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-subtle">
        {entries.length > 0 ? (
          <span>
            {t("plugins.field.entries")}
            {": "}
            <span className="font-mono text-fg-muted">{entries.join(" · ")}</span>
          </span>
        ) : null}
        {installed ? (
          <span>
            {t("plugins.field.installed")}
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
            {registryEntry?.homepage ? t("plugins.homepage") : t("plugins.openReleasePage")}
          </button>
        ) : null}
      </div>

      {installed?.lastError ? (
        <div className="rounded-md border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">
          {installed.lastError}
        </div>
      ) : null}
    </div>
  );
}
