import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import type { StoryInterpolationRef, StoryRichRun } from "@shared/types/story";
import { parseColorValue } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import {
    applyMarkToRange,
    domToRuns,
    getSelectionUnitRange,
    markSelectedChips,
    normalizeRuns,
    rangeHasMark,
    rangeMarkColor,
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
    /**
     * Current rich runs read straight from the live editor DOM (bypasses any not-yet-flushed draft).
     * Returns `null` when the editor is not mounted so callers fall back to their own state instead of
     * committing an empty edit.
     */
    getRuns: () => StoryRichRun[] | null;
};

export const RichTextInput = forwardRef<RichTextInputHandle, {
    initialRuns: StoryRichRun[];
    className?: string;
    style?: CSSProperties;
    placeholder?: string;
    /** Where the caret lands when the editor mounts. Defaults to the end (natural for entering a line). */
    initialCaret?: "start" | "end";
    /** When set, Shift+Enter calls this; otherwise Shift+Enter inserts a line break. */
    onShiftEnter?: () => void;
    onChange: (value: string, runs: StoryRichRun[]) => void;
    onEnter: () => void;
    onCancel: () => void;
    onBlur: () => void;
    /** Cmd/Ctrl+Enter — commit and open a fresh generic insert slot below (bypasses continuation). */
    onModEnter?: () => void;
    /**
     * The caret sat at a visual boundary and the author pressed an arrow that would leave the line:
     * ArrowUp on the first visual line, ArrowDown on the last, ArrowLeft at the very start, ArrowRight
     * at the very end. The parent moves focus to the adjacent story row.
     */
    onArrowOut?: (direction: "up" | "down" | "left" | "right") => void;
    /** Backspace pressed with a collapsed caret at the start of an empty line (row demote / delete). */
    onBackspaceAtEmptyStart?: () => void;
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
        const caret = props.initialCaret === "start" ? 0 : end;
        setSelectionUnitRange(el, caret, caret);
        savedRange.current = { start: caret, end: caret };
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
            const el = editorRef.current;
            const range = el ? getSelectionUnitRange(el) : null;
            if (el) {
                markSelectedChips(el, range);
            }
            let color: string | undefined;
            try {
                const raw = globalThis.document.queryCommandValue("foreColor");
                const parsed = raw ? parseColorValue(String(raw), { hex: "", alpha: 1 }) : null;
                color = parsed && parsed.hex ? parsed.hex : undefined;
            } catch {
                // queryCommandValue is best-effort in Chromium; ignore failures.
            }
            let bold = globalThis.document.queryCommandState("bold");
            let italic = globalThis.document.queryCommandState("italic");
            if (el && range && range.start !== range.end) {
                // A selection can include inline value chips (contentEditable=false), which execCommand's
                // query state ignores — derive the active marks from the unit model instead.
                const runs = domToRuns(el);
                bold = rangeHasMark(runs, range.start, range.end, "bold");
                italic = rangeHasMark(runs, range.start, range.end, "italic");
                color = rangeMarkColor(runs, range.start, range.end);
            }
            onActiveRef.current?.({ bold, italic, color });
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

    /**
     * Where the collapsed caret currently sits, relative to the line's edges. `atFirstLine`/`atLastLine`
     * are geometric (so wrapped or Shift+Enter multi-line text only leaves the field from the true top /
     * bottom visual line), while `atStart`/`atEnd` are exact unit offsets. Returns null when there is no
     * caret inside the editor.
     */
    const getCaretEdges = useCallback(() => {
        const el = editorRef.current;
        if (!el) {
            return null;
        }
        const selection = globalThis.window.getSelection();
        if (!selection || selection.rangeCount === 0) {
            return null;
        }
        const range = selection.getRangeAt(0);
        if (!el.contains(range.commonAncestorContainer)) {
            return null;
        }
        const collapsed = range.collapsed;
        const unit = getSelectionUnitRange(el);
        const total = totalUnits(domToRuns(el));
        const empty = total === 0;
        const atStart = !!unit && unit.start === 0;
        const atEnd = !!unit && unit.end >= total;
        let atFirstLine = atStart;
        let atLastLine = atEnd;
        if (empty) {
            atFirstLine = true;
            atLastLine = true;
        } else {
            const caretRect = caretClientRect(range);
            if (caretRect) {
                const elRect = el.getBoundingClientRect();
                const cs = globalThis.window.getComputedStyle(el);
                const padTop = parseFloat(cs.paddingTop) || 0;
                const padBottom = parseFloat(cs.paddingBottom) || 0;
                const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4 || 18;
                atFirstLine = caretRect.top - (elRect.top + padTop) <= lineHeight * 0.6;
                atLastLine = (elRect.bottom - padBottom) - caretRect.bottom <= lineHeight * 0.6;
            }
        }
        return { collapsed, atStart, atEnd, atFirstLine, atLastLine, empty };
    }, []);

    const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Escape") {
            event.preventDefault();
            props.onCancel();
            return;
        }
        if (event.key === "Enter") {
            event.preventDefault();
            if (event.metaKey || event.ctrlKey) {
                props.onModEnter ? props.onModEnter() : props.onEnter();
                return;
            }
            if (event.shiftKey) {
                if (props.onShiftEnter) {
                    props.onShiftEnter();
                } else {
                    globalThis.document.execCommand("insertText", false, "\n");
                    emitChange();
                }
                return;
            }
            props.onEnter();
            return;
        }
        if (event.key === "Backspace" && props.onBackspaceAtEmptyStart) {
            const edges = getCaretEdges();
            if (edges && edges.collapsed && edges.empty) {
                event.preventDefault();
                props.onBackspaceAtEmptyStart();
                return;
            }
        }
        if (!props.onArrowOut) {
            return;
        }
        const isArrow = event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "ArrowLeft" || event.key === "ArrowRight";
        if (!isArrow || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) {
            return;
        }
        const edges = getCaretEdges();
        if (!edges || !edges.collapsed) {
            return;
        }
        const leaves =
            (event.key === "ArrowUp" && edges.atFirstLine) ||
            (event.key === "ArrowDown" && edges.atLastLine) ||
            (event.key === "ArrowLeft" && edges.atStart) ||
            (event.key === "ArrowRight" && edges.atEnd);
        if (!leaves) {
            return;
        }
        event.preventDefault();
        props.onArrowOut(
            event.key === "ArrowUp" ? "up" : event.key === "ArrowDown" ? "down" : event.key === "ArrowLeft" ? "left" : "right",
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [emitChange, getCaretEdges, props.onArrowOut, props.onBackspaceAtEmptyStart, props.onCancel, props.onEnter, props.onModEnter, props.onShiftEnter]);

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
     * Apply a bold/italic/color mark. For a real selection we go through the unit model so inline value
     * chips get styled too (execCommand can't touch contentEditable=false chips); a collapsed caret keeps
     * execCommand's "typing state" so the next typed characters inherit the style.
     */
    const applyMark = useCallback((mark: "bold" | "italic" | "color", color?: string) => {
        const el = editorRef.current;
        if (!el) {
            return;
        }
        el.focus();
        let range = getSelectionUnitRange(el);
        if (!range && savedRange.current) {
            // Focus was on a portal popover (color palette); restore the last real selection.
            setSelectionUnitRange(el, savedRange.current.start, savedRange.current.end);
            range = savedRange.current;
        }
        if (!range) {
            return;
        }
        if (range.start === range.end) {
            try {
                globalThis.document.execCommand("styleWithCSS", false, "true");
                globalThis.document.execCommand(mark === "color" ? "foreColor" : mark, false, mark === "color" ? color : undefined);
            } catch {
                // execCommand is best-effort in Chromium; ignore failures.
            }
            saveSelection();
            emitChange();
            return;
        }
        const runs = domToRuns(el);
        let next: StoryRichRun[];
        if (mark === "color") {
            const value = color || undefined;
            next = applyMarkToRange(runs, range.start, range.end, marks => ({ ...marks, color: value }));
        } else {
            const active = rangeHasMark(runs, range.start, range.end, mark);
            next = applyMarkToRange(runs, range.start, range.end, marks => ({ ...marks, [mark]: active ? undefined : true }));
        }
        renderRunsToElement(el, next, resolveLabelRef.current);
        setSelectionUnitRange(el, range.start, range.end);
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
        toggleMark: (mark) => applyMark(mark),
        setColor: (color) => applyMark("color", color),
        insertPause,
        updatePauseAt: (unit, pause) => spliceUnits(unit, 1, [{ pause }], true),
        removePauseAt: (unit) => spliceUnits(unit, 1, [], false),
        insertInterpolation,
        updateInterpolationAt: (unit, interp) => spliceUnits(unit, 1, [{ interpolation: interp }], true),
        removeInterpolationAt: (unit) => spliceUnits(unit, 1, [], false),
        getRuns: () => (editorRef.current ? domToRuns(editorRef.current) : null),
    }), [applyMark, insertPause, insertInterpolation, spliceUnits]);

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
            onKeyDown={handleKeyDown}
        />
    );
});

/** Bounding rect of a (usually collapsed) caret range, tolerant of Chromium's empty-rect edge cases. */
function caretClientRect(range: Range): DOMRect | null {
    const rect = range.getBoundingClientRect();
    if (rect && (rect.height > 0 || rect.width > 0 || rect.top !== 0 || rect.bottom !== 0)) {
        return rect;
    }
    const rects = range.getClientRects();
    return rects.length > 0 ? rects[0] : null;
}
