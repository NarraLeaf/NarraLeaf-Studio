import { isMacPlatform } from "@/lib/app/platform";
import { Keybinding, FocusContext } from "./types";
import { FocusManager } from "./FocusManager";
import { UIStore } from "./UIStore";
import { isEditableKeyboardTarget } from "./keyboardEditable";
import { getKeybindingCatalogEntry } from "./keybindingCatalog";

/**
 * Parse a keybinding string (e.g., "mod+s") into modifier keys and key
 */
interface ParsedKeybinding {
    ctrl: boolean;
    alt: boolean;
    shift: boolean;
    meta: boolean;
    key: string;
}

/**
 * Exported for tests (the platform flag is injected there); production code goes
 * through the service, which resolves the flag itself.
 *
 * `mod` is the primary shortcut modifier — ⌘ on macOS, Ctrl elsewhere. Use it for
 * every cross-platform shortcut instead of registering ctrl/meta twins. Literal
 * `ctrl` stays available for the few bindings that genuinely mean the Control key
 * on macOS too (e.g. ctrl+tab tab-switching, where ⌘+Tab belongs to the OS).
 */
export function parseKeybinding(binding: string, isMac: boolean): ParsedKeybinding {
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
            case "mod":
                if (isMac) {
                    result.meta = true;
                } else {
                    result.ctrl = true;
                }
                break;
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

const MAC_MODIFIER_SYMBOLS: Record<string, string> = {
    mod: "⌘",
    cmd: "⌘",
    meta: "⌘",
    super: "⌘",
    ctrl: "⌃",
    control: "⌃",
    alt: "⌥",
    option: "⌥",
    shift: "⇧",
};

const MODIFIER_LABELS: Record<string, string> = {
    mod: "Ctrl",
    cmd: "Win",
    meta: "Win",
    super: "Win",
    ctrl: "Ctrl",
    control: "Ctrl",
    alt: "Alt",
    option: "Alt",
    shift: "Shift",
};

/** Key tokens whose name reads better than the raw string once capitalized. */
const KEY_LABELS: Record<string, string> = {
    " ": "Space",
    space: "Space",
    escape: "Esc",
    arrowup: "↑",
    arrowdown: "↓",
    arrowleft: "←",
    arrowright: "→",
    "=": "+",
};

/**
 * Render a binding for humans: "mod+c" → "⌘C" on macOS, "Ctrl+C" elsewhere.
 *
 * The same string a binding is registered with is the one shown in menus, so a
 * `mod` binding must not be displayed verbatim — and hardcoding "ctrl" in the
 * label is how it silently drifts from what the key actually does on macOS.
 *
 * Exported for tests (the platform flag is injected there).
 */
export function formatKeybinding(binding: string, isMac: boolean): string {
    const parts = binding.toLowerCase().split("+");
    const rendered = parts.map(part => {
        const modifier = isMac ? MAC_MODIFIER_SYMBOLS[part] : MODIFIER_LABELS[part];
        if (modifier) {
            return modifier;
        }
        const key = KEY_LABELS[part] ?? part;
        return key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1);
    });
    // macOS convention runs the symbols together (⇧⌘P); elsewhere they are joined.
    return isMac ? rendered.join("") : rendered.join("+");
}

/**
 * Normalize browser key for comparison with parsed binding keys (lowercase tokens).
 */
function normalizeKeyboardEventKey(event: KeyboardEvent): string {
    return event.key === " " ? "space" : event.key.toLowerCase();
}

/**
 * Global-state key holding the user's keybinding overrides as one `Record<id, binding>` map.
 * A single key (not one per id) because ids may contain dots, which the dotted-path settings
 * store would silently split into nested objects.
 */
export const KEYBINDING_OVERRIDES_SETTINGS_KEY = "keybindings.overrides";

/**
 * Global-state signal key: the Settings window writes a timestamp here to ask the workspace to
 * open its keybinding-settings tab (global-state changes broadcast to every window; the Settings
 * window has no other channel to the workspace's editor area).
 */
export const KEYBINDINGS_OPEN_REQUEST_SETTINGS_KEY = "keybindings.openRequest";

/** Coerce persisted overrides (untrusted JSON) into id → non-empty binding string. */
export function sanitizeKeybindingOverrides(raw: unknown): Record<string, string> {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return {};
    }
    const result: Record<string, string> = {};
    for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof value === "string" && value.trim()) {
            result[id] = value.trim();
        }
    }
    return result;
}

/**
 * Build a binding string from a keydown captured by the settings recorder, or null when the
 * event is not a complete chord (a bare modifier, or a bare key with no modifier where one is
 * required is still allowed — F-keys and the like bind fine alone).
 *
 * The primary modifier records as `mod` (⌘ on macOS, Ctrl elsewhere) so a recorded binding stays
 * portable, matching how built-in bindings are declared. macOS's real Control key records as the
 * literal `ctrl`.
 */
export function keybindingFromKeyboardEvent(
    event: Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">,
    isMac: boolean,
): string | null {
    const key = event.key === " " ? "space" : event.key.toLowerCase();
    if (key === "control" || key === "alt" || key === "shift" || key === "meta") {
        return null;
    }

    const parts: string[] = [];
    if (isMac ? event.metaKey : event.ctrlKey) {
        parts.push("mod");
    }
    if (isMac && event.ctrlKey) {
        parts.push("ctrl");
    }
    if (!isMac && event.metaKey) {
        parts.push("meta");
    }
    if (event.altKey) {
        parts.push("alt");
    }
    if (event.shiftKey) {
        parts.push("shift");
    }
    parts.push(key);
    return parts.join("+");
}

/**
 * Check if keyboard event matches parsed keybinding. Exported for tests.
 */
export function matchesKeybinding(event: KeyboardEvent, parsed: ParsedKeybinding): boolean {
    const evKey = normalizeKeyboardEventKey(event);
    return (
        event.ctrlKey === parsed.ctrl &&
        event.altKey === parsed.alt &&
        event.shiftKey === parsed.shift &&
        event.metaKey === parsed.meta &&
        evKey === parsed.key
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
    /**
     * User rebinds, id → binding string. Applied at match time (and by every display surface via
     * {@link getEffectiveKey}), so a registered binding never has to know it was overridden.
     * Seeded from global state (`keybindings.overrides`) by UIService; persistence is the
     * caller's job — this layer is intentionally storage-free.
     */
    private overrides = new Map<string, string>();
    private overrideListeners = new Set<() => void>();

    constructor(focusManager: FocusManager, uiStore: UIStore) {
        this.keybindings = new Map();
        this.focusManager = focusManager;
        this.uiStore = uiStore;
    }

    // === Overrides ===

    /** Replace the whole override map (startup seed / cross-window sync). */
    public setOverrides(overrides: Record<string, string>): void {
        this.overrides = new Map(Object.entries(overrides));
        this.emitOverridesChanged();
    }

    /** Set (or clear, with null) one override. Does not persist — the caller does. */
    public setOverride(id: string, key: string | null): void {
        if (key && key.trim()) {
            this.overrides.set(id, key.trim());
        } else {
            this.overrides.delete(id);
        }
        this.emitOverridesChanged();
    }

    public getOverride(id: string): string | undefined {
        return this.overrides.get(id);
    }

    /** Snapshot of the current overrides (for persistence / display). */
    public getOverridesSnapshot(): Record<string, string> {
        return Object.fromEntries(this.overrides);
    }

    /**
     * The binding that actually fires: the user's override, else the catalog default, else the
     * inline registration key. Overrides and catalog defaults resolve by the *catalog* id, so a
     * rebind recorded once applies to every per-tab registration of the same command.
     */
    public getEffectiveKey(binding: Pick<Keybinding, "id" | "key" | "catalogId">): string {
        const catalogId = binding.catalogId ?? binding.id;
        return (
            this.overrides.get(catalogId) ??
            getKeybindingCatalogEntry(catalogId)?.key ??
            binding.key
        );
    }

    public onOverridesChanged(listener: () => void): () => void {
        this.overrideListeners.add(listener);
        return () => {
            this.overrideListeners.delete(listener);
        };
    }

    private emitOverridesChanged(): void {
        for (const listener of this.overrideListeners) {
            listener();
        }
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

        if (event.isComposing) {
            return;
        }

        const currentFocus = this.focusManager.getFocus();
        const inEditableField = isEditableKeyboardTarget(event.target);

        // Find matching keybindings
        const isMac = isMacPlatform();
        for (const keybinding of this.keybindings.values()) {
            const parsed = parseKeybinding(this.getEffectiveKey(keybinding), isMac);

            if (matchesKeybinding(event, parsed)) {
                if (inEditableField && !keybinding.allowInEditable) {
                    continue;
                }
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
        this.overrides.clear();
        this.overrideListeners.clear();
    }
}

