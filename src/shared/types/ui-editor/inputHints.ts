/**
 * The input hint bar: a row of "button - what it does" at the edge of the screen, the strip every
 * console game draws along the bottom of a menu.
 *
 * It is not authored row by row. What it lists is what the buttons do **right now** - the moves the
 * focus can make, the actions the page or the stage on screen answers, Back while there is somewhere
 * to go back to - read from the same vocabulary and the same navigation the presses go through
 * (`runtime/input/inputHints.ts`). A hint bar placed once on the dialogue box says "A Advance" during
 * dialogue and "A Confirm  B Back" once the player has opened a menu, and a rebinding shows up in it
 * without anybody touching the bar.
 *
 * What it does author: how it looks, which devices it shows for, which family of glyphs it draws,
 * and - optionally - its own words for the moves Studio names. Left empty, those words are Studio's,
 * in the player's language (`game.inputHints`); an action the project declared is named by its own
 * name.
 *
 * Comments in English per project convention.
 */

export const UI_INPUT_HINTS_ELEMENT_TYPE = "nl.inputHints";

/** The moves Studio names itself. Everything else in the bar is named by the project's own actions. */
export const UI_INPUT_HINT_WORDS = ["select", "confirm", "back", "advance", "stageControls"] as const;

export type UIInputHintWord = (typeof UI_INPUT_HINT_WORDS)[number];

/** The prop holding an author's own words for a move, and the prop naming a translation key for them. */
export function uiInputHintLabelProp(word: UIInputHintWord): string {
    return `${word}Label`;
}

export function uiInputHintLabelKeyProp(word: UIInputHintWord): string {
    return `${word}LabelLocalizationKey`;
}

/**
 * Which devices the bar shows for. A mouse player has the buttons in front of them and needs no list
 * of keys, so the default leaves the bar empty for a pointer and fills it for keys and a pad.
 */
export const UI_INPUT_HINTS_SHOW_FOR = ["keysAndGamepad", "gamepad", "always"] as const;

export type UIInputHintsShowFor = (typeof UI_INPUT_HINTS_SHOW_FOR)[number];

/** The pad's glyph family. `auto` reads it off the pad that is connected. */
export const UI_INPUT_HINT_GLYPH_STYLES = ["auto", "xbox", "playstation", "nintendo"] as const;

export type UIInputHintGlyphStyle = (typeof UI_INPUT_HINT_GLYPH_STYLES)[number];

export type UIInputHintControllerFamily = Exclude<UIInputHintGlyphStyle, "auto">;

export type UIInputHintsAlign = "start" | "center" | "end";

export type UIInputHintsProps = {
    showFor: UIInputHintsShowFor;
    glyphStyle: UIInputHintGlyphStyle;
    align: UIInputHintsAlign;
    fontSize: number;
    /** The words' colour. */
    color: string;
    /** The glyph's fill and the character on it. */
    glyphBackground: string;
    glyphColor: string;
    /** Space between one hint and the next. */
    gap: number;
} & Partial<Record<`${UIInputHintWord}Label` | `${UIInputHintWord}LabelLocalizationKey`, string>>;

export const DEFAULT_UI_INPUT_HINTS_PROPS: UIInputHintsProps = {
    showFor: "keysAndGamepad",
    glyphStyle: "auto",
    align: "end",
    fontSize: 22,
    color: "#ffffff",
    glyphBackground: "#f2f2f2",
    glyphColor: "#161616",
    gap: 28,
};

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
    return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function finite(value: unknown, fallback: number, min: number, max: number): number {
    return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function colour(value: unknown, fallback: string): string {
    return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

export function normalizeUIInputHintsProps(value: unknown): UIInputHintsProps {
    const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    const base = DEFAULT_UI_INPUT_HINTS_PROPS;
    const out: UIInputHintsProps = {
        showFor: pick(raw.showFor, UI_INPUT_HINTS_SHOW_FOR, base.showFor),
        glyphStyle: pick(raw.glyphStyle, UI_INPUT_HINT_GLYPH_STYLES, base.glyphStyle),
        align: pick(raw.align, ["start", "center", "end"] as const, base.align),
        fontSize: finite(raw.fontSize, base.fontSize, 6, 200),
        color: colour(raw.color, base.color),
        glyphBackground: colour(raw.glyphBackground, base.glyphBackground),
        glyphColor: colour(raw.glyphColor, base.glyphColor),
        gap: finite(raw.gap, base.gap, 0, 400),
    };
    for (const word of UI_INPUT_HINT_WORDS) {
        for (const prop of [uiInputHintLabelProp(word), uiInputHintLabelKeyProp(word)]) {
            const text = raw[prop];
            if (typeof text === "string" && text.length > 0) {
                (out as Record<string, unknown>)[prop] = text;
            }
        }
    }
    return out;
}

// === Glyphs ==============================================================================

/**
 * The pad family a connected controller belongs to, from the id the browser reports for it. The
 * Gamepad API maps every standard pad onto the Xbox layout, so the buttons are the same; what differs
 * is what is printed on them.
 */
export function detectUIInputHintControllerFamily(controllerId: string | null | undefined): UIInputHintControllerFamily {
    const id = (controllerId ?? "").toLowerCase();
    if (/054c|playstation|dualshock|dualsense/.test(id)) {
        return "playstation";
    }
    if (/057e|nintendo|switch|pro controller|joy-con/.test(id)) {
        return "nintendo";
    }
    return "xbox";
}

/** What is printed on one standard-mapping button, in one family. */
export type UIInputHintGlyph = {
    text: string;
    /** A face button is round; shoulders, triggers and the rest are a rounded bar. */
    shape: "round" | "bar";
};

const XBOX_GLYPHS: Readonly<Record<string, string>> = {
    A: "A", B: "B", X: "X", Y: "Y",
    LB: "LB", RB: "RB", LT: "LT", RT: "RT",
    Back: "View", Start: "Menu", L3: "LS", R3: "RS", Home: "Guide",
};

const PLAYSTATION_GLYPHS: Readonly<Record<string, string>> = {
    A: "✕", B: "○", X: "□", Y: "△",
    LB: "L1", RB: "R1", LT: "L2", RT: "R2",
    Back: "Create", Start: "Options", L3: "L3", R3: "R3", Home: "PS",
};

// The standard mapping names buttons by where they are, and a Nintendo pad prints the letters the
// other way round: the bottom button (standard A) says B.
const NINTENDO_GLYPHS: Readonly<Record<string, string>> = {
    A: "B", B: "A", X: "Y", Y: "X",
    LB: "L", RB: "R", LT: "ZL", RT: "ZR",
    Back: "−", Start: "+", L3: "LS", R3: "RS", Home: "Home",
};

const DIRECTION_GLYPHS: Readonly<Record<string, string>> = {
    "D-pad Up": "↑", "D-pad Down": "↓", "D-pad Left": "←", "D-pad Right": "→",
    "Left Stick Up": "LS↑", "Left Stick Down": "LS↓", "Left Stick Left": "LS←", "Left Stick Right": "LS→",
};

export function uiInputHintGamepadGlyph(button: string, family: UIInputHintControllerFamily): UIInputHintGlyph {
    const table = family === "playstation" ? PLAYSTATION_GLYPHS : family === "nintendo" ? NINTENDO_GLYPHS : XBOX_GLYPHS;
    const face = button === "A" || button === "B" || button === "X" || button === "Y";
    return { text: table[button] ?? DIRECTION_GLYPHS[button] ?? button, shape: face ? "round" : "bar" };
}

/** The four directions as one glyph: the D-pad's cross on a pad, the arrows on a keyboard. */
export function uiInputHintDirectionsGlyph(device: "gamepad" | "key"): UIInputHintGlyph {
    return { text: device === "gamepad" ? "✚" : "↑↓", shape: device === "gamepad" ? "round" : "bar" };
}

const KEY_GLYPHS: Readonly<Record<string, string>> = {
    ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
    Escape: "Esc", Space: "Space", Enter: "Enter", Backspace: "⌫", Tab: "Tab",
};

/** A keyboard binding as printed on its key: `Shift+Tab` keeps its modifier, `Escape` is `Esc`. */
export function uiInputHintKeyGlyph(binding: string): UIInputHintGlyph {
    const parts = binding.split("+");
    const key = parts.pop() ?? binding;
    const text = [...parts, KEY_GLYPHS[key] ?? key].join("+");
    return { text, shape: "bar" };
}
