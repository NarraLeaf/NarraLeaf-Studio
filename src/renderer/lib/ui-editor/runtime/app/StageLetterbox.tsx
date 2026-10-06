import type { CSSProperties } from "react";
import { useAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";
import {
    normalizeLetterboxConfiguration,
    type LetterboxConfiguration,
    type LetterboxFillMode,
} from "@shared/types/letterbox";

/**
 * The CSS that lays a letterbox picture across the window.
 *
 * Every mode is centred, `tile` included (a surface background tiles from its top left): the stage
 * sits in the middle of the window, so a centred tiling puts the same seam the same distance from it
 * on both sides and the two bars mirror each other.
 */
export function letterboxImageStyle(url: string, fillMode: LetterboxFillMode): CSSProperties {
    const base: CSSProperties = {
        backgroundImage: `url("${url.replace(/["\\]/g, "\\$&")}")`,
        backgroundPosition: "center",
    };
    if (fillMode === "tile") {
        return { ...base, backgroundRepeat: "repeat", backgroundSize: "auto" };
    }
    return {
        ...base,
        backgroundRepeat: "no-repeat",
        backgroundSize: fillMode === "stretch" ? "100% 100%" : "cover",
    };
}

/**
 * The project's letterbox: the colour and picture around the stage, for `StageViewportFrame`'s
 * `backdrop`.
 *
 * Covers the whole frame and leaves the middle to the stage, which paints over it - so the picture
 * is one continuous image across both bars, the way a player sees it, rather than two crops.
 *
 * The colour is painted whether or not a picture is set, and goes on showing while the picture loads
 * or if it never does: a picture that cannot be found leaves the author's colour, not a black that
 * nobody chose. `useAssetObjectUrl` is the shared hook, so this resolves through the pack in a built
 * game and through the window's own map in Dev Mode.
 */
export function StageLetterbox({ config }: { config: LetterboxConfiguration | undefined }) {
    const letterbox = normalizeLetterboxConfiguration(config);
    const { url } = useAssetObjectUrl(letterbox.image?.assetId ?? null);
    const style: CSSProperties = {
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        backgroundColor: letterbox.color,
        ...(letterbox.image && url ? letterboxImageStyle(url, letterbox.image.fillMode) : {}),
    };
    return <div aria-hidden="true" data-stage-letterbox={letterbox.image?.fillMode ?? ""} style={style} />;
}
