/**
 * Saving the frame on screen as an image asset - the one thing the video preview writes.
 *
 * What it is for: a poster for an `nl.video` element (the picture shown before the clip starts), a
 * gallery thumbnail, a still to hold on after the clip ends. All three want the exact frame at the
 * clip's own resolution, which a screenshot of the preview cannot give.
 */

/** The picture currently shown by `video`, as PNG bytes at the clip's own size. */
export async function captureVideoFrame(video: HTMLVideoElement): Promise<Uint8Array | null> {
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) {
        return null;
    }
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) {
        return null;
    }
    context.drawImage(video, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    return new Uint8Array(await blob.arrayBuffer());
}

/**
 * The file name a captured frame is saved under: the clip's name and the time it was taken at,
 * `opening_0m03.240s.png`. Time rather than frame number, because the time is what the author sees
 * on the toolbar, and it is written without colons, which Windows refuses in a file name.
 */
export function frameCaptureName(assetName: string, ms: number): string {
    const stem = assetName.replace(/\.[^./\\]+$/, "").trim() || "frame";
    const total = Math.max(0, Math.round(ms));
    const minutes = Math.floor(total / 60_000);
    const seconds = Math.floor((total % 60_000) / 1000);
    const millis = total % 1000;
    return `${stem}_${minutes}m${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}s.png`;
}
