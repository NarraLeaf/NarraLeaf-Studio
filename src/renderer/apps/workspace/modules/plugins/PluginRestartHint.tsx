import { AlertTriangle } from "lucide-react";
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
 */
export function PluginRestartHint({ onRestart, busy }: { onRestart: () => void; busy: boolean }) {
    const { t } = useTranslation();
    return (
        <div className="flex shrink-0 items-center gap-2 border-b border-edge-subtle bg-warning/5 px-3 py-2 text-2xs leading-snug text-warning">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1">{t("plugins.workspace.restartHint")}</span>
            <button
                type="button"
                onClick={onRestart}
                disabled={busy}
                className="shrink-0 cursor-default rounded-md border border-warning/30 px-1.5 py-0.5 text-2xs font-medium text-warning transition-colors hover:bg-warning/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
                {t("plugins.workspace.restart")}
            </button>
        </div>
    );
}
