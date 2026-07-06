import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import type { StoryRichRun } from "@shared/types/story";
import { createPauseChip, domToRuns, normalizeRuns, renderRunsToElement, richRunsToPlain } from "./richText";

export type RichTextInputHandle = {
    focus: () => void;
    toggleBold: () => void;
    toggleItalic: () => void;
    setColor: (color: string) => void;
    insertPause: (pause: number | true) => void;
};

export const RichTextInput = forwardRef<RichTextInputHandle, {
    initialRuns: StoryRichRun[];
    className?: string;
    placeholder?: string;
    /** When set, Shift+Enter calls this; otherwise Shift+Enter inserts a line break. */
    onShiftEnter?: () => void;
    onChange: (value: string, runs: StoryRichRun[]) => void;
    onCommit: () => void;
    onCancel: () => void;
    onEnter: () => void;
}>(function RichTextInput(props, ref) {
    const editorRef = useRef<HTMLDivElement | null>(null);
    const savedRange = useRef<Range | null>(null);
    const onChangeRef = useRef(props.onChange);
    onChangeRef.current = props.onChange;

    useEffect(() => {
        const el = editorRef.current;
        if (!el) {
            return;
        }
        renderRunsToElement(el, normalizeRuns(props.initialRuns));
        el.focus();
        const range = globalThis.document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const selection = globalThis.window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        savedRange.current = range.cloneRange();
        // Render the initial content once; subsequent edits are DOM-driven.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const saveSelection = useCallback(() => {
        const el = editorRef.current;
        const selection = globalThis.window.getSelection();
        if (!el || !selection || selection.rangeCount === 0) {
            return;
        }
        const range = selection.getRangeAt(0);
        if (el.contains(range.commonAncestorContainer)) {
            savedRange.current = range.cloneRange();
        }
    }, []);

    const restoreSelection = useCallback(() => {
        const el = editorRef.current;
        if (!el) {
            return;
        }
        el.focus();
        const selection = globalThis.window.getSelection();
        if (savedRange.current && selection) {
            selection.removeAllRanges();
            selection.addRange(savedRange.current);
        }
    }, []);

    const emitChange = useCallback(() => {
        const el = editorRef.current;
        if (!el) {
            return;
        }
        const runs = domToRuns(el);
        onChangeRef.current(richRunsToPlain(runs), runs);
    }, []);

    const runCommand = useCallback((command: string, value?: string) => {
        restoreSelection();
        try {
            globalThis.document.execCommand("styleWithCSS", false, "true");
            globalThis.document.execCommand(command, false, value);
        } catch {
            // execCommand is best-effort in Chromium; ignore failures.
        }
        saveSelection();
        emitChange();
    }, [emitChange, restoreSelection, saveSelection]);

    const insertPause = useCallback((pause: number | true) => {
        restoreSelection();
        const selection = globalThis.window.getSelection();
        const el = editorRef.current;
        if (!el || !selection || selection.rangeCount === 0) {
            return;
        }
        const range = selection.getRangeAt(0);
        range.deleteContents();
        const chip = createPauseChip(pause);
        range.insertNode(chip);
        range.setStartAfter(chip);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        savedRange.current = range.cloneRange();
        emitChange();
    }, [emitChange, restoreSelection]);

    useImperativeHandle(ref, () => ({
        focus: () => { editorRef.current?.focus(); },
        toggleBold: () => runCommand("bold"),
        toggleItalic: () => runCommand("italic"),
        setColor: (color: string) => runCommand("foreColor", color),
        insertPause,
    }), [insertPause, runCommand]);

    return (
        <div
            ref={editorRef}
            className={props.className}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="false"
            data-placeholder={props.placeholder ?? ""}
            onClick={event => event.stopPropagation()}
            onInput={emitChange}
            onKeyUp={saveSelection}
            onMouseUp={saveSelection}
            onBlur={() => { saveSelection(); props.onCommit(); }}
            onPaste={event => {
                event.preventDefault();
                const text = event.clipboardData.getData("text/plain");
                globalThis.document.execCommand("insertText", false, text);
            }}
            onKeyDown={event => {
                if (event.key === "Escape") {
                    event.preventDefault();
                    props.onCancel();
                    return;
                }
                if (event.key === "Enter" && event.shiftKey) {
                    event.preventDefault();
                    if (props.onShiftEnter) {
                        props.onShiftEnter();
                    } else {
                        globalThis.document.execCommand("insertText", false, "\n");
                        emitChange();
                    }
                    return;
                }
                if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    props.onEnter();
                }
            }}
        />
    );
});
