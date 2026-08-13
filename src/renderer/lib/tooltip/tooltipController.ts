/**
 * Studio's own tooltip, in place of the browser's `title=` bubble.
 *
 * Two things were wrong with the native one. It is drawn by Chromium, so it is the only surface in
 * the app that does not follow the theme; and it waits about a second before appearing, which is far
 * too long for a toolbar the author is scanning. It also paints over the pixels being aimed at,
 * which is why editing surfaces were told not to carry `title` at all.
 *
 * Resolution is DOM-based, exactly like the help overlay's `data-help-topic`: an element opts in by
 * carrying `data-tip` and needs to know nothing else. That is what makes ~460 call sites a rename
 * rather than 460 wrappers, and a wrapper element around each one would change the layout of every
 * toolbar row it sits in. It also means the shared controls need no new prop - they all spread their
 * rest props onto the DOM node - and the built-in plugins get the themed tooltip without an API.
 */

import {
    TOOLTIP_DELAY_DEFAULT_MS,
    TOOLTIP_DELAY_MAX_MS,
    TOOLTIP_DELAY_MIN_MS,
} from "@/lib/settings/tooltipOptions";

/** Marks the element a tooltip describes. Absent or empty means no tooltip. */
export const TOOLTIP_ATTRIBUTE = "data-tip";

/**
 * Marks a hot-chain scope, written by `TooltipGroup`.
 *
 * Inside a group the delay is paid once: the first tooltip waits, and from then until the pointer
 * leaves the group every other tooltip in it appears immediately. That is what makes a dense strip
 * of icon buttons feel right, and it is why no button has to declare "instant" for itself.
 */
export const TOOLTIP_GROUP_ATTRIBUTE = "data-tip-group";

/**
 * Which way a tooltip opens, read from the element or from the nearest ancestor that declares one -
 * so a strip states it once for everything in it.
 *
 * A rail of icons wants its tooltips pointing inward, into the room the app has, rather than above
 * each icon where they would sit on the icon above. Without it the default is above and the rail
 * reads as a stack of labels over its own buttons.
 */
export const TOOLTIP_SIDE_ATTRIBUTE = "data-tip-side";

export type TooltipSide = "top" | "bottom" | "left" | "right";

const SIDES: readonly TooltipSide[] = ["top", "bottom", "left", "right"];

export const TOOLTIP_SIDE_DEFAULT: TooltipSide = "top";

/** The side an element asks for, inherited from its nearest declaring ancestor. */
export function resolveTooltipSide(from: Element | null): TooltipSide {
    const declaring = from?.closest("[" + TOOLTIP_SIDE_ATTRIBUTE + "]") ?? null;
    const value = declaring?.getAttribute(TOOLTIP_SIDE_ATTRIBUTE);
    return SIDES.includes(value as TooltipSide) ? (value as TooltipSide) : TOOLTIP_SIDE_DEFAULT;
}

/** What the host draws, or null for nothing. */
export interface TooltipTarget {
    anchor: HTMLElement;
    text: string;
    side: TooltipSide;
}

type Publish = (target: TooltipTarget | null) => void;

/**
 * One delay for the whole app, groups included - a group buys immediacy through the hot chain, not
 * through a shorter timer. Module-level rather than per-window because it is a single preference
 * (`ui.tooltipDelay`), applied by the appearance bootstrap in every Studio window.
 */
let delayMs = TOOLTIP_DELAY_DEFAULT_MS;

export function setTooltipDelay(ms: number): void {
    if (!Number.isFinite(ms)) {
        return;
    }
    delayMs = Math.min(TOOLTIP_DELAY_MAX_MS, Math.max(TOOLTIP_DELAY_MIN_MS, Math.round(ms)));
}

export function getTooltipDelay(): number {
    return delayMs;
}

/** The text an element declares, or null when it declares none. */
export function tooltipTextOf(element: Element | null): string | null {
    if (!(element instanceof HTMLElement)) {
        return null;
    }
    const text = element.getAttribute(TOOLTIP_ATTRIBUTE);
    return text ? text : null;
}

/** The nearest ancestor (or self) that declares a tooltip. */
export function resolveTooltipElement(from: Element | null): HTMLElement | null {
    let node: Element | null = from;
    while (node) {
        const text = tooltipTextOf(node);
        if (text) {
            return node as HTMLElement;
        }
        node = node.parentElement;
    }
    return null;
}

/**
 * Watch one document and publish what should be showing.
 *
 * The hit test rather than the event target, but only when the cheap path misses: a disabled control
 * receives no pointer events at all, so `event.target` while hovering a greyed-out button is its
 * container. The native tooltip does appear there, and those are some of the tooltips that matter
 * most - a disabled button's is usually the only statement of why it is disabled. So when the event
 * target resolves to nothing, the pointer position is hit-tested instead, which does return the
 * disabled element. That costs one hit test per frame while the pointer is over a region that has no
 * tooltip, and nothing at all while it is over one. The drag path skips both: a pointer moving with
 * a button held is drawing, not reading.
 */
export function startTooltipTracking(doc: Document, publish: Publish): () => void {
    const view = doc.defaultView;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let frame = 0;
    let anchor: HTMLElement | null = null;
    let shownText: string | null = null;
    let hotGroup: HTMLElement | null = null;
    let lastProbe: Element | null = null;
    /** The control the running timer belongs to, so movement over it does not restart the wait. */
    let waitingOn: HTMLElement | null = null;

    const groupOf = (element: HTMLElement | null): HTMLElement | null =>
        element ? element.closest<HTMLElement>("[" + TOOLTIP_GROUP_ATTRIBUTE + "]") : null;

    const cancelTimer = (): void => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
        waitingOn = null;
    };

    const clearShown = (): void => {
        if (anchor) {
            anchor = null;
            shownText = null;
            publish(null);
        }
    };

    const show = (element: HTMLElement, text: string): void => {
        anchor = element;
        shownText = text;
        const group = groupOf(element);
        if (group) {
            hotGroup = group;
        }
        publish({ anchor: element, text, side: resolveTooltipSide(element) });
    };

    /** Hide, and forget where the pointer was, so re-entering the same element shows again. */
    const hide = (coolGroup: boolean): void => {
        cancelTimer();
        lastProbe = null;
        if (coolGroup) {
            hotGroup = null;
        }
        clearShown();
    };

    const settle = (element: HTMLElement | null, under: Element | null): void => {
        // The group cools the moment the pointer is outside it, which keeps the rule one sentence
        // long: a strip is warm while you are in it. No grace period - keeping a group warm after
        // the pointer has left would make the next tooltip's timing depend on where it had been.
        if (hotGroup && (!under || !hotGroup.contains(under))) {
            hotGroup = null;
        }

        const text = element ? tooltipTextOf(element) : null;
        if (!element || !text) {
            hide(false);
            return;
        }

        if (element === anchor) {
            // Same element, new words - a play button that has become a stop button. Redraw rather
            // than leave the old text standing under the pointer.
            if (text !== shownText) {
                show(element, text);
            }
            return;
        }

        // A pointer resting on a control still emits moves - a hand on a mouse is never quite still,
        // and a repainting row under the cursor produces them on its own. Restarting the wait on each
        // one is a tooltip that never arrives, so the wait belongs to the control, not to the event.
        if (element === waitingOn) {
            return;
        }

        cancelTimer();
        if (hotGroup && hotGroup.contains(element)) {
            show(element, text);
            return;
        }
        clearShown();
        waitingOn = element;
        timer = setTimeout(() => {
            timer = null;
            waitingOn = null;
            // Read the words again rather than close over them: a control can relabel itself while
            // the pointer waits on it.
            const current = tooltipTextOf(element);
            if (element.isConnected && current) {
                show(element, current);
            }
        }, delayMs);
    };

    const probe = (x: number, y: number): void => {
        const under = doc.elementFromPoint(x, y);
        if (under === lastProbe) {
            return;
        }
        lastProbe = under;
        settle(resolveTooltipElement(under), under);
    };

    const onPointerMove = (event: PointerEvent): void => {
        if (event.buttons !== 0) {
            hide(true);
            return;
        }
        const direct = resolveTooltipElement(event.target instanceof Element ? event.target : null);
        if (direct) {
            // No early exit on "same element as last time": the walk above is the whole cost, and
            // skipping the rest would leave a control that has relabelled itself under a resting
            // pointer still showing the words it had before.
            lastProbe = direct;
            settle(direct, direct);
            return;
        }
        const x = event.clientX;
        const y = event.clientY;
        if (frame) {
            return;
        }
        frame = view ? view.requestAnimationFrame(() => {
            frame = 0;
            probe(x, y);
        }) : 0;
    };

    const onPointerOut = (event: PointerEvent): void => {
        // `relatedTarget` is null when the pointer left the window rather than moved between
        // elements, and no further `pointermove` arrives to take a tooltip left showing back down.
        if (!event.relatedTarget) {
            hide(true);
        }
    };

    /**
     * Keyboard focus shows straight away. The delay is there so a pointer crossing the screen does
     * not trail bubbles behind it; someone who has tabbed onto a control has already chosen it.
     */
    const onFocusIn = (event: FocusEvent): void => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }
        const text = tooltipTextOf(target);
        if (!text || !target.matches(":focus-visible")) {
            return;
        }
        cancelTimer();
        show(target, text);
    };

    const onFocusOut = (event: FocusEvent): void => {
        if (anchor && event.target === anchor) {
            hide(false);
        }
    };

    const onPointerDown = (): void => hide(true);
    const onKeyDown = (): void => hide(true);
    const onWheel = (): void => hide(true);
    const onScroll = (): void => hide(false);
    const onWindowBlur = (): void => hide(true);

    doc.addEventListener("pointermove", onPointerMove, { passive: true });
    doc.addEventListener("pointerout", onPointerOut, { passive: true });
    doc.addEventListener("pointerdown", onPointerDown, { passive: true, capture: true });
    doc.addEventListener("keydown", onKeyDown, { passive: true, capture: true });
    doc.addEventListener("wheel", onWheel, { passive: true, capture: true });
    doc.addEventListener("scroll", onScroll, { passive: true, capture: true });
    doc.addEventListener("focusin", onFocusIn, { passive: true });
    doc.addEventListener("focusout", onFocusOut, { passive: true });
    view?.addEventListener("blur", onWindowBlur);

    return () => {
        cancelTimer();
        if (frame && view) {
            view.cancelAnimationFrame(frame);
            frame = 0;
        }
        doc.removeEventListener("pointermove", onPointerMove);
        doc.removeEventListener("pointerout", onPointerOut);
        doc.removeEventListener("pointerdown", onPointerDown, true);
        doc.removeEventListener("keydown", onKeyDown, true);
        doc.removeEventListener("wheel", onWheel, true);
        doc.removeEventListener("scroll", onScroll, true);
        doc.removeEventListener("focusin", onFocusIn);
        doc.removeEventListener("focusout", onFocusOut);
        view?.removeEventListener("blur", onWindowBlur);
    };
}
