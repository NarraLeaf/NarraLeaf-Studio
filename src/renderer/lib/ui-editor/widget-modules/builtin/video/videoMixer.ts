/**
 * Routes the `nl.video` widget's sound through the player's mixer.
 *
 * The widget used to write `videoProps.volume` straight onto the DOM element, which meant the clip
 * answered to no player setting at all: muting the game, dropping the master slider or pulling BGM
 * to zero left the video blaring at whatever the author typed. The element sits outside the engine's
 * audio graph, so nothing was ever going to apply those for it.
 *
 * **Why the volume is multiplied here rather than routed into a gain node.** The obvious fix is
 * `AudioContext.createMediaElementSource(video)` into the engine's channel gain node - volume, mute
 * and fades then come for free. Two things rule it out:
 *
 * 1. There is no legitimate way to reach the node. `AudioManager` keeps its channels in a
 *    TypeScript-`private` `channels` map, and the `@narraleaf/sound` `Channel` it holds does not
 *    expose its `GainNode` either. Reaching it means two layers of private-field access into a
 *    dependency, in a place that is not already a documented shim.
 * 2. `createMediaElementSource` may be called **once per element**, and it permanently detaches the
 *    element from normal output. This widget genuinely remounts: `GameSurfaceRenderer` re-keys a
 *    surface on open/close, the editor canvas re-renders it on every prop edit, and the `<video>`
 *    node itself is remounted whenever `sourceUrl` resolves. A second call on a reused element
 *    throws `InvalidStateError`; a first call on an element whose React tree is then discarded
 *    leaves a dangling source node and a silent video. That is a latent bug that would surface as
 *    "the OP movie is silent sometimes", which is worse than the defect being fixed.
 *
 * So: compute the same product the engine's gain nodes would have produced and write it to
 * `element.volume`. With a bus tree that is a **chain walk**, not one channel lookup: the clip's
 * authored volume, times every bus between its track and the master output, times the player's
 * slider for whichever seeded bus the chain runs through, times master. A clip on `voice/alice` is
 * therefore governed by both the Alice fader and Voice Volume without this module naming either.
 * The host does the walk (`resolveMixedElementVolume`, behind `hostApi.sound.resolveElementVolume`)
 * because it is the side that holds the track list; the subscription below is what keeps the result
 * honest while the player is dragging a slider - including a bus slider, which fans in through the
 * same listener set as the preferences.
 *
 * Comments in English per project convention.
 */

import { useEffect, useState } from "react";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";

/** The slice of the blueprint host API this needs; kept structural so tests can hand in a stub. */
export type VideoMixerHost = {
    resolveElementVolume: (input: { audioTrackId?: string | null; volume?: number | null }) => number;
    subscribeMixerChanges: (listener: () => void) => () => void;
};

/**
 * The mixer seam of the host this widget is rendering under, or `null` on the editor canvas.
 *
 * `blueprintRuntime` is the same signal the renderer already uses to tell a live host from the
 * canvas; the extra `resolveElementVolume` check covers a host built by an older code path that
 * predates the method, where falling back to the authored volume is the right answer.
 */
export function resolveVideoMixerHost(hostAdapter: UIHostAdapter): VideoMixerHost | null {
    const sound = hostAdapter.blueprintRuntime?.hostApi?.sound;
    return sound && typeof sound.resolveElementVolume === "function" ? sound : null;
}

/**
 * The volume to write to the `<video>` element, kept current as the player changes settings.
 *
 * On the editor canvas (no host) this is the authored volume unchanged: there is no live game to
 * read preferences from, and an author scrubbing a clip in the inspector expects to hear what they
 * typed rather than what some absent player's sliders would do to it.
 */
export function useVideoElementVolume(
    host: VideoMixerHost | null,
    audioTrackId: string | null,
    authoredVolume: number,
): number {
    const [resolved, setResolved] = useState(() =>
        host ? host.resolveElementVolume({ audioTrackId, volume: authoredVolume }) : authoredVolume);

    useEffect(() => {
        if (!host) {
            setResolved(authoredVolume);
            return;
        }
        const read = () => setResolved(host.resolveElementVolume({ audioTrackId, volume: authoredVolume }));
        // Read once on (re)subscribe as well as on every change: a preference the player set before
        // this widget mounted produces no event, and without this the clip would start at the wrong
        // level and only correct itself the next time a slider moved.
        read();
        return host.subscribeMixerChanges(read);
    }, [host, audioTrackId, authoredVolume]);

    return resolved;
}
