/**
 * The thumbnails along the video preview's timeline, decoded on demand.
 *
 * A second, hidden `<video>` over the same object URL does the decoding, so scrubbing the filmstrip
 * never moves the picture the author is looking at. The timeline asks for the frames its visible
 * tiles need, in the order it wants them; the decoder seeks to each in turn and keeps a small bitmap
 * of it. Asking again replaces the queue rather than adding to it, so zooming or scrolling past a
 * stretch of the clip abandons the frames nobody can see any more.
 *
 * Keys are times in milliseconds, snapped by the timeline to a grid (see {@link tileKeyStep}) so a
 * frame decoded at one zoom level is reused at the next rather than decoded again a few milliseconds
 * off.
 */

/** Frames kept at once. Each is a tile-sized bitmap; this many is a few tens of megabytes at most. */
const CACHE_LIMIT = 320;
/** A seek that has not landed by now is abandoned - the tile keeps its neighbour's frame. */
const SEEK_TIMEOUT_MS = 3000;
/** Side of the square the alpha check samples each decoded frame down to. */
const ALPHA_PROBE_SIZE = 16;

export class FilmstripDecoder {
    private readonly video: HTMLVideoElement;
    private readonly frames = new Map<number, ImageBitmap>();
    private queue: number[] = [];
    private pumping = false;
    private disposed = false;
    private alphaFound = false;
    private readonly ready: Promise<boolean>;

    /**
     * @param onFrame called after each frame lands, so the timeline can repaint.
     * @param onAlpha called once, the first time a decoded frame turns out to have transparent pixels.
     */
    constructor(
        url: string,
        host: Document,
        private readonly tileHeight: number,
        private readonly onFrame: () => void,
        private readonly onAlpha: () => void,
    ) {
        const video = host.createElement("video");
        video.muted = true;
        video.preload = "auto";
        video.playsInline = true;
        // Attached where nothing can see it: some builds refuse to decode a frame for an element
        // that was never in the document (the asset thumbnailer does the same).
        video.style.position = "fixed";
        video.style.left = "-10000px";
        video.style.width = "1px";
        video.style.height = "1px";
        video.style.pointerEvents = "none";
        host.body.appendChild(video);
        this.video = video;
        this.ready = new Promise(resolve => {
            const done = (ok: boolean) => {
                video.removeEventListener("loadeddata", onLoaded);
                video.removeEventListener("error", onError);
                resolve(ok);
            };
            const onLoaded = () => done(true);
            const onError = () => done(false);
            video.addEventListener("loadeddata", onLoaded);
            video.addEventListener("error", onError);
        });
        video.src = url;
        video.load();
    }

    /** The frame decoded for `key`, if there is one. */
    frameAt(key: number): ImageBitmap | undefined {
        const frame = this.frames.get(key);
        if (frame) {
            // Refresh its place in the eviction order.
            this.frames.delete(key);
            this.frames.set(key, frame);
        }
        return frame;
    }

    /** The decoded frame nearest `key`, to stand in while `key` itself is still coming. */
    nearestFrame(key: number): ImageBitmap | undefined {
        let best: ImageBitmap | undefined;
        let bestDistance = Infinity;
        for (const [candidate, frame] of this.frames) {
            const distance = Math.abs(candidate - key);
            if (distance < bestDistance) {
                bestDistance = distance;
                best = frame;
            }
        }
        return best;
    }

    /** Replace what is wanted, in priority order. Frames already decoded are skipped. */
    request(keys: readonly number[]): void {
        this.queue = keys.filter(key => !this.frames.has(key));
        void this.pump();
    }

    dispose(): void {
        this.disposed = true;
        this.queue = [];
        for (const frame of this.frames.values()) {
            frame.close();
        }
        this.frames.clear();
        this.video.removeAttribute("src");
        this.video.load();
        this.video.remove();
    }

    private async pump(): Promise<void> {
        if (this.pumping) {
            return;
        }
        this.pumping = true;
        try {
            if (!(await this.ready)) {
                return;
            }
            while (!this.disposed && this.queue.length > 0) {
                const key = this.queue.shift()!;
                if (this.frames.has(key)) {
                    continue;
                }
                const frame = await this.decode(key);
                if (this.disposed) {
                    frame?.close();
                    return;
                }
                if (frame) {
                    this.frames.set(key, frame);
                    this.evict();
                    this.onFrame();
                }
            }
        } finally {
            this.pumping = false;
        }
    }

    private evict(): void {
        while (this.frames.size > CACHE_LIMIT) {
            const oldest = this.frames.keys().next().value;
            if (oldest === undefined) {
                return;
            }
            this.frames.get(oldest)?.close();
            this.frames.delete(oldest);
        }
    }

    private async decode(key: number): Promise<ImageBitmap | null> {
        const video = this.video;
        const landed = await new Promise<boolean>(resolve => {
            const timer = window.setTimeout(() => finish(false), SEEK_TIMEOUT_MS);
            const finish = (ok: boolean) => {
                window.clearTimeout(timer);
                video.removeEventListener("seeked", onSeeked);
                video.removeEventListener("error", onError);
                resolve(ok);
            };
            const onSeeked = () => finish(true);
            const onError = () => finish(false);
            video.addEventListener("seeked", onSeeked);
            video.addEventListener("error", onError);
            video.currentTime = Math.max(0, Math.min(video.duration || 0, key / 1000));
        });
        if (!landed || !video.videoWidth || !video.videoHeight) {
            return null;
        }
        const height = Math.max(1, Math.round(this.tileHeight));
        const width = Math.max(1, Math.round((height * video.videoWidth) / video.videoHeight));
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext("2d");
        if (!context) {
            return null;
        }
        context.drawImage(video, 0, 0, width, height);
        if (!this.alphaFound && this.hasTransparency(video)) {
            this.alphaFound = true;
            this.onAlpha();
        }
        try {
            return await createImageBitmap(canvas);
        } catch {
            return null;
        }
    }

    /**
     * Whether this frame has pixels that are not fully opaque.
     *
     * Read off the picture rather than the file, because Chromium composites a VP8/VP9 alpha plane
     * that the container only records as a tag, and a frame that draws with holes in it is the fact
     * the preview needs - whatever the file claims.
     */
    private hasTransparency(video: HTMLVideoElement): boolean {
        const canvas = new OffscreenCanvas(ALPHA_PROBE_SIZE, ALPHA_PROBE_SIZE);
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) {
            return false;
        }
        context.drawImage(video, 0, 0, ALPHA_PROBE_SIZE, ALPHA_PROBE_SIZE);
        const { data } = context.getImageData(0, 0, ALPHA_PROBE_SIZE, ALPHA_PROBE_SIZE);
        for (let index = 3; index < data.length; index += 4) {
            if (data[index] < 250) {
                return true;
            }
        }
        return false;
    }
}

/** Grid steps a tile's time may snap to, in milliseconds. */
const KEY_STEPS = [10, 20, 40, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10_000, 30_000, 60_000, 120_000, 300_000];

/**
 * The grid tile times snap to at a given tile length: the finest step no shorter than a quarter of a
 * tile. Coarse enough that a small zoom lands on the same keys (and the cached frames), fine enough
 * that no tile shows a frame visibly away from the time under its left edge.
 */
export function tileKeyStep(tileMs: number): number {
    return KEY_STEPS.find(step => step >= tileMs / 4) ?? KEY_STEPS[KEY_STEPS.length - 1];
}
