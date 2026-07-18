import { useCallback, useEffect, useRef, useState } from "react";
import { clipLength, type AudioClip, type SampleRange } from "./audioClip";

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
    /** Sample the current playback started from, and the context time it started at. */
    const originRef = useRef({ sample: 0, startedAt: 0 });
    const [playing, setPlaying] = useState(false);
    const [position, setPosition] = useState(0);
    const [loop, setLoop] = useState(false);

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

    /** Monitoring volume only — it never touches the samples, so it is not an edit. */
    const setGain = useCallback((value: number) => {
        gainValueRef.current = value;
        if (gainRef.current) {
            gainRef.current.gain.value = value;
        }
    }, []);

    const stop = useCallback(() => {
        const source = sourceRef.current;
        sourceRef.current = null;
        if (source) {
            source.onended = null;
            try {
                source.stop();
            } catch {
                // Already stopped — nothing to unwind.
            }
            source.disconnect();
        }
        setPlaying(false);
    }, []);

    const play = useCallback(
        (from: number, range: SampleRange | null) => {
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

            const start = Math.max(0, Math.min(clipLength(clip) - 1, from));
            if (range && range.end > range.start) {
                source.loop = loop;
                source.loopStart = range.start / clip.sampleRate;
                source.loopEnd = range.end / clip.sampleRate;
            } else {
                source.loop = loop;
                source.loopStart = 0;
                source.loopEnd = clipLength(clip) / clip.sampleRate;
            }

            const offsetSeconds = start / clip.sampleRate;
            const durationSeconds =
                range && range.end > range.start && !loop
                    ? Math.max(0, (range.end - start) / clip.sampleRate)
                    : undefined;
            originRef.current = { sample: start, startedAt: context.currentTime };
            source.onended = () => {
                if (sourceRef.current === source) {
                    sourceRef.current = null;
                    setPlaying(false);
                }
            };
            if (durationSeconds === undefined) {
                source.start(0, offsetSeconds);
            } else {
                source.start(0, offsetSeconds, durationSeconds);
            }
            sourceRef.current = source;
            setPlaying(true);
            setPosition(start);
        },
        [clip, getContext, loop, stop],
    );

    // Track the playhead while playing. Driven by the audio clock (not a timer count) so it stays
    // true even when frames are dropped.
    useEffect(() => {
        if (!playing || !clip) {
            return;
        }
        let frame = 0;
        const tick = () => {
            const context = contextRef.current;
            if (context) {
                const elapsed = context.currentTime - originRef.current.startedAt;
                const total = clipLength(clip);
                const raw = originRef.current.sample + elapsed * clip.sampleRate;
                setPosition(total > 0 ? raw % total : 0);
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

    return { playing, position, setPosition, loop, setLoop, play, stop, setGain };
}
