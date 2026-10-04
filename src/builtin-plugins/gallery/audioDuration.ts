/**
 * How long a picked clip is, read once when it is added to the gallery.
 *
 * A track's length is what its row shows in the editor and what `durationSec` hands an EXTRA screen,
 * and nothing about an audio asset records it: the asset record carries a name and a hash, not a
 * length. So it is measured at the moment a clip is imported, the one time the gallery has the file
 * in hand, and stored with the variant from then on.
 *
 * Measured from the container header rather than by decoding: a media element reports `duration`
 * at `loadedmetadata`. Best-effort throughout - a format this shell cannot parse, a stream with no
 * length in its header, or a read that takes too long all give `null`, and the track is stored
 * without a length exactly as before. Plugins cannot import Studio's own helper for this, which is
 * why the gallery carries its own.
 */

import type { Asset, PluginApp } from "narraleaf-studio/plugin";

/** Give up rather than hold an import of many tracks open on one unreadable file. */
const METADATA_TIMEOUT_MS = 5000;

/** Reads a clip's length in seconds, or `null` when it cannot be known. */
export type GalleryAudioLengthReader = (asset: Asset) => Promise<number | null>;

/**
 * The slice of a media element the measurement touches, so a test can stand one in. The handlers
 * take `never[]` so a real element's `(event) => any` handlers fit the same slot as a bare callback.
 */
export type MediaMetadataElement = {
    preload: string;
    src: string;
    readonly duration: number;
    onloadedmetadata: ((...args: never[]) => unknown) | null;
    onerror: ((...args: never[]) => unknown) | null;
};

/**
 * The length a media element reports for `url` once it has read the header.
 *
 * `Infinity` - what a stream with no length in its header reports - and anything not a positive
 * number count as unknown.
 */
export function readMediaDuration(
    url: string,
    createElement: () => MediaMetadataElement,
    timeoutMs = METADATA_TIMEOUT_MS,
): Promise<number | null> {
    const element = createElement();
    return new Promise<number | null>(resolve => {
        const finish = (value: number | null) => {
            clearTimeout(timer);
            element.onloadedmetadata = null;
            element.onerror = null;
            // Let go of the file: the element would otherwise keep the object URL loaded.
            element.src = "";
            resolve(value);
        };
        const timer = setTimeout(() => finish(null), timeoutMs);
        element.onloadedmetadata = () => {
            const duration = element.duration;
            finish(Number.isFinite(duration) && duration > 0 ? duration : null);
        };
        element.onerror = () => finish(null);
        element.preload = "metadata";
        element.src = url;
    });
}

/** Measures a picked audio asset through a short-lived object URL of its bytes. */
export function createAudioLengthReader(app: PluginApp): GalleryAudioLengthReader {
    return async asset => {
        if (typeof Audio !== "function") {
            return null;
        }
        let url: string;
        try {
            url = await app.services.assets.createObjectUrl(asset);
        } catch {
            return null;
        }
        try {
            return await readMediaDuration(url, () => new Audio());
        } finally {
            app.services.assets.revokeObjectUrl(url);
        }
    };
}
