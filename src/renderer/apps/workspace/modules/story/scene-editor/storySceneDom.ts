import type { ClipboardEvent } from "react";

export function isInteractiveTarget(target: EventTarget): boolean {
    const element = target instanceof HTMLElement ? target : null;
    return Boolean(element?.closest("button,input,textarea,select,[contenteditable=true]"));
}

/**
 * Is the caret in something the author is typing into, so the editor should keep its hands off?
 *
 * `except` names one field that does not count. The insert slot is the standing exception: it is the
 * one text input whose paste the editor takes over, so a gesture that means "paste without the wizard"
 * has to mean the same thing with the caret sitting in it. Without the carve-out `Ctrl+Shift+V` was
 * simply unreachable there - the flag was never set and the paste opened the wizard the author had
 * just asked to skip.
 */
export function isTextInputActive(except?: HTMLElement | null): boolean {
    const active = document.activeElement;
    if (except && active === except) {
        return false;
    }
    return active instanceof HTMLInputElement
        || active instanceof HTMLTextAreaElement
        || active instanceof HTMLSelectElement
        // The dialogue / narration rich-text editor is a contentEditable <div>, not an <input>. Treat
        // it as a text input so the editor stops hijacking copy/cut/paste while the author is typing.
        || (active instanceof HTMLElement && active.isContentEditable);
}

export function hasShiftModifier(event: ClipboardEvent<HTMLElement>): boolean {
    return Boolean((event.nativeEvent as unknown as { shiftKey?: boolean }).shiftKey);
}

export function documentExecCopy(): void {
    document.execCommand("copy");
}
