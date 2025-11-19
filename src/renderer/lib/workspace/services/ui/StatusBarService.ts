import { UIStore } from "./UIStore";
import { StatusBarItem, StatusBarAlignment } from "./types";

/**
 * Status Bar Service
 * Manages status bar items (not implemented in UI yet, but ready for future use)
 */
export class StatusBarService {
    private store: UIStore;

    constructor(store: UIStore) {
        this.store = store;
    }

    /**
     * Create a status bar item
     */
    public create(options: {
        id: string;
        text: string;
        tooltip?: string;
        alignment?: StatusBarAlignment;
        priority?: number;
        command?: () => void;
    }): () => void {
        const item: StatusBarItem = {
            id: options.id,
            text: options.text,
            tooltip: options.tooltip,
            alignment: options.alignment ?? StatusBarAlignment.Left,
            priority: options.priority ?? 0,
            command: options.command,
            visible: true,
        };

        this.store.addStatusBarItem(item);

        // Return disposer function
        return () => this.remove(item.id);
    }

    /**
     * Remove a status bar item
     */
    public remove(id: string): void {
        this.store.removeStatusBarItem(id);
    }

    /**
     * Update a status bar item
     */
    public update(id: string, updates: Partial<Omit<StatusBarItem, "id">>): void {
        const item = this.get(id);
        if (item) {
            this.store.updateStatusBarItem({
                ...item,
                ...updates,
            });
        }
    }

    /**
     * Set item text
     */
    public setText(id: string, text: string): void {
        this.update(id, { text });
    }

    /**
     * Set item tooltip
     */
    public setTooltip(id: string, tooltip: string): void {
        this.update(id, { tooltip });
    }

    /**
     * Set item visibility
     */
    public setVisible(id: string, visible: boolean): void {
        this.update(id, { visible });
    }

    /**
     * Show a status bar item
     */
    public show(id: string): void {
        this.setVisible(id, true);
    }

    /**
     * Hide a status bar item
     */
    public hide(id: string): void {
        this.setVisible(id, false);
    }

    /**
     * Get all status bar items
     */
    public getAll(): StatusBarItem[] {
        return this.store.getStatusBarItems();
    }

    /**
     * Get a status bar item by id
     */
    public get(id: string): StatusBarItem | undefined {
        return this.store.getStatusBarItems().find(i => i.id === id);
    }

    /**
     * Get status bar items by alignment
     */
    public getByAlignment(alignment: StatusBarAlignment): StatusBarItem[] {
        return this.store.getStatusBarItems().filter(i => i.alignment === alignment);
    }
}

