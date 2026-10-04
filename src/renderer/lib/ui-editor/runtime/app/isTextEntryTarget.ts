/**
 * Whether a DOM event originated inside a control the player is typing into.
 *
 * Game keys (Space to advance, Escape to open the menu) must stand down while a text field has
 * focus, or entering a name would drive the story - the convention every editor and web app follows.
 * Every keyboard listener the game puts on `window` asks this first and ignores the key when it says
 * yes: the app-level key dispatch (the global and page key heads, input actions), each widget's
 * `On Key Down` / `On Key Up` - the text field's own included - the skip key, and the held-input
 * state. What a text field reports while it is typed into is its own Value Changed and, on Enter,
 * Submit, which its renderer dispatches.
 */

/** Input types that accept typed text; `checkbox`/`radio`/`button`/… deliberately do not. */
const TEXT_ENTRY_INPUT_TYPES = new Set([
    "text",
    "password",
    "number",
    "search",
    "email",
    "tel",
    "url",
]);

export function isTextEntryTarget(target: EventTarget | null): boolean {
    if (!target || typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) {
        return false;
    }
    if (target.isContentEditable) {
        return true;
    }
    const tag = target.tagName;
    if (tag === "TEXTAREA") {
        return true;
    }
    if (tag !== "INPUT") {
        return false;
    }
    const input = target as HTMLInputElement;
    // A read-only field still owns the caret and arrow keys, so it stays exempt; a disabled one
    // cannot be focused at all and never reaches here.
    return TEXT_ENTRY_INPUT_TYPES.has(input.type);
}
