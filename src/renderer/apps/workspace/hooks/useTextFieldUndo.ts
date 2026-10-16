import { useCallback, useEffect, useRef, useState } from "react";
import { isMacPlatform } from "@/lib/app/platform";
import { isImeKeyEvent } from "@/lib/utils/imeComposition";
import {
    editKindForInputType,
    RichTextHistory,
    type RichTextSelection,
} from "@/apps/workspace/modules/story/scene-editor/richTextHistory";

/** One state of a plain text field: its text, and where the caret was. */
export type TextFieldSnapshot = { value: string; range: RichTextSelection | null };

/**
 * Undo and redo for one plain `<input>`, kept to that input.
 *
 * Chromium keeps ONE undo stack per page, shared by every text field on it, so Ctrl+Z in a field
 * undoes whatever was typed last anywhere: with the caret in the Search panel's search box, it put
 * back the replace box's text. It also knows nothing of the values React sets - the clear button,
 * Escape - so it can step a controlled field into text it never held. Each field given this hook
 * keeps a stack of its own instead, and the browser's is never consulted for it.
 *
 * The keys are the ones a text field answers to on each platform: Ctrl+Z, and Ctrl+Shift+Z or
 * Ctrl+Y to redo (Cmd+Z and Cmd+Shift+Z on macOS). An Undo the Edit menu hands to the field arrives
 * as a `historyUndo` input event and is answered the same way. With nothing left on the field's
 * stack the key does nothing: it is the field's undo, so it never reaches into another field or out
 * to the workspace.
 *
 * Typing is recorded on `beforeinput`, the one moment the text before the edit can still be read,
 * and coalesces into bursts exactly as a rich-text row does ({@link RichTextHistory}). A value that
 * changes without being typed - cleared, or set by the field's owner - is one step of its own.
 *
 * `value` is the field's controlled value and `setValue` its owner's setter: undo goes through the
 * owner, as typing does, so the owner and the field never disagree. Returns the ref callback to put
 * on the input.
 */
export function useTextFieldUndo(
    value: string,
    setValue: (value: string) => void,
): (element: HTMLInputElement | null) => void {
    const [element, setElement] = useState<HTMLInputElement | null>(null);
    const historyRef = useRef(new RichTextHistory<TextFieldSnapshot>());
    /** The text the field last held that this hook knows how it got: typed, or put there by undo. */
    const knownRef = useRef(value);
    const setValueRef = useRef(setValue);
    setValueRef.current = setValue;

    useEffect(() => {
        if (value === knownRef.current) {
            return;
        }
        historyRef.current.record({ value: knownRef.current, range: null }, { kind: "structural", now: performance.now() });
        knownRef.current = value;
    }, [value]);

    const restore = useCallback((snapshot: TextFieldSnapshot) => {
        knownRef.current = snapshot.value;
        setValueRef.current(snapshot.value);
        // After the owner's value has been committed to the field: setting the caret earlier would be
        // undone by React writing the value over it.
        requestAnimationFrame(() => {
            const field = element;
            if (field && snapshot.range && field.value === snapshot.value) {
                field.setSelectionRange(snapshot.range.start, snapshot.range.end);
            }
        });
    }, [element]);

    useEffect(() => {
        if (!element) {
            return;
        }
        const current = (): TextFieldSnapshot => ({
            value: element.value,
            range: element.selectionStart === null || element.selectionEnd === null
                ? null
                : { start: element.selectionStart, end: element.selectionEnd },
        });
        const step = (direction: "undo" | "redo") => {
            const history = historyRef.current;
            const next = direction === "undo" ? history.undo(current()) : history.redo(current());
            if (next) {
                restore(next);
            }
        };
        const isMac = isMacPlatform();

        const onKeyDown = (event: KeyboardEvent) => {
            if (isImeKeyEvent(event) || event.altKey || !(isMac ? event.metaKey : event.ctrlKey)) {
                return;
            }
            const key = event.key.toLowerCase();
            const undo = key === "z" && !event.shiftKey;
            const redo = (key === "z" && event.shiftKey) || (!isMac && key === "y" && !event.shiftKey);
            if (!undo && !redo) {
                return;
            }
            // Always taken, even with nothing to undo here: letting it through is exactly what
            // reached into the other field.
            event.preventDefault();
            step(undo ? "undo" : "redo");
        };
        const onBeforeInput = (event: Event) => {
            const input = event as InputEvent;
            if (input.inputType === "historyUndo" || input.inputType === "historyRedo") {
                event.preventDefault();
                step(input.inputType === "historyUndo" ? "undo" : "redo");
                return;
            }
            historyRef.current.record(current, {
                kind: editKindForInputType(input.inputType),
                boundary: input.data === " ",
                now: performance.now(),
            });
        };
        // Typing reaches the owner through React's change handler, after this; the owner's new value
        // then comes back as `value` already known, and is not a step of its own.
        const onInput = () => {
            knownRef.current = element.value;
        };

        element.addEventListener("keydown", onKeyDown);
        element.addEventListener("beforeinput", onBeforeInput);
        element.addEventListener("input", onInput);
        return () => {
            element.removeEventListener("keydown", onKeyDown);
            element.removeEventListener("beforeinput", onBeforeInput);
            element.removeEventListener("input", onInput);
        };
    }, [element, restore]);

    return setElement;
}
