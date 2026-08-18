import { AlertTriangle } from "lucide-react";
import { Button } from "@/lib/components";
import { useTranslation } from "@/lib/i18n";

/**
 * The banner that appears once anything about the installed set has changed in this session.
 *
 * The panel applies changes live, and for what the host owns - panels, blueprint nodes, widgets,
 * actions, story contributions - that is exact: `createPluginApp` tracks every registration and
 * reclaims it on unload. What no host can reclaim is what a plugin's own code did outside that
 * bag: a `window` listener, a patched global, a running timer, a module already imported and
 * therefore cached at its URL. So the banner does not claim a restart is needed, and does not
 * claim it is not - it says what is true, and offers the restart rather than a dismiss, because
 * "close this and wonder" is not an answer to "did that actually take?".
 *
 * Built to `RecoveryBanner`'s shape, which is the other strip that says "this window is in a state
 * you did not start it in, and here is the way out of it" - same warning rule, same icon size, same
 * ghost button, so the two read as one idea rather than two people's idea of a banner.
 */
export function PluginRestartHint({ onRestart, busy }: { onRestart: () => void; busy: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-warning/30 bg-warning/10 px-3 py-1.5">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
      <p className="min-w-0 flex-1 text-xs text-fg-muted">{t("plugins.workspace.restartHint")}</p>
      <Button variant="ghost" size="sm" onClick={onRestart} disabled={busy}>
        {t("plugins.workspace.restart")}
      </Button>
    </div>
  );
}
