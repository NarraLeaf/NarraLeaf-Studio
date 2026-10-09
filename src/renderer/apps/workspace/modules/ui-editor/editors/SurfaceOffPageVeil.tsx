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
 *
 * Under a wallpaper the canvas is clear and the veil is drawn in the window's base colour instead
 * (`.nl-off-page-veil` in styles.css), so what lies past the edge is the wallpaper, dimmed, rather
 * than a black frame cut into it.
 */
export function SurfaceOffPageVeil({ designSize }: { designSize: Size }) {
    const bands = computeOffPageVeilBands(designSize);
    return (
        <div className="pointer-events-none absolute inset-0 z-[3]" aria-hidden="true" data-off-page-veil="">
            {bands.map((band, index) => (
                <div
                    key={index}
                    className="nl-off-page-veil absolute bg-surface-canvas/70"
                    style={{ left: band.left, top: band.top, width: band.width, height: band.height }}
                />
            ))}
        </div>
    );
}

/**
 * The stage under the page, drawn only under a wallpaper. Without one the canvas is the stage colour
 * already; with one the canvas is clear, and a page that leaves parts of itself transparent (a Game UI
 * surface, a page with no background) would show the wallpaper there, which the player never sees.
 * So the page's own rectangle keeps the colour the game puts behind it.
 *
 * Mount inside the transformed canvas node, first, under the reference layers and the page.
 */
export function SurfaceStageBacking({ designSize }: { designSize: Size }) {
    return (
        <div
            className="nl-stage-backing pointer-events-none absolute left-0 top-0"
            style={{ width: designSize.width, height: designSize.height }}
            aria-hidden="true"
        />
    );
}
