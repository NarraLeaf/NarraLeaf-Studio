/**
 * DOM targets where typing should not be interrupted by global workspace keybindings.
 */
export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
    if (target == null) {
        return false;
    }
    const el = target instanceof Element ? target : (target as Node).parentElement;
    if (!el) {
        return false;
    }

    const inContentEditable = el.closest("[contenteditable='true'], [contenteditable='plaintext-only']");
    if (inContentEditable) {
        return true;
    }

    const selectEl = el.closest("select");
    if (selectEl) {
        return !selectEl.disabled;
    }

    const textarea = el.closest("textarea");
    if (textarea instanceof HTMLTextAreaElement) {
        return !textarea.readOnly && !textarea.disabled;
    }

    const input = el.closest("input");
    if (input instanceof HTMLInputElement) {
        if (input.readOnly || input.disabled) {
            return false;
        }
        const t = (input.type || "text").toLowerCase();
        const textLike = new Set([
            "text",
            "search",
            "email",
            "password",
            "number",
            "url",
            "tel",
            "",
            "date",
            "time",
            "datetime-local",
            "month",
            "week",
        ]);
        return textLike.has(t);
    }

    return false;
}
