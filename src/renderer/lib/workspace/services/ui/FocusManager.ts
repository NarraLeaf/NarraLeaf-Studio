import { EventEmitter } from "./EventEmitter";
import { FocusContext, FocusArea } from "./types";

/**
 * Focus events
 */
export interface FocusEvents {
    focusChanged: FocusContext;
}

/**
 * Focus Manager
 * Manages focus state across the workspace
 * Allows different areas to register dynamic actions and keybindings
 */
export class FocusManager {
    private currentFocus: FocusContext;
    private events: EventEmitter<FocusEvents>;

    constructor() {
        this.currentFocus = {
            area: FocusArea.None,
            targetId: undefined,
        };
        this.events = new EventEmitter<FocusEvents>();
    }

    /**
     * Get current focus context
     */
    public getFocus(): Readonly<FocusContext> {
        return { ...this.currentFocus };
    }

    /**
     * Set focus to a specific area and target
     */
    public setFocus(area: FocusArea, targetId?: string): void {
        const oldFocus = { ...this.currentFocus };
        this.currentFocus = { area, targetId };

        // Only emit if focus actually changed
        if (oldFocus.area !== area || oldFocus.targetId !== targetId) {
            this.events.emit("focusChanged", this.currentFocus);
        }
    }

    /**
     * Clear focus
     */
    public clearFocus(): void {
        this.setFocus(FocusArea.None);
    }

    /**
     * Check if a specific area is focused
     */
    public isFocused(area: FocusArea, targetId?: string): boolean {
        if (targetId) {
            return this.currentFocus.area === area && this.currentFocus.targetId === targetId;
        }
        return this.currentFocus.area === area;
    }

    /**
     * Get event emitter
     */
    public getEvents(): EventEmitter<FocusEvents> {
        return this.events;
    }

    /**
     * Subscribe to focus changes
     */
    public onFocusChange(handler: (context: FocusContext) => void): () => void {
        return this.events.on("focusChanged", handler);
    }
}

