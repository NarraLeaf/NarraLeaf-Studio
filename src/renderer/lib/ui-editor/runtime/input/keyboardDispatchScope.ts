/**
 * Which halves of a keyboard dispatch may run for one key press.
 *
 * A key reaches up to two places. The **global** blueprint's key heads, which belong to the game and
 * not to anything on screen, and the **active page's** own heads plus the input intents that page
 * answers to. They are gated differently, and getting that wrong is what this module exists to stop
 * happening again.
 *
 * The page half is conditional, and has to be: a page that is not drawn is not a page anyone is
 * pressing a key at, and while a layer owns the keyboard an Escape belongs to that layer rather than
 * to the page underneath it.
 *
 * **The global half is not conditional.** `blueprint.event.head.keyDown` is offered on the global
 * blueprint, and a head on the game-wide blueprint is exactly the one an author reaches for when
 * they want a key that works wherever the player is. Gating it on a page being drawn made it stop
 * the moment the stage took the screen - so a binding that worked on the title screen went silent
 * during a scene, which is where most of them are wanted. What may still stop it is what stops any
 * dispatch: something already called `stopPropagation` on this event, or the key belongs to a text
 * field someone is typing into. Neither is about pages.
 *
 * Comments in English per project convention.
 */

export type KeyboardDispatchScope = {
    /** The game-wide blueprint's key heads. */
    global: boolean;
    /** The active page's own key heads, and the input intents that page declares. */
    surface: boolean;
};

export type KeyboardDispatchScopeInput = {
    /** Whether there is a game app at all: no host, nothing to dispatch into. */
    gameReady: boolean;
    /**
     * Whether the active page is drawn and currently owns the keyboard.
     *
     * The page lane's own answer, computed where the composite is known. Passed in rather than
     * derived so this module stays a statement of the rule and not a second copy of the layer stack.
     */
    surfaceKeyboardReady: boolean;
};

export function resolveKeyboardDispatchScope(input: KeyboardDispatchScopeInput): KeyboardDispatchScope {
    return {
        global: input.gameReady,
        surface: input.gameReady && input.surfaceKeyboardReady,
    };
}
