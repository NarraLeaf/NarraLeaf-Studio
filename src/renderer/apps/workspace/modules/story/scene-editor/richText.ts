import type { StoryInlineEvent, StoryInterpolationRef, StoryRichRun, StoryTextMarks, StoryTextSegment } from "@shared/types/story";
import { formatStorySecondsLabel, storyMsToSeconds } from "@shared/utils/storyTime";

/** Pause chip class (a literal so Tailwind's content scan can see it). */
const PAUSE_CHIP_CLASS = "story-rt-pause mx-0.5 inline-flex select-none items-center rounded bg-primary/20 px-1 py-0.5 align-middle text-2xs font-medium text-primary";
const PAUSE_CHIP_INTERACTIVE_CLASS = "cursor-pointer hover:bg-primary/30";
const PAUSE_ICON_SVG = '<svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="14" y="4" width="4" height="16" rx="1"></rect><rect x="6" y="4" width="4" height="16" rx="1"></rect></svg>';

/** Interpolation chip class (variable / blueprint value). */
const INTERP_CHIP_CLASS = "story-rt-interp mx-0.5 inline-flex select-none items-center rounded bg-success/20 px-1 py-0.5 align-middle text-2xs font-medium text-success";
const INTERP_CHIP_INTERACTIVE_CLASS = "cursor-pointer hover:bg-success/30";
const INTERP_ICON_SVG = '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M8 3H7a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1"></path><path d="M16 3h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-1"></path></svg>';

/** Inline reveal-time event chip class (expression switch / SE). */
const EVENT_CHIP_CLASS = "story-rt-event mx-0.5 inline-flex select-none items-center rounded bg-warning/20 px-1 py-0.5 align-middle text-2xs font-medium text-warning";
const EVENT_CHIP_INTERACTIVE_CLASS = "cursor-pointer hover:bg-warning/30";
/** lucide "smile" — the expression-switch token. */
const EVENT_FACE_ICON_SVG = '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="M8 14s1.5 2 4 2 4-2 4-2"></path><line x1="9" y1="9" x2="9.01" y2="9"></line><line x1="15" y1="9" x2="15.01" y2="9"></line></svg>';
/** lucide "music" — the sound-only token. */
const EVENT_SOUND_ICON_SVG = '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>';

export type ResolveInterpolationLabel = (interp: StoryInterpolationRef) => string;

/** Chip copy. Callers pass translated strings so this layer never hardcodes user-facing text. */
export type RichChipTitles = {
    pauseClick: string;
    pauseSeconds: (seconds: number) => string;
    insertedValue: (label: string) => string;
    valueFallback: string;
    /** Title for an expression-switch event chip (optionally naming the form). */
    expressionEvent: string;
    /** Title for a sound-only event chip. */
    soundEvent: string;
};

/**
 * Options for {@link renderRunsToElement}, the single renderer behind both the contentEditable
 * editor and the read-only row preview.
 *
 * `interactive` is the *only* permitted difference between the two: editor chips open the pause /
 * value popovers, view chips do not, so only the editor gets a pointer cursor and a button role.
 * Everything else - tag structure, text content, and the `data-pause` / `data-interp` attributes the
 * unit model reads - must stay identical, or a selection made in the view cannot be mapped onto the
 * editor's unit offsets.
 */
export type RichRenderOptions = {
    resolveLabel?: ResolveInterpolationLabel;
    titles: RichChipTitles;
    interactive?: boolean;
};

export function isTextRun(run: StoryRichRun): run is { text: string; marks?: StoryTextMarks } {
    return "text" in run;
}

export function isInterpolationRun(run: StoryRichRun): run is { interpolation: StoryInterpolationRef; marks?: StoryTextMarks } {
    return "interpolation" in run;
}

export function isEventRun(run: StoryRichRun): run is { event: StoryInlineEvent } {
    return "event" in run;
}

/** True for any atomic inline chip (pause, interpolation or event) that counts as a single unit. */
function isChipElement(el: HTMLElement): boolean {
    return el.dataset.pause !== undefined || el.dataset.interp !== undefined || el.dataset.event !== undefined;
}

function parseInterpolation(raw: string): StoryInterpolationRef | null {
    try {
        const parsed = JSON.parse(raw) as StoryInterpolationRef;
        if (parsed && (parsed.kind === "variable" || parsed.kind === "blueprint")) {
            return parsed;
        }
    } catch {
        // fall through
    }
    return null;
}

/** Parse a chip's serialized event payload (`data-event`); keeps only a usable expression/sound. */
function parseEvent(raw: string): StoryInlineEvent | null {
    try {
        const parsed = JSON.parse(raw) as StoryInlineEvent;
        if (!parsed || typeof parsed !== "object") {
            return null;
        }
        const event: StoryInlineEvent = {};
        if (parsed.expression && typeof parsed.expression.characterId === "string") {
            event.expression = parsed.expression;
        }
        if (parsed.sound && typeof parsed.sound.assetId === "string") {
            event.sound = parsed.sound;
        }
        return event.expression || event.sound ? event : null;
    } catch {
        return null;
    }
}

/** Parse a chip's serialized marks (`data-marks`), dropping anything empty. */
function parseMarks(raw: string | undefined): StoryTextMarks | undefined {
    if (!raw) {
        return undefined;
    }
    try {
        return cleanMarks(JSON.parse(raw) as StoryTextMarks);
    } catch {
        return undefined;
    }
}

/** Plain-text projection of rich runs (pause runs contribute nothing). */
export function richRunsToPlain(runs: StoryRichRun[]): string {
    return runs.map(run => (isTextRun(run) ? run.text : "")).join("");
}

export function plainToRichRuns(value: string): StoryRichRun[] {
    return value ? [{ text: value }] : [];
}

/** The editing runs for a segment: its rich runs, or a single plain run derived from `value`. */
export function segmentToRuns(segment: StoryTextSegment | null | undefined): StoryRichRun[] {
    if (!segment) {
        return [];
    }
    if (segment.rich && segment.rich.length > 0) {
        return normalizeRuns(segment.rich);
    }
    return plainToRichRuns(segment.value);
}

/** Strip empty marks; return undefined when nothing meaningful remains. */
export function cleanMarks(marks: StoryTextMarks | undefined): StoryTextMarks | undefined {
    if (!marks) {
        return undefined;
    }
    const out: StoryTextMarks = {};
    if (marks.bold) out.bold = true;
    if (marks.italic) out.italic = true;
    if (marks.color) out.color = marks.color;
    if (marks.ruby) out.ruby = marks.ruby;
    if (typeof marks.cps === "number" && Number.isFinite(marks.cps)) out.cps = marks.cps;
    if (typeof marks.fontSize === "number" && Number.isFinite(marks.fontSize)) out.fontSize = marks.fontSize;
    return Object.keys(out).length > 0 ? out : undefined;
}

function marksKey(marks: StoryTextMarks | undefined): string {
    const clean = cleanMarks(marks);
    if (!clean) {
        return "";
    }
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(clean).sort()) {
        sorted[key] = (clean as Record<string, unknown>)[key];
    }
    return JSON.stringify(sorted);
}

/** Drop empty text runs and merge adjacent text runs that share the same marks. */
export function normalizeRuns(runs: StoryRichRun[]): StoryRichRun[] {
    const out: StoryRichRun[] = [];
    for (const run of runs) {
        if (isTextRun(run)) {
            if (!run.text) {
                continue;
            }
            const marks = cleanMarks(run.marks);
            const prev = out[out.length - 1];
            if (prev && isTextRun(prev) && marksKey(prev.marks) === marksKey(marks)) {
                out[out.length - 1] = marks ? { text: prev.text + run.text, marks } : { text: prev.text + run.text };
            } else {
                out.push(marks ? { text: run.text, marks } : { text: run.text });
            }
        } else if (isInterpolationRun(run)) {
            const marks = cleanMarks(run.marks);
            out.push(marks ? { interpolation: run.interpolation, marks } : { interpolation: run.interpolation });
        } else if (isEventRun(run)) {
            out.push({ event: run.event });
        } else {
            out.push({ pause: run.pause });
        }
    }
    return out;
}

/** Normalize runs and collapse to `undefined` when the content is effectively plain text. */
export function richIfMeaningful(runs: StoryRichRun[]): StoryRichRun[] | undefined {
    const normalized = normalizeRuns(runs);
    if (normalized.length === 0) {
        return undefined;
    }
    if (normalized.length === 1) {
        const only = normalized[0];
        if (isTextRun(only) && !only.marks) {
            return undefined;
        }
    }
    return normalized;
}

function mergeMarks(a: StoryTextMarks | undefined, b: StoryTextMarks | undefined): StoryTextMarks | undefined {
    if (!a && !b) {
        return undefined;
    }
    return cleanMarks({ ...(a ?? {}), ...(b ?? {}) });
}

function parsePauseValue(raw: string): number | true {
    if (raw === "click" || raw === "true" || raw === "") {
        return true;
    }
    const numeric = Number(raw);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : true;
}

function readMarksFromElement(el: HTMLElement): StoryTextMarks | undefined {
    const marks: StoryTextMarks = {};
    const tag = el.tagName;
    if (tag === "B" || tag === "STRONG") marks.bold = true;
    if (tag === "I" || tag === "EM") marks.italic = true;
    const fontWeight = el.style.fontWeight;
    if (fontWeight === "bold" || Number(fontWeight) >= 600) marks.bold = true;
    if (el.style.fontStyle === "italic") marks.italic = true;
    if (el.style.color) marks.color = el.style.color;
    if (el.style.fontSize) {
        const size = parseInt(el.style.fontSize, 10);
        if (Number.isFinite(size)) marks.fontSize = size;
    }
    if (el.dataset.ruby) marks.ruby = el.dataset.ruby;
    if (el.dataset.cps) {
        const cps = Number(el.dataset.cps);
        if (Number.isFinite(cps)) marks.cps = cps;
    }
    return cleanMarks(marks);
}

function createMarkSpan(text: string, marks: StoryTextMarks): HTMLSpanElement {
    const span = globalThis.document.createElement("span");
    if (marks.bold) span.style.fontWeight = "700";
    if (marks.italic) span.style.fontStyle = "italic";
    if (marks.color) span.style.color = marks.color;
    if (typeof marks.fontSize === "number") {
        span.style.fontSize = `${marks.fontSize}px`;
        span.dataset.fontsize = String(marks.fontSize);
    }
    if (marks.ruby) {
        span.dataset.ruby = marks.ruby;
        span.title = `ruby: ${marks.ruby}`;
        span.style.textDecoration = "underline dotted";
    }
    if (typeof marks.cps === "number") span.dataset.cps = String(marks.cps);
    span.textContent = text;
    return span;
}

function createPauseChip(pause: number | true, options: RichRenderOptions): HTMLSpanElement {
    const span = globalThis.document.createElement("span");
    span.dataset.pause = pause === true ? "click" : String(Math.round(pause as number));
    span.contentEditable = "false";
    span.className = options.interactive ? `${PAUSE_CHIP_CLASS} ${PAUSE_CHIP_INTERACTIVE_CLASS}` : PAUSE_CHIP_CLASS;
    if (options.interactive) {
        span.setAttribute("role", "button");
    }
    span.title = pause === true ? options.titles.pauseClick : options.titles.pauseSeconds(storyMsToSeconds(pause));
    const label = pause === true ? "" : `<span class="ml-0.5">${formatStorySecondsLabel(pause)}</span>`;
    // PAUSE_ICON_SVG is a trusted static string; the label only interpolates a rounded number.
    span.innerHTML = `${PAUSE_ICON_SVG}${label}`;
    return span;
}

function createInterpolationChip(interp: StoryInterpolationRef, label: string, marks: StoryTextMarks | undefined, options: RichRenderOptions): HTMLSpanElement {
    const span = globalThis.document.createElement("span");
    span.dataset.interp = JSON.stringify(interp);
    const clean = cleanMarks(marks);
    if (clean) {
        span.dataset.marks = JSON.stringify(clean);
    }
    span.contentEditable = "false";
    span.className = options.interactive ? `${INTERP_CHIP_CLASS} ${INTERP_CHIP_INTERACTIVE_CLASS}` : INTERP_CHIP_CLASS;
    if (options.interactive) {
        span.setAttribute("role", "button");
    }
    span.title = options.titles.insertedValue(label);
    // INTERP_ICON_SVG is a trusted static string; the label is set via textContent (no HTML injection).
    span.innerHTML = INTERP_ICON_SVG;
    const labelSpan = globalThis.document.createElement("span");
    labelSpan.className = "ml-0.5";
    labelSpan.textContent = label;
    // Marks style the value text only - never the chip background.
    if (clean?.bold) labelSpan.style.fontWeight = "700";
    if (clean?.italic) labelSpan.style.fontStyle = "italic";
    if (clean?.color) labelSpan.style.color = clean.color;
    if (typeof clean?.fontSize === "number") labelSpan.style.fontSize = `${clean.fontSize}px`;
    span.appendChild(labelSpan);
    return span;
}

function createEventChip(event: StoryInlineEvent, options: RichRenderOptions): HTMLSpanElement {
    const span = globalThis.document.createElement("span");
    span.dataset.event = JSON.stringify(event);
    span.contentEditable = "false";
    span.className = options.interactive ? `${EVENT_CHIP_CLASS} ${EVENT_CHIP_INTERACTIVE_CLASS}` : EVENT_CHIP_CLASS;
    if (options.interactive) {
        span.setAttribute("role", "button");
    }
    // An expression switch reads as a face; a sound-only token as a note. Kept icon-compact and
    // zero-width like the pause/value chips - the picker reopens on click.
    if (event.expression) {
        const form = event.expression.formName?.trim();
        span.title = form ? `${options.titles.expressionEvent}: ${form}` : options.titles.expressionEvent;
        span.innerHTML = EVENT_FACE_ICON_SVG;
        if (form) {
            const labelSpan = globalThis.document.createElement("span");
            labelSpan.className = "ml-0.5";
            labelSpan.textContent = form;
            span.appendChild(labelSpan);
        }
    } else {
        span.title = options.titles.soundEvent;
        span.innerHTML = EVENT_SOUND_ICON_SVG;
    }
    return span;
}

/**
 * Render rich runs into a root element, replacing its content.
 *
 * The one renderer for both surfaces: the contentEditable editor (`interactive: true`) and the
 * read-only row preview. Keeping them on this function is what lets {@link getSelectionUnitRange}
 * read a selection made in either - see {@link RichRenderOptions}.
 */
export function renderRunsToElement(root: HTMLElement, runs: StoryRichRun[], options: RichRenderOptions): void {
    root.textContent = "";
    for (const run of runs) {
        if (isTextRun(run)) {
            const marks = cleanMarks(run.marks);
            root.appendChild(marks ? createMarkSpan(run.text, marks) : globalThis.document.createTextNode(run.text));
        } else if (isInterpolationRun(run)) {
            root.appendChild(createInterpolationChip(run.interpolation, options.resolveLabel?.(run.interpolation) ?? options.titles.valueFallback, run.marks, options));
        } else if (isEventRun(run)) {
            root.appendChild(createEventChip(run.event, options));
        } else {
            root.appendChild(createPauseChip(run.pause, options));
        }
    }
}

/** Serialize a contentEditable root back into rich runs (robust against nested/pasted markup). */
export function domToRuns(root: HTMLElement): StoryRichRun[] {
    const runs: StoryRichRun[] = [];
    const walk = (node: Node, marks: StoryTextMarks | undefined) => {
        node.childNodes.forEach(child => {
            if (child.nodeType === Node.TEXT_NODE) {
                const text = child.textContent ?? "";
                if (text) {
                    runs.push(marks ? { text, marks } : { text });
                }
                return;
            }
            if (child.nodeType !== Node.ELEMENT_NODE) {
                return;
            }
            const el = child as HTMLElement;
            if (el.dataset.pause !== undefined) {
                runs.push({ pause: parsePauseValue(el.dataset.pause) });
                return;
            }
            if (el.dataset.event !== undefined) {
                const event = parseEvent(el.dataset.event);
                if (event) {
                    runs.push({ event });
                }
                return;
            }
            if (el.dataset.interp !== undefined) {
                const interp = parseInterpolation(el.dataset.interp);
                if (interp) {
                    const chipMarks = parseMarks(el.dataset.marks);
                    runs.push(chipMarks ? { interpolation: interp, marks: chipMarks } : { interpolation: interp });
                }
                return;
            }
            if (el.tagName === "BR") {
                return;
            }
            walk(el, mergeMarks(marks, readMarksFromElement(el)));
        });
    };
    walk(root, undefined);
    return normalizeRuns(runs);
}

// ---------------------------------------------------------------------------
// Unit model: a text run contributes `text.length` units; a pause run is 1 unit.
// Marks are applied over unit ranges, which guarantees correct "mixed word"
// splitting when styles overlap (e.g. bold over [0,8) and color over [4,12)
// yields a middle run carrying both).
// ---------------------------------------------------------------------------

function runLength(run: StoryRichRun): number {
    return isTextRun(run) ? run.text.length : 1;
}

export function totalUnits(runs: StoryRichRun[]): number {
    return runs.reduce((sum, run) => sum + runLength(run), 0);
}

function sliceRuns(runs: StoryRichRun[], start: number, end: number): StoryRichRun[] {
    if (start >= end) {
        return [];
    }
    const out: StoryRichRun[] = [];
    let pos = 0;
    for (const run of runs) {
        const len = runLength(run);
        const runStart = pos;
        const runEnd = pos + len;
        pos = runEnd;
        if (runEnd <= start || runStart >= end) {
            continue;
        }
        if (!isTextRun(run)) {
            out.push(run);
            continue;
        }
        const localStart = Math.max(0, start - runStart);
        const localEnd = Math.min(len, end - runStart);
        const text = run.text.slice(localStart, localEnd);
        out.push(run.marks ? { text, marks: run.marks } : { text });
    }
    return out;
}

/** Replace units [start, end) with `insert` and normalize. */
export function spliceRuns(runs: StoryRichRun[], start: number, end: number, insert: StoryRichRun[]): StoryRichRun[] {
    const total = totalUnits(runs);
    return normalizeRuns([
        ...sliceRuns(runs, 0, start),
        ...insert,
        ...sliceRuns(runs, end, total),
    ]);
}

/** True when every stylable unit (text or inline value) in [start, end) already carries the mark. */
export function rangeHasMark(runs: StoryRichRun[], start: number, end: number, key: keyof StoryTextMarks): boolean {
    let pos = 0;
    let hasAny = false;
    let allHave = true;
    for (const run of runs) {
        const len = runLength(run);
        const runStart = pos;
        const runEnd = pos + len;
        pos = runEnd;
        if (runEnd <= start || runStart >= end || (!isTextRun(run) && !isInterpolationRun(run))) {
            continue;
        }
        hasAny = true;
        if (!(run.marks && run.marks[key])) {
            allHave = false;
        }
    }
    return hasAny && allHave;
}

/** The single color shared by every stylable unit in [start, end), or undefined if they differ / none. */
export function rangeMarkColor(runs: StoryRichRun[], start: number, end: number): string | undefined {
    let pos = 0;
    let color: string | undefined;
    let first = true;
    for (const run of runs) {
        const len = runLength(run);
        const runStart = pos;
        const runEnd = pos + len;
        pos = runEnd;
        if (runEnd <= start || runStart >= end || (!isTextRun(run) && !isInterpolationRun(run))) {
            continue;
        }
        const c = run.marks?.color;
        if (first) {
            color = c;
            first = false;
        } else if (c !== color) {
            return undefined;
        }
    }
    return color;
}

/** Apply a marks patch to the text units in [start, end), splitting runs at the boundaries. */
export function applyMarkToRange(
    runs: StoryRichRun[],
    start: number,
    end: number,
    patch: (marks: StoryTextMarks) => StoryTextMarks,
): StoryRichRun[] {
    if (start >= end) {
        return runs;
    }
    const out: StoryRichRun[] = [];
    let pos = 0;
    for (const run of runs) {
        const len = runLength(run);
        const runStart = pos;
        const runEnd = pos + len;
        pos = runEnd;
        if (runEnd <= start || runStart >= end) {
            out.push(run);
            continue;
        }
        if (isInterpolationRun(run)) {
            // Atomic single-unit chip fully inside the range: style its value text.
            const marks = cleanMarks(patch({ ...(run.marks ?? {}) }));
            out.push(marks ? { interpolation: run.interpolation, marks } : { interpolation: run.interpolation });
            continue;
        }
        if (!isTextRun(run)) {
            out.push(run);
            continue;
        }
        const localStart = Math.max(0, start - runStart);
        const localEnd = Math.min(len, end - runStart);
        const text = run.text;
        if (localStart > 0) {
            out.push(run.marks ? { text: text.slice(0, localStart), marks: run.marks } : { text: text.slice(0, localStart) });
        }
        const midMarks = cleanMarks(patch({ ...(run.marks ?? {}) }));
        const midText = text.slice(localStart, localEnd);
        out.push(midMarks ? { text: midText, marks: midMarks } : { text: midText });
        if (localEnd < len) {
            out.push(run.marks ? { text: text.slice(localEnd), marks: run.marks } : { text: text.slice(localEnd) });
        }
    }
    return normalizeRuns(out);
}

// ---------------------------------------------------------------------------
// DOM ↔ unit-offset mapping (pause chips count as a single atomic unit).
// ---------------------------------------------------------------------------

function countUnits(node: Node): number {
    let total = 0;
    node.childNodes.forEach(child => {
        if (child.nodeType === Node.TEXT_NODE) {
            total += child.textContent?.length ?? 0;
        } else if (child.nodeType === Node.ELEMENT_NODE) {
            const el = child as HTMLElement;
            total += isChipElement(el) ? 1 : countUnits(el);
        }
    });
    return total;
}

export function getSelectionUnitRange(root: HTMLElement): { start: number; end: number } | null {
    const selection = globalThis.window.getSelection();
    if (!selection || selection.rangeCount === 0) {
        return null;
    }
    const range = selection.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) {
        return null;
    }
    const measure = (container: Node, offset: number): number => {
        const measured = globalThis.document.createRange();
        measured.setStart(root, 0);
        measured.setEnd(container, offset);
        return countUnits(measured.cloneContents());
    };
    const start = measure(range.startContainer, range.startOffset);
    const end = measure(range.endContainer, range.endOffset);
    return { start: Math.min(start, end), end: Math.max(start, end) };
}

/**
 * The unit offset nearest a viewport point - how a goal column lands: the caret keeps its x across
 * vertical moves, and the row it arrives in has to turn that x back into an offset in its own text.
 *
 * Chromium-only (`caretRangeFromPoint`); returns null where it is unavailable or the point falls
 * outside `root`, leaving the caller to fall back to a line edge.
 */
export function unitOffsetFromPoint(root: HTMLElement, x: number, y: number): number | null {
    const doc = globalThis.document as Document & { caretRangeFromPoint?(x: number, y: number): Range | null };
    const range = doc.caretRangeFromPoint?.(x, y) ?? null;
    if (!range || !root.contains(range.startContainer)) {
        return null;
    }
    const measured = doc.createRange();
    measured.setStart(root, 0);
    measured.setEnd(range.startContainer, range.startOffset);
    return countUnits(measured.cloneContents());
}

function pointAt(root: HTMLElement, target: number): { node: Node; offset: number } {
    let remaining = target;
    let result: { node: Node; offset: number } | null = null;
    const walk = (node: Node) => {
        const children = Array.from(node.childNodes);
        for (let index = 0; index < children.length && !result; index += 1) {
            const child = children[index];
            if (child.nodeType === Node.TEXT_NODE) {
                const len = child.textContent?.length ?? 0;
                if (remaining <= len) {
                    result = { node: child, offset: remaining };
                    return;
                }
                remaining -= len;
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                const el = child as HTMLElement;
                if (isChipElement(el)) {
                    if (remaining === 0) {
                        result = { node, offset: index };
                        return;
                    }
                    remaining -= 1;
                    if (remaining === 0) {
                        result = { node, offset: index + 1 };
                        return;
                    }
                } else {
                    walk(el);
                }
            }
        }
    };
    walk(root);
    return result ?? { node: root, offset: root.childNodes.length };
}

/** Unit offset of an element (e.g. a pause chip) within the editor root. */
export function unitOffsetOfElement(root: HTMLElement, el: HTMLElement): number {
    const range = globalThis.document.createRange();
    range.setStart(root, 0);
    range.setEndBefore(el);
    return countUnits(range.cloneContents());
}

/**
 * Flag chips (`data-selected`) whose atomic unit falls inside the selection, so a `contentEditable=false`
 * chip can show a selection highlight (the browser draws none on non-editable inline elements).
 */
export function markSelectedChips(root: HTMLElement, range: { start: number; end: number } | null): void {
    const active = Boolean(range) && (range as { start: number; end: number }).end > (range as { start: number; end: number }).start;
    root.querySelectorAll<HTMLElement>("[data-interp],[data-pause],[data-event]").forEach(chip => {
        const start = unitOffsetOfElement(root, chip);
        if (active && start >= (range as { start: number; end: number }).start && start + 1 <= (range as { start: number; end: number }).end) {
            chip.dataset.selected = "true";
        } else {
            delete chip.dataset.selected;
        }
    });
}

export function setSelectionUnitRange(root: HTMLElement, start: number, end: number): void {
    const startPoint = pointAt(root, start);
    const endPoint = pointAt(root, end);
    const range = globalThis.document.createRange();
    range.setStart(startPoint.node, startPoint.offset);
    range.setEnd(endPoint.node, endPoint.offset);
    const selection = globalThis.window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
}
