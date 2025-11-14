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
    private focusStack: FocusContext[] = []; // Stack to track previous focus states for dialogs
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
    public setFocus(area: FocusArea, targetId?: string, options?: { silent?: boolean; pushToStack?: boolean }): void {
        const oldFocus = { ...this.currentFocus };

        // Handle dialog focus management
        if (area === FocusArea.Dialog) {
            // When setting focus to a dialog, push current focus to stack
            if (options?.pushToStack !== false) { // Default to true for dialogs
                this.focusStack.push(oldFocus);
            }
        }

        this.currentFocus = { area, targetId };

        // Only emit if focus actually changed and not silent
        if (!options?.silent && (oldFocus.area !== area || oldFocus.targetId !== targetId)) {
            this.events.emit("focusChanged", this.currentFocus);
        }
    }

    /**
     * Restore previous focus from stack (used when closing dialogs)
     */
    public restorePreviousFocus(): void {
        const previousFocus = this.focusStack.pop();
        if (previousFocus) {
            this.setFocus(previousFocus.area, previousFocus.targetId, { pushToStack: false });
        } else {
            // If no previous focus in stack, clear focus
            this.clearFocus();
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

