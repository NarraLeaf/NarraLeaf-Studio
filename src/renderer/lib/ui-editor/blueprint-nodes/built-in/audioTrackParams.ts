/**
 * The spelling of an audio-track reference inside a blueprint node's params.
 *
 * Its own module because three places need it and none of them may import the other two: the sound
 * nodes define the Track picker, the game nodes reuse it for `Get/Set Track Volume`, and
 * `graphParamResolvers` reads it back on the data path - and both node modules already import the
 * resolver, so a constant living in either of them would close a cycle.
 *
 * Comments in English per project convention.
 */

/**
 * The param key a node stores its track reference under.
 *
 * Spelled `audioTrackId`, not `trackId`: story motion already keys its timeline rows on `trackId`
 * and the two would collide in any structural sweep over a document. It is also one of
 * `AUDIO_TRACK_REFERENCE_FIELDS`, which is what makes a graph that names a track count towards
 * that track's reference count on the project Audio surface.
 */
export const BLUEPRINT_SOUND_PARAM_TRACK = "audioTrackId";

/**
 * The dynamic select source the flow projection populates from `AudioTrackService`.
 *
 * Dynamic rather than static because the whole point of a track is that a project can add one:
 * "Ambience" has to appear in the picker the moment the author creates it on the project Audio
 * surface, without a node-catalog change.
 */
export const BLUEPRINT_AUDIO_TRACK_OPTIONS_SOURCE = "audioTracks";

/** Empty is a real state (nothing picked yet); callers decide what it means for them. */
export function readBlueprintAudioTrackParam(params: Record<string, unknown> | undefined): string {
    const value = params?.[BLUEPRINT_SOUND_PARAM_TRACK];
    return typeof value === "string" ? value.trim() : "";
}
