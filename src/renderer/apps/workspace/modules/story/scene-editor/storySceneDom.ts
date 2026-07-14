import type { ClipboardEvent } from "react";

export function isInteractiveTarget(target: EventTarget): boolean {
    const element = target instanceof HTMLElement ? target : null;
    return Boolean(element?.closest("button,input,textarea,select,[contenteditable=true]"));
}

export function isTextInputActive(): boolean {
    const active = document.activeElement;
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
