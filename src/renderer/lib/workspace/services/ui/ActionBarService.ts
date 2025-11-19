import { UIStore } from "./UIStore";
import { ActionBarItem } from "./types";

/**
 * Action Bar Service
 * Manages action bar items in the title bar
 */
export class ActionBarService {
    private store: UIStore;

    constructor(store: UIStore) {
        this.store = store;
    }

    /**
     * Register an action bar item
     */
    public register(item: ActionBarItem): () => void {
        this.store.addActionBarItem(item);
        
        // Return disposer function
        return () => this.unregister(item.id);
    }

    /**
     * Unregister an action bar item
     */
    public unregister(id: string): void {
        this.store.removeActionBarItem(id);
    }

    /**
     * Update an action bar item
     */
    public update(id: string, updates: Partial<Omit<ActionBarItem, "id">>): void {
        const item = this.store.getActionBarItems().find(i => i.id === id);
        if (item) {
            this.store.updateActionBarItem({
                ...item,
                ...updates,
            });
        }
    }

    /**
     * Set item visibility
     */
    public setVisible(id: string, visible: boolean): void {
        this.update(id, { visible });
    }

    /**
     * Set item enabled state
     */
    public setEnabled(id: string, enabled: boolean): void {
        this.update(id, { disabled: !enabled });
    }

    /**
     * Set item badge
     */
    public setBadge(id: string, badge: string | number | undefined): void {
        this.update(id, { badge });
    }

    /**
     * Get all action bar items
     */
    public getAll(): ActionBarItem[] {
        return this.store.getActionBarItems();
    }

    /**
     * Get an action bar item by id
     */
    public get(id: string): ActionBarItem | undefined {
        return this.store.getActionBarItems().find(i => i.id === id);
    }
}

