/**
 * How the player moves between a game's controls without aiming at them.
 *
 * A game is played with a mouse, a keyboard and a gamepad, and only the first can point. The other
 * two need a focus - one control that is "the one" - and a way to move it: up, down, left, right,
 * and in and out of a group. That is one system for both of them, not one per device, built in three
 * layers, each of which knows nothing about the one above it:
 *
 *  1. **The focus.** Which control holds it, where a direction takes it, what an element says about
 *     being reached ({@link UIElementNavigation}) and how a focused control looks - the `focused`
 *     state of its appearance, the author's to draw as `hovered` is, with the platform's ring only
 *     for a control that has no look of its own.
 *  2. **The intents.** The focus is moved by a fixed set of operations, the slots
 *     ({@link UI_NAVIGATION_SLOTS}): move up, confirm, back, and so on. A slot does nothing by itself.
 *     It is filled by one of the project's own intents (`UIInputActionDef.navigationSlot`), and the
 *     bindings of that intent are what move the focus. A project whose intents fill no slot has no
 *     navigation, and nothing in the runtime makes one up for it: the default keys are content, and a
 *     new project gets them from its template the way it gets every other intent.
 *  3. **The devices.** A key, a pad button, a pointer gesture: bindings of an intent, nothing more.
 *     A pad is not special to navigation - it raises intents as a keyboard does, and a graph that
 *     wants the pad itself reads it with its own nodes.
 *
 * This file is the data half: what an element, a surface and an intent say about it. The runtime
 * that reads it lives in `runtime/navigation`.
 *
 * ## An element
 *
 * Every control a game draws is reachable by default - a button, a switch, a list row, a choice -
 * because an author who placed a button wants it pressed, and making every one of them opt in would
 * leave a project unreachable from a pad the day it fills the slots. So {@link UIElementNavigation}
 * is a list of exceptions, absent on almost every element:
 *
 *  - `focusable: "never"` takes the element, and everything inside it, out of navigation. A panel of
 *    decorative buttons, a control that only means something to a mouse.
 *  - `focusable: "always"` puts an element that is not a control in: an image with a click head is
 *    clicked by Confirm once the player moves onto it.
 *  - `neighbors` names where one direction goes, for the layouts geometry reads wrong.
 *  - `region` makes a container a group: moving stays inside it until it runs out, can wrap around
 *    at the edge, and coming back into it can return to where the player left it.
 *  - `preferredOnEntry` is where the focus lands when the surface opens.
 *
 * Its own field rather than a `props` key, for the reason `animation` is: it belongs to the placement
 * rather than to the widget, every type has it, and a linked component instance may set it although
 * its props come from the definition.
 *
 * ## A surface
 *
 * {@link UISurfaceNavigation} says where the focus starts and whether it is put there at all: a
 * mouse player opening the settings page should not see a ring appear on its first control, a pad
 * player has nothing to press until one does.
 *
 * No schema bump: every field is optional and absence is the behaviour the runtime has without it.
 *
 * Comments in English per project convention.
 */

import type { UIElement, UIElementId, UISurface } from "./document";
import type { AppearanceSystemCondition } from "./appearance";
import type { UIInputActionDef, UIInputBinding } from "./inputAction";

export const UI_NAVIGATION_DIRECTIONS = ["up", "down", "left", "right"] as const;

export type UINavigationDirection = (typeof UI_NAVIGATION_DIRECTIONS)[number];

export function isUINavigationDirection(value: unknown): value is UINavigationDirection {
    return typeof value === "string" && (UI_NAVIGATION_DIRECTIONS as readonly string[]).includes(value);
}

/** Whether an element takes part in navigation. `auto` is "if it is a control". */
export const UI_FOCUSABILITY_VALUES = ["auto", "always", "never"] as const;

export type UIFocusability = (typeof UI_FOCUSABILITY_VALUES)[number];

/** A container that keeps the focus in itself while there is somewhere to go inside. */
export type UINavigationRegion = {
    /** Moving past the last control inside comes back round to the first, rather than leaving. */
    wrap?: boolean;
    /** Coming back into the group lands on the control the player left it from. */
    rememberLast?: boolean;
};

export type UIElementNavigation = {
    focusable?: UIFocusability;
    /** Where one direction goes from here, by element id, overriding what the layout would say. */
    neighbors?: Partial<Record<UINavigationDirection, UIElementId>>;
    /** Present makes this element a group. Only meaningful on an element that holds children. */
    region?: UINavigationRegion;
    /** Where the focus lands when the surface opens, unless the surface names an element itself. */
    preferredOnEntry?: boolean;
};

/**
 * When a surface that has just opened puts the focus on a control.
 *
 * - `device`: when the player last used a keyboard or a pad - the players who need one;
 * - `always`: whatever they used, for a screen that is all about one choice;
 * - `never`: not until they press a direction.
 */
export const UI_NAVIGATION_AUTO_FOCUS_VALUES = ["device", "always", "never"] as const;

export type UINavigationAutoFocus = (typeof UI_NAVIGATION_AUTO_FOCUS_VALUES)[number];

export type UISurfaceNavigation = {
    /** The element the focus starts on. Absent: the one marked `preferredOnEntry`, else the first. */
    defaultFocusElementId?: UIElementId;
    autoFocus?: UINavigationAutoFocus;
    /** Moving past the edge of the surface comes back round from the other side. */
    wrap?: boolean;
};

export const UI_NAVIGATION_AUTO_FOCUS_DEFAULT: UINavigationAutoFocus = "device";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * A stored element record, or null when it says nothing a default would not.
 *
 * Every field is rebuilt rather than spread, and every default is dropped, so "set it and put it
 * back" leaves the document as it was - the rule an element's animation follows.
 */
export function normalizeUIElementNavigation(value: unknown): UIElementNavigation | null {
    if (!isPlainRecord(value)) {
        return null;
    }
    const out: UIElementNavigation = {};
    if (value.focusable === "always" || value.focusable === "never") {
        out.focusable = value.focusable;
    }
    if (isPlainRecord(value.neighbors)) {
        const neighbors: Partial<Record<UINavigationDirection, UIElementId>> = {};
        for (const direction of UI_NAVIGATION_DIRECTIONS) {
            const id = value.neighbors[direction];
            if (typeof id === "string" && id.trim().length > 0) {
                neighbors[direction] = id;
            }
        }
        if (Object.keys(neighbors).length > 0) {
            out.neighbors = neighbors;
        }
    }
    if (isPlainRecord(value.region)) {
        out.region = {
            ...(value.region.wrap === true ? { wrap: true } : {}),
            ...(value.region.rememberLast === true ? { rememberLast: true } : {}),
        };
    }
    if (value.preferredOnEntry === true) {
        out.preferredOnEntry = true;
    }
    return Object.keys(out).length > 0 ? out : null;
}

/** The element's record, or an empty one. Never null, for a reader that only wants a field. */
export function readUIElementNavigation(element: Pick<UIElement, "navigation"> | null | undefined): UIElementNavigation {
    return normalizeUIElementNavigation(element?.navigation) ?? {};
}

export function readUIElementFocusability(element: Pick<UIElement, "navigation"> | null | undefined): UIFocusability {
    return readUIElementNavigation(element).focusable ?? "auto";
}

/** A stored surface record, or null when it says nothing a default would not. */
export function normalizeUISurfaceNavigation(value: unknown): UISurfaceNavigation | null {
    if (!isPlainRecord(value)) {
        return null;
    }
    const out: UISurfaceNavigation = {};
    if (typeof value.defaultFocusElementId === "string" && value.defaultFocusElementId.trim().length > 0) {
        out.defaultFocusElementId = value.defaultFocusElementId;
    }
    if (value.autoFocus === "always" || value.autoFocus === "never") {
        out.autoFocus = value.autoFocus;
    }
    if (value.wrap === true) {
        out.wrap = true;
    }
    return Object.keys(out).length > 0 ? out : null;
}

export function readUISurfaceNavigation(surface: Pick<UISurface, "settings"> | null | undefined): UISurfaceNavigation {
    return normalizeUISurfaceNavigation(surface?.settings?.navigation) ?? {};
}

// === The slots the intents fill ==========================================================

/**
 * What the player can ask navigation to do. On the stage, with nothing focused, Confirm also reads
 * the story on - the press a click on the stage is - and Menu steps into the stage's own buttons.
 *
 * Fixed: the focus system knows these operations and no others. Which buttons perform one is not
 * fixed - that is the intent a project puts in the slot.
 */
export const UI_NAVIGATION_SLOTS = ["up", "down", "left", "right", "next", "previous", "confirm", "cancel", "menu"] as const;

export type UINavigationSlot = (typeof UI_NAVIGATION_SLOTS)[number];

export function isUINavigationSlot(value: unknown): value is UINavigationSlot {
    return typeof value === "string" && (UI_NAVIGATION_SLOTS as readonly string[]).includes(value);
}

/** The slots a held button repeats, as a held arrow key does in a text field. */
export function uiNavigationSlotRepeats(slot: UINavigationSlot): boolean {
    return slot === "up" || slot === "down" || slot === "left" || slot === "right"
        || slot === "next" || slot === "previous";
}

type SlotCarrier = Readonly<Record<string, Pick<UIInputActionDef, "navigationSlot">>> | undefined;

/**
 * Which intent fills each slot, read from the project's intents.
 *
 * Stored on the intent rather than in a table of its own, so an intent that is deleted takes its slot
 * with it and nothing can point at an intent that is not there. Normalising the library already
 * keeps one intent per slot (`normalizeUIInputActionLibrary`); this reads the same rule again for a
 * caller holding a table that never went through it.
 */
export function resolveUINavigationSlots(actions: SlotCarrier): Partial<Record<UINavigationSlot, string>> {
    const slots: Partial<Record<UINavigationSlot, string>> = {};
    for (const [actionId, action] of Object.entries(actions ?? {})) {
        const slot = action?.navigationSlot;
        if (isUINavigationSlot(slot) && !slots[slot]) {
            slots[slot] = actionId;
        }
    }
    return slots;
}

/** Whether any of the project's intents fills a slot: whether the game has navigation at all. */
export function hasUINavigationSlots(actions: SlotCarrier): boolean {
    return Object.values(actions ?? {}).some(action => isUINavigationSlot(action?.navigationSlot));
}

/**
 * The slots a press fills: the slots of the intents it raised.
 *
 * Shift+Tab is also Tab - a key binding without modifiers matches a press with them - so when both
 * Next and Previous are raised the one that names Shift is the one the player meant.
 */
export function raisedUINavigationSlots(actions: SlotCarrier, actionIds: readonly string[]): Set<UINavigationSlot> {
    const slots = resolveUINavigationSlots(actions);
    const raised = new Set(actionIds);
    const out = new Set<UINavigationSlot>();
    for (const slot of UI_NAVIGATION_SLOTS) {
        const actionId = slots[slot];
        if (actionId && raised.has(actionId)) {
            out.add(slot);
        }
    }
    if (out.has("previous")) {
        out.delete("next");
    }
    return out;
}

/**
 * What an intent created for a slot starts bound to, when the author asks Studio to fill the empty
 * slots - and what the starter project's navigation intents carry.
 *
 * A preset, spent the moment the intent exists, exactly as `UI_INPUT_ACTION_PRESETS` are: the
 * bindings are written into the project and are the author's from then on. The runtime never reads
 * this table. The keyboard has had arrows, Tab, Enter and Escape for this longer than games have had
 * pads, and the pad's are the ones every console menu uses; the left stick reaches here as four
 * virtual buttons (`Left Stick Up`, ...), which is what lets it share the D-pad's rows.
 */
export const UI_NAVIGATION_SLOT_PRESET_BINDINGS: Readonly<Record<UINavigationSlot, readonly UIInputBinding[]>> = {
    up: [{ kind: "key", key: "Arrow Up" }, { kind: "gamepad", button: "D-pad Up" }, { kind: "gamepad", button: "Left Stick Up" }],
    down: [{ kind: "key", key: "Arrow Down" }, { kind: "gamepad", button: "D-pad Down" }, { kind: "gamepad", button: "Left Stick Down" }],
    left: [{ kind: "key", key: "Arrow Left" }, { kind: "gamepad", button: "D-pad Left" }, { kind: "gamepad", button: "Left Stick Left" }],
    right: [{ kind: "key", key: "Arrow Right" }, { kind: "gamepad", button: "D-pad Right" }, { kind: "gamepad", button: "Left Stick Right" }],
    next: [{ kind: "key", key: "Tab" }],
    previous: [{ kind: "key", key: "Shift+Tab" }],
    confirm: [{ kind: "key", key: "Enter" }, { kind: "key", key: "Space" }, { kind: "gamepad", button: "A" }],
    cancel: [{ kind: "key", key: "Escape" }, { kind: "gamepad", button: "B" }],
    // Into the buttons on the stage and back out - the quick menu during dialogue, which the D-pad
    // does not wander onto by itself. A pad's alone: a keyboard player has a mouse to reach it with.
    menu: [{ kind: "gamepad", button: "Y" }],
};

/**
 * Whether an element has a look of its own for holding the focus: an appearance row that applies
 * while it is focused.
 *
 * A focused control is drawn with that look, and the platform's focus ring is only the fallback for
 * a control the author gave none - so this is the question that decides between them. Searched
 * through the whole of the props rather than one known path, because every widget keeps its
 * appearance under its own shape.
 */
export function uiElementHasFocusLook(element: Pick<UIElement, "props"> | null | undefined): boolean {
    const visit = (value: unknown, depth: number): boolean => {
        if (!value || typeof value !== "object" || depth > 12) {
            return false;
        }
        if (Array.isArray(value)) {
            return value.some(entry => visit(entry, depth + 1));
        }
        const record = value as Record<string, unknown>;
        const conditions = record.conditions as AppearanceSystemCondition | null | undefined;
        if (conditions && typeof conditions === "object" && conditions.focused === true) {
            return true;
        }
        return Object.values(record).some(entry => visit(entry, depth + 1));
    };
    return visit(element?.props, 0);
}
