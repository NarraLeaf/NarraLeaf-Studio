import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    getVideoPreviewRestartGeneration,
    isVideoPreviewPlaying,
    releaseVideoPreviewPlayback,
    requestVideoPreviewRestart,
    resetVideoPreviewPlayback,
    setVideoPreviewPlaying,
    subscribeVideoPreviewPlayback,
} from "./videoPreviewPlayback";

/**
 * The store is module-level, so every test starts by emptying it.
 *
 * These cover the one invariant the author actually sees: a Surface opens paused. That is a user
 * ruling, and until `releaseVideoPreviewPlayback` existed nothing implemented it — the module's own
 * comment claimed a teardown caller that was never written, so a `playing` id entered on the first
 * Play and stayed for the rest of the session.
 */
beforeEach(() => {
    resetVideoPreviewPlayback();
});

describe("releaseVideoPreviewPlayback", () => {
    it("forgets one widget and leaves its neighbours playing", () => {
        setVideoPreviewPlaying("video-a", true);
        setVideoPreviewPlaying("video-b", true);
        requestVideoPreviewRestart("video-a");

        releaseVideoPreviewPlayback("video-a");

        // Reopening the Surface remounts the renderer, which reads the store fresh: paused, and its
        // restart counter back at zero rather than carrying a stale generation that would rewind the
        // new node on its first render.
        expect(isVideoPreviewPlaying("video-a")).toBe(false);
        expect(getVideoPreviewRestartGeneration("video-a")).toBe(0);
        expect(isVideoPreviewPlaying("video-b")).toBe(true);
    });

    it("notifies subscribers, so a docker bar rendered for the survivor is not left stale", () => {
        setVideoPreviewPlaying("video-a", true);
        const listener = vi.fn();
        const unsubscribe = subscribeVideoPreviewPlayback(listener);

        releaseVideoPreviewPlayback("video-a");
        expect(listener).toHaveBeenCalledTimes(1);

        // Releasing something the store never held is not a change, and must not wake every
        // subscribed widget on the canvas.
        releaseVideoPreviewPlayback("video-never-played");
        expect(listener).toHaveBeenCalledTimes(1);

        unsubscribe();
    });

    it("keeps the store from growing for the lifetime of the session", () => {
        for (let index = 0; index < 50; index++) {
            const id = `video-${index}`;
            setVideoPreviewPlaying(id, true);
            requestVideoPreviewRestart(id);
            // What an unmount does — a Surface switch, a closed tab, a deleted element.
            releaseVideoPreviewPlayback(id);
        }

        // Nothing is retained, so fifty visits to a Surface cost the same as one.
        for (let index = 0; index < 50; index++) {
            expect(isVideoPreviewPlaying(`video-${index}`)).toBe(false);
            expect(getVideoPreviewRestartGeneration(`video-${index}`)).toBe(0);
        }
    });
});
