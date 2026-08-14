import { createContext, useContext, useLayoutEffect } from "react";

/**
 * The mark a panel wears when Settings was opened *at* it.
 *
 * Another window sends a `highlight` (the version rail's server dialog sends
 * `SERVERS_PANEL_SETTING_KEY`) and Settings scrolls to that row and tints it. A tint is
 * enough for a row that holds one control, and not enough for a `Custom` panel: the panel
 * is a surface of its own, and the author was sent here to press one particular thing in
 * it. So the panel is told, and it can put the ring on that control instead.
 *
 * Read it in one line:
 *
 * ```tsx
 * const highlighted = useSettingsHighlight();
 * <Button className={cn(highlighted && SETTINGS_HIGHLIGHT_RING)} data-settings-highlight="on" />
 * ```
 *
 * Reading it is also what tells {@link SettingsExplorer} to stop marking the panel's block:
 * a panel that says nothing gets the ring around the whole of itself, which lands the
 * author in the right place without every panel having to take part.
 *
 * The mark goes away on its own. It says "here", and a border that stays says "wrong".
 */
export interface SettingsHighlightState {
    /** Whether the mark is up right now. False once its timer has run out. */
    readonly highlighted: boolean;
    /**
     * Called by the panel that reads this state; the returned function releases it.
     *
     * The explorer cannot see whether a panel put the ring anywhere, and it must not draw a
     * second one around the block if it did.
     */
    claim(): () => void;
}

/** Present only around the panel the highlight named, so no other panel can claim it. */
export const SettingsHighlightContext = createContext<SettingsHighlightState | null>(null);

/**
 * The ring itself: `primary`, the token every "this one" in Studio is drawn in.
 *
 * Two pixels rather than the focus ring's one, because this is not focus and is not
 * competing with it - the author is looking for a control they have not touched yet.
 *
 * ⚠ A ring is a `box-shadow`, and `styles.css` drops the box-shadow of any focused native
 * control (see docs/design-system.md §5). On a `<button>` this mark is therefore invisible
 * while that button has focus. Nothing focuses the highlighted control, so this holds; a
 * panel that focuses it must mark a wrapper instead.
 */
export const SETTINGS_HIGHLIGHT_RING = "ring-2 ring-primary";

/**
 * Whether this panel is the one Settings was opened at.
 *
 * A layout effect rather than an ordinary one so the claim is in before the first paint:
 * an effect that runs after it would let the block's ring appear for a frame and then move.
 */
export function useSettingsHighlight(): boolean {
    const state = useContext(SettingsHighlightContext);
    const claim = state?.claim;
    useLayoutEffect(() => claim?.(), [claim]);
    return state?.highlighted ?? false;
}
