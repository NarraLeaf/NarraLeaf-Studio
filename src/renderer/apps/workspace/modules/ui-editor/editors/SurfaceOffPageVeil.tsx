type Size = { width: number; height: number };
type Band = { left: number; top: number; width: number; height: number };

/**
 * How far past the page the veil reaches, in design pixels. At the canvas's smallest zoom (0.1) this
 * is ten thousand screen pixels to every side, wider than any window the editor is drawn in.
 */
export const OFF_PAGE_VEIL_REACH = 100_000;

/**
 * The four bands that cover everything outside the design rect: a full-width strip above and below,
 * and the page's height to the left and right, so no corner is covered twice.
 */
export function computeOffPageVeilBands(designSize: Size, reach: number = OFF_PAGE_VEIL_REACH): Band[] {
    const { width, height } = designSize;
    return [
        { left: -reach, top: -reach, width: width + reach * 2, height: reach },
        { left: -reach, top: height, width: width + reach * 2, height: reach },
        { left: -reach, top: 0, width: reach, height },
        { left: width, top: 0, width: reach, height },
    ];
}

/**
 * Fades whatever lies outside the page on the editing canvas.
 *
 * The canvas draws the page without clipping it, so an element moved past the edge is still there to
 * see, click and drag back - clipped, it vanished and nothing on the canvas could reach it again. The
 * player's screen does end at the edge, so what lies beyond is drawn under this veil in the canvas's
 * own colour: visible, and visibly not on the page.
 *
 * Mount inside the transformed canvas node, after the page and under the reference frames; it is
 * positioned in design pixels and takes no pointer events, so a press goes through to the element.
 */
export function SurfaceOffPageVeil({ designSize }: { designSize: Size }) {
    const bands = computeOffPageVeilBands(designSize);
    return (
        <div className="pointer-events-none absolute inset-0 z-[3]" aria-hidden="true" data-off-page-veil="">
            {bands.map((band, index) => (
                <div
                    key={index}
                    className="absolute bg-surface-canvas/70"
                    style={{ left: band.left, top: band.top, width: band.width, height: band.height }}
                />
            ))}
        </div>
    );
}
