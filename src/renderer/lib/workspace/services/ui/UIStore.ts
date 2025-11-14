import { EventEmitter } from "./EventEmitter";
import {
    Notification,
    ActionBarItem,
    PanelDefinition,
    EditorTab,
    Dialog,
    StatusBarItem,
    FocusContext,
} from "./types";
import {
    ActionDefinition,
    ActionGroup,
    EditorLayout,
    EditorGroup,
    EditorTabDefinition,
} from "@/apps/workspace/registry/types";

export interface SelectionState {
    type: "asset" | "node" | "scene" | null;
    data: any | null;
}

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
    actions: ActionDefinition[];
    actionGroups: ActionGroup[];
    editorLayout: EditorLayout;
    selection: SelectionState;
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
    
    // Action and ActionGroup events
    actionRegistered: ActionDefinition;
    actionUnregistered: string; // action id
    actionUpdated: ActionDefinition;
    
    actionGroupRegistered: ActionGroup;
    actionGroupUnregistered: string; // group id
    actionGroupUpdated: ActionGroup;
    
    // EditorLayout events
    editorLayoutChanged: EditorLayout;
    editorTabOpenedInGroup: { tab: EditorTabDefinition; groupId: string; activated: boolean };
    editorTabClosedInGroup: { tabId: string; groupId: string };
    editorTabActivatedInGroup: { tabId: string; groupId: string };
    
    stateChanged: Partial<UIState>;
    selectionChanged: SelectionState;
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
            actions: [],
            actionGroups: [],
            editorLayout: {
                id: "main",
                tabs: [],
                focus: null,
            },
            selection: { type: null, data: null },
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

    // === Selection ===
    public setSelection(selection: SelectionState): void {
        this.state.selection = selection;
        this.events.emit("selectionChanged", selection);
        this.events.emit("stateChanged", { selection });
    }

    public getSelection(): SelectionState {
        return this.state.selection;
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

    public registerPanel<TPayload = any>(panel: PanelDefinition<TPayload>): void {
        // Remove existing panel with same id
        this.state.panels = this.state.panels.filter(p => p.id !== panel.id);
        this.state.panels.push(panel as PanelDefinition<any>);
        // Sort by order
        this.state.panels.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        // Set default visibility
        if (panel.defaultVisible !== false && !(panel.id in this.state.panelVisibility)) {
            this.state.panelVisibility[panel.id] = true;
        }
        this.events.emit("panelRegistered", panel as PanelDefinition<any>);
        this.events.emit("stateChanged", { panels: [...this.state.panels] });
    }

    public unregisterPanel(id: string): void {
        this.state.panels = this.state.panels.filter(p => p.id !== id);
        delete this.state.panelVisibility[id];
        this.events.emit("panelUnregistered", id);
        this.events.emit("stateChanged", { panels: [...this.state.panels] });
    }

    public updatePanelPayload<TPayload = any>(panelId: string, payload: TPayload): void {
        const panel = this.state.panels.find(p => p.id === panelId);
        if (panel) {
            panel.payload = payload;
            this.events.emit("stateChanged", { panels: [...this.state.panels] });
        }
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

    // === Actions ===

    public registerAction(action: ActionDefinition): void {
        // Remove existing action with same id
        this.state.actions = this.state.actions.filter(a => a.id !== action.id);
        this.state.actions.push(action);
        // Sort by order
        this.state.actions.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        this.events.emit("actionRegistered", action);
        this.events.emit("stateChanged", { actions: [...this.state.actions] });
    }

    public unregisterAction(id: string): void {
        this.state.actions = this.state.actions.filter(a => a.id !== id);
        this.events.emit("actionUnregistered", id);
        this.events.emit("stateChanged", { actions: [...this.state.actions] });
    }

    public updateAction(action: ActionDefinition): void {
        const index = this.state.actions.findIndex(a => a.id === action.id);
        if (index >= 0) {
            this.state.actions[index] = action;
            this.state.actions.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
            this.events.emit("actionUpdated", action);
            this.events.emit("stateChanged", { actions: [...this.state.actions] });
        }
    }

    public getActions(): ActionDefinition[] {
        return [...this.state.actions];
    }

    // === Action Groups ===

    public registerActionGroup(group: ActionGroup): void {
        // Remove existing group with same id
        this.state.actionGroups = this.state.actionGroups.filter(g => g.id !== group.id);
        this.state.actionGroups.push(group);
        // Sort by order
        this.state.actionGroups.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        this.events.emit("actionGroupRegistered", group);
        this.events.emit("stateChanged", { actionGroups: [...this.state.actionGroups] });
    }

    public unregisterActionGroup(id: string): void {
        this.state.actionGroups = this.state.actionGroups.filter(g => g.id !== id);
        this.events.emit("actionGroupUnregistered", id);
        this.events.emit("stateChanged", { actionGroups: [...this.state.actionGroups] });
    }

    public updateActionGroup(group: ActionGroup): void {
        const index = this.state.actionGroups.findIndex(g => g.id === group.id);
        if (index >= 0) {
            this.state.actionGroups[index] = group;
            this.state.actionGroups.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
            this.events.emit("actionGroupUpdated", group);
            this.events.emit("stateChanged", { actionGroups: [...this.state.actionGroups] });
        }
    }

    public getActionGroups(): ActionGroup[] {
        return [...this.state.actionGroups];
    }

    // === Editor Layout ===

    private findGroup(layout: EditorLayout, groupId?: string): EditorGroup | null {
        if ("tabs" in layout) {
            return !groupId || layout.id === groupId ? layout : null;
        }
        return this.findGroup(layout.first, groupId) || this.findGroup(layout.second, groupId);
    }

    private updateGroup(
        layout: EditorLayout,
        groupId: string,
        updater: (group: EditorGroup) => EditorGroup
    ): EditorLayout {
        if ("tabs" in layout) {
            return layout.id === groupId ? updater(layout) : layout;
        }
        return {
            ...layout,
            first: this.updateGroup(layout.first, groupId, updater),
            second: this.updateGroup(layout.second, groupId, updater),
        };
    }

    public openEditorTabInGroup<TPayload = any>(tab: EditorTabDefinition<TPayload>, groupId?: string, activate: boolean = true): void {
        const targetGroup = this.findGroup(this.state.editorLayout, groupId);
        const targetId = targetGroup?.id ?? (this.state.editorLayout as EditorGroup).id;

        this.state.editorLayout = this.updateGroup(this.state.editorLayout, targetId, (group) => {
            // Check if tab already exists
            const existingIndex = group.tabs.findIndex((t) => t.id === tab.id);
            if (existingIndex >= 0) {
                // Update existing tab with new payload
                const updatedTabs = [...group.tabs];
                updatedTabs[existingIndex] = tab as EditorTabDefinition<any>;
                return { ...group, tabs: updatedTabs, focus: activate ? tab.id : group.focus };
            }
            // Add new tab
            const newGroup = {
                ...group,
                tabs: [...group.tabs, tab as EditorTabDefinition<any>],
            };
            return activate ? { ...newGroup, focus: tab.id } : newGroup;
        });

        this.events.emit("editorTabOpenedInGroup", { tab: tab as EditorTabDefinition<any>, groupId: targetId, activated: activate });
        this.events.emit("editorLayoutChanged", this.state.editorLayout);
        this.events.emit("stateChanged", { editorLayout: this.state.editorLayout });
    }

    public updateEditorTabPayload<TPayload = any>(tabId: string, payload: TPayload, groupId?: string): void {
        const targetGroup = this.findGroup(this.state.editorLayout, groupId);
        const targetId = targetGroup?.id ?? (this.state.editorLayout as EditorGroup).id;

        this.state.editorLayout = this.updateGroup(this.state.editorLayout, targetId, (group) => {
            const tabIndex = group.tabs.findIndex((t) => t.id === tabId);
            if (tabIndex >= 0) {
                const updatedTabs = [...group.tabs];
                updatedTabs[tabIndex] = { ...updatedTabs[tabIndex], payload };
                return { ...group, tabs: updatedTabs };
            }
            return group;
        });

        this.events.emit("editorLayoutChanged", this.state.editorLayout);
        this.events.emit("stateChanged", { editorLayout: this.state.editorLayout });
    }

    public closeEditorTabInGroup(tabId: string, groupId?: string): void {
        const targetGroup = this.findGroup(this.state.editorLayout, groupId);
        const targetId = targetGroup?.id ?? (this.state.editorLayout as EditorGroup).id;

        this.state.editorLayout = this.updateGroup(this.state.editorLayout, targetId, (group) => {
            const tabs = group.tabs.filter((t) => t.id !== tabId);
            let activeTabId = group.focus;

            // If we closed the active tab, activate another
            if (activeTabId === tabId) {
                activeTabId = tabs.length > 0 ? tabs[tabs.length - 1].id : null;
            }

            return { ...group, tabs, focus: activeTabId };
        });

        this.events.emit("editorTabClosedInGroup", { tabId, groupId: targetId });
        this.events.emit("editorLayoutChanged", this.state.editorLayout);
        this.events.emit("stateChanged", { editorLayout: this.state.editorLayout });
    }

    public setActiveEditorTabInGroup(tabId: string, groupId: string): void {
        this.state.editorLayout = this.updateGroup(this.state.editorLayout, groupId, (group) => ({
            ...group,
            focus: tabId,
        }));

        this.events.emit("editorTabActivatedInGroup", { tabId, groupId });
        this.events.emit("editorLayoutChanged", this.state.editorLayout);
        this.events.emit("stateChanged", { editorLayout: this.state.editorLayout });
    }

    public getEditorLayout(): Readonly<EditorLayout> {
        return this.state.editorLayout;
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
            actions: [],
            actionGroups: [],
            editorLayout: {
                id: "main",
                tabs: [],
                focus: null,
            },
            selection: { type: null, data: null },
        };
        this.events.clear();
    }
}

