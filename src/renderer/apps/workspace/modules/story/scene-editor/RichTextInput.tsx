import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import type { StoryRichRun } from "@shared/types/story";
import {
    domToRuns,
    getSelectionUnitRange,
    normalizeRuns,
    renderRunsToElement,
    richRunsToPlain,
    setSelectionUnitRange,
    spliceRuns,
    totalUnits,
    unitOffsetOfElement,
} from "./richText";

export type ActiveMarks = { bold: boolean; italic: boolean };

export type PauseClickInfo = {
    unit: number;
    value: number | true;
    anchor: { top: number; left: number; bottom: number };
};

export type RichTextInputHandle = {
    focus: () => void;
    toggleMark: (mark: "bold" | "italic") => void;
    setColor: (color: string) => void;
    insertPause: (pause: number | true) => void;
    updatePauseAt: (unit: number, pause: number | true) => void;
    removePauseAt: (unit: number) => void;
};

export const RichTextInput = forwardRef<RichTextInputHandle, {
    initialRuns: StoryRichRun[];
    className?: string;
    placeholder?: string;
    /** When set, Shift+Enter calls this; otherwise Shift+Enter inserts a line break. */
    onShiftEnter?: () => void;
    onChange: (value: string, runs: StoryRichRun[]) => void;
    onEnter: () => void;
    onCancel: () => void;
    onBlur: () => void;
    onPauseClick?: (info: PauseClickInfo) => void;
    onActiveMarksChange?: (marks: ActiveMarks) => void;
}>(function RichTextInput(props, ref) {
    const editorRef = useRef<HTMLDivElement | null>(null);
    const savedRange = useRef<{ start: number; end: number } | null>(null);
    const onChangeRef = useRef(props.onChange);
    onChangeRef.current = props.onChange;
    const onActiveRef = useRef(props.onActiveMarksChange);
    onActiveRef.current = props.onActiveMarksChange;

    useEffect(() => {
        const el = editorRef.current;
        if (!el) {
            return;
        }
        const runs = normalizeRuns(props.initialRuns);
        renderRunsToElement(el, runs);
        el.focus();
        const end = totalUnits(runs);
        setSelectionUnitRange(el, end, end);
        savedRange.current = { start: end, end };
        // Render initial content once; edits are model/DOM driven from here.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const emitChange = useCallback(() => {
        const el = editorRef.current;
        if (!el) {
            return;
        }
        const runs = domToRuns(el);
        onChangeRef.current(richRunsToPlain(runs), runs);
    }, []);

    const reportActive = useCallback(() => {
        try {
            onActiveRef.current?.({
                bold: globalThis.document.queryCommandState("bold"),
                italic: globalThis.document.queryCommandState("italic"),
            });
        } catch {
            // queryCommandState can throw when there is no selection; ignore.
        }
    }, []);

    const saveSelection = useCallback(() => {
        const el = editorRef.current;
        if (!el) {
            return;
        }
        const range = getSelectionUnitRange(el);
        if (range) {
            savedRange.current = range;
        }
        reportActive();
    }, [reportActive]);

    // Keep the toolbar's active state in sync as the caret / selection moves.
    useEffect(() => {
        const onSelectionChange = () => {
            const el = editorRef.current;
            const selection = globalThis.window.getSelection();
            if (el && selection && selection.rangeCount > 0 && el.contains(selection.getRangeAt(0).commonAncestorContainer)) {
                reportActive();
            }
        };
        globalThis.document.addEventListener("selectionchange", onSelectionChange);
        return () => globalThis.document.removeEventListener("selectionchange", onSelectionChange);
    }, [reportActive]);

    /**
     * Apply an inline style via the browser's native command. execCommand carries the "typing
     * state" for a collapsed caret (so continuing to type keeps the style) and, together with
     * domToRuns' nested-mark merging, produces correct combined runs for overlapping styles.
     */
    const applyExec = useCallback((command: string, value?: string) => {
        const el = editorRef.current;
        if (!el) {
            return;
        }
        el.focus();
        const live = getSelectionUnitRange(el);
        if (!live && savedRange.current) {
            // Focus was on a portal popover (color palette); restore the last real selection.
            setSelectionUnitRange(el, savedRange.current.start, savedRange.current.end);
        }
        try {
            globalThis.document.execCommand("styleWithCSS", false, "true");
            globalThis.document.execCommand(command, false, value);
        } catch {
            // execCommand is best-effort in Chromium; ignore failures.
        }
        saveSelection();
        emitChange();
    }, [emitChange, saveSelection]);

    // Splice by explicit unit range without focusing the editor (so a pause popover's input keeps
    // focus). Caret is only restored when the editor already holds focus.
    const spliceUnits = useCallback((start: number, deleteCount: number, insert: StoryRichRun[], caretAfter: boolean) => {
        const el = editorRef.current;
        if (!el) {
            return;
        }
        const runs = spliceRuns(domToRuns(el), start, start + deleteCount, insert);
        renderRunsToElement(el, runs);
        if (globalThis.document.activeElement === el) {
            const pos = caretAfter ? start + insert.length : start;
            setSelectionUnitRange(el, pos, pos);
        }
        emitChange();
    }, [emitChange]);

    const insertPause = useCallback((pause: number | true) => {
        const el = editorRef.current;
        if (!el) {
            return;
        }
        el.focus();
        const range = getSelectionUnitRange(el) ?? savedRange.current;
        if (!range) {
            return;
        }
        const runs = spliceRuns(domToRuns(el), range.start, range.end, [{ pause }]);
        renderRunsToElement(el, runs);
        setSelectionUnitRange(el, range.start + 1, range.start + 1);
        savedRange.current = { start: range.start + 1, end: range.start + 1 };
        emitChange();
    }, [emitChange]);

    useImperativeHandle(ref, () => ({
        focus: () => { editorRef.current?.focus(); },
        toggleMark: (mark) => applyExec(mark === "bold" ? "bold" : "italic"),
        setColor: (color) => applyExec("foreColor", color),
        insertPause,
        updatePauseAt: (unit, pause) => spliceUnits(unit, 1, [{ pause }], true),
        removePauseAt: (unit) => spliceUnits(unit, 1, [], false),
    }), [applyExec, insertPause, spliceUnits]);

    return (
        <div
            ref={editorRef}
            className={props.className}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="false"
            data-placeholder={props.placeholder ?? ""}
            onClick={event => {
                event.stopPropagation();
                const el = editorRef.current;
                const chip = (event.target as HTMLElement).closest?.("[data-pause]") as HTMLElement | null;
                if (el && chip && el.contains(chip) && props.onPauseClick) {
                    const rect = chip.getBoundingClientRect();
                    props.onPauseClick({
                        unit: unitOffsetOfElement(el, chip),
                        value: chip.dataset.pause === "click" ? true : Number(chip.dataset.pause) || true,
                        anchor: { top: rect.top, left: rect.left, bottom: rect.bottom },
                    });
                }
            }}
            onInput={emitChange}
            onKeyUp={saveSelection}
            onMouseUp={saveSelection}
            onBlur={() => { saveSelection(); props.onBlur(); }}
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
