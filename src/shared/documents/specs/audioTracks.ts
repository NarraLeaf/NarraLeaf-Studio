import {
    AUDIO_TRACK_SCHEMA_VERSION,
    migrateProjectAudioTrackDocument,
    type ProjectAudioTrack,
    type ProjectAudioTrackDocument,
} from "../../types/audioTrack";
import {buildDocumentDiff, DocumentChange, DocumentDiff} from "../diff";
import {defineDocumentSpec} from "../registry";
import {authoredName, byId, change, diffKeyed, fromToParams, sameJsonValue} from "./diffHelpers";
import {rejectNewerSchema, requireDocumentObject} from "./parseHelpers";

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
    summarize: document => ({
        title: "",
        counts: [{key: "audioTracks", value: document.tracks.length}],
    }),
    diff: diffAudioTracks,
});

const LABEL = {
    added: "documentDiff.audioTracks.added",
    removed: "documentDiff.audioTracks.removed",
    renamed: "documentDiff.audioTracks.renamed",
    rerouted: "documentDiff.audioTracks.rerouted",
    reroutedToMaster: "documentDiff.audioTracks.reroutedToMaster",
    volume: "documentDiff.audioTracks.volume",
    loopOn: "documentDiff.audioTracks.loopOn",
    loopOff: "documentDiff.audioTracks.loopOff",
    order: "documentDiff.audioTracks.order",
} as const;

/**
 * One row per track, and the routing is the row this is for.
 *
 * Where a bus feeds is the one thing about a mixer that cannot be seen in a count and cannot be
 * heard until the game runs: moving a track under another one re-multiplies its gain and hands it
 * a different fader, and the document has the same number of tracks it had before. Under the
 * summary tier that was a change nobody could act on.
 *
 * Both ends of a re-route are named with the bus's own name, read from the side it belongs to - the
 * older name from the older document, the newer from the newer - so a track that was re-routed in
 * the same version that renamed its new parent still reads correctly.
 */
export function diffAudioTracks(base: ProjectAudioTrackDocument, head: ProjectAudioTrackDocument, options: {limit: number}): DocumentDiff {
    const rows: DocumentChange[] = [];

    for (const entry of diffKeyed(byId(base.tracks), byId(head.tracks))) {
        const path = ["tracks", entry.key];
        const subject = authoredName(entry.head?.name) ?? authoredName(entry.base?.name);
        if (!entry.base || !entry.head) {
            rows.push(change(path, entry.kind, entry.head ? LABEL.added : LABEL.removed, {subject}));
            continue;
        }
        if (!sameJsonValue(entry.base.name, entry.head.name)) {
            rows.push(change([...path, "name"], "changed", LABEL.renamed, {
                params: fromToParams(entry.base.name, entry.head.name),
                subject,
            }));
        }
        if (!sameJsonValue(entry.base.parentId, entry.head.parentId)) {
            const from = busName(base.tracks, entry.base.parentId);
            const to = busName(head.tracks, entry.head.parentId);
            // `moved` rather than `changed`: this is the same event a re-parented row or element is,
            // and it wears the same marker as those.
            rows.push(change([...path, "parentId"], "moved", to === undefined ? LABEL.reroutedToMaster : LABEL.rerouted, {
                params: {...(from === undefined ? {} : {from}), ...(to === undefined ? {} : {to})},
                subject,
            }));
        }
        // As a percentage, which is the number on the fader the author moved. The stored 0..1 is
        // what the runtime multiplies with, and reading "0.8 → 0.9" against a slider that says 80
        // would be two spellings of one value in front of the same person.
        if (!sameJsonValue(entry.base.volume, entry.head.volume)) {
            rows.push(change([...path, "volume"], "changed", LABEL.volume, {
                params: fromToParams(percent(entry.base.volume), percent(entry.head.volume)),
                subject,
            }));
        }
        // Stated as the policy that now holds rather than as a pair of switch positions: `true` and
        // `false` are the document's words for it, not the author's.
        if (!sameJsonValue(entry.base.loop, entry.head.loop)) {
            rows.push(change([...path, "loop"], "changed", entry.head.loop ? LABEL.loopOn : LABEL.loopOff, {subject}));
        }
    }

    // The list is the order the mixer is drawn in, which the author arranged. Reported only when the
    // same tracks came out in a different order; one that arrived or left is already its own row.
    if (!sameJsonValue(sharedOrder(base, head), sharedOrder(head, base))) {
        rows.push(change(["tracks"], "moved", LABEL.order));
    }

    // `meta` holds the two timestamps and nothing else, so it is not compared: a document written
    // twice with no edit between would otherwise report a change the author did not make.
    return buildDocumentDiff(rows, {tier: "semantic", limit: options.limit});
}

/**
 * What the author calls the bus a track feeds into, on the side that track was read from.
 *
 * `undefined` for the master output - a track that hangs off it has no parent to name - and for a
 * parent id that no track on that side holds, which a hand-edited or merge-mangled file can carry.
 * Both cases leave that half of the pair out rather than filling it with an id.
 */
function busName(tracks: readonly ProjectAudioTrack[], parentId: string | null): string | undefined {
    if (parentId === null) {
        return undefined;
    }
    return authoredName(tracks.find(track => track.id === parentId)?.name);
}

/** 0..1 as the fader's own number. Rounded because 0.8 * 100 is not 80 in binary floating point. */
function percent(volume: number): number | undefined {
    return typeof volume === "number" && Number.isFinite(volume) ? Math.round(volume * 100) : undefined;
}

/** The ids of `source`'s tracks that `other` also has, in `source`'s order. */
function sharedOrder(source: ProjectAudioTrackDocument, other: ProjectAudioTrackDocument): string[] {
    const known = new Set(other.tracks.map(track => track.id));
    return source.tracks.map(track => track.id).filter(id => known.has(id));
}
