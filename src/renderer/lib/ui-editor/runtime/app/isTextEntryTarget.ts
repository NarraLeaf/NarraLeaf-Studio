/**
 * Whether a DOM event originated inside a control the player is typing into.
 *
 * Global game keys (space to advance, Escape to open the menu) must stand down while a text field
 * has focus, or entering a name would drive the story. This is the same convention every editor and
 * web app follows, and it is checked at the app-level keyboard dispatch only - a widget's own
 * keyboard blueprint event still fires, since that arrives by DOM bubbling instead.
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
