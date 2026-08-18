import { useState } from "react";
import { Badge } from "@/lib/components/elements";
import { nameInitials, nameMonogramColor } from "@/lib/components/monogram";
import { getAppInfo } from "@/lib/renderApp";
import { useTranslation } from "@/lib/i18n";
import type { Translator } from "@shared/i18n";
import { compareSemver, satisfiesRange } from "@shared/utils/semver";
import type { PluginListItem, PluginStatus } from "@shared/types/plugins";
import type { PluginRegistryEntry } from "@shared/types/pluginRegistry";

/**
 * The pieces every plugin list shows the same way, wherever it is shown.
 *
 * Two surfaces list plugins now - the Launcher's tab and the workspace's sidebar panel - and a
 * plugin that reads as "needs authorization" in one and as something else in the other would be two
 * different facts to the author rather than one. So the badge, the tile, and the two version
 * questions live here, once.
 */

/** Whether a registry entry offers a newer version than what is installed. */
export function hasUpdate(
  installed: PluginListItem | null | undefined,
  entry: PluginRegistryEntry | null | undefined
): boolean {
  if (!installed || !entry) return false;
  return compareSemver(entry.version, installed.manifest.version) > 0;
}

/**
 * Whether this Studio build satisfies the range the entry declares. Kept
 * separate from {@link hasUpdate} on purpose: an update the running build cannot
 * take is still worth surfacing, it just needs to say why rather than offering a
 * button that the main process would refuse.
 */
export function isCompatible(entry: PluginRegistryEntry | null | undefined): boolean {
  if (!entry?.studioVersion) return true;
  return satisfiesRange(getAppInfo().version, entry.studioVersion);
}

export function statusText(status: PluginStatus, t: Translator["t"]): string {
  switch (status) {
    case "enabled":
      return t("plugins.status.enabled");
    case "disabled":
      return t("plugins.status.disabled");
    case "needsAuthorization":
      return t("plugins.status.needsAuthorization");
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
  const tone =
    status === "error" ? "danger" : status === "needsAuthorization" ? "warning" : "neutral";
  return <Badge tone={tone}>{statusText(status, t)}</Badge>;
}

/**
 * The plugin's thumbnail, or a monogram tile colored from its name — the same
 * language as the projects list.
 *
 * `src` is always local: an `app://` address for an installed package, a
 * `data:` URL for a store thumbnail main fetched on our behalf. The image is
 * boxed to the same square either way, so a plugin cannot change the shape of
 * its row by what it ships, and anything that still fails to decode falls back
 * to the monogram rather than to a broken-image glyph.
 */
export function PluginAvatar({
  name,
  src,
  size = 36
}: {
  name: string;
  src?: string | null;
  size?: number;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (src && failedSrc !== src) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden
        width={size}
        height={size}
        decoding="async"
        onError={() => setFailedSrc(src)}
        className="shrink-0 rounded-lg object-cover"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-lg text-xs font-medium text-white/90"
      style={{ width: size, height: size, backgroundColor: nameMonogramColor(name) }}
    >
      {nameInitials(name)}
    </span>
  );
}
