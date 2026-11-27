import { useEffect, type RefObject } from "react";
import type { StoryBlockId } from "@shared/types/story";

/** A find hit as the scene editor lists it: plain-text offsets into one row's segment. */
export type StoryFindHighlightMatch = { blockId: StoryBlockId; start: number; end: number };

const HIGHLIGHT = "nl-story-find";
const HIGHLIGHT_ACTIVE = "nl-story-find-active";

/** Elements that draw something other than the segment's own characters - chips, never searched. */
const NON_TEXT = "[data-pause],[data-interp],[data-event],[contenteditable='false']";

type HighlightRegistry = { set(name: string, value: unknown): void; delete(name: string): void };
type HighlightConstructor = new (...ranges: Range[]) => unknown;

function highlightApi(): { registry: HighlightRegistry; Highlight: HighlightConstructor } | null {
    const registry = (globalThis.CSS as unknown as { highlights?: HighlightRegistry } | undefined)?.highlights;
    const Highlight = (globalThis as unknown as { Highlight?: HighlightConstructor }).Highlight;
    return registry && Highlight ? { registry, Highlight } : null;
}

/**
 * A DOM range over plain-text offsets `[start, end)` of a row's text, counting only the characters
 * the segment owns (chip labels are skipped, as the search skips them). Null when the offsets do not
 * land - the row is mid-edit or rendered differently than the segment the hit came from.
 */
export function rangeForPlainOffsets(container: Element, start: number, end: number): Range | null {
    const doc = container.ownerDocument;
    const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
        acceptNode: node => (node.parentElement?.closest(NON_TEXT) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    let offset = 0;
    let range: Range | null = null;
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
        const length = node.data.length;
        if (!range && start <= offset + length && start >= offset) {
            range = doc.createRange();
            range.setStart(node, start - offset);
        }
        if (range && end <= offset + length) {
            range.setEnd(node, end - offset);
            return range;
        }
        offset += length;
    }
    return null;
}

/**
 * Paint the scene's find hits inside the row text while the find bar is open: every hit tinted, the
 * current one in the accent. Selecting the row was the only sign of a hit before, so a line holding
 * the word twice gave no clue which one Replace would take.
 *
 * Rows are virtualised and mount as the page scrolls, so the paint is redone (once per frame at
 * most) whenever the row list's DOM changes.
 */
export function useStoryFindHighlights(
    rootRef: RefObject<HTMLElement | null>,
    open: boolean,
    matches: readonly StoryFindHighlightMatch[],
    activeIndex: number,
): void {
    useEffect(() => {
        const api = highlightApi();
        const root = rootRef.current;
        if (!api) {
            return;
        }
        const clear = () => {
            api.registry.delete(HIGHLIGHT);
            api.registry.delete(HIGHLIGHT_ACTIVE);
        };
        if (!open || matches.length === 0 || !root) {
            clear();
            return;
        }
        const paint = () => {
            const rest: Range[] = [];
            let active: Range | null = null;
            matches.forEach((match, index) => {
                const row = root.querySelector(`[data-story-row-block-id="${CSS.escape(match.blockId)}"] [data-story-row-text]`);
                const range = row ? rangeForPlainOffsets(row, match.start, match.end) : null;
                if (!range) {
                    return;
                }
                if (index === activeIndex) {
                    active = range;
                } else {
                    rest.push(range);
                }
            });
            api.registry.set(HIGHLIGHT, new api.Highlight(...rest));
            if (active) {
                api.registry.set(HIGHLIGHT_ACTIVE, new api.Highlight(active));
            } else {
                api.registry.delete(HIGHLIGHT_ACTIVE);
            }
        };
        paint();
        let frame = 0;
        const observer = new MutationObserver(() => {
            if (frame) {
                return;
            }
            frame = window.requestAnimationFrame(() => {
                frame = 0;
                paint();
            });
        });
        observer.observe(root, { childList: true, subtree: true, characterData: true });
        return () => {
            observer.disconnect();
            if (frame) {
                window.cancelAnimationFrame(frame);
            }
            clear();
        };
    }, [activeIndex, matches, open, rootRef]);
}
