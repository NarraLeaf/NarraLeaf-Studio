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
 * A character thumbnail framed on the head rather than on the middle of the
 * image, which on a full-body sprite is the waist.
 *
 * The crop is applied by positioning the original image inside the frame rather
 * than by re-encoding it, so the thumbnail stays sharp at any pixel density.
 */
export function HeadThumbnail({ url, alt, className, iconClassName, frame }: HeadThumbnailProps) {
    // An explicit frame is authoritative — the silhouette heuristic is only the fallback.
    const hasFrame = frame !== undefined;
    // The crop is read live from the shared cache below; this bump only forces a re-render once this
    // component's own async resolution finishes. Reading the cache directly (rather than mirroring it
    // into state) means a crop already warmed by another thumbnail — or one that lands while an
    // explicit frame is showing — is picked up immediately, instead of leaving the image stuck at
    // opacity-0 when a frame is later removed and the effect short-circuits on the cache hit.
    const [, bump] = React.useReducer((n: number) => n + 1, 0);

    React.useEffect(() => {
        if (hasFrame || !url || peekHeadCrop(url) !== undefined) return;

        let cancelled = false;
        void resolveHeadCrop(url).then(() => {
            if (!cancelled) {
                bump();
            }
        });
        return () => {
            cancelled = true;
        };
    }, [url, hasFrame]);

    const crop = hasFrame ? frame : (url ? peekHeadCrop(url) : null);
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
