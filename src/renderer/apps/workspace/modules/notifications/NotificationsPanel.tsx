import { useEffect, useSyncExternalStore } from "react";
import { AlertTriangle, CheckCircle2, Info, Trash2, XCircle } from "lucide-react";
import { useWorkspace } from "../../context";
import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { NotificationType } from "@/lib/workspace/services/ui/types";

const TYPE_META: Record<NotificationType, { icon: React.ReactNode; className: string }> = {
    [NotificationType.Info]: { icon: <Info className="h-3.5 w-3.5" />, className: "text-fg-muted" },
    [NotificationType.Success]: { icon: <CheckCircle2 className="h-3.5 w-3.5" />, className: "text-success" },
    [NotificationType.Warning]: { icon: <AlertTriangle className="h-3.5 w-3.5" />, className: "text-warning" },
    [NotificationType.Error]: { icon: <XCircle className="h-3.5 w-3.5" />, className: "text-danger" },
};

function formatTime(timestamp: number, locale: string): string {
    return new Date(timestamp).toLocaleString(locale, {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

/**
 * Notification center as a right-dock panel: the ring-buffered toast history (dismissed ones
 * included) with a one-click clear. Being mounted marks the history as seen, so the bell badge
 * resets however the panel was reached (bell click or rail icon).
 */
export function NotificationsPanel() {
    const { t, locale } = useTranslation();
    const { context } = useWorkspace();
    const notifications = context ? context.services.get<UIService>(Services.UI).notifications : null;

    const history = useSyncExternalStore(
        listener => notifications?.onHistoryChanged(listener) ?? (() => {}),
        () => notifications?.getHistory() ?? [],
    );

    // Everything visible counts as read — including entries arriving while the panel is open.
    useEffect(() => {
        if (notifications && notifications.getUnreadCount() > 0) {
            notifications.markHistorySeen();
        }
    }, [notifications, history]);

    return (
        <div className="flex h-full flex-col">
            <div className="flex shrink-0 items-center justify-end px-3 pt-2 pb-1">
                {history.length > 0 && (
                    <button
                        type="button"
                        onClick={() => notifications?.clearHistory()}
                        title={t("workspace.shell.notifications.clearAll")}
                        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-fg-muted transition-colors hover:bg-fill hover:text-fg"
                    >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>{t("workspace.shell.notifications.clearAll")}</span>
                    </button>
                )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
                {history.length === 0 ? (
                    <div className="px-4 py-8 text-center text-sm text-fg-subtle">
                        {t("workspace.shell.notifications.empty")}
                    </div>
                ) : (
                    history.map(entry => {
                        const meta = TYPE_META[entry.type] ?? TYPE_META[NotificationType.Info];
                        return (
                            <div key={entry.id} className="border-b border-edge-subtle px-3 py-2.5">
                                <div className="flex items-start gap-2">
                                    <span className={`mt-0.5 shrink-0 ${meta.className}`}>{meta.icon}</span>
                                    <div className="min-w-0 flex-1">
                                        <div className="text-sm text-fg-muted">{entry.message}</div>
                                        {entry.detail && (
                                            <div className="mt-0.5 text-xs leading-5 text-fg-subtle">
                                                {entry.detail}
                                            </div>
                                        )}
                                        <div className="mt-1 text-2xs text-fg-subtle">
                                            {formatTime(entry.timestamp, locale)}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
