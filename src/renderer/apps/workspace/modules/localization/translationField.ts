/**
 * The DOM half of the translation field: tokens in, tokens out.
 *
 * A translation is a sequence of {@link TranslationToken}s - words, and the tags that name the
 * line's styling, pauses and values. The field draws each tag as an element the caret cannot enter
 * and cannot open, so a translator moves a style boundary the way they move anything else in a
 * sentence: with the arrow keys, with Backspace, by putting the caret somewhere and pressing a
 * button. There is no style editor to visit, because there is no styling to invent - only this
 * line's own tags, placed.
 *
 * The words between an opening tag and its closing one are still drawn wearing the style, so the
 * field previews what the player will read at the same time as it shows where the range ends.
 *
 * Chips are built by `renderRunsToElement` - the story editor's own builder - so a pause in a
 * translation looks exactly like the pause in the line it translates. Nothing here describes a chip
 * a second time.
 *
 * Comments in English per project convention.
 */

import type { StoryRichRun } from "@shared/types/story";
import type { TranslationToken } from "@shared/utils/localizationText";
import { printTranslationToken, tokenizeTranslation } from "@shared/utils/localizationText";
import { renderRunsToElement, type RichRenderOptions } from "@/apps/workspace/modules/story/scene-editor/richText";

/** Marks the two halves of a style range, and carries which run they name. */
const TAG_OPEN_ATTRIBUTE = "tagopen";
const TAG_CLOSE_ATTRIBUTE = "tagclose";
/** Marks a chip that stands on its own, and carries the index its token is written with. */
const TOKEN_INDEX_ATTRIBUTE = "tokenindex";
const VALUE_INDEX_ATTRIBUTE = "valueindex";

/** Class names live here so Tailwind's content scan can see them as literals. */
const TAG_CHIP_CLASS = "story-rt-tag mx-px inline-block select-none align-middle text-2xs leading-none text-primary/80";

/** Build a chip for one source run by asking the story renderer for it, then taking what it made. */
function chipFor(run: StoryRichRun, options: RichRenderOptions): HTMLElement | null {
    const scratch = globalThis.document.createElement("span");
    renderRunsToElement(scratch, [run], { ...options, interactive: false });
    const first = scratch.firstElementChild;
    return first instanceof HTMLElement ? first : null;
}

/** The bracket that opens or closes a style range. Inert: it is moved, never opened. */
function tagChip(index: number, closing: boolean): HTMLSpanElement {
    const span = globalThis.document.createElement("span");
    span.dataset[closing ? TAG_CLOSE_ATTRIBUTE : TAG_OPEN_ATTRIBUTE] = String(index);
    span.contentEditable = "false";
    span.className = TAG_CHIP_CLASS;
    span.textContent = closing ? "⟩" : "⟨";
    return span;
}

/** A run of words wearing a style, drawn by the story renderer so the two cannot disagree. */
function styledText(text: string, run: StoryRichRun | undefined, options: RichRenderOptions): Node {
    const marks = run && "text" in run ? run.marks : undefined;
    if (!marks) {
        return globalThis.document.createTextNode(text);
    }
    const scratch = globalThis.document.createElement("span");
    renderRunsToElement(scratch, [{ text, marks }], { ...options, interactive: false });
    return scratch.firstChild ?? globalThis.document.createTextNode(text);
}

/**
 * Draw a translation into a contentEditable root.
 *
 * The interpolation a `{n}` names is the source's nth interpolation run, which is the only place the
 * two numbering schemes have to be reconciled; everything else indexes the source runs directly.
 */
export function renderTranslationTokens(
    root: HTMLElement,
    tokens: readonly TranslationToken[],
    sourceRuns: readonly StoryRichRun[],
    options: RichRenderOptions,
): void {
    const interpolations = sourceRuns.filter(run => "interpolation" in run);
    root.textContent = "";
    let open: number | undefined;
    for (const token of tokens) {
        if (token.kind === "text") {
            root.appendChild(styledText(token.text, open === undefined ? undefined : sourceRuns[open], options));
            continue;
        }
        if (token.kind === "open") {
            root.appendChild(tagChip(token.index, false));
            open = token.index;
            continue;
        }
        if (token.kind === "close") {
            root.appendChild(tagChip(token.index, true));
            open = undefined;
            continue;
        }
        const run = token.kind === "value" ? interpolations[token.index] : sourceRuns[token.index];
        const chip = run ? chipFor(run, options) : null;
        if (!chip) {
            continue;
        }
        chip.dataset[token.kind === "value" ? VALUE_INDEX_ATTRIBUTE : TOKEN_INDEX_ATTRIBUTE] = String(token.index);
        root.appendChild(chip);
    }
}

/**
 * Read a contentEditable root back into tokens.
 *
 * Every tag carries the index it was written with, so this is exact rather than a guess: nothing is
 * matched by value, and a translation that leaves the field is the translation that entered it plus
 * whatever the translator did. Markup the browser or a paste introduced is walked into for its text.
 */
export function translationTokensFromDom(root: HTMLElement): TranslationToken[] {
    const tokens: TranslationToken[] = [];
    const pushText = (text: string): void => {
        if (!text) {
            return;
        }
        const previous = tokens[tokens.length - 1];
        if (previous && previous.kind === "text") {
            previous.text += text;
            return;
        }
        tokens.push({ kind: "text", text });
    };
    const walk = (node: Node): void => {
        node.childNodes.forEach(child => {
            if (child.nodeType === Node.TEXT_NODE) {
                pushText(child.textContent ?? "");
                return;
            }
            if (!(child instanceof HTMLElement)) {
                return;
            }
            if (child.tagName === "BR") {
                pushText("\n");
                return;
            }
            const data = child.dataset;
            if (data[TAG_OPEN_ATTRIBUTE] !== undefined) {
                tokens.push({ kind: "open", index: Number(data[TAG_OPEN_ATTRIBUTE]) });
                return;
            }
            if (data[TAG_CLOSE_ATTRIBUTE] !== undefined) {
                tokens.push({ kind: "close", index: Number(data[TAG_CLOSE_ATTRIBUTE]) });
                return;
            }
            if (data[VALUE_INDEX_ATTRIBUTE] !== undefined) {
                tokens.push({ kind: "value", index: Number(data[VALUE_INDEX_ATTRIBUTE]) });
                return;
            }
            if (data[TOKEN_INDEX_ATTRIBUTE] !== undefined) {
                tokens.push({ kind: "standalone", index: Number(data[TOKEN_INDEX_ATTRIBUTE]) });
                return;
            }
            walk(child);
        });
    };
    walk(root);
    return tokens;
}

/** Tokens as the string the localization document stores. */
export function printTranslationTokens(tokens: readonly TranslationToken[]): string {
    return tokens.map(printTranslationToken).join("");
}

/** A translation string as tokens. Re-exported so the field has one import for the whole model. */
export function translationTokens(target: string): TranslationToken[] {
    return tokenizeTranslation(target);
}

/**
 * How many caret positions precede `node`/`offset` inside `root`.
 *
 * Text counts by character and every chip counts as one, which is the same unit the story editor's
 * rich field counts in - so a caret restored after a redraw lands where the translator left it.
 */
export function caretOffsetIn(root: HTMLElement, node: Node, offset: number): number {
    let count = 0;
    let done = false;
    const walk = (current: Node): void => {
        if (done) {
            return;
        }
        if (current === node && current.nodeType !== Node.TEXT_NODE) {
            // An offset inside an element counts the children before it.
            let index = 0;
            current.childNodes.forEach(child => {
                if (index < offset) {
                    walk(child);
                }
                index += 1;
            });
            done = true;
            return;
        }
        if (current.nodeType === Node.TEXT_NODE) {
            if (current === node) {
                count += offset;
                done = true;
                return;
            }
            count += (current.textContent ?? "").length;
            return;
        }
        if (current instanceof HTMLElement && isChip(current)) {
            count += 1;
            return;
        }
        current.childNodes.forEach(walk);
    };
    root.childNodes.forEach(walk);
    return count;
}

/** Put the caret at `target` caret positions into `root`, or at its end. */
export function setCaretOffset(root: HTMLElement, target: number): void {
    const selection = globalThis.window.getSelection();
    if (!selection) {
        return;
    }
    let remaining = target;
    let placed = false;
    const range = globalThis.document.createRange();
    const walk = (current: Node): void => {
        if (placed) {
            return;
        }
        if (current.nodeType === Node.TEXT_NODE) {
            const length = (current.textContent ?? "").length;
            if (remaining <= length) {
                range.setStart(current, remaining);
                placed = true;
                return;
            }
            remaining -= length;
            return;
        }
        if (current instanceof HTMLElement && isChip(current)) {
            if (remaining <= 0) {
                range.setStartBefore(current);
                placed = true;
                return;
            }
            remaining -= 1;
            return;
        }
        current.childNodes.forEach(walk);
    };
    root.childNodes.forEach(walk);
    if (!placed) {
        range.selectNodeContents(root);
        range.collapse(false);
    }
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
}

/** True for an element the caret treats as a single position: a tag, a pause, a value, an event. */
function isChip(element: HTMLElement): boolean {
    const data = element.dataset;
    return data[TAG_OPEN_ATTRIBUTE] !== undefined
        || data[TAG_CLOSE_ATTRIBUTE] !== undefined
        || data.pause !== undefined
        || data.interp !== undefined
        || data.event !== undefined;
}
