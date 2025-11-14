import { Keybinding, FocusContext } from "./types";
import { FocusManager } from "./FocusManager";
import { UIStore } from "./UIStore";

/**
 * Parse a keybinding string (e.g., "ctrl+s") into modifier keys and key
 */
interface ParsedKeybinding {
    ctrl: boolean;
    alt: boolean;
    shift: boolean;
    meta: boolean;
    key: string;
}

function parseKeybinding(binding: string): ParsedKeybinding {
    const parts = binding.toLowerCase().split("+");
    const result: ParsedKeybinding = {
        ctrl: false,
        alt: false,
        shift: false,
        meta: false,
        key: "",
    };

    for (const part of parts) {
        switch (part) {
            case "ctrl":
            case "control":
                result.ctrl = true;
                break;
            case "alt":
            case "option":
                result.alt = true;
                break;
            case "shift":
                result.shift = true;
                break;
            case "cmd":
            case "meta":
            case "super":
                result.meta = true;
                break;
            default:
                result.key = part;
        }
    }

    return result;
}

/**
 * Check if keyboard event matches parsed keybinding
 */
function matchesKeybinding(event: KeyboardEvent, parsed: ParsedKeybinding): boolean {
    return (
        event.ctrlKey === parsed.ctrl &&
        event.altKey === parsed.alt &&
        event.shiftKey === parsed.shift &&
        event.metaKey === parsed.meta &&
        event.key.toLowerCase() === parsed.key
    );
}

/**
 * Keybinding Service
 * Manages keyboard shortcuts and dispatches them based on focus context
 */
export class KeybindingService {
    private keybindings: Map<string, Keybinding>;
    private focusManager: FocusManager;
    private uiStore: UIStore;
    private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

    constructor(focusManager: FocusManager, uiStore: UIStore) {
        this.keybindings = new Map();
        this.focusManager = focusManager;
        this.uiStore = uiStore;
    }

    /**
     * Register a keybinding
     * Returns a disposer function
     */
    public register(keybinding: Keybinding): () => void {
        this.keybindings.set(keybinding.id, keybinding);
        return () => this.unregister(keybinding.id);
    }

    /**
     * Unregister a keybinding
     */
    public unregister(id: string): void {
        this.keybindings.delete(id);
    }

    /**
     * Register multiple keybindings
     * Returns a disposer function that unregisters all
     */
    public registerMany(keybindings: Keybinding[]): () => void {
        const disposers = keybindings.map(kb => this.register(kb));
        return () => {
            disposers.forEach(dispose => dispose());
        };
    }

    /**
     * Get all registered keybindings
     */
    public getAll(): Keybinding[] {
        return Array.from(this.keybindings.values());
    }

    /**
     * Start listening for keyboard events
     */
    public start(): void {
        if (this.keydownHandler) {
            return; // Already started
        }

        this.keydownHandler = (event: KeyboardEvent) => {
            this.handleKeyDown(event);
        };

        window.addEventListener("keydown", this.keydownHandler);
    }

    /**
     * Stop listening for keyboard events
     */
    public stop(): void {
        if (this.keydownHandler) {
            window.removeEventListener("keydown", this.keydownHandler);
            this.keydownHandler = null;
        }
    }

    /**
     * Handle keydown event
     */
    private handleKeyDown(event: KeyboardEvent): void {
        // If there's an active dialog, don't process global keybindings
        // Dialogs handle their own keyboard events
        if (this.uiStore.getActiveDialogId()) {
            return;
        }

        const currentFocus = this.focusManager.getFocus();

        // Find matching keybindings
        for (const keybinding of this.keybindings.values()) {
            const parsed = parseKeybinding(keybinding.key);

            if (matchesKeybinding(event, parsed)) {
                // Check if keybinding is active in current context
                if (keybinding.when && !keybinding.when(currentFocus)) {
                    continue;
                }

                // Execute handler
                event.preventDefault();
                event.stopPropagation();

                const result = keybinding.handler(currentFocus);
                if (result instanceof Promise) {
                    result.catch(err => {
                        console.error(`Error executing keybinding ${keybinding.id}:`, err);
                    });
                }

                // Only handle first matching keybinding
                break;
            }
        }
    }

    /**
     * Clear all keybindings
     */
    public clear(): void {
        this.keybindings.clear();
    }
}

