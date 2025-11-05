import { UIStore } from "./UIStore";
import { EditorTab } from "./types";

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
    public open<TPayload = any>(tab: EditorTab<TPayload>): void {
        this.store.openEditorTab(tab);
    }

    /**
     * Open or update an editor tab with new payload
     * If the tab is already open, updates its payload
     */
    public openOrUpdate<TPayload = any>(tab: EditorTab<TPayload>): void {
        const existing = this.get(tab.id);
        if (existing) {
            this.store.updateEditorTab(tab);
            this.store.setActiveEditorTab(tab.id);
        } else {
            this.store.openEditorTab(tab);
        }
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
     * Update an editor tab
     */
    public update<TPayload = any>(tabId: string, updates: Partial<Omit<EditorTab<TPayload>, "id">>): void {
        const tab = this.get<TPayload>(tabId);
        if (tab) {
            this.store.updateEditorTab({
                ...tab,
                ...updates,
            });
        }
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

