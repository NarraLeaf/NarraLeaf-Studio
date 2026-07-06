import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import type { StoryRichRun } from "@shared/types/story";
import {
    applyMarkToRange,
    domToRuns,
    getSelectionUnitRange,
    normalizeRuns,
    rangeHasMark,
    renderRunsToElement,
    richRunsToPlain,
    setSelectionUnitRange,
    spliceRuns,
    totalUnits,
} from "./richText";

export type RichTextInputHandle = {
    focus: () => void;
    toggleMark: (mark: "bold" | "italic") => void;
    setColor: (color: string) => void;
    insertPause: (pause: number | true) => void;
    /** Replace the pause chip at unit `unit` (0-based) with a new value. */
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
}>(function RichTextInput(props, ref) {
    const editorRef = useRef<HTMLDivElement | null>(null);
    const savedRange = useRef<{ start: number; end: number } | null>(null);
    const onChangeRef = useRef(props.onChange);
    onChangeRef.current = props.onChange;

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

    const saveSelection = useCallback(() => {
        const el = editorRef.current;
        if (!el) {
            return;
        }
        const range = getSelectionUnitRange(el);
        if (range) {
            savedRange.current = range;
        }
    }, []);

    /** Read runs + selection, apply a mutation, re-render, restore caret, emit. */
    const mutate = useCallback((
        fn: (runs: StoryRichRun[], range: { start: number; end: number }) => { runs: StoryRichRun[]; caret: [number, number] } | null,
    ) => {
        const el = editorRef.current;
        if (!el) {
            return;
        }
        el.focus();
        const range = getSelectionUnitRange(el) ?? savedRange.current;
        if (!range) {
            return;
        }
        const result = fn(domToRuns(el), range);
        if (!result) {
            return;
        }
        renderRunsToElement(el, result.runs);
        setSelectionUnitRange(el, result.caret[0], result.caret[1]);
        savedRange.current = { start: result.caret[0], end: result.caret[1] };
        emitChange();
    }, [emitChange]);

    useImperativeHandle(ref, () => ({
        focus: () => { editorRef.current?.focus(); },
        toggleMark: (mark) => mutate((runs, range) => {
            if (range.start === range.end) {
                return null;
            }
            const active = rangeHasMark(runs, range.start, range.end, mark);
            const next = applyMarkToRange(runs, range.start, range.end, marks => ({ ...marks, [mark]: active ? undefined : true }));
            return { runs: next, caret: [range.start, range.end] };
        }),
        setColor: (color) => mutate((runs, range) => {
            if (range.start === range.end) {
                return null;
            }
            const next = applyMarkToRange(runs, range.start, range.end, marks => ({ ...marks, color: color || undefined }));
            return { runs: next, caret: [range.start, range.end] };
        }),
        insertPause: (pause) => mutate((runs, range) => ({
            runs: spliceRuns(runs, range.start, range.end, [{ pause }]),
            caret: [range.start + 1, range.start + 1],
        })),
        updatePauseAt: (unit, pause) => mutate(runs => ({
            runs: spliceRuns(runs, unit, unit + 1, [{ pause }]),
            caret: [unit + 1, unit + 1],
        })),
        removePauseAt: (unit) => mutate(runs => ({
            runs: spliceRuns(runs, unit, unit + 1, []),
            caret: [unit, unit],
        })),
    }), [mutate]);

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
                        mutate((runs, range) => ({
                            runs: spliceRuns(runs, range.start, range.end, [{ text: "\n" }]),
                            caret: [range.start + 1, range.start + 1],
                        }));
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
