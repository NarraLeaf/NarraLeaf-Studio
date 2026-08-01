import { useCallback, useEffect, useRef, useState } from "react";
import { clipLength, type AudioClip } from "./audioClip";
import {
    playbackPosition,
    resolvePlaybackGeometry,
    type PlaybackGeometry,
    type PlayRange,
} from "./transport";

export type { PlayRange } from "./transport";

/**
 * Playback for the edited clip.
 *
 * An `<audio>` element cannot do this: it plays the *file*, and the whole point of the editor is
 * that what you hear is the current in-memory clip, including edits that were never written to
 * disk. So samples go straight into an `AudioBufferSourceNode`, which also gives exact range
 * playback and gapless looping of a selection for free.
 */
export function useClipPlayback(clip: AudioClip | null) {
    const contextRef = useRef<AudioContext | null>(null);
    const sourceRef = useRef<AudioBufferSourceNode | null>(null);
    const gainRef = useRef<GainNode | null>(null);
    const gainValueRef = useRef(1);
    /**
     * What the sounding run is doing, and the context time it started at.
     *
     * The same geometry the source node was armed with - see {@link PlaybackGeometry}. Null while
     * nothing is sounding.
     */
    const originRef = useRef<{ geometry: PlaybackGeometry; startedAt: number } | null>(null);
    const [playing, setPlaying] = useState(false);
    const [position, setPosition] = useState(0);
    const [loop, setLoop] = useState(false);
    /**
     * True when the last run ended by reaching the end of what it was playing, rather than being
     * stopped or seeked away from.
     *
     * Only a natural end fires `onended` - {@link stop} detaches the handler before stopping the
     * source - so this is exact, where inspecting the parked playhead would not be: the audio
     * clock stops on a frame boundary and leaves it a few hundred samples either side of the end.
     * The transport reads it to decide that the next press means "play it again" rather than
     * "resume", which from the end would play nothing.
     */
    const [finished, setFinished] = useState(false);

    const getContext = useCallback((): AudioContext => {
        if (!contextRef.current) {
            contextRef.current = new AudioContext();
        }
        if (!gainRef.current) {
            gainRef.current = contextRef.current.createGain();
            gainRef.current.gain.value = gainValueRef.current;
            gainRef.current.connect(contextRef.current.destination);
        }
        return contextRef.current;
    }, []);

    /** Monitoring volume only - it never touches the samples, so it is not an edit. */
    const setGain = useCallback((value: number) => {
        gainValueRef.current = value;
        if (gainRef.current) {
            gainRef.current.gain.value = value;
        }
    }, []);

    const stop = useCallback(() => {
        const source = sourceRef.current;
        sourceRef.current = null;
        // Nothing is sounding, so there is no geometry to read a playhead out of.
        originRef.current = null;
        if (source) {
            source.onended = null;
            try {
                source.stop();
            } catch {
                // Already stopped - nothing to unwind.
            }
            source.disconnect();
        }
        setPlaying(false);
        // Stopping is not finishing: a paused run resumes from where it was left.
        setFinished(false);
    }, []);

    /**
     * Move the playhead. Seeking clears {@link finished} - once the author has chosen a spot, the
     * next press plays from there, even if the previous run had run itself out.
     */
    const seek = useCallback((sample: number) => {
        setFinished(false);
        setPosition(sample);
    }, []);

    const play = useCallback(
        (from: number, range: PlayRange | null) => {
            if (!clip || clipLength(clip) === 0) {
                return;
            }
            stop();
            const context = getContext();
            void context.resume();
            const buffer = context.createBuffer(clip.channels.length, clipLength(clip), clip.sampleRate);
            for (let channel = 0; channel < clip.channels.length; channel++) {
                buffer.copyToChannel(clip.channels[channel] as Float32Array<ArrayBuffer>, channel);
            }
            const source = context.createBufferSource();
            source.buffer = buffer;
            source.connect(gainRef.current ?? context.destination);

            // Resolved once and used for both jobs below: arming the node, and reading the playhead
            // back out in the tick. Two derivations of the same thing is how they came apart.
            const geometry = resolvePlaybackGeometry({
                from,
                range,
                totalSamples: clipLength(clip),
                looping: loop,
            });
            source.loop = geometry.looping;
            // The turnaround, not the entry: starting before `loopStart` is the whole point of an
            // intro→loop, and Web Audio does exactly that - it plays from `offset` and wraps to
            // `loopStart` the first time it reaches `loopEnd`.
            source.loopStart = geometry.loopStart / clip.sampleRate;
            source.loopEnd = geometry.end / clip.sampleRate;

            const offsetSeconds = geometry.start / clip.sampleRate;
            const durationSeconds =
                !geometry.looping && geometry.end < clipLength(clip)
                    ? Math.max(0, (geometry.end - geometry.start) / clip.sampleRate)
                    : undefined;
            originRef.current = { geometry, startedAt: context.currentTime };
            source.onended = () => {
                if (sourceRef.current === source) {
                    sourceRef.current = null;
                    setPlaying(false);
                    // Reached here on its own: `stop` detaches this handler, so nothing else can.
                    setFinished(true);
                }
            };
            if (durationSeconds === undefined) {
                source.start(0, offsetSeconds);
            } else {
                source.start(0, offsetSeconds, durationSeconds);
            }
            sourceRef.current = source;
            setPlaying(true);
            setFinished(false);
            setPosition(geometry.start);
        },
        [clip, getContext, loop, stop],
    );

    // Track the playhead while playing. Driven by the audio clock (not a timer count) so it stays
    // true even when frames are dropped, and folded through the run's own geometry so the line
    // wraps where the audio wraps - to the loop point, not to the head of the file.
    useEffect(() => {
        if (!playing || !clip) {
            return;
        }
        let frame = 0;
        const tick = () => {
            const context = contextRef.current;
            const origin = originRef.current;
            if (context && origin) {
                const elapsed = context.currentTime - origin.startedAt;
                setPosition(playbackPosition(origin.geometry, elapsed * clip.sampleRate));
            }
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [playing, clip]);

    // Editing the clip invalidates whatever is currently sounding.
    useEffect(() => stop, [clip, stop]);

    useEffect(() => {
        return () => {
            stop();
            void contextRef.current?.close();
            contextRef.current = null;
        };
    }, [stop]);

    return { playing, position, setPosition: seek, finished, loop, setLoop, play, stop, setGain };
}
