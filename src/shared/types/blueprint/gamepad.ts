/**
 * The gamepad buttons a blueprint head, an input-action binding and a picker all name.
 *
 * One tuple, the way {@link ../ui-editor/inputAction.UI_INPUT_POINTER_GESTURES} is one tuple: a
 * button that exists in the type and in no picker is the failure this prevents. The names are the
 * Xbox layout the Gamepad API's `"standard"` mapping already uses (A/B/X/Y, LB/RB, …), not a
 * second vocabulary authors would have to learn beside it.
 *
 * Analogue sticks are not buttons. They are continuous, so they are read through query nodes; the
 * D-pad is buttons 12–15 and is bindable. The left stick also reads as four virtual buttons, one per
 * direction it is pushed far enough, so a menu that moves with the D-pad moves with the stick too. Non-standard pads are ignored rather than
 * remapped: v1 has no remap table, and a pad whose `mapping` is not `"standard"` has no agreed
 * index for any of these names.
 *
 * Comments in English per project convention.
 */

/**
 * Canonical button names, in standard-mapping index order (0–16).
 *
 * Hardware names, not localised copy - the same ruling as keyboard `Escape`. Aliases (PlayStation
 * face buttons, `l1`/`select`/`guide`, cardinal `south`/`east`/…) collapse onto this list in
 * {@link formatBlueprintGamepadButton}; pickers and stored bindings always show these spellings.
 */
export const BLUEPRINT_GAMEPAD_BUTTONS = [
    "A",
    "B",
    "X",
    "Y",
    "LB",
    "RB",
    "LT",
    "RT",
    "Back",
    "Start",
    "L3",
    "R3",
    "D-pad Up",
    "D-pad Down",
    "D-pad Left",
    "D-pad Right",
    "Home",
    // Not buttons on the pad: the left stick pushed far enough one way, read as a button so it can be
    // bound beside the D-pad (menus move with either) and heard by a head. After the physical ones,
    // which keep their index order; see BLUEPRINT_GAMEPAD_PHYSICAL_BUTTON_COUNT.
    "Left Stick Up",
    "Left Stick Down",
    "Left Stick Left",
    "Left Stick Right",
] as const;

/** How many of the names above are the standard mapping's buttons 0-16. The rest are stick directions. */
export const BLUEPRINT_GAMEPAD_PHYSICAL_BUTTON_COUNT = 17;

export type BlueprintGamepadButton = (typeof BLUEPRINT_GAMEPAD_BUTTONS)[number];

/** Inspector param key selecting which button a filtered gamepad event head watches. */
export const BLUEPRINT_NODE_PARAM_EVENT_HEAD_GAMEPAD_BUTTON = "button" as const;

const CANONICAL_BY_LOWER = new Map<string, BlueprintGamepadButton>(
    BLUEPRINT_GAMEPAD_BUTTONS.map(name => [name.toLowerCase(), name]),
);

/**
 * Spellings that mean a canonical name. Keys are lower-cased; lookup is case-insensitive.
 *
 * PlayStation face buttons, numbered shoulders, the three names for the view/menu pair, and the
 * cardinal face-button names the Gamepad spec itself uses (`south` is A) all land on the Xbox
 * spelling. Anything not in this table and not already a canonical name is refused.
 */
const BUTTON_ALIASES: Readonly<Record<string, BlueprintGamepadButton>> = {
    cross: "A",
    circle: "B",
    square: "X",
    triangle: "Y",
    l1: "LB",
    r1: "RB",
    l2: "LT",
    r2: "RT",
    select: "Back",
    share: "Back",
    view: "Back",
    options: "Start",
    menu: "Start",
    guide: "Home",
    home: "Home",
    south: "A",
    east: "B",
    west: "X",
    north: "Y",
};

export function isBlueprintGamepadButton(value: unknown): value is BlueprintGamepadButton {
    return typeof value === "string" && CANONICAL_BY_LOWER.has(value.toLowerCase());
}

/**
 * A stored or typed button name, canonicalised, or `""` when this build cannot make sense of it.
 *
 * Aliases and case fold first, then the canonical list. An empty string is the same answer as an
 * unconfigured head: it matches nothing, rather than matching everything.
 */
/**
 * Whether a button name is one of the pad's own buttons rather than a direction of the left stick.
 * A stick direction is a binding an intent can use beside the D-pad, and a head can name it; a head
 * that hears any button does not hear a thumb resting on the stick.
 */
export function isPhysicalBlueprintGamepadButton(value: unknown): boolean {
    const index = (BLUEPRINT_GAMEPAD_BUTTONS as readonly string[]).indexOf(formatBlueprintGamepadButton(value));
    return index >= 0 && index < BLUEPRINT_GAMEPAD_PHYSICAL_BUTTON_COUNT;
}

export function formatBlueprintGamepadButton(value: unknown): string {
    if (typeof value !== "string") {
        return "";
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return "";
    }
    const lower = trimmed.toLowerCase();
    const aliased = BUTTON_ALIASES[lower];
    if (aliased) {
        return aliased;
    }
    return CANONICAL_BY_LOWER.get(lower) ?? "";
}

/**
 * Standard-mapping index 0–16 to the canonical name, or `""` outside that range.
 *
 * The Gamepad API reports a `buttons` array in this order when `mapping === "standard"`. An index
 * a pad does not have (Home is 16 and some pads stop at 15) is simply not pressed.
 */
export function normalizeBlueprintGamepadButtonIndex(index: number): string {
    if (!Number.isInteger(index) || index < 0 || index >= BLUEPRINT_GAMEPAD_PHYSICAL_BUTTON_COUNT) {
        return "";
    }
    return BLUEPRINT_GAMEPAD_BUTTONS[index];
}

/** The four analogue axes a query node can read, in standard-mapping `axes[]` order. */
export const BLUEPRINT_GAMEPAD_AXES = ["LeftX", "LeftY", "RightX", "RightY"] as const;

export type BlueprintGamepadAxis = (typeof BLUEPRINT_GAMEPAD_AXES)[number];

export const BLUEPRINT_NODE_PARAM_GAMEPAD_AXIS = "axis" as const;

export function isBlueprintGamepadAxis(value: unknown): value is BlueprintGamepadAxis {
    return typeof value === "string" && (BLUEPRINT_GAMEPAD_AXES as readonly string[]).includes(value);
}

export function formatBlueprintGamepadAxis(value: unknown): string {
    if (typeof value !== "string") {
        return "";
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return "";
    }
    const lower = trimmed.toLowerCase();
    return BLUEPRINT_GAMEPAD_AXES.find(axis => axis.toLowerCase() === lower) ?? "";
}
