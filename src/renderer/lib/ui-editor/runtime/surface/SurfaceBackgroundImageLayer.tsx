import type { CSSProperties } from "react";
import type { UISurface } from "@shared/types/ui-editor/document";
import { useAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";
import { getSurfaceBackgroundImage, surfaceBackgroundImageStyle } from "@/lib/ui-editor/runtime/surfaceBackground";

/**
 * The Surface's background picture, as its own layer under the element tree.
 *
 * Mounted by everything that paints a Surface's design box - the editor canvas, the page thumbnails,
 * the runtime page stack, a nested Surface inside a frame widget - so that all of them agree on what
 * a background is without each one resolving the asset itself.
 *
 * Sized to the design box rather than to the window: the picture is authored against the design
 * size, so it is the one thing that must scale exactly the way the widgets over it do. The bars a
 * letterboxed page leaves outside that box keep the background colour, which is painted a level up.
 *
 * First child, absolutely positioned, no z-index: the element tree that follows paints over it by
 * document order. Giving this a stacking index instead would put it in a fight with widget effects.
 */
export function SurfaceBackgroundImageLayer({
    surface,
    opacity = 1,
}: {
    surface: UISurface;
    /** Thins the picture for a page presented over a running game. */
    opacity?: number;
}) {
    const background = getSurfaceBackgroundImage(surface);
    const { url } = useAssetObjectUrl(background?.assetId ?? null);
    if (!background || !url) {
        return null;
    }

    const style: CSSProperties = {
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        ...surfaceBackgroundImageStyle(url, background.fillMode),
        ...(opacity < 1 ? { opacity } : {}),
    };
    return <div aria-hidden="true" data-ui-surface-background-image={background.fillMode} style={style} />;
}
