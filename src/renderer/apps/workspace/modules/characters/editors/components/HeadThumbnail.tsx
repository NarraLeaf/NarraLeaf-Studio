import { cn } from "@/lib/utils/cn";
import { NormalizedCrop, peekHeadCrop, resolveHeadCrop } from "@/lib/utils/headCrop";
import { Image as ImageIcon } from "lucide-react";
import React from "react";

type HeadThumbnailProps = {
    url: string | null | undefined;
    alt: string;
    /** Classes for the frame. Must describe a square box, or the crop will stretch. */
    className?: string;
    /** Size of the placeholder icon shown when there is no image. */
    iconClassName?: string;
    /**
     * Explicit framing rect (normalized 0–1). When provided, it is used verbatim and the automatic
     * head-crop detection is skipped — this is how an author-chosen portrait selection frames the image.
     */
    frame?: NormalizedCrop;
};

/**
 * `undefined` while the head is still being located, `null` once the image is
 * known to have no findable head — see `headCrop`.
 */
type CropState = {
    url: string | null | undefined;
    crop: NormalizedCrop | null | undefined;
};

function readCache(url: string | null | undefined): CropState {
    return { url, crop: url ? peekHeadCrop(url) : null };
}

/**
 * A character thumbnail framed on the head rather than on the middle of the
 * image, which on a full-body sprite is the waist.
 *
 * The crop is applied by positioning the original image inside the frame rather
 * than by re-encoding it, so the thumbnail stays sharp at any pixel density.
 */
export function HeadThumbnail({ url, alt, className, iconClassName, frame }: HeadThumbnailProps) {
    const [state, setState] = React.useState<CropState>(() => readCache(url));
    // An explicit frame is authoritative — the silhouette heuristic is only the fallback.
    const hasFrame = frame !== undefined;

    // Swapping the image has to drop the old crop in the same render that swaps
    // the `src`, or the new art paints a frame wearing the old one's framing.
    if (!hasFrame && state.url !== url) {
        setState(readCache(url));
    }

    React.useEffect(() => {
        if (hasFrame || !url || peekHeadCrop(url) !== undefined) return;

        let cancelled = false;
        void resolveHeadCrop(url).then(crop => {
            if (!cancelled) {
                setState({ url, crop });
            }
        });
        return () => {
            cancelled = true;
        };
    }, [url, hasFrame]);

    const crop = hasFrame ? frame : (state.url === url ? state.crop : undefined);
    return (
        <div className={cn("relative flex items-center justify-center overflow-hidden shrink-0", className)}>
            {url ? (
                <img
                    src={url}
                    alt={alt}
                    className={cn(
                        "transition-opacity duration-150",
                        // Held back until the head is located so the thumbnail
                        // does not visibly jump from centre-cropped to framed.
                        crop === undefined ? "opacity-0" : "opacity-100",
                        crop ? "absolute max-w-none" : "w-full h-full object-cover object-top",
                    )}
                    style={crop ? toFrameStyle(crop) : undefined}
                />
            ) : (
                <ImageIcon className={cn("text-fg-subtle", iconClassName ?? "w-5 h-5")} />
            )}
        </div>
    );
}

/** Scales and offsets the image so that `crop` exactly fills the square frame. */
function toFrameStyle(crop: NormalizedCrop): React.CSSProperties {
    return {
        width: `${100 / crop.w}%`,
        height: `${100 / crop.h}%`,
        left: `${(-crop.x / crop.w) * 100}%`,
        top: `${(-crop.y / crop.h) * 100}%`,
    };
}
