import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { StoryInterpolationRef, StoryRichRun } from "@shared/types/story";
import { parseColorValue } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
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
    type ResolveInterpolationLabel,
} from "./richText";

export type ActiveMarks = { bold: boolean; italic: boolean; color?: string };

export type PauseClickInfo = {
    unit: number;
    value: number | true;
    anchor: { top: number; left: number; bottom: number };
};

export type InterpolationClickInfo = {
    unit: number;
    value: StoryInterpolationRef;
    anchor: { top: number; left: number; bottom: number };
};

export type RichTextInputHandle = {
    focus: () => void;
    toggleMark: (mark: "bold" | "italic") => void;
    setColor: (color: string) => void;
    insertPause: (pause: number | true) => void;
    updatePauseAt: (unit: number, pause: number | true) => void;
    removePauseAt: (unit: number) => void;
    insertInterpolation: (interp: StoryInterpolationRef) => void;
    updateInterpolationAt: (unit: number, interp: StoryInterpolationRef) => void;
    removeInterpolationAt: (unit: number) => void;
};

export const RichTextInput = forwardRef<RichTextInputHandle, {
    initialRuns: StoryRichRun[];
    className?: string;
    style?: CSSProperties;
    placeholder?: string;
    /** When set, Shift+Enter calls this; otherwise Shift+Enter inserts a line break. */
    onShiftEnter?: () => void;
    onChange: (value: string, runs: StoryRichRun[]) => void;
    onEnter: () => void;
    onCancel: () => void;
    onBlur: () => void;
    onPauseClick?: (info: PauseClickInfo) => void;
    onInterpolationClick?: (info: InterpolationClickInfo) => void;
    resolveInterpolationLabel?: ResolveInterpolationLabel;
    onActiveMarksChange?: (marks: ActiveMarks) => void;
}>(function RichTextInput(props, ref) {
    const editorRef = useRef<HTMLDivElement | null>(null);
    const savedRange = useRef<{ start: number; end: number } | null>(null);
    // Caret color mirrors the color mark at the caret so authors preview the color they'll type in.
    const [caretColor, setCaretColor] = useState<string | null>(null);
    const onChangeRef = useRef(props.onChange);
    onChangeRef.current = props.onChange;
    const onActiveRef = useRef(props.onActiveMarksChange);
    onActiveRef.current = props.onActiveMarksChange;
    // Kept in a ref so the DOM-render callbacks stay stable while labels refresh on rename.
    const resolveLabelRef = useRef(props.resolveInterpolationLabel);
    resolveLabelRef.current = props.resolveInterpolationLabel;

    useEffect(() => {
        const el = editorRef.current;
        if (!el) {
            return;
        }
        const runs = normalizeRuns(props.initialRuns);
        renderRunsToElement(el, runs, resolveLabelRef.current);
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
            let color: string | undefined;
            try {
                const raw = globalThis.document.queryCommandValue("foreColor");
                const parsed = raw ? parseColorValue(String(raw), { hex: "", alpha: 1 }) : null;
                color = parsed && parsed.hex ? parsed.hex : undefined;
            } catch {
                // queryCommandValue is best-effort in Chromium; ignore failures.
            }
            onActiveRef.current?.({
                bold: globalThis.document.queryCommandState("bold"),
                italic: globalThis.document.queryCommandState("italic"),
                color,
            });
            setCaretColor(color ?? null);
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
        renderRunsToElement(el, runs, resolveLabelRef.current);
        if (globalThis.document.activeElement === el) {
            const pos = caretAfter ? start + insert.length : start;
            setSelectionUnitRange(el, pos, pos);
        }
        emitChange();
    }, [emitChange]);

    const insertRun = useCallback((run: StoryRichRun) => {
        const el = editorRef.current;
        if (!el) {
            return;
        }
        el.focus();
        const range = getSelectionUnitRange(el) ?? savedRange.current;
        if (!range) {
            return;
        }
        const runs = spliceRuns(domToRuns(el), range.start, range.end, [run]);
        renderRunsToElement(el, runs, resolveLabelRef.current);
        setSelectionUnitRange(el, range.start + 1, range.start + 1);
        savedRange.current = { start: range.start + 1, end: range.start + 1 };
        emitChange();
    }, [emitChange]);

    const insertPause = useCallback((pause: number | true) => insertRun({ pause }), [insertRun]);
    const insertInterpolation = useCallback((interp: StoryInterpolationRef) => insertRun({ interpolation: interp }), [insertRun]);

    useImperativeHandle(ref, () => ({
        focus: () => { editorRef.current?.focus(); },
        toggleMark: (mark) => applyExec(mark === "bold" ? "bold" : "italic"),
        setColor: (color) => applyExec("foreColor", color),
        insertPause,
        updatePauseAt: (unit, pause) => spliceUnits(unit, 1, [{ pause }], true),
        removePauseAt: (unit) => spliceUnits(unit, 1, [], false),
        insertInterpolation,
        updateInterpolationAt: (unit, interp) => spliceUnits(unit, 1, [{ interpolation: interp }], true),
        removeInterpolationAt: (unit) => spliceUnits(unit, 1, [], false),
    }), [applyExec, insertPause, insertInterpolation, spliceUnits]);

    return (
        <div
            ref={editorRef}
            className={props.className}
            style={{ ...props.style, caretColor: caretColor ?? undefined }}
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
                const interpChip = (event.target as HTMLElement).closest?.("[data-interp]") as HTMLElement | null;
                if (el && interpChip && el.contains(interpChip) && props.onInterpolationClick) {
                    let value: StoryInterpolationRef | null = null;
                    try {
                        value = JSON.parse(interpChip.dataset.interp ?? "") as StoryInterpolationRef;
                    } catch {
                        value = null;
                    }
                    if (value) {
                        const rect = interpChip.getBoundingClientRect();
                        props.onInterpolationClick({
                            unit: unitOffsetOfElement(el, interpChip),
                            value,
                            anchor: { top: rect.top, left: rect.left, bottom: rect.bottom },
                        });
                    }
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
