import { UIStore } from "./UIStore";
import { EditorTab } from "./types";
import { EditorTabDefinition } from "@/apps/workspace/registry/types";

/**
 * Editor Service
 * Manages editor tabs with type-safe payload support
 */
export class EditorService {
    private store: UIStore;

    constructor(store: UIStore) {
        this.store = store;
    }

    /**
     * Open an editor tab with optional payload
     */
    public open<TPayload = any>(tab: EditorTabDefinition<TPayload>, groupId?: string, options?: { activate?: boolean }): void {
        // Route to group-aware API to ensure consistent behavior with Registry
        this.store.openEditorTabInGroup(tab, groupId, options?.activate ?? true);
    }

    /**
     * Open or update an editor tab with new payload
     * If the tab is already open, updates its payload
     */
    public openOrUpdate<TPayload = any>(tab: EditorTabDefinition<TPayload>, groupId?: string, options?: { activate?: boolean }): void {
        // Group-aware API already updates existing tabs and activates them
        this.store.openEditorTabInGroup(tab, groupId, options?.activate ?? true);
    }

    /**
     * Turn a preview tab into an ordinary one, and answer whether it was a preview.
     *
     * What an editor calls when the author starts working in it - see `UIStore.promoteEditorTab`
     * for the rest of the rule. Safe to call on any tab: an ordinary one answers false.
     */
    public promote(tabId: string, groupId?: string): boolean {
        return this.store.promoteEditorTab(tabId, groupId);
    }

    /**
     * Close an editor tab
     */
    public close(tabId: string): void {
        this.store.closeEditorTab(tabId);
    }

    /**
     * Close all editor tabs
     */
    public closeAll(): void {
        const tabs = this.store.getEditorTabs();
        tabs.forEach(tab => this.close(tab.id));
    }

    /**
     * Close all except the specified tab
     */
    public closeAllExcept(tabId: string): void {
        const tabs = this.store.getEditorTabs();
        tabs.forEach(tab => {
            if (tab.id !== tabId) {
                this.close(tab.id);
            }
        });
    }

    /**
     * Set the active editor tab
     */
    public setActive(tabId: string): void {
        this.store.setActiveEditorTab(tabId);
    }

    /**
     * Get the active editor tab id
     */
    public getActiveId(): string | null {
        return this.store.getActiveEditorTabId();
    }

    /**
     * Get the active editor tab
     */
    public getActive(): EditorTab | null {
        const activeId = this.getActiveId();
        if (!activeId) return null;
        return this.get(activeId) ?? null;
    }

    /**
     * Get all editor tabs
     */
    public getAll(): EditorTab[] {
        return this.store.getEditorTabs();
    }

    /**
     * Get an editor tab by id
     */
    public get<TPayload = any>(tabId: string): EditorTab<TPayload> | undefined {
        return this.store.getEditorTabs().find(t => t.id === tabId);
    }

    /**
     * Update an editor tab in place, wherever in the layout it sits.
     *
     * Writes into `editorLayout` - the group tree the tab strip renders - rather than replacing the
     * tab, so a title, an unsaved dot or a payload can change without the tab losing its slot, its
     * pane or its focus.
     */
    public update<TPayload = any>(tabId: string, updates: Partial<Omit<EditorTab<TPayload>, "id">>): void {
        this.store.updateEditorTab(tabId, updates);
    }

    /**
     * Update payload of an editor tab
     */
    public updatePayload<TPayload = any>(tabId: string, payload: TPayload): void {
        this.update<TPayload>(tabId, { payload });
    }

    /**
     * Get payload of an editor tab
     */
    public getPayload<TPayload = any>(tabId: string): TPayload | undefined {
        const tab = this.get<TPayload>(tabId);
        return tab?.payload;
    }

    /**
     * Set tab modified state
     */
    public setModified(tabId: string, modified: boolean): void {
        this.update(tabId, { modified });
    }

    /**
     * Set tab badge
     *
     * Stored on the tab and readable back through {@link get}. The tab strip draws a title, an
     * unsaved dot and a close button and nothing else, so a badge set here is state, not a mark on
     * the screen.
     */
    public setBadge(tabId: string, badge: string | number | undefined): void {
        this.update(tabId, { badge });
    }

    /**
     * Check if a tab is open
     */
    public isOpen(tabId: string): boolean {
        return this.get(tabId) !== undefined;
    }
}

