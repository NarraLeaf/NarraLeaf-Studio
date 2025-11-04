import { UIStore } from "./UIStore";
import {
    Notification,
    NotificationType,
    NotificationSeverity,
    NotificationAction,
} from "./types";

/**
 * Notification Service
 * Manages VSCode-style notifications
 */
export class NotificationService {
    private store: UIStore;
    private nextId = 1;

    constructor(store: UIStore) {
        this.store = store;
    }

    /**
     * Show an info notification
     */
    public info(message: string, detail?: string, actions?: NotificationAction[]): string {
        return this.show({
            type: NotificationType.Info,
            message,
            detail,
            actions,
        });
    }

    /**
     * Show a success notification
     */
    public success(message: string, detail?: string, actions?: NotificationAction[]): string {
        return this.show({
            type: NotificationType.Success,
            message,
            detail,
            actions,
        });
    }

    /**
     * Show a warning notification
     */
    public warning(message: string, detail?: string, actions?: NotificationAction[]): string {
        return this.show({
            type: NotificationType.Warning,
            message,
            detail,
            actions,
        });
    }

    /**
     * Show an error notification
     */
    public error(message: string, detail?: string, actions?: NotificationAction[]): string {
        return this.show({
            type: NotificationType.Error,
            message,
            detail,
            actions,
        });
    }

    /**
     * Show a notification with custom options
     */
    public show(options: {
        type: NotificationType;
        message: string;
        detail?: string;
        severity?: NotificationSeverity;
        timeout?: number;
        actions?: NotificationAction[];
        closable?: boolean;
        onClose?: () => void;
    }): string {
        const id = `notification-${this.nextId++}`;
        
        const notification: Notification = {
            id,
            type: options.type,
            message: options.message,
            detail: options.detail,
            severity: options.severity ?? NotificationSeverity.Medium,
            timeout: options.timeout ?? 5000, // Default 5s timeout
            actions: options.actions,
            closable: options.closable !== false, // Default closable
            onClose: options.onClose,
            timestamp: Date.now(),
        };

        this.store.addNotification(notification);

        // Auto-dismiss if timeout is set
        if (notification.timeout && notification.timeout > 0) {
            setTimeout(() => {
                this.close(id);
            }, notification.timeout);
        }

        return id;
    }

    /**
     * Show a notification that stays until closed
     */
    public showSticky(options: {
        type: NotificationType;
        message: string;
        detail?: string;
        severity?: NotificationSeverity;
        actions?: NotificationAction[];
        closable?: boolean;
        onClose?: () => void;
    }): string {
        return this.show({ ...options, timeout: 0 });
    }

    /**
     * Close a notification
     */
    public close(id: string): void {
        const notification = this.store.getNotifications().find(n => n.id === id);
        this.store.removeNotification(id);
        
        // Call onClose callback
        if (notification?.onClose) {
            notification.onClose();
        }
    }

    /**
     * Close all notifications
     */
    public closeAll(): void {
        const notifications = this.store.getNotifications();
        notifications.forEach(n => this.close(n.id));
    }

    /**
     * Get all notifications
     */
    public getAll(): Notification[] {
        return this.store.getNotifications();
    }

    /**
     * Update a notification
     */
    public update(id: string, updates: Partial<Omit<Notification, "id" | "timestamp">>): void {
        const notification = this.store.getNotifications().find(n => n.id === id);
        if (notification) {
            this.store.updateNotification({
                ...notification,
                ...updates,
            });
        }
    }
}

