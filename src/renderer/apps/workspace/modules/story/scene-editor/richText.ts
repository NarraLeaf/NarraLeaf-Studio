import type { StoryRichRun, StoryTextMarks, StoryTextSegment } from "@shared/types/story";

/** Pause chip class (a literal so Tailwind's content scan can see it). */
const PAUSE_CHIP_CLASS = "story-rt-pause mx-0.5 inline-flex cursor-pointer select-none items-center rounded bg-primary/20 px-1 py-0.5 align-middle text-[10px] font-medium text-primary hover:bg-primary/30";
const PAUSE_ICON_SVG = '<svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="14" y="4" width="4" height="16" rx="1"></rect><rect x="6" y="4" width="4" height="16" rx="1"></rect></svg>';

export function isTextRun(run: StoryRichRun): run is { text: string; marks?: StoryTextMarks } {
    return "text" in run;
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

export function createPauseChip(pause: number | true): HTMLSpanElement {
    const span = globalThis.document.createElement("span");
    span.dataset.pause = pause === true ? "click" : String(Math.round(pause as number));
    span.contentEditable = "false";
    span.className = PAUSE_CHIP_CLASS;
    span.setAttribute("role", "button");
    span.title = pause === true ? "Pause — waits for a click" : `Pause — waits ${Math.round(pause)}ms`;
    const label = pause === true ? "" : `<span class="ml-0.5">${Math.round(pause)}ms</span>`;
    // PAUSE_ICON_SVG is a trusted static string; the label only interpolates a rounded number.
    span.innerHTML = `${PAUSE_ICON_SVG}${label}`;
    return span;
}

/** Render rich runs into a contentEditable root, replacing its content. */
export function renderRunsToElement(root: HTMLElement, runs: StoryRichRun[]): void {
    root.textContent = "";
    for (const run of runs) {
        if (isTextRun(run)) {
            const marks = cleanMarks(run.marks);
            root.appendChild(marks ? createMarkSpan(run.text, marks) : globalThis.document.createTextNode(run.text));
        } else {
            root.appendChild(createPauseChip(run.pause));
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

/** True when every text unit in [start, end) already carries the given mark. */
export function rangeHasMark(runs: StoryRichRun[], start: number, end: number, key: keyof StoryTextMarks): boolean {
    let pos = 0;
    let hasAny = false;
    let allHave = true;
    for (const run of runs) {
        const len = runLength(run);
        const runStart = pos;
        const runEnd = pos + len;
        pos = runEnd;
        if (runEnd <= start || runStart >= end || !isTextRun(run)) {
            continue;
        }
        hasAny = true;
        if (!(run.marks && run.marks[key])) {
            allHave = false;
        }
    }
    return hasAny && allHave;
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
        if (!isTextRun(run) || runEnd <= start || runStart >= end) {
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
            total += el.dataset.pause !== undefined ? 1 : countUnits(el);
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
                if (el.dataset.pause !== undefined) {
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
