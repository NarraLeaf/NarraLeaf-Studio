/**
 * The keyboard focus follows the keys: the page or layer that owns the keyboard holds the focus too.
 *
 * Which entry hears a key is decided by `keyboardOwner` - a page opened over the game, a modal layer
 * over a page, or the stage when the story is on screen. The browser's focus was never told. It stayed
 * wherever it had been: on body once the control that had it went away, or, in Dev Mode, wherever
 * sequential navigation fell back to - so the first Tab after opening the Load page from the title by
 * keyboard went to the window's own title-bar buttons rather than to the page the player was looking
 * at, and Enter then pressed one of those. A page that owns the keys and does not hold the focus
 * answers Escape and loses Tab.
 *
 * So the owner takes it. When an entry starts owning the keyboard, its surface becomes the focused
 * element (focusable from script only, and drawn without a ring: it is a place for Tab to start
 * from, not a control) - unless the focus is already inside it, or is somewhere that is not the
 * game's at all. When it stops owning them, a focus left inside it is let go, and the element that
 * had it is remembered: a confirmation layer closing gives the focus back to the button the player
 * opened it with, which is what every dialog does.
 *
 * Nothing is handed back to the stage. The story hears its keys from the window (see
 * `keyboardOwner`), and a control on the stage holding the focus would take Space and Enter for
 * itself (`keyInputClaimedByControl`) - closing the Save page the player opened from the quick menu
 * would leave Space pressing Save again instead of reading on.
 *
 * Comments in English per project convention.
 */

/** Marks the element a running game draws into, so a focus elsewhere in the window is left alone. */
export const GAME_ROOT_ATTRIBUTE = "data-nl-game-root";

/**
 * Whether the focus may be moved without taking it from something that is not the game's.
 *
 * Free when nothing in particular has it, when what has it can no longer be used, or when it sits in
 * the same game as `surface`. A text field in a Dev Mode panel, a button in the window's own title
 * bar the player tabbed to, an editor canvas beside a preview: those are the window's, and a page
 * opening in the game does not get to take the focus from them.
 */
function focusIsFree(surface: HTMLElement, active: Element | null): boolean {
    const document = surface.ownerDocument;
    if (!active || active === document.body || active === document.documentElement) {
        return true;
    }
    if (active.closest("[inert]") !== null) {
        return true;
    }
    const gameRoot = surface.closest(`[${GAME_ROOT_ATTRIBUTE}]`);
    return gameRoot !== null && gameRoot.contains(active);
}

/**
 * Where the focus is after {@link takeKeyboardFocus}:
 *
 * - `held` - inside the surface, whether it was moved there or already was;
 * - `elsewhere` - on something that is not the game's, which keeps it;
 * - `refused` - the surface cannot take it yet. A page that has just started owning the keys can
 *   still be hidden for the frame it is revealed in (see `SurfaceAnimationLayer`), and a hidden
 *   element does not take the focus; asking again on a later frame is the caller's to do.
 */
export type KeyboardFocusTake = "held" | "elsewhere" | "refused";

/**
 * Put the keyboard focus inside `surface`, which has just started owning the keyboard.
 *
 * `remembered` is what {@link releaseKeyboardFocus} handed back when this surface last let the focus
 * go: it gets the focus back if it is still inside the surface and can still take it. Otherwise the
 * surface itself does, which is focusable from script (`tabindex="-1"`) for exactly this.
 */
export function takeKeyboardFocus(surface: HTMLElement, remembered: HTMLElement | null): KeyboardFocusTake {
    const active = surface.ownerDocument.activeElement;
    if (active && surface.contains(active)) {
        return "held";
    }
    if (!focusIsFree(surface, active)) {
        return "elsewhere";
    }
    const target = remembered && remembered.isConnected && surface.contains(remembered) && remembered.closest("[inert]") === null
        ? remembered
        : surface;
    // A page arriving must not scroll anything to bring itself into view: it is already where it is
    // drawn, and the game's own containers do not scroll.
    target.focus({ preventScroll: true });
    return surface.ownerDocument.activeElement === target ? "held" : "refused";
}

/**
 * Let go of the keyboard focus if it is inside `surface`, which has stopped owning the keyboard.
 *
 * Returns the element that had it, for {@link takeKeyboardFocus} to give it back to, or null when the
 * focus was elsewhere or on the surface itself.
 */
export function releaseKeyboardFocus(surface: HTMLElement): HTMLElement | null {
    const active = surface.ownerDocument.activeElement;
    if (!(active instanceof HTMLElement) || !surface.contains(active)) {
        return null;
    }
    active.blur();
    return active === surface ? null : active;
}
