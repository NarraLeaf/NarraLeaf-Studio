import type { StoryRichRun, StoryTextMarks, StoryTextSegment } from "@shared/types/story";

/** Pause chip class (a literal so Tailwind's content scan can see it). */
const PAUSE_CHIP_CLASS = "story-rt-pause mx-0.5 inline-block select-none rounded bg-primary/20 px-1 text-[11px] align-middle text-primary";

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
    span.dataset.pause = pause === true ? "click" : String(pause);
    span.contentEditable = "false";
    span.className = PAUSE_CHIP_CLASS;
    span.textContent = pause === true ? "⏸" : `⏸${pause}`;
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
