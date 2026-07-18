import { ModuleAction } from "@/apps/workspace/modules";
import { EventEmitter } from "./EventEmitter";
import { KeybindingService } from "./KeybindingService";
import { Keybinding } from "./types";
import type { UIElementSelection } from "@shared/types/ui-editor/selection";
import {
    Notification,
    ActionBarItem,
    PanelDefinition,
    PanelPosition,
    EditorTab,
    Dialog,
    StatusBarItem,
    FocusContext,
} from "./types";
import {
    ActionDefinition,
    ActionGroup,
    ActionMenuItem,
    ActionSubmenu,
    EditorLayout,
    EditorGroup,
    EditorTabDefinition,
    ActionSeparator,
} from "@/apps/workspace/registry/types";

export interface SelectionState {
    type: "asset" | "character" | "element" | "scene" | "storyMotionKeyframe" | null;
    data: any | UIElementSelection | null;
}

export function isUIElementSelection(selection: SelectionState): selection is { type: "element"; data: UIElementSelection } {
    return selection.type === "element" && Boolean(selection.data) && (selection.data as UIElementSelection).editor === "ui";
}

/**
 * UI state
 */
export interface UIState {
    notifications: Notification[];
    actionBarItems: ActionBarItem[];
    panels: PanelDefinition[];
    /** User-defined panel ordering per position (panel ids). Overrides the static `order` field. */
    panelOrder: Record<string, string[]>;
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
    panelOrderChanged: { position: string; order: string[] };
    
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

export interface EditorTabFocusTarget {
    tabId: string;
    groupId: string;
}

interface EditorTabFocusEntry extends EditorTabFocusTarget {
    key: string;
}

/**
 * Central UI state store with event emission
 */
export class UIStore {
    private state: UIState;
    private events: EventEmitter<UIStateEvents>;
    private keybindingService?: KeybindingService;
    private kbDisposers: Map<string, () => void> = new Map();
    private editorTabFocusHistory: string[] = [];

    constructor() {
        this.state = {
            notifications: [],
            actionBarItems: [],
            panels: [],
            panelOrder: {},
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

    /** Inject KeybindingService (called by UIService after construction) */
    public setKeybindingService(kb: KeybindingService) {
        this.keybindingService = kb;
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
        this.state.actionBarItems.sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));
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
            this.state.actionBarItems.sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));
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
        // Sort by user-defined order (if any), falling back to the static `order` field
        this.sortPanels();
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

    /** Fixed grouping of positions so `state.panels` stays partitioned by dock area. */
    private static readonly POSITION_RANK: Record<string, number> = {
        [PanelPosition.Left]: 0,
        [PanelPosition.Right]: 1,
        [PanelPosition.Bottom]: 2,
    };

    /**
     * Sort `state.panels` in place: grouped by position, then by the user-defined order override
     * for that position (if present), falling back to the static `order` field. Panels not listed
     * in an override are appended after the listed ones, keeping their `order`-based sequence.
     */
    private sortPanels(): void {
        const rank = (position: string) => UIStore.POSITION_RANK[position] ?? Number.MAX_SAFE_INTEGER;
        this.state.panels.sort((a, b) => {
            const ra = rank(a.position);
            const rb = rank(b.position);
            if (ra !== rb) {
                return ra - rb;
            }
            const override = this.state.panelOrder[a.position];
            if (override) {
                const ia = override.indexOf(a.id);
                const ib = override.indexOf(b.id);
                const oa = ia === -1 ? Number.MAX_SAFE_INTEGER : ia;
                const ob = ib === -1 ? Number.MAX_SAFE_INTEGER : ib;
                if (oa !== ob) {
                    return oa - ob;
                }
            }
            return (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER);
        });
    }

    /**
     * Set the user-defined ordering for a dock area (list of panel ids, first shown first).
     * Reorders the panels and notifies subscribers.
     */
    public setPanelOrder(position: PanelPosition, orderedIds: string[]): void {
        this.state.panelOrder = { ...this.state.panelOrder, [position]: [...orderedIds] };
        this.sortPanels();
        this.events.emit("panelOrderChanged", { position, order: [...orderedIds] });
        this.events.emit("stateChanged", { panels: [...this.state.panels] });
    }

    public getPanelOrder(): Record<string, string[]> {
        const copy: Record<string, string[]> = {};
        for (const [position, ids] of Object.entries(this.state.panelOrder)) {
            copy[position] = [...ids];
        }
        return copy;
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
        this.state.actions.sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));
        // Auto keybinding registration
        this.registerKeybindingForAction(action);
        this.events.emit("actionRegistered", action);
        this.events.emit("stateChanged", { actions: [...this.state.actions] });
    }

    public unregisterAction(id: string): void {
        this.state.actions = this.state.actions.filter(a => a.id !== id);
        this.events.emit("actionUnregistered", id);
        this.events.emit("stateChanged", { actions: [...this.state.actions] });
        // Dispose keybinding if exists
        const d = this.kbDisposers.get(id);
        if (d) {
            d();
            this.kbDisposers.delete(id);
        }
    }

    public updateAction(action: ActionDefinition): void {
        const index = this.state.actions.findIndex(a => a.id === action.id);
        if (index >= 0) {
            this.state.actions[index] = action;
            this.state.actions.sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));
            this.registerKeybindingForAction(action);
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
        this.state.actionGroups.sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));

        // === Auto keybinding registration for group actions ===
        for (const action of UIStore.flattenGroupActions(group)) {
            if ("separator" in action) continue;
            this.registerKeybindingForAction(action, group.id);
        }

        this.events.emit("actionGroupRegistered", group);
        this.events.emit("stateChanged", { actionGroups: [...this.state.actionGroups] });
    }

    public unregisterActionGroup(id: string): void {
        this.state.actionGroups = this.state.actionGroups.filter(g => g.id !== id);
        this.events.emit("actionGroupUnregistered", id);
        this.events.emit("stateChanged", { actionGroups: [...this.state.actionGroups] });
        for (const aid of Array.from(this.kbDisposers.keys())) {
            if (aid.startsWith(`${id}-`)) {
                const dispose = this.kbDisposers.get(aid);
                dispose?.();
                this.kbDisposers.delete(aid);
            }
        }
    }

    public updateActionGroup(group: ActionGroup): void {
        const index = this.state.actionGroups.findIndex(g => g.id === group.id);
        if (index >= 0) {
            this.state.actionGroups[index] = group;
            this.state.actionGroups.sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));
            this.events.emit("actionGroupUpdated", group);
            this.events.emit("stateChanged", { actionGroups: [...this.state.actionGroups] });
        }
    }

    public getActionGroups(): ActionGroup[] {
        return [...this.state.actionGroups];
    }

    // === Editor Layout ===

    /** Replace the group node with the given id by an arbitrary layout subtree. */
    private replaceGroupNode(
        layout: EditorLayout,
        groupId: string,
        replacement: (group: EditorGroup) => EditorLayout,
    ): EditorLayout {
        if ("tabs" in layout) {
            return layout.id === groupId ? replacement(layout) : layout;
        }
        return {
            ...layout,
            first: this.replaceGroupNode(layout.first, groupId, replacement),
            second: this.replaceGroupNode(layout.second, groupId, replacement),
        };
    }

    /** All groups in the layout, first/left before second/right. */
    private collectGroups(layout: EditorLayout = this.state.editorLayout): EditorGroup[] {
        if ("tabs" in layout) {
            return [layout];
        }
        return [...this.collectGroups(layout.first), ...this.collectGroups(layout.second)];
    }

    /** A group/split id not used anywhere in the current layout. */
    private nextLayoutNodeId(prefix: string): string {
        const used = new Set<string>();
        const visit = (layout: EditorLayout) => {
            used.add(layout.id);
            if (!("tabs" in layout)) {
                visit(layout.first);
                visit(layout.second);
            }
        };
        visit(this.state.editorLayout);
        for (let index = 1; ; index++) {
            const candidate = `${prefix}-${index}`;
            if (!used.has(candidate)) {
                return candidate;
            }
        }
    }

    /**
     * Split a group: its active tab moves into a fresh group placed beside it ("horizontal" puts
     * the new group to the right, "vertical" below). No-op when the group has no tabs — an empty
     * split has nothing to show. The moved tab keeps focus, now in the new group.
     */
    public splitEditorGroup(groupId: string, direction: "horizontal" | "vertical", tabId?: string): boolean {
        const group = this.findGroup(this.state.editorLayout, groupId);
        if (!group || group.tabs.length === 0) {
            return false;
        }
        // `tabId` is the tab a context menu was opened on; commands and chords have no click
        // target and split the focused tab instead.
        const movedTab =
            (tabId ? group.tabs.find((tab) => tab.id === tabId) : undefined) ??
            group.tabs.find((tab) => tab.id === group.focus) ??
            group.tabs[group.tabs.length - 1];
        const newGroupId = this.nextLayoutNodeId("group");
        const splitId = this.nextLayoutNodeId("split");

        this.state.editorLayout = this.replaceGroupNode(this.state.editorLayout, groupId, (target) => {
            const remaining = target.tabs.filter((tab) => tab.id !== movedTab.id);
            return {
                id: splitId,
                direction,
                ratio: 0.5,
                first: {
                    ...target,
                    tabs: remaining,
                    focus: remaining.some((tab) => tab.id === target.focus)
                        ? target.focus
                        : remaining[remaining.length - 1]?.id ?? null,
                },
                second: { id: newGroupId, tabs: [movedTab], focus: movedTab.id },
            };
        });

        this.recordEditorTabFocus(newGroupId, movedTab.id);
        this.events.emit("editorLayoutChanged", this.state.editorLayout);
        this.events.emit("stateChanged", { editorLayout: this.state.editorLayout });
        return true;
    }

    /**
     * Collapse the layout to a single group: every other group's tabs append into the kept group
     * (nothing is closed — "close other groups" merges, it does not discard work).
     */
    public closeOtherEditorGroups(keepGroupId: string): boolean {
        const keep = this.findGroup(this.state.editorLayout, keepGroupId);
        if (!keep) {
            return false;
        }
        const groups = this.collectGroups();
        if (groups.length < 2) {
            return false;
        }

        const merged: EditorGroup = { ...keep, tabs: [...keep.tabs] };
        const knownIds = new Set(merged.tabs.map((tab) => tab.id));
        for (const group of groups) {
            if (group.id === keepGroupId) {
                continue;
            }
            for (const tab of group.tabs) {
                if (!knownIds.has(tab.id)) {
                    knownIds.add(tab.id);
                    merged.tabs.push(tab);
                }
            }
        }
        if (!merged.focus || !merged.tabs.some((tab) => tab.id === merged.focus)) {
            merged.focus = merged.tabs[merged.tabs.length - 1]?.id ?? null;
        }

        this.state.editorLayout = merged;
        this.pruneEditorTabFocusHistory();
        if (merged.focus) {
            this.recordEditorTabFocus(merged.id, merged.focus);
        }
        this.events.emit("editorLayoutChanged", this.state.editorLayout);
        this.events.emit("stateChanged", { editorLayout: this.state.editorLayout });
        return true;
    }

    /**
     * Drop split panes that no longer hold an editor. Closing the last tab of one side of a split
     * would otherwise leave an empty pane with a bare tab strip sitting on half the editor area;
     * the split exists to show two editors, so it collapses back to the surviving side. The root
     * group is kept even when empty — that is the "no tabs open" drop zone.
     */
    private pruneEmptyEditorGroups(): void {
        const prune = (layout: EditorLayout): EditorLayout => {
            if ("tabs" in layout) {
                return layout;
            }
            const first = prune(layout.first);
            const second = prune(layout.second);
            const isEmptyGroup = (node: EditorLayout) => "tabs" in node && node.tabs.length === 0;
            if (isEmptyGroup(first)) {
                return second;
            }
            if (isEmptyGroup(second)) {
                return first;
            }
            return first === layout.first && second === layout.second ? layout : { ...layout, first, second };
        };
        this.state.editorLayout = prune(this.state.editorLayout);
    }

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

    private getEditorTabFocusKey(groupId: string, tabId: string): string {
        return `${groupId}:${tabId}`;
    }

    private collectEditorTabFocusEntries(layout: EditorLayout = this.state.editorLayout): EditorTabFocusEntry[] {
        const entries: EditorTabFocusEntry[] = [];

        const visit = (node: EditorLayout) => {
            if ("tabs" in node) {
                for (const tab of node.tabs) {
                    entries.push({
                        key: this.getEditorTabFocusKey(node.id, tab.id),
                        tabId: tab.id,
                        groupId: node.id,
                    });
                }
                return;
            }

            visit(node.first);
            visit(node.second);
        };

        visit(layout);
        return entries;
    }

    private pruneEditorTabFocusHistory(entries: readonly EditorTabFocusEntry[] = this.collectEditorTabFocusEntries()): void {
        const validKeys = new Set(entries.map((entry) => entry.key));
        const seen = new Set<string>();
        const pruned: string[] = [];

        for (const key of this.editorTabFocusHistory) {
            if (!validKeys.has(key) || seen.has(key)) {
                continue;
            }
            seen.add(key);
            pruned.push(key);
        }

        this.editorTabFocusHistory = pruned;
    }

    private recordEditorTabFocus(groupId: string, tabId: string): void {
        const entries = this.collectEditorTabFocusEntries();
        const key = this.getEditorTabFocusKey(groupId, tabId);

        if (!entries.some((entry) => entry.key === key)) {
            this.pruneEditorTabFocusHistory(entries);
            return;
        }

        this.editorTabFocusHistory = [
            key,
            ...this.editorTabFocusHistory.filter((existingKey) => existingKey !== key),
        ];
        this.pruneEditorTabFocusHistory(entries);
    }

    private getPreferredEditorTabFocusTarget(
        entries: readonly EditorTabFocusEntry[] = this.collectEditorTabFocusEntries()
    ): EditorTabFocusTarget | null {
        this.pruneEditorTabFocusHistory(entries);
        const byKey = new Map(entries.map((entry) => [entry.key, entry]));
        const entry = this.editorTabFocusHistory
            .map((key) => byKey.get(key))
            .find((candidate): candidate is EditorTabFocusEntry => Boolean(candidate));

        return entry ? { tabId: entry.tabId, groupId: entry.groupId } : null;
    }

    private setEditorGroupFocus(target: EditorTabFocusTarget): boolean {
        let didSetFocus = false;

        this.state.editorLayout = this.updateGroup(this.state.editorLayout, target.groupId, (group) => {
            if (!group.tabs.some((tab) => tab.id === target.tabId)) {
                return group;
            }

            didSetFocus = true;
            return { ...group, focus: target.tabId };
        });

        return didSetFocus;
    }

    private ensureEditorGroupHasValidFocus(groupId: string): void {
        this.state.editorLayout = this.updateGroup(this.state.editorLayout, groupId, (group) => {
            if (group.focus && group.tabs.some((tab) => tab.id === group.focus)) {
                return group;
            }

            return {
                ...group,
                focus: group.tabs.length > 0 ? group.tabs[group.tabs.length - 1].id : null,
            };
        });
    }

    public getEditorTabFocusHistoryKeys(): string[] {
        this.pruneEditorTabFocusHistory();
        return [...this.editorTabFocusHistory];
    }

    public openEditorTabInGroup<TPayload = any>(tab: EditorTabDefinition<TPayload>, groupId?: string, activate: boolean = true, index?: number): void {
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
            // Add new tab — at `index` when given (reopening a closed tab puts it
            // back where it was), appended otherwise.
            const updatedTabs = [...group.tabs];
            const insertAt = index === undefined ? updatedTabs.length : Math.max(0, Math.min(index, updatedTabs.length));
            updatedTabs.splice(insertAt, 0, tab as EditorTabDefinition<any>);
            const newGroup = { ...group, tabs: updatedTabs };
            return activate ? { ...newGroup, focus: tab.id } : newGroup;
        });

        if (activate) {
            this.recordEditorTabFocus(targetId, tab.id);
        } else {
            this.pruneEditorTabFocusHistory();
        }

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

    public closeEditorTabInGroup(tabId: string, groupId?: string): EditorTabFocusTarget | null {
        const targetGroup = this.findGroup(this.state.editorLayout, groupId);
        const targetId = targetGroup?.id ?? (this.state.editorLayout as EditorGroup).id;
        const closedActiveTab = targetGroup?.focus === tabId;

        this.state.editorLayout = this.updateGroup(this.state.editorLayout, targetId, (group) => {
            const tabs = group.tabs.filter((t) => t.id !== tabId);
            let activeTabId = group.focus;

            // Active replacement is selected after MRU pruning so it can span groups.
            if (activeTabId === tabId) {
                activeTabId = null;
            }

            return { ...group, tabs, focus: activeTabId };
        });
        this.pruneEmptyEditorGroups();

        const entriesAfterClose = this.collectEditorTabFocusEntries();
        this.pruneEditorTabFocusHistory(entriesAfterClose);
        let focusTarget: EditorTabFocusTarget | null = null;

        if (closedActiveTab) {
            focusTarget = this.getPreferredEditorTabFocusTarget(entriesAfterClose);
            if (!focusTarget) {
                const groupAfterClose = this.findGroup(this.state.editorLayout, targetId);
                const fallbackTab = groupAfterClose?.tabs[groupAfterClose.tabs.length - 1];
                focusTarget = fallbackTab ? { tabId: fallbackTab.id, groupId: targetId } : null;
            }

            if (focusTarget) {
                if (focusTarget.groupId !== targetId) {
                    this.ensureEditorGroupHasValidFocus(targetId);
                }
                if (this.setEditorGroupFocus(focusTarget)) {
                    this.recordEditorTabFocus(focusTarget.groupId, focusTarget.tabId);
                }
            }
        } else {
            this.ensureEditorGroupHasValidFocus(targetId);
        }

        this.events.emit("editorTabClosedInGroup", { tabId, groupId: targetId });
        this.events.emit("editorLayoutChanged", this.state.editorLayout);
        this.events.emit("stateChanged", { editorLayout: this.state.editorLayout });

        return focusTarget;
    }

    /**
     * Close multiple tabs in one layout update. Emits one layout change and one close event per removed tab.
     */
    public closeEditorTabsInGroup(tabIds: readonly string[], groupId?: string): EditorTabFocusTarget | null {
        const idSet = new Set(tabIds);
        if (idSet.size === 0) {
            return null;
        }

        const targetGroup = this.findGroup(this.state.editorLayout, groupId);
        const targetId = targetGroup?.id ?? (this.state.editorLayout as EditorGroup).id;
        const groupSnapshot =
            targetGroup ?? (this.state.editorLayout as EditorGroup);
        const closedIds = groupSnapshot.tabs.filter((t) => idSet.has(t.id)).map((t) => t.id);
        if (closedIds.length === 0) {
            return null;
        }
        const closedActiveTab = Boolean(groupSnapshot.focus && idSet.has(groupSnapshot.focus));

        this.state.editorLayout = this.updateGroup(this.state.editorLayout, targetId, (group) => {
            const tabs = group.tabs.filter((t) => !idSet.has(t.id));
            let activeTabId = group.focus;

            if (activeTabId && idSet.has(activeTabId)) {
                activeTabId = null;
            } else if (activeTabId && !tabs.some((t) => t.id === activeTabId)) {
                activeTabId = null;
            }

            return { ...group, tabs, focus: activeTabId };
        });
        this.pruneEmptyEditorGroups();

        const entriesAfterClose = this.collectEditorTabFocusEntries();
        this.pruneEditorTabFocusHistory(entriesAfterClose);
        let focusTarget: EditorTabFocusTarget | null = null;

        if (closedActiveTab) {
            focusTarget = this.getPreferredEditorTabFocusTarget(entriesAfterClose);
            if (!focusTarget) {
                const groupAfterClose = this.findGroup(this.state.editorLayout, targetId);
                const fallbackTab = groupAfterClose?.tabs[groupAfterClose.tabs.length - 1];
                focusTarget = fallbackTab ? { tabId: fallbackTab.id, groupId: targetId } : null;
            }

            if (focusTarget) {
                if (focusTarget.groupId !== targetId) {
                    this.ensureEditorGroupHasValidFocus(targetId);
                }
                if (this.setEditorGroupFocus(focusTarget)) {
                    this.recordEditorTabFocus(focusTarget.groupId, focusTarget.tabId);
                }
            }
        } else {
            this.ensureEditorGroupHasValidFocus(targetId);
        }

        for (const tabId of closedIds) {
            this.events.emit("editorTabClosedInGroup", { tabId, groupId: targetId });
        }
        this.events.emit("editorLayoutChanged", this.state.editorLayout);
        this.events.emit("stateChanged", { editorLayout: this.state.editorLayout });

        return focusTarget;
    }

    public setActiveEditorTabInGroup(tabId: string, groupId: string): void {
        this.state.editorLayout = this.updateGroup(this.state.editorLayout, groupId, (group) => ({
            ...group,
            focus: tabId,
        }));

        this.recordEditorTabFocus(groupId, tabId);
        this.events.emit("editorTabActivatedInGroup", { tabId, groupId });
        this.events.emit("editorLayoutChanged", this.state.editorLayout);
        this.events.emit("stateChanged", { editorLayout: this.state.editorLayout });
    }

    public getEditorLayout(): Readonly<EditorLayout> {
        return this.state.editorLayout;
    }

    /**
     * Flatten all ActionDefinition objects contained in an ActionGroup (recursively).
     */
    private static flattenGroupActions(group: ActionGroup): (ModuleAction | ActionSeparator)[] {
        const collected: (ModuleAction | ActionSeparator)[] = [];

        // Helper to recursively walk through menu items
        const walk = (item: ActionMenuItem | ActionDefinition): void => {
            // Skip separators
            if ((item as any).separator) {
                return;
            }

            // If submenu -> recurse
            if ("items" in item && Array.isArray((item as any).items)) {
                (item as ActionSubmenu).items.forEach(walk);
                return;
            }

            // Finally, it should be an ActionDefinition
            collected.push(item as ActionDefinition);
        };

        // Old flat list API
        if (group.actions) {
            group.actions.forEach((a) => collected.push(a));
        }

        // Hierarchical API
        if (group.items) {
            group.items.forEach(walk);
        }

        return collected;
    }

    /**
     * Register (or refresh) keybinding for an ActionDefinition
     * @param action the action definition
     * @param ownerPrefix optional prefix (e.g., group id) to make keybinding ids unique
     */
    private registerKeybindingForAction(action: ActionDefinition, ownerPrefix?: string) {
        if (!this.keybindingService || !action.shortcut) {
            return;
        }

        const kbKey = ownerPrefix ? `${ownerPrefix}-${action.id}` : action.id;

        // dispose previous if exist so we can refresh
        this.kbDisposers.get(kbKey)?.();

        const kb: Keybinding = {
            id: `action:${kbKey}`,
            key: action.shortcut,
            description: action.tooltip ?? action.label ?? action.id,
            handler: () => action.onClick(null as any),
            when: action.when,
            allowInEditable: action.allowInEditable,
        };
        const dispose = this.keybindingService.register(kb);
        this.kbDisposers.set(kbKey, dispose);
    }

    /**
     * Clear all state
     */
    public clear(): void {
        this.state = {
            notifications: [],
            actionBarItems: [],
            panels: [],
            panelOrder: {},
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
        this.editorTabFocusHistory = [];
        this.events.clear();
    }
}
