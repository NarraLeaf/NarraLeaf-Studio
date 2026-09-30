import { useCallback, useEffect, useRef, useState } from "react";
import type { SampleRange } from "../audio/audioClip";

/** Overrides for one run, for auditions that are not the transport's own play button. */
export interface VideoPlayOptions {
    /** Loop this run whatever the transport's repeat toggle says. */
    looping?: boolean;
    /**
     * Stop once playback has wrapped back to the start and reached this time, in milliseconds.
     *
     * Judged on the frames' own timestamps rather than a timer: starting a run costs a seek, and on a
     * busy machine a wall-clock stop cut the second half of a seam preview short by most of a second.
     */
    stopAfterWrapAt?: number;
}

/** What the sounding run is doing. Null while nothing plays. */
interface Run {
    /** Milliseconds; null plays to the end of the file. */
    range: SampleRange | null;
    looping: boolean;
    stopAfterWrapAt: number | null;
    wrapped: boolean;
    /** The last frame's time, to see the wrap by. */
    lastMs: number;
}

/**
 * Playback for the video preview, driven through the preview's own `<video>`.
 *
 * Unlike the audio preview this plays the file itself rather than decoded samples: the picture is
 * what is being inspected, and the element is the decoder the shipped game uses too. What the hook
 * adds on top is what the element does not do by itself - a range that loops or stops at its end,
 * a run that stops after a fixed time, and a position that follows the frames actually shown.
 *
 * **The position is the presented frame's own timestamp**, read from `requestVideoFrameCallback`,
 * rather than `currentTime`. After a seek `currentTime` is wherever the seek asked for, which is
 * usually the middle of a frame; the callback reports the frame the author is looking at. It is
 * also paced by the frames, so the playhead moves once per picture instead of once per display
 * refresh.
 *
 * Every time here is in milliseconds, the unit the timeline's view window counts in.
 */
export function useVideoTransport(video: HTMLVideoElement | null, onFrameInterval?: (seconds: number) => void) {
    const [playing, setPlaying] = useState(false);
    const [position, setPosition] = useState(0);
    const [loop, setLoop] = useState(false);
    const [rate, setRateState] = useState(1);
    /**
     * True when the last run stopped by reaching the end of what it was playing, rather than being
     * paused or seeked. The transport reads it to decide the next press means "play it again", as
     * the audio preview's does - from the end, "resume" would play nothing.
     */
    const [finished, setFinished] = useState(false);

    /**
     * The newest position, ahead of the render that shows it. Relative moves - a frame step, a
     * second's jump - start from here rather than from `position`, so a key held down steps from
     * where the last press went and not from a frame that has not landed yet.
     */
    const positionRef = useRef(0);
    const runRef = useRef<Run | null>(null);
    const intervalRef = useRef(onFrameInterval);
    intervalRef.current = onFrameInterval;

    const stop = useCallback(() => {
        runRef.current = null;
        if (video) {
            video.loop = false;
            video.pause();
        }
    }, [video]);

    const play = useCallback(
        (fromMs: number, range: SampleRange | null, options?: VideoPlayOptions) => {
            if (!video) {
                return;
            }
            const looping = options?.looping ?? loop;
            runRef.current = {
                range,
                looping,
                stopAfterWrapAt: options?.stopAfterWrapAt ?? null,
                wrapped: false,
                lastMs: Number.NEGATIVE_INFINITY,
            };
            // A whole-file loop is the element's own, which is how the game loops a clip too; a range
            // has no native form and is wrapped by hand in the frame callback below.
            video.loop = looping && !range;
            video.currentTime = Math.max(0, fromMs) / 1000;
            positionRef.current = Math.max(0, fromMs);
            setFinished(false);
            void video.play().catch(() => {
                runRef.current = null;
                setPlaying(false);
            });
        },
        [video, loop],
    );

    /** Move the playhead. Stops playback first: a seek is the author taking the clip in hand. */
    const seek = useCallback(
        (ms: number) => {
            if (!video) {
                return;
            }
            stop();
            setFinished(false);
            video.currentTime = Math.max(0, ms) / 1000;
            // Until the frame lands and the callback reports its own timestamp.
            positionRef.current = Math.max(0, ms);
            setPosition(positionRef.current);
        },
        [video, stop],
    );

    const setRate = useCallback(
        (next: number) => {
            setRateState(next);
            if (video) {
                video.playbackRate = next;
            }
        },
        [video],
    );

    // The toggle applies to the run in progress, the way the audio preview's does - except an
    // audition that brought its own looping and its own stop point.
    useEffect(() => {
        const run = runRef.current;
        if (!run || run.stopAfterWrapAt !== null) {
            return;
        }
        run.looping = loop;
        if (video) {
            video.loop = loop && !run.range;
        }
    }, [loop, video]);

    useEffect(() => {
        if (!video) {
            return;
        }
        video.playbackRate = rate;
        const onPlay = () => setPlaying(true);
        const onPause = () => setPlaying(false);
        const onEnded = () => {
            runRef.current = null;
            setPlaying(false);
            setFinished(true);
        };
        video.addEventListener("play", onPlay);
        video.addEventListener("pause", onPause);
        video.addEventListener("ended", onEnded);

        let handle = 0;
        let previous: { mediaTime: number; presentedFrames: number } | null = null;
        const onFrame: VideoFrameRequestCallback = (_now, metadata) => {
            const ms = metadata.mediaTime * 1000;
            // A frame presented while a newer seek is still under way is the old position arriving
            // late. Taking it would put the playhead back where the author has already left.
            if (!video.seeking) {
                positionRef.current = ms;
                setPosition(ms);
            }
            if (video.paused) {
                previous = null;
            } else {
                // Consecutive frames at normal speed are the one clean sample of the frame rate.
                if (previous && metadata.presentedFrames === previous.presentedFrames + 1 && video.playbackRate === 1) {
                    intervalRef.current?.(metadata.mediaTime - previous.mediaTime);
                }
                previous = { mediaTime: metadata.mediaTime, presentedFrames: metadata.presentedFrames };
                const run = runRef.current;
                if (run && run.stopAfterWrapAt !== null) {
                    // Only settled frames count: the one a seek lands on can start a hair before the
                    // time asked for, which would read as a step backwards.
                    if (!video.seeking) {
                        if (ms < run.lastMs) {
                            run.wrapped = true;
                        }
                        run.lastMs = ms;
                    }
                    if (run.wrapped && ms >= run.stopAfterWrapAt) {
                        runRef.current = null;
                        video.loop = false;
                        video.pause();
                    }
                } else if (run?.range && ms >= run.range.end) {
                    if (run.looping) {
                        video.currentTime = run.range.start / 1000;
                    } else {
                        runRef.current = null;
                        video.pause();
                        video.currentTime = run.range.end / 1000;
                        setFinished(true);
                    }
                }
            }
            handle = video.requestVideoFrameCallback(onFrame);
        };
        handle = video.requestVideoFrameCallback(onFrame);

        return () => {
            video.cancelVideoFrameCallback(handle);
            video.removeEventListener("play", onPlay);
            video.removeEventListener("pause", onPause);
            video.removeEventListener("ended", onEnded);
        };
        // `rate` is applied here only for a newly mounted element; `setRate` handles changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [video]);

    const currentPosition = useCallback(() => positionRef.current, []);

    return { playing, position, currentPosition, finished, loop, setLoop, rate, setRate, play, stop, seek };
}
