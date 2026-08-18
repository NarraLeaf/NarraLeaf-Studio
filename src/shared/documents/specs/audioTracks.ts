import {
  AUDIO_TRACK_SCHEMA_VERSION,
  migrateProjectAudioTrackDocument,
  type ProjectAudioTrackDocument
} from "../../types/audioTrack";
import { defineDocumentSpec } from "../registry";
import { rejectNewerSchema, requireDocumentObject } from "./parseHelpers";

/**
 * `editor/audio-tracks.json` - the project's mixer, as a tree of buses.
 *
 * Owned by `AudioTrackService`. A first-class document rather than a corner of `.nlproj` because a
 * track is authored content that references point at: version control has to be able to show a
 * renamed track or a re-routed bus as its own change, and a diff of the whole project file cannot.
 *
 * v1 documents (a flat list of `{channel, gain, fadeInMs, fadeOutMs}` presets) are migrated on load
 * by `migrateProjectAudioTrackDocument`; see `@shared/types/audioTrack` for what maps onto what.
 *
 * The path is `ProjectNameConvention.EditorAudioTracks` spelled as a pattern; the two are kept in
 * step by the renderer's `services/core/documentSpecs.test.ts`, which is the only place that can see
 * both (this module is shared, the convention is not).
 */
export const AUDIO_TRACKS_DOCUMENT_PATH = "editor/audio-tracks.json";

export const audioTracksSpec = defineDocumentSpec<ProjectAudioTrackDocument>({
  kind: "audio-tracks",
  version: AUDIO_TRACK_SCHEMA_VERSION,
  paths: [AUDIO_TRACKS_DOCUMENT_PATH],
  parse: (raw, context) => {
    const record = requireDocumentObject(raw, context, "an audio track list");
    rejectNewerSchema(record, context, AUDIO_TRACK_SCHEMA_VERSION);
    // A present-but-wrong `tracks` is corrupt rather than "no tracks": the normalizer seeds the
    // three built-ins for anything it cannot read, and the first edit would write that seed back
    // over whatever the author actually had.
    if (record.tracks !== undefined && !Array.isArray(record.tracks)) {
      context.corrupt(`"tracks" must be an array, got ${typeof record.tracks}`);
    }
    return migrateProjectAudioTrackDocument(record);
  },
  // No authored name: there is one of these per project and the history UI labels it by kind.
  summarize: (document) => ({
    title: "",
    counts: [{ key: "audioTracks", value: document.tracks.length }]
  })
});
