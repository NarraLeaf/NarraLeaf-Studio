import { EventEmitter } from "./EventEmitter";
import {
    Notification,
    ActionBarItem,
    PanelDefinition,
    EditorTab,
    Dialog,
    StatusBarItem,
} from "./types";

/**
 * UI state
 */
export interface UIState {
    notifications: Notification[];
    actionBarItems: ActionBarItem[];
    panels: PanelDefinition[];
    panelVisibility: Record<string, boolean>;
    editorTabs: EditorTab[];
    activeEditorTabId: string | null;
    dialogs: Dialog[];
    statusBarItems: StatusBarItem[];
    activeDialogId: string | null;
}

/**
 * UI state change events
 */
export interface UIStateEvents {
    notificationAdded: Notification;
    notificationRemoved: string; // notification id
    notificationUpdated: Notification;
    
    actionBarItemAdded: ActionBarItem;
    actionBarItemRemoved: string; // item id
    actionBarItemUpdated: ActionBarItem;
    
    panelRegistered: PanelDefinition;
    panelUnregistered: string; // panel id
    panelVisibilityChanged: { panelId: string; visible: boolean };
    
    editorTabOpened: EditorTab;
    editorTabClosed: string; // tab id
    editorTabActivated: string; // tab id
    editorTabUpdated: EditorTab;
    
    dialogOpened: Dialog;
    dialogClosed: string; // dialog id
    
    statusBarItemAdded: StatusBarItem;
    statusBarItemRemoved: string; // item id
    statusBarItemUpdated: StatusBarItem;
    
    stateChanged: Partial<UIState>;
}

/**
 * Central UI state store with event emission
 */
export class UIStore {
    private state: UIState;
    private events: EventEmitter<UIStateEvents>;

    constructor() {
        this.state = {
            notifications: [],
            actionBarItems: [],
            panels: [],
            panelVisibility: {},
            editorTabs: [],
            activeEditorTabId: null,
            dialogs: [],
            statusBarItems: [],
            activeDialogId: null,
        };
        this.events = new EventEmitter<UIStateEvents>();
    }

    /**
     * Get event emitter
     */
    public getEvents(): EventEmitter<UIStateEvents> {
        return this.events;
    }

    /**
     * Get current state (immutable snapshot)
     */
    public getState(): Readonly<UIState> {
        return { ...this.state };
    }

    // === Notifications ===

    public addNotification(notification: Notification): void {
        this.state.notifications.push(notification);
        this.events.emit("notificationAdded", notification);
        this.events.emit("stateChanged", { notifications: [...this.state.notifications] });
    }

    public removeNotification(id: string): void {
        this.state.notifications = this.state.notifications.filter(n => n.id !== id);
        this.events.emit("notificationRemoved", id);
        this.events.emit("stateChanged", { notifications: [...this.state.notifications] });
    }

    public updateNotification(notification: Notification): void {
        const index = this.state.notifications.findIndex(n => n.id === notification.id);
        if (index >= 0) {
            this.state.notifications[index] = notification;
            this.events.emit("notificationUpdated", notification);
            this.events.emit("stateChanged", { notifications: [...this.state.notifications] });
        }
    }

    public getNotifications(): Notification[] {
        return [...this.state.notifications];
    }

    // === Action Bar Items ===

    public addActionBarItem(item: ActionBarItem): void {
        // Remove existing item with same id
        this.state.actionBarItems = this.state.actionBarItems.filter(i => i.id !== item.id);
        this.state.actionBarItems.push(item);
        // Sort by order
        this.state.actionBarItems.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        this.events.emit("actionBarItemAdded", item);
        this.events.emit("stateChanged", { actionBarItems: [...this.state.actionBarItems] });
    }

    public removeActionBarItem(id: string): void {
        this.state.actionBarItems = this.state.actionBarItems.filter(i => i.id !== id);
        this.events.emit("actionBarItemRemoved", id);
        this.events.emit("stateChanged", { actionBarItems: [...this.state.actionBarItems] });
    }

    public updateActionBarItem(item: ActionBarItem): void {
        const index = this.state.actionBarItems.findIndex(i => i.id === item.id);
        if (index >= 0) {
            this.state.actionBarItems[index] = item;
            this.state.actionBarItems.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
            this.events.emit("actionBarItemUpdated", item);
            this.events.emit("stateChanged", { actionBarItems: [...this.state.actionBarItems] });
        }
    }

    public getActionBarItems(): ActionBarItem[] {
        return [...this.state.actionBarItems];
    }

    // === Panels ===

    public registerPanel(panel: PanelDefinition): void {
        // Remove existing panel with same id
        this.state.panels = this.state.panels.filter(p => p.id !== panel.id);
        this.state.panels.push(panel);
        // Sort by order
        this.state.panels.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        // Set default visibility
        if (panel.defaultVisible !== false && !(panel.id in this.state.panelVisibility)) {
            this.state.panelVisibility[panel.id] = true;
        }
        this.events.emit("panelRegistered", panel);
        this.events.emit("stateChanged", { panels: [...this.state.panels] });
    }

    public unregisterPanel(id: string): void {
        this.state.panels = this.state.panels.filter(p => p.id !== id);
        delete this.state.panelVisibility[id];
        this.events.emit("panelUnregistered", id);
        this.events.emit("stateChanged", { panels: [...this.state.panels] });
    }

    public setPanelVisibility(panelId: string, visible: boolean): void {
        this.state.panelVisibility[panelId] = visible;
        this.events.emit("panelVisibilityChanged", { panelId, visible });
        this.events.emit("stateChanged", { panelVisibility: { ...this.state.panelVisibility } });
    }

    public togglePanelVisibility(panelId: string): void {
        const visible = !this.state.panelVisibility[panelId];
        this.setPanelVisibility(panelId, visible);
    }

    public getPanels(): PanelDefinition[] {
        return [...this.state.panels];
    }

    public getPanelVisibility(): Record<string, boolean> {
        return { ...this.state.panelVisibility };
    }

    // === Editor Tabs ===

    public openEditorTab(tab: EditorTab): void {
        // Check if tab already exists
        const index = this.state.editorTabs.findIndex(t => t.id === tab.id);
        if (index >= 0) {
            // Update existing tab
            this.state.editorTabs[index] = tab;
            this.events.emit("editorTabUpdated", tab);
        } else {
            // Add new tab
            this.state.editorTabs.push(tab);
            this.events.emit("editorTabOpened", tab);
        }
        // Activate the tab
        this.state.activeEditorTabId = tab.id;
        this.events.emit("editorTabActivated", tab.id);
        this.events.emit("stateChanged", {
            editorTabs: [...this.state.editorTabs],
            activeEditorTabId: this.state.activeEditorTabId,
        });
    }

    public closeEditorTab(tabId: string): void {
        this.state.editorTabs = this.state.editorTabs.filter(t => t.id !== tabId);
        // If closed tab was active, activate another
        if (this.state.activeEditorTabId === tabId) {
            this.state.activeEditorTabId = this.state.editorTabs.length > 0
                ? this.state.editorTabs[this.state.editorTabs.length - 1].id
                : null;
        }
        this.events.emit("editorTabClosed", tabId);
        this.events.emit("stateChanged", {
            editorTabs: [...this.state.editorTabs],
            activeEditorTabId: this.state.activeEditorTabId,
        });
    }

    public setActiveEditorTab(tabId: string): void {
        if (this.state.editorTabs.some(t => t.id === tabId)) {
            this.state.activeEditorTabId = tabId;
            this.events.emit("editorTabActivated", tabId);
            this.events.emit("stateChanged", { activeEditorTabId: tabId });
        }
    }

    public updateEditorTab(tab: EditorTab): void {
        const index = this.state.editorTabs.findIndex(t => t.id === tab.id);
        if (index >= 0) {
            this.state.editorTabs[index] = tab;
            this.events.emit("editorTabUpdated", tab);
            this.events.emit("stateChanged", { editorTabs: [...this.state.editorTabs] });
        }
    }

    public getEditorTabs(): EditorTab[] {
        return [...this.state.editorTabs];
    }

    public getActiveEditorTabId(): string | null {
        return this.state.activeEditorTabId;
    }

    // === Dialogs ===

    public openDialog(dialog: Dialog): void {
        // Remove existing dialog with same id
        this.state.dialogs = this.state.dialogs.filter(d => d.id !== dialog.id);
        this.state.dialogs.push(dialog);
        this.state.activeDialogId = dialog.id;
        this.events.emit("dialogOpened", dialog);
        this.events.emit("stateChanged", {
            dialogs: [...this.state.dialogs],
            activeDialogId: this.state.activeDialogId,
        });
    }

    public closeDialog(id: string): void {
        const dialog = this.state.dialogs.find(d => d.id === id);
        this.state.dialogs = this.state.dialogs.filter(d => d.id !== id);
        if (this.state.activeDialogId === id) {
            this.state.activeDialogId = this.state.dialogs.length > 0
                ? this.state.dialogs[this.state.dialogs.length - 1].id
                : null;
        }
        this.events.emit("dialogClosed", id);
        this.events.emit("stateChanged", {
            dialogs: [...this.state.dialogs],
            activeDialogId: this.state.activeDialogId,
        });
        
        // Call onClose callback
        if (dialog?.onClose) {
            dialog.onClose();
        }
    }

    public getDialogs(): Dialog[] {
        return [...this.state.dialogs];
    }

    public getActiveDialogId(): string | null {
        return this.state.activeDialogId;
    }

    // === Status Bar Items ===

    public addStatusBarItem(item: StatusBarItem): void {
        // Remove existing item with same id
        this.state.statusBarItems = this.state.statusBarItems.filter(i => i.id !== item.id);
        this.state.statusBarItems.push(item);
        // Sort by priority
        this.state.statusBarItems.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
        this.events.emit("statusBarItemAdded", item);
        this.events.emit("stateChanged", { statusBarItems: [...this.state.statusBarItems] });
    }

    public removeStatusBarItem(id: string): void {
        this.state.statusBarItems = this.state.statusBarItems.filter(i => i.id !== id);
        this.events.emit("statusBarItemRemoved", id);
        this.events.emit("stateChanged", { statusBarItems: [...this.state.statusBarItems] });
    }

    public updateStatusBarItem(item: StatusBarItem): void {
        const index = this.state.statusBarItems.findIndex(i => i.id === item.id);
        if (index >= 0) {
            this.state.statusBarItems[index] = item;
            this.state.statusBarItems.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
            this.events.emit("statusBarItemUpdated", item);
            this.events.emit("stateChanged", { statusBarItems: [...this.state.statusBarItems] });
        }
    }

    public getStatusBarItems(): StatusBarItem[] {
        return [...this.state.statusBarItems];
    }

    /**
     * Clear all state
     */
    public clear(): void {
        this.state = {
            notifications: [],
            actionBarItems: [],
            panels: [],
            panelVisibility: {},
            editorTabs: [],
            activeEditorTabId: null,
            dialogs: [],
            statusBarItems: [],
            activeDialogId: null,
        };
        this.events.clear();
    }
}

