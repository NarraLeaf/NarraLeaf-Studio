import { AlertTriangle, X } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

/**
 * The banner that appears once anything about the installed set has changed in this session.
 *
 * The panel applies changes live, and for what the host owns - panels, blueprint nodes, widgets,
 * actions, story contributions - that is exact: `createPluginApp` tracks every registration and
 * reclaims it on unload. What no host can reclaim is what a plugin's own code did outside that
 * bag: a `window` listener, a patched global, a running timer, a module already imported and
 * therefore cached at its URL. So the banner does not claim a restart is needed, and does not
 * claim it is not - it says what is true, and stays until dismissed rather than fading like the
 * task line, because it outlives the operation that raised it.
 */
export function PluginRestartHint({ onDismiss }: { onDismiss: () => void }) {
    const { t } = useTranslation();
    return (
        <div className="flex shrink-0 items-start gap-1.5 border-b border-edge-subtle bg-warning/5 px-3 py-2 text-2xs leading-5 text-warning">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="min-w-0 flex-1">{t("plugins.workspace.restartHint")}</span>
            <button
                type="button"
                onClick={onDismiss}
                title={t("common.close")}
                aria-label={t("common.close")}
                className="grid h-4 w-4 shrink-0 cursor-default place-items-center rounded text-warning/70 transition-colors hover:bg-warning/15 hover:text-warning"
            >
                <X className="h-3 w-3" />
            </button>
        </div>
    );
}
