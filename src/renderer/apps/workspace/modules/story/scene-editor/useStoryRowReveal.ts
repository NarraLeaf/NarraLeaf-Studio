import { useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import type { StoryBlockId } from "@shared/types/story";
import {
    resolveRevealScrollTop,
    storyRevealLead,
    type StoryRevealBand,
    type StoryRevealTarget,
    type StoryRowRevealRequest,
} from "./storyRowReveal";

/**
 * As much of the virtualiser as revealing a row needs. Structural rather than the real type so the
 * hook can be exercised without one: what it wants is where an index sits and a way to make it exist.
 */
export type StoryRevealVirtualizer = {
    measurementsCache: ReadonlyArray<{ start: number; size: number }>;
    scrollToIndex: (index: number, options?: { align?: "start" | "center" | "end" | "auto" }) => void;
};

export type StoryRowRevealOptions = {
    scrollContainerRef: RefObject<HTMLElement | null>;
    addRowRef: RefObject<HTMLElement | null>;
    rowVirtualizer: StoryRevealVirtualizer;
    /** Index of a block among the rows currently on the page, or -1 when the page is not showing it. */
    resolveRowIndex: (blockId: StoryBlockId) => number;
    /** The row whose wrapper currently holds the open insert slot, or null when no row hosts one. */
    slotHostBlockId: StoryBlockId | null;
    /** One row's height at the current density - the unit the lead is measured in. */
    rowHeight: number;
    subscribe: (listener: (request: StoryRowRevealRequest) => void) => () => void;
};

/**
 * How long a reveal is allowed to chase its target.
 *
 * A reveal cannot finish in one frame, and it is not because of animation. The list is windowed, so
 * the row asked for may not exist yet; when it does mount it measures itself, and a wrapped line of
 * dialogue is not the height the estimate assumed. So the move is re-derived every frame from what is
 * now true, and stops the moment nothing more needs to happen. The cap is the backstop for a target
 * that never arrives - a row the author's filter is hiding, a slot whose commit beat us to it.
 */
const MAX_FRAMES = 12;

/**
 * Drive the one effect that moves the scene editor's viewport.
 *
 * Every reveal in the editor lands here, carrying the intent that says how far the page may move (see
 * `storyRowReveal`). Nothing else scrolls the row list: `Element.scrollIntoView` is deliberately not
 * used, because it walks every scrollable ancestor and will move the workbench around the editor to
 * satisfy a request about one row inside it.
 */
export function useStoryRowReveal(options: StoryRowRevealOptions): void {
    // Everything the loop reads changes on almost every render; the subscription must not. Refs are
    // what let this effect run exactly once per tab rather than re-subscribing per keystroke.
    const latest = useRef(options);
    latest.current = options;

    // Layout, not passive: the deep-link and drafted-jump effects in the tab are layout effects too,
    // and on a cold open they publish before any passive effect has run. A subscription that arrived
    // one phase later would drop exactly the navigation that opened the tab.
    useLayoutEffect(() => {
        let rafId = 0;
        let detach: (() => void) | null = null;

        const stop = (): void => {
            if (rafId) {
                window.cancelAnimationFrame(rafId);
                rafId = 0;
            }
            detach?.();
            detach = null;
        };

        /**
         * Where the target sits, in the scroller's content coordinates, or null while it is not there
         * to be measured yet.
         *
         * A row is answered from the virtualiser rather than from the DOM, and that is the point: the
         * row asked for is very often not mounted, which is exactly when the author most needs the
         * page to move. The measurement is an estimate until the row mounts, which the loop corrects.
         */
        const resolveBand = (scroller: HTMLElement, target: StoryRevealTarget): StoryRevealBand | null => {
            const { rowVirtualizer, resolveRowIndex, addRowRef } = latest.current;
            if (target.kind === "row") {
                const index = resolveRowIndex(target.blockId);
                if (index < 0) {
                    return null;
                }
                const measurement = rowVirtualizer.measurementsCache[index];
                if (!measurement) {
                    // Nothing measured yet (the scene is still loading). Ask for the index anyway: it
                    // costs nothing and it is what mounts the row for the next frame to measure.
                    rowVirtualizer.scrollToIndex(index, { align: "auto" });
                    return null;
                }
                return { top: measurement.start, height: measurement.size };
            }
            const element = target.kind === "addRow"
                ? addRowRef.current
                : scroller.querySelector<HTMLElement>("[data-story-insert-slot]");
            if (!element) {
                return null;
            }
            const rect = element.getBoundingClientRect();
            return {
                top: scroller.scrollTop + (rect.top - scroller.getBoundingClientRect().top),
                height: rect.height,
            };
        };

        /**
         * A slot rendered inside a row's wrapper cannot be found until that row is mounted, and the
         * only thing that mounts it is scrolling to it. This is the one case where the first move is
         * made blind - to the host row, by index - so that the frame after it has a slot to measure.
         * The scene flow map's drafted jump is the path that needs it: it opens a tab, seeds a slot far
         * down a chapter, and used to look for it one frame later in a list that had never rendered it.
         */
        const mountSlotHost = (): void => {
            const { slotHostBlockId, resolveRowIndex, rowVirtualizer } = latest.current;
            if (!slotHostBlockId) {
                return;
            }
            const index = resolveRowIndex(slotHostBlockId);
            if (index >= 0) {
                rowVirtualizer.scrollToIndex(index, { align: "center" });
            }
        };

        const run = (request: StoryRowRevealRequest): void => {
            stop();
            if (request.intent === "none") {
                return;
            }
            let frame = 0;
            const tick = (): void => {
                rafId = 0;
                const scroller = latest.current.scrollContainerRef.current;
                // A hidden tab reports no height, and geometry against a zero-height port is noise. The
                // frame cap ends it; the tab's own keep-alive restore owns where a hidden tab reopens.
                if (!scroller || scroller.clientHeight === 0) {
                    if (frame++ < MAX_FRAMES) {
                        rafId = window.requestAnimationFrame(tick);
                    } else {
                        stop();
                    }
                    return;
                }
                const band = resolveBand(scroller, request.target);
                if (!band) {
                    if (request.target.kind === "slot") {
                        mountSlotHost();
                    }
                    if (frame++ < MAX_FRAMES) {
                        rafId = window.requestAnimationFrame(tick);
                    } else {
                        stop();
                    }
                    return;
                }
                const next = resolveRevealScrollTop(request.intent, band, {
                    scrollTop: scroller.scrollTop,
                    height: scroller.clientHeight,
                    maxScrollTop: scroller.scrollHeight - scroller.clientHeight,
                    lead: storyRevealLead(latest.current.rowHeight, scroller.clientHeight),
                });
                if (next === null) {
                    // Settled: the target is where the intent wanted it and nothing more is owed.
                    stop();
                    return;
                }
                scroller.scrollTop = next;
                if (frame++ < MAX_FRAMES) {
                    rafId = window.requestAnimationFrame(tick);
                } else {
                    stop();
                }
            };

            // The author outranks the reveal for as long as it is still running. A reveal takes a few
            // frames, and in those frames a wheel or a press on the scrollbar is a statement about
            // where the page should be that no navigation gets to overrule.
            const scroller = latest.current.scrollContainerRef.current;
            if (scroller) {
                const surrender = (): void => stop();
                scroller.addEventListener("wheel", surrender, { passive: true });
                scroller.addEventListener("pointerdown", surrender);
                scroller.addEventListener("touchstart", surrender, { passive: true });
                detach = () => {
                    scroller.removeEventListener("wheel", surrender);
                    scroller.removeEventListener("pointerdown", surrender);
                    scroller.removeEventListener("touchstart", surrender);
                };
            }
            // Always a frame late, never inline: a reveal is declared while the state that produces it
            // is still being committed, so reading the layout now would measure the page as it was
            // before the row, the slot or the deletion that prompted the request.
            rafId = window.requestAnimationFrame(tick);
        };

        const unsubscribe = latest.current.subscribe(run);
        return () => {
            unsubscribe();
            stop();
        };
    }, []);
}
