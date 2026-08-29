import React, { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle, type LucideIcon } from "lucide-react";
import { Notification, NotificationType } from "@/lib/workspace/services/ui/types";
import { useWorkspace } from "../../context";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { Services } from "@/lib/workspace/services/services";
import { useTranslation } from "@/lib/i18n";
import { Button } from "@/lib/components/elements";
import { ToolbarButton } from "@/lib/components/elements/ToolbarButton";
import { cn } from "@/lib/utils/cn";

/** One outline glyph per type, from the icon set the rest of the workspace uses. */
const TYPE_ICON: Record<NotificationType, LucideIcon> = {
    [NotificationType.Info]: Info,
    [NotificationType.Success]: CheckCircle2,
    [NotificationType.Warning]: AlertTriangle,
    [NotificationType.Error]: XCircle,
};

/** Info reuses `primary`; there is no separate info token (design-system §1). */
const TYPE_ACCENT: Record<NotificationType, string> = {
    [NotificationType.Info]: "border-l-primary text-primary",
    [NotificationType.Success]: "border-l-success text-success",
    [NotificationType.Warning]: "border-l-warning text-warning",
    [NotificationType.Error]: "border-l-danger text-danger",
};

/**
 * Individual notification item.
 *
 * A notification is an overlay, so it sits on the opaque overlay surface rather
 * than on a translucent wash of its own accent colour behind a blur: a message
 * that may carry a build path or a compiler error is the last thing that can
 * afford to be read against a blurred screenshot of whatever is underneath it.
 * The type is carried by the icon and a hairline down the leading edge instead,
 * neither of which touches the contrast of the words.
 */
function NotificationItem({ notification, onClose }: { notification: Notification; onClose: () => void }) {
    const { t } = useTranslation();
    const Icon = TYPE_ICON[notification.type];
    const accent = TYPE_ACCENT[notification.type];

    return (
        <div
            role={notification.type === NotificationType.Error ? "alert" : "status"}
            className={cn(
                "flex w-96 items-start gap-3 rounded-lg p-3",
                // Per-side widths rather than `border` + `border-l-2`: the engine
                // (narraleaf-react) ships a compiled Tailwind v4 sheet that the
                // workspace window injects after its own, and its `.border` rule
                // lands last and resets all four widths to 1px.
                "border-y border-r border-l-2 border-edge bg-surface-overlay shadow-lg shadow-black/30",
                "animate-slide-in-right",
                accent,
            )}
        >
            <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />

            <div className="min-w-0 flex-1">
                <p className="nl-selectable-text text-sm font-medium text-fg">{notification.message}</p>
                {notification.detail && (
                    <p className="nl-selectable-text mt-1 text-xs text-fg-muted">{notification.detail}</p>
                )}

                {notification.actions && notification.actions.length > 0 && (
                    <div className="mt-3 flex gap-2">
                        {notification.actions.map((action, index) => (
                            <Button
                                key={index}
                                size="sm"
                                variant={action.primary ? "primary" : "secondary"}
                                onClick={() => {
                                    action.onClick();
                                    onClose();
                                }}
                            >
                                {action.label}
                            </Button>
                        ))}
                    </div>
                )}
            </div>

            {notification.closable && (
                <ToolbarButton
                    size="xs"
                    onClick={onClose}
                    className="-mr-1 -mt-1 flex-shrink-0"
                    aria-label={t("common.close")}
                >
                    <X className="h-3.5 w-3.5" />
                </ToolbarButton>
            )}
        </div>
    );
}

/**
 * Notification container
 * Displays all active notifications in a corner of the screen
 */
export function NotificationContainer() {
    const { context } = useWorkspace();
    const [notifications, setNotifications] = useState<Notification[]>([]);

    useEffect(() => {
        if (!context) return;
        
        const uiService = context.services.get<UIService>(Services.UI);
        const store = uiService.getStore();
        
        // Initial state
        setNotifications(store.getNotifications());

        // Subscribe to changes
        const events = uiService.getEvents();
        const unsubscribe = events.on("stateChanged", (changes) => {
            if (changes.notifications) {
                setNotifications([...changes.notifications]);
            }
        });

        return unsubscribe;
    }, [context]);

    if (notifications.length === 0 || !context) {
        return null;
    }

    return (
        <div
            aria-live="polite"
            className="fixed right-4 top-[calc(var(--nl-window-titlebar-height)+1rem)] z-50 flex flex-col gap-2 pointer-events-none"
        >
            {notifications.map(notification => (
                <div key={notification.id} className="pointer-events-auto">
                    <NotificationItem
                        notification={notification}
                        onClose={() => {
                            const uiService = context.services.get<UIService>(Services.UI);
                            uiService.notifications.close(notification.id);
                        }}
                    />
                </div>
            ))}
        </div>
    );
}
