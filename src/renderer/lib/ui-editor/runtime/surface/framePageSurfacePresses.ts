/**
 * Where a press on a frame's page lands, for that page's own Surface `Mouse Click` and `Right Click`.
 *
 * A page shown in a Page widget (`nl.frame`) is a live page with a blueprint of its own, and its
 * Surface heads say "any click on this page". They were never asked: a top-level page hears its
 * clicks on the shell `GameSurfaceRenderer` draws it in, and a frame draws its pages without one, so
 * the press went past the page to the surface holding the frame, which answered it alone.
 *
 * The page now answers first and the press goes on to the surface around it, as a press on an
 * element goes on to every element above it: a head asks for a press, it does not take it. The
 * surface holding the frame keeps hearing every click inside the frame, as it always has, because
 * the frame is part of that surface.
 *
 * A page takes a press where one of its elements is drawn, as a page on the screen does (its empty
 * areas let the press through, see `SurfaceStackBox`). In a frame the press on an empty area does
 * not fall through to anything new - it lands on the frame - so it is the frame's, not the page's.
 *
 * Comments in English per project convention.
 */

const UI_ELEMENT_ID_SELECTOR = "[data-ui-element-id]";

type PressEvent = {
    target: EventTarget | null;
    currentTarget: Element;
    clientX: number;
    clientY: number;
};

/**
 * The press in the page's design space, or null when it did not land on one of the page's elements.
 *
 * `currentTarget` is the box the frame draws the page in, which shows the page's whole design size
 * however the frame has fitted it.
 */
export function framePagePressPoint(
    event: PressEvent,
    designSize: { width: number; height: number },
): { x: number; y: number } | null {
    const target = event.target;
    const targetElement = typeof Element !== "undefined" && target instanceof Element
        ? target
        : (target as Node | null)?.parentElement ?? null;
    const owner = targetElement?.closest(UI_ELEMENT_ID_SELECTOR) ?? null;
    if (!owner || !event.currentTarget.contains(owner)) {
        return null;
    }
    const box = event.currentTarget.getBoundingClientRect();
    const scaleX = box.width > 0 ? designSize.width / box.width : 1;
    const scaleY = box.height > 0 ? designSize.height / box.height : 1;
    return {
        x: (event.clientX - box.left) * scaleX,
        y: (event.clientY - box.top) * scaleY,
    };
}
