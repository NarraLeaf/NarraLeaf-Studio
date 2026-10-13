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
    // The picture's own size, read once it loads. A framing is normalized to the picture, so whether
    // it is square - and how to fit it when it is not - is only known in its pixels.
    const [natural, setNatural] = React.useState<{ url: string; width: number; height: number } | null>(null);
    const size = natural && natural.url === url ? natural : null;
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
    const recordSize = (event: React.SyntheticEvent<HTMLImageElement>) => {
        const image = event.currentTarget;
        if (url && image.naturalWidth > 0 && image.naturalHeight > 0) {
            setNatural({ url, width: image.naturalWidth, height: image.naturalHeight });
        }
    };
    return (
        <div className={cn("relative flex items-center justify-center overflow-hidden shrink-0", className)}>
            {url ? (
                <img
                    src={url}
                    alt={alt}
                    onLoad={recordSize}
                    className={cn(
                        "transition-opacity duration-150",
                        // Held back until the head is located, and a framing until the picture's size
                        // is known, so the thumbnail does not visibly jump into place.
                        crop === undefined || (crop && !size) ? "opacity-0" : "opacity-100",
                        crop ? "absolute max-w-none" : "w-full h-full object-cover object-top",
                    )}
                    style={crop && size ? toFrameStyle(crop, size) : undefined}
                />
            ) : (
                <ImageIcon className={cn("text-fg-subtle", iconClassName ?? "w-5 h-5")} />
            )}
        </div>
    );
}

/**
 * Scales and offsets the image so that `crop` fits the square frame the way the avatar bake fits it:
 * one scale for both axes, the crop's long side across the frame, the short side centred. A square
 * crop fills the frame exactly. A crop that is not square in the picture's pixels used to be
 * stretched to the square, so the editor's avatar was taller or wider than the one the game shows.
 */
function toFrameStyle(crop: NormalizedCrop, size: { width: number; height: number }): React.CSSProperties {
    const cropWidth = crop.w * size.width;
    const cropHeight = crop.h * size.height;
    const long = Math.max(cropWidth, cropHeight);
    return {
        width: `${(size.width / long) * 100}%`,
        height: `${(size.height / long) * 100}%`,
        left: `${(((long - cropWidth) / 2 - crop.x * size.width) / long) * 100}%`,
        top: `${(((long - cropHeight) / 2 - crop.y * size.height) / long) * 100}%`,
    };
}
