import { UIStore } from "./UIStore";
import { PanelDefinition, PanelPosition } from "./types";

/**
 * Panel Service
 * Manages sidebar and bottom panel registration and visibility with payload support
 */
export class PanelService {
    private store: UIStore;

    constructor(store: UIStore) {
        this.store = store;
    }

    /**
     * Register a panel with optional payload
     * Returns a disposer function
     */
    public register<TPayload = any>(panel: PanelDefinition<TPayload>): () => void {
        this.store.registerPanel(panel);
        
        // Return disposer function
        return () => this.unregister(panel.id);
    }

    /**
     * Unregister a panel
     */
    public unregister(id: string): void {
        this.store.unregisterPanel(id);
    }

    /**
     * Show a panel
     */
    public show(panelId: string): void {
        this.store.setPanelVisibility(panelId, true);
    }

    /**
     * Hide a panel
     */
    public hide(panelId: string): void {
        this.store.setPanelVisibility(panelId, false);
    }

    /**
     * Toggle panel visibility
     */
    public toggle(panelId: string): void {
        this.store.togglePanelVisibility(panelId);
    }

    /**
     * Check if a panel is visible
     */
    public isVisible(panelId: string): boolean {
        return this.store.getPanelVisibility()[panelId] ?? false;
    }

    /**
     * Get all panels
     */
    public getAll(): PanelDefinition[] {
        return this.store.getPanels();
    }

    /**
     * Get panels by position
     */
    public getByPosition(position: PanelPosition): PanelDefinition[] {
        return this.store.getPanels().filter(p => p.position === position);
    }

    /**
     * Get a panel by id
     */
    public get<TPayload = any>(id: string): PanelDefinition<TPayload> | undefined {
        return this.store.getPanels().find(p => p.id === id);
    }

    /**
     * Update panel badge
     */
    public setBadge(panelId: string, badge: string | number | undefined): void {
        const panel = this.get(panelId);
        if (panel) {
            this.store.registerPanel({
                ...panel,
                badge,
            });
        }
    }

    /**
     * Update panel payload
     */
    public updatePayload<TPayload = any>(panelId: string, payload: TPayload): void {
        const panel = this.get<TPayload>(panelId);
        if (panel) {
            this.store.registerPanel({
                ...panel,
                payload,
            });
        }
    }

    /**
     * Get panel payload
     */
    public getPayload<TPayload = any>(panelId: string): TPayload | undefined {
        const panel = this.get<TPayload>(panelId);
        return panel?.payload;
    }

    /**
     * Get panel visibility state
     */
    public getVisibility(): Record<string, boolean> {
        return this.store.getPanelVisibility();
    }
}

