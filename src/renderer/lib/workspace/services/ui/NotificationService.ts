import { UIStore } from "./UIStore";
import type { ServiceAssetsService } from "../core/ServiceAssetsService";
import {
    Notification,
    NotificationType,
    NotificationSeverity,
    NotificationAction,
} from "./types";

/** Per-project store namespace and payload shape for the persisted history. */
const HISTORY_STORE_NAMESPACE = "notification_history";
const HISTORY_STORE_VERSION = 1;
interface NotificationHistoryStore {
    version: typeof HISTORY_STORE_VERSION;
    entries: NotificationHistoryEntry[];
}

/**
 * A history record: the serializable core of a notification, kept after the toast is dismissed.
 * Callbacks/actions are deliberately dropped - history is a log, not a live surface.
 */
export interface NotificationHistoryEntry {
    id: string;
    type: NotificationType;
    message: string;
    detail?: string;
    timestamp: number;
}

/**
 * Notification Service
 * Manages VSCode-style notifications. Toasts behave exactly as before; additionally every shown
 * notification lands in a ring-buffered history that the notification-center drawer reads, and
 * that survives a restart - see {@link startPersistence}.
 */
export class NotificationService {
    private static readonly HistoryLimit = 100;
    /** Notifications can arrive in bursts; one write per burst, not one per toast. */
    private static readonly PersistDebounceMs = 500;

    private store: UIStore;
    private nextId = 1;
    private history: NotificationHistoryEntry[] = [];
    private readonly historyListeners = new Set<() => void>();
    private persistenceUnsub: (() => void) | null = null;
    private persistTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(store: UIStore) {
        this.store = store;
    }

    // === History (survives dismissal; ring-buffered) ===

    /**
     * Load the persisted history and keep writing it back as it changes.
     *
     * Lives here rather than in UIService because the history is this service's state: UIService
     * composes the UI services, and having it reach in to read, seed and save one of them made it
     * the only place that knew this buffer was persistent at all.
     *
     * Unreadable history is not worth failing workspace startup over - it degrades to an empty log.
     */
    public async startPersistence(serviceAssets: ServiceAssetsService): Promise<void> {
        this.stopPersistence();
        try {
            const stored = await serviceAssets.readStore<NotificationHistoryStore>(HISTORY_STORE_NAMESPACE);
            if (stored.ok && stored.data?.version === HISTORY_STORE_VERSION && Array.isArray(stored.data.entries)) {
                this.seedHistory(stored.data.entries);
            }
        } catch {
            // Corrupt or absent store: start from empty.
        }
        this.persistenceUnsub = this.onHistoryChanged(() => {
            if (this.persistTimer) {
                clearTimeout(this.persistTimer);
            }
            this.persistTimer = setTimeout(() => {
                this.persistTimer = null;
                void serviceAssets.writeStore<NotificationHistoryStore>(HISTORY_STORE_NAMESPACE, {
                    version: HISTORY_STORE_VERSION,
                    entries: [...this.history],
                });
            }, NotificationService.PersistDebounceMs);
        });
    }

    /** Detach persistence and drop any pending write (workspace teardown). */
    public stopPersistence(): void {
        this.persistenceUnsub?.();
        this.persistenceUnsub = null;
        if (this.persistTimer) {
            clearTimeout(this.persistTimer);
            this.persistTimer = null;
        }
    }

    /** Stable snapshot, newest first. */
    public getHistory(): readonly NotificationHistoryEntry[] {
        return this.history;
    }

    /** Replace the current buffer (used when seeding from persistence). */
    public seedHistory(entries: NotificationHistoryEntry[]): void {
        this.history = entries.slice(0, NotificationService.HistoryLimit);
        this.emitHistoryChanged();
    }

    public clearHistory(): void {
        if (this.history.length === 0) {
            return;
        }
        this.history = [];
        this.emitHistoryChanged();
    }

    public onHistoryChanged(listener: () => void): () => void {
        this.historyListeners.add(listener);
        return () => {
            this.historyListeners.delete(listener);
        };
    }

    // Unread tracking is shared here so the bell badge and the notifications panel agree -
    // opening the panel through any path (bell, rail icon) marks everything seen.
    private lastSeenTimestamp = 0;

    public markHistorySeen(): void {
        this.lastSeenTimestamp = Date.now();
        this.emitHistoryChanged();
    }

    public getUnreadCount(): number {
        return this.history.filter(entry => entry.timestamp > this.lastSeenTimestamp).length;
    }

    private recordHistory(entry: NotificationHistoryEntry): void {
        this.history = [entry, ...this.history].slice(0, NotificationService.HistoryLimit);
        this.emitHistoryChanged();
    }

    private emitHistoryChanged(): void {
        for (const listener of this.historyListeners) {
            listener();
        }
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
        this.recordHistory({
            id,
            type: notification.type,
            message: notification.message,
            detail: notification.detail,
            timestamp: notification.timestamp,
        });

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

