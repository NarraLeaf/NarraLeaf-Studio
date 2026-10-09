/**
 * How the player moves between a game's controls without aiming at them.
 *
 * A game is played with a mouse, a keyboard and a gamepad, and only the first can point. The other
 * two need a focus - one control that is "the one" - and a way to move it: up, down, left, right,
 * and in and out of a group. That is one system for both of them, not one per device. The keyboard's
 * arrows and the pad's D-pad move the same focus by the same rules, and a mouse resting on a control
 * makes that control the place the next arrow press starts from. Each device only differs in the
 * buttons that raise the moves, and those are input actions like any other (see
 * {@link UI_NAVIGATION_ACTIONS}).
 *
 * This file is the data half: what an element and a surface say about it. The runtime that reads it
 * lives in `runtime/navigation`.
 *
 * ## An element
 *
 * Every control a game draws is reachable by default - a button, a switch, a list row, a choice -
 * because an author who placed a button wants it pressed, and making every one of them opt in would
 * leave every existing project unreachable from a pad. So {@link UIElementNavigation} is a list of
 * exceptions, absent on almost every element:
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

// === The actions that move the focus ====================================================

/**
 * What the player can ask navigation to do. On the stage, with nothing focused, Confirm also reads
 * the story on - the press a click on the stage is - and Menu steps into the stage's own controls.
 *
 * Each is an input action with a reserved id, so the
 * buttons that raise it are bindings an author can see and change, a surface can answer it with a
 * graph of its own, and the global blueprint can listen to it - the intent system the rest of the
 * game's input already goes through, rather than keys wired into the runtime.
 */
export const UI_NAVIGATION_INTENTS = ["up", "down", "left", "right", "next", "previous", "confirm", "cancel", "menu"] as const;

export type UINavigationIntent = (typeof UI_NAVIGATION_INTENTS)[number];

/** The prefix no author action can carry: ids an author creates are generated, never dotted. */
export const UI_NAVIGATION_ACTION_PREFIX = "nl.nav.";

export function uiNavigationActionId(intent: UINavigationIntent): string {
    return `${UI_NAVIGATION_ACTION_PREFIX}${intent}`;
}

export function readUINavigationActionIntent(actionId: string): UINavigationIntent | null {
    if (!actionId.startsWith(UI_NAVIGATION_ACTION_PREFIX)) {
        return null;
    }
    const intent = actionId.slice(UI_NAVIGATION_ACTION_PREFIX.length);
    return (UI_NAVIGATION_INTENTS as readonly string[]).includes(intent) ? (intent as UINavigationIntent) : null;
}

export function isUINavigationActionId(actionId: string): boolean {
    return readUINavigationActionIntent(actionId) !== null;
}

/**
 * What each intent is bound to until an author says otherwise.
 *
 * The keyboard has had arrows, Tab, Enter and Escape for this longer than games have had pads, and
 * the pad's are the ones every console menu uses. Both sticks of a pad are not bindings - the left
 * one reaches here as four virtual buttons (`Left Stick Up`, ...), which is what lets it share the
 * D-pad's rows.
 */
const UI_NAVIGATION_DEFAULT_BINDINGS: Readonly<Record<UINavigationIntent, readonly UIInputBinding[]>> = {
    up: [{ kind: "key", key: "ArrowUp" }, { kind: "gamepad", button: "D-pad Up" }, { kind: "gamepad", button: "Left Stick Up" }],
    down: [{ kind: "key", key: "ArrowDown" }, { kind: "gamepad", button: "D-pad Down" }, { kind: "gamepad", button: "Left Stick Down" }],
    left: [{ kind: "key", key: "ArrowLeft" }, { kind: "gamepad", button: "D-pad Left" }, { kind: "gamepad", button: "Left Stick Left" }],
    right: [{ kind: "key", key: "ArrowRight" }, { kind: "gamepad", button: "D-pad Right" }, { kind: "gamepad", button: "Left Stick Right" }],
    next: [{ kind: "key", key: "Tab" }],
    previous: [{ kind: "key", key: "Shift+Tab" }],
    confirm: [{ kind: "key", key: "Enter" }, { kind: "key", key: "Space" }, { kind: "gamepad", button: "A" }],
    cancel: [{ kind: "key", key: "Escape" }, { kind: "gamepad", button: "B" }],
    // Into the controls on the stage and back out - the quick menu during dialogue, which the D-pad
    // does not wander onto by itself. A pad's alone: a keyboard player has a mouse to reach it with.
    menu: [{ kind: "gamepad", button: "Y" }],
};

export function defaultUINavigationBindings(intent: UINavigationIntent): UIInputBinding[] {
    return UI_NAVIGATION_DEFAULT_BINDINGS[intent].map(binding => ({ ...binding }));
}

/** The intents a held button repeats, as a held arrow key does in a text field. */
export function uiNavigationIntentRepeats(intent: UINavigationIntent): boolean {
    return intent === "up" || intent === "down" || intent === "left" || intent === "right"
        || intent === "next" || intent === "previous";
}

/**
 * The vocabulary a running game routes by: the project's own actions, and the navigation actions.
 *
 * A navigation action the document holds an entry for is that entry - an author who rebound Confirm
 * changed it there - and one it does not hold is the default. Nothing is written into the document
 * for a default, so a project that never touched navigation carries nothing for it, and a Studio
 * that changes a default changes it for every such project.
 */
export function resolveRuntimeInputVocabulary(
    actions: Readonly<Record<string, UIInputActionDef>> | undefined,
): Record<string, UIInputActionDef> {
    const out: Record<string, UIInputActionDef> = { ...(actions ?? {}) };
    for (const intent of UI_NAVIGATION_INTENTS) {
        const id = uiNavigationActionId(intent);
        if (!out[id]) {
            out[id] = { id, name: intent, bindings: defaultUINavigationBindings(intent) };
        }
    }
    return out;
}

/**
 * Whether an element has a look of its own for being pointed at: an appearance row that applies
 * while it is hovered.
 *
 * A focused control is drawn with that look (`NavigationFocusContext`), and the platform's focus
 * ring is only the fallback for a control the author gave no hover look - so this is the question
 * that decides between them. Searched through the whole of the props rather than one known path,
 * because every widget keeps its appearance under its own shape.
 */
export function uiElementHasHoverLook(element: Pick<UIElement, "props"> | null | undefined): boolean {
    const visit = (value: unknown, depth: number): boolean => {
        if (!value || typeof value !== "object" || depth > 12) {
            return false;
        }
        if (Array.isArray(value)) {
            return value.some(entry => visit(entry, depth + 1));
        }
        const record = value as Record<string, unknown>;
        const conditions = record.conditions;
        if (conditions && typeof conditions === "object" && (conditions as Record<string, unknown>).hovered === true) {
            return true;
        }
        return Object.values(record).some(entry => visit(entry, depth + 1));
    };
    return visit(element?.props, 0);
}
