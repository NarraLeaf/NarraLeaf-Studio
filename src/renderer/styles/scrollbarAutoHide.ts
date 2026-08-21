/**
 * The JS half of the scrollbar rules in `styles.css`.
 *
 * The stylesheet draws no thumb at all by default and keys the visible one off a
 * `data-nl-scrollbar` attribute, because CSS has no way to ask whether a scroller
 * is currently moving. This supplies that answer: it stamps the attribute on
 * whichever element just scrolled, holds it there while the wheel keeps turning,
 * then steps it down to nothing once the scrolling stops.
 *
 * One capturing listener on the document covers every scroller in the window,
 * present and future — `scroll` does not bubble, but it does capture, so there is
 * nothing to register per element and nothing to tear down when one goes away.
 *
 * Scrollers that should never show a thumb at all opt out in CSS instead, with
 * `.nl-no-scrollbar`; the attribute landing on one of them is harmless.
 */

/** Mirrors the `[data-nl-scrollbar]` selectors in styles.css. */
const ATTRIBUTE = "data-nl-scrollbar";

/**
 * The fade, as attribute values: full strength first, then the steps down.
 * Running off the end removes the attribute. See the note in styles.css for why
 * the fade is a handful of discrete values rather than a CSS transition.
 */
const STEPS = ["", "dim", "faint"] as const;

/**
 * How long the thumb stays at full strength after the last scroll event.
 *
 * Long enough to cover the gap between two flicks of a wheel — a thumb that
 * started fading between them would spend the whole gesture flickering.
 */
const HOLD_MS = 650;

/** Gap between fade steps. Three of them make the fade about a fifth of a second. */
const STEP_MS = 90;

type Tracked = {
    /** Index into `STEPS`. */
    step: number;
    /** Timestamp before which the fade must not start; every scroll event pushes it forward. */
    holdUntil: number;
};

const tracked = new Map<Element, Tracked>();

/**
 * Take one step down the fade, or re-arm if the element scrolled again while this
 * was pending.
 *
 * Re-arming rather than cancelling is what keeps the scroll path cheap: an event
 * arriving mid-hold only writes a number, and never touches a timer.
 */
function advance(element: Element): void {
    const record = tracked.get(element);
    if (!record) {
        return;
    }

    const remaining = record.holdUntil - performance.now();
    if (remaining > 1) {
        window.setTimeout(() => advance(element), remaining);
        return;
    }

    record.step += 1;
    if (record.step >= STEPS.length) {
        tracked.delete(element);
        element.removeAttribute(ATTRIBUTE);
        return;
    }

    element.setAttribute(ATTRIBUTE, STEPS[record.step]);
    window.setTimeout(() => advance(element), STEP_MS);
}

function onScroll(event: Event): void {
    // A document-level scroll reports the document as its target, but the scrollbar
    // it draws belongs to the root element.
    const element = event.target instanceof Element ? event.target : document.scrollingElement;
    if (!element) {
        return;
    }

    const record = tracked.get(element);
    if (!record) {
        element.setAttribute(ATTRIBUTE, STEPS[0]);
        tracked.set(element, { step: 0, holdUntil: performance.now() + HOLD_MS });
        window.setTimeout(() => advance(element), HOLD_MS);
        return;
    }

    record.holdUntil = performance.now() + HOLD_MS;
    if (record.step > 0) {
        // Caught mid-fade: back to full strength.
        record.step = 0;
        element.setAttribute(ATTRIBUTE, STEPS[0]);
    }
}

let installed = false;

/**
 * Start following scroll events.
 *
 * Idempotent, and safe to call before anything has rendered — the listener sits on
 * the document, not on any particular scroller. Call it early: until it runs, the
 * stylesheet's default of "no thumb" is all there is.
 */
export function installScrollbarAutoHide(): void {
    if (installed) {
        return;
    }
    installed = true;
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
}

/** Test seam: the timings the fade is built from. */
export const SCROLLBAR_AUTO_HIDE_TIMING = { attribute: ATTRIBUTE, steps: STEPS, holdMs: HOLD_MS, stepMs: STEP_MS } as const;
