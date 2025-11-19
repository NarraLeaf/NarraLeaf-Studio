import React, { useEffect, useState } from "react";
import { Notification, NotificationType } from "@/lib/workspace/services/ui/types";
import { useWorkspace } from "../../context";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { Services } from "@/lib/workspace/services/services";

/**
 * Individual notification item
 */
function NotificationItem({ notification, onClose }: { notification: Notification; onClose: () => void }) {
    // Icon based on type
    const getIcon = () => {
        switch (notification.type) {
            case NotificationType.Info:
                return (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                );
            case NotificationType.Success:
                return (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                );
            case NotificationType.Warning:
                return (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                );
            case NotificationType.Error:
                return (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                );
        }
    };

    // Color based on type
    const getColorClasses = () => {
        switch (notification.type) {
            case NotificationType.Info:
                return "bg-primary/10 border-primary/30 text-primary";
            case NotificationType.Success:
                return "bg-green-500/10 border-green-500/30 text-green-400";
            case NotificationType.Warning:
                return "bg-yellow-500/10 border-yellow-500/30 text-yellow-400";
            case NotificationType.Error:
                return "bg-red-500/10 border-red-500/30 text-red-400";
        }
    };

    return (
        <div
            className={`
                flex items-start gap-3 p-4 rounded-lg border backdrop-blur-sm
                shadow-lg min-w-[320px] max-w-[480px]
                animate-slide-in-right
                ${getColorClasses()}
            `}
        >
            <div className="flex-shrink-0 mt-0.5">{getIcon()}</div>
            
            <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white">{notification.message}</p>
                {notification.detail && (
                    <p className="mt-1 text-xs text-gray-400">{notification.detail}</p>
                )}
                
                {notification.actions && notification.actions.length > 0 && (
                    <div className="mt-3 flex gap-2">
                        {notification.actions.map((action, index) => (
                            <button
                                key={index}
                                onClick={() => {
                                    action.onClick();
                                    onClose();
                                }}
                                className={`
                                    px-3 py-1 text-xs rounded transition-colors
                                    ${action.primary
                                        ? "bg-white/20 hover:bg-white/30 text-white font-medium"
                                        : "bg-white/5 hover:bg-white/10 text-gray-300"
                                    }
                                `}
                            >
                                {action.label}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {notification.closable && (
                <button
                    onClick={onClose}
                    className="flex-shrink-0 p-1 rounded hover:bg-white/10 transition-colors"
                    aria-label="Close"
                >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
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
        <div className="fixed top-4 right-4 z-50 flex flex-col gap-3 pointer-events-none">
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

