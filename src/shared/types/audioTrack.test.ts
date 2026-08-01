import { describe, expect, it } from "vitest";
import {
    AUDIO_TRACK_ID_MUSIC,
    AUDIO_TRACK_ID_SFX,
    AUDIO_TRACK_ID_VOICE,
    AUDIO_TRACK_SCHEMA_VERSION,
    BUILTIN_AUDIO_TRACKS,
    DEFAULT_AUDIO_TRACK_ID,
    countAudioTrackReferences,
    createSeededAudioTrackDocument,
    migrateProjectAudioTrackDocument,
    normalizeAudioTrackChannel,
    normalizeProjectAudioTrack,
    normalizeProjectAudioTracks,
    resolveAudioTrack,
    resolveAudioTrackPlayback,
    type ProjectAudioTrack,
} from "./audioTrack";

const custom = (patch: Partial<ProjectAudioTrack> & { id: string }): ProjectAudioTrack => ({
    name: patch.id,
    channel: "sound",
    gain: 1,
    fadeInMs: 0,
    fadeOutMs: 0,
    loop: false,
    ...patch,
});

describe("the seeded built-ins", () => {
    it("is one track per bus, in the order the surface lists them", () => {
        expect(BUILTIN_AUDIO_TRACKS.map(track => [track.id, track.channel])).toEqual([
            [AUDIO_TRACK_ID_MUSIC, "bgm"],
            [AUDIO_TRACK_ID_SFX, "sound"],
            [AUDIO_TRACK_ID_VOICE, "voice"],
        ]);
    });

    /** Studio's behaviour before tracks existed, restated as data. Changing these changes every project. */
    it("reproduces the pre-track defaults", () => {
        const [music, sfx, voice] = BUILTIN_AUDIO_TRACKS;
        expect(music).toMatchObject({ gain: 1, fadeInMs: 800, fadeOutMs: 800, loop: true, builtin: true });
        expect(sfx).toMatchObject({ gain: 1, fadeInMs: 0, fadeOutMs: 0, loop: false, builtin: true });
        expect(voice).toMatchObject({ gain: 1, fadeInMs: 0, fadeOutMs: 0, loop: false, builtin: true });
    });

    it("names a built-in for every channel, and each one really is on that channel", () => {
        for (const [channel, id] of Object.entries(DEFAULT_AUDIO_TRACK_ID)) {
            const track = BUILTIN_AUDIO_TRACKS.find(entry => entry.id === id);
            expect(track, channel).toBeDefined();
            expect(track!.channel).toBe(channel);
        }
    });
});

describe("normalizeAudioTrackChannel", () => {
    it("keeps the three the engine has", () => {
        expect(normalizeAudioTrackChannel("bgm")).toBe("bgm");
        expect(normalizeAudioTrackChannel("voice")).toBe("voice");
        expect(normalizeAudioTrackChannel("sound")).toBe("sound");
    });

    it("lands anything else on the sound bus", () => {
        expect(normalizeAudioTrackChannel("ambience")).toBe("sound");
        expect(normalizeAudioTrackChannel(undefined)).toBe("sound");
        expect(normalizeAudioTrackChannel(3)).toBe("sound");
    });
});

describe("normalizeProjectAudioTrack", () => {
    it("drops an entry nothing can point at", () => {
        expect(normalizeProjectAudioTrack({ name: "Ambience" })).toBeNull();
        expect(normalizeProjectAudioTrack({ id: "   ", name: "Ambience" })).toBeNull();
        expect(normalizeProjectAudioTrack(null)).toBeNull();
        expect(normalizeProjectAudioTrack(["ambience"])).toBeNull();
        expect(normalizeProjectAudioTrack("ambience")).toBeNull();
    });

    it("clamps gain into 0..2", () => {
        expect(normalizeProjectAudioTrack({ id: "a", gain: -3 })!.gain).toBe(0);
        expect(normalizeProjectAudioTrack({ id: "a", gain: 9 })!.gain).toBe(2);
        expect(normalizeProjectAudioTrack({ id: "a", gain: 1.5 })!.gain).toBe(1.5);
    });

    it("falls back rather than storing a gain that is not a number", () => {
        expect(normalizeProjectAudioTrack({ id: "a", gain: Number.NaN })!.gain).toBe(1);
        expect(normalizeProjectAudioTrack({ id: "a", gain: Number.POSITIVE_INFINITY })!.gain).toBe(1);
        expect(normalizeProjectAudioTrack({ id: "a", gain: "loud" })!.gain).toBe(1);
    });

    it("floors fades at zero", () => {
        const track = normalizeProjectAudioTrack({ id: "a", fadeInMs: -500, fadeOutMs: -1 })!;
        expect(track.fadeInMs).toBe(0);
        expect(track.fadeOutMs).toBe(0);
        expect(normalizeProjectAudioTrack({ id: "a", fadeInMs: 250 })!.fadeInMs).toBe(250);
    });

    it("trims the id and the name, and names an unnamed track after its id", () => {
        const track = normalizeProjectAudioTrack({ id: "  ambience ", name: "  Ambience " })!;
        expect(track.id).toBe("ambience");
        expect(track.name).toBe("Ambience");
        expect(normalizeProjectAudioTrack({ id: "ambience" })!.name).toBe("ambience");
    });

    it("marks the built-ins and only the built-ins", () => {
        expect(normalizeProjectAudioTrack({ id: AUDIO_TRACK_ID_MUSIC })!.builtin).toBe(true);
        expect("builtin" in normalizeProjectAudioTrack({ id: "ambience", builtin: true })!).toBe(false);
    });

    /**
     * `DEFAULT_AUDIO_TRACK_ID` promises `music` is where a bgm play with no track lands. A `music`
     * re-pointed at another bus would break every such play without touching the row that did it.
     */
    it("holds a built-in to its own bus while letting everything else be tuned", () => {
        const track = normalizeProjectAudioTrack({
            id: AUDIO_TRACK_ID_MUSIC,
            name: "Score",
            channel: "voice",
            gain: 0.6,
            fadeInMs: 1200,
            loop: false,
        })!;
        expect(track.channel).toBe("bgm");
        expect(track).toMatchObject({ name: "Score", gain: 0.6, fadeInMs: 1200, loop: false });
    });

    it("takes a built-in's own defaults for fields the stored entry omits", () => {
        expect(normalizeProjectAudioTrack({ id: AUDIO_TRACK_ID_MUSIC })).toEqual(BUILTIN_AUDIO_TRACKS[0]);
    });
});

describe("normalizeProjectAudioTracks", () => {
    it("seeds all three from nothing at all", () => {
        for (const input of [undefined, null, [], {}, "tracks"]) {
            expect(normalizeProjectAudioTracks(input)).toEqual([...BUILTIN_AUDIO_TRACKS]);
        }
    });

    it("puts the built-ins first even when the file listed them last", () => {
        const tracks = normalizeProjectAudioTracks([
            custom({ id: "ambience", name: "Ambience" }),
            { id: AUDIO_TRACK_ID_VOICE },
            custom({ id: "ui", name: "UI" }),
            { id: AUDIO_TRACK_ID_MUSIC },
        ]);
        expect(tracks.map(track => track.id)).toEqual([
            AUDIO_TRACK_ID_MUSIC, AUDIO_TRACK_ID_SFX, AUDIO_TRACK_ID_VOICE, "ambience", "ui",
        ]);
    });

    it("preserves the order the author arranged the custom tracks in", () => {
        const tracks = normalizeProjectAudioTracks([
            custom({ id: "ui" }), custom({ id: "ambience" }), custom({ id: "stinger" }),
        ]);
        expect(tracks.slice(3).map(track => track.id)).toEqual(["ui", "ambience", "stinger"]);
    });

    it("keeps a stored built-in's edits rather than resetting it to the seed", () => {
        const [music] = normalizeProjectAudioTracks([
            { id: AUDIO_TRACK_ID_MUSIC, name: "Score", gain: 0.5, fadeInMs: 2000, fadeOutMs: 2000, loop: true },
        ]);
        expect(music).toMatchObject({ name: "Score", gain: 0.5, fadeInMs: 2000, builtin: true });
    });

    it("keeps the first of a duplicated id", () => {
        const tracks = normalizeProjectAudioTracks([
            custom({ id: "ambience", name: "First" }),
            custom({ id: "ambience", name: "Second" }),
        ]);
        expect(tracks.filter(track => track.id === "ambience")).toEqual([
            expect.objectContaining({ name: "First" }),
        ]);
    });

    it("drops the entries that have no id and keeps the rest", () => {
        const tracks = normalizeProjectAudioTracks([{ name: "nameless" }, null, 7, custom({ id: "ui" })]);
        expect(tracks.map(track => track.id)).toEqual([
            AUDIO_TRACK_ID_MUSIC, AUDIO_TRACK_ID_SFX, AUDIO_TRACK_ID_VOICE, "ui",
        ]);
    });

    it("does not hand back the frozen seed objects, so a mutation cannot poison the next project", () => {
        const tracks = normalizeProjectAudioTracks([]);
        tracks[0].name = "Score";
        expect(BUILTIN_AUDIO_TRACKS[0].name).toBe("Music");
        expect(normalizeProjectAudioTracks([])[0].name).toBe("Music");
    });
});

describe("the document", () => {
    it("seeds at the current schema version, with meta only when a timestamp is given", () => {
        const seeded = createSeededAudioTrackDocument("2026-07-31T00:00:00.000Z");
        expect(seeded.schemaVersion).toBe(AUDIO_TRACK_SCHEMA_VERSION);
        expect(seeded.tracks).toEqual([...BUILTIN_AUDIO_TRACKS]);
        expect(seeded.meta).toEqual({
            createdAt: "2026-07-31T00:00:00.000Z",
            updatedAt: "2026-07-31T00:00:00.000Z",
        });
        expect("meta" in createSeededAudioTrackDocument()).toBe(false);
    });

    it("migrates an empty or unrecognised root to the seeded document", () => {
        expect(migrateProjectAudioTrackDocument({})).toEqual(createSeededAudioTrackDocument());
        expect(migrateProjectAudioTrackDocument(null)).toEqual(createSeededAudioTrackDocument());
        expect(migrateProjectAudioTrackDocument({ tracks: {} })).toEqual(createSeededAudioTrackDocument());
    });

    it("carries meta through and drops a meta that is not an object", () => {
        expect(migrateProjectAudioTrackDocument({ meta: { createdAt: "x" } }).meta).toEqual({ createdAt: "x" });
        expect("meta" in migrateProjectAudioTrackDocument({ meta: "x" })).toBe(false);
    });

    /** The canonical encoder refuses `undefined` by name, so an optional key must be absent instead. */
    it("never writes an explicit undefined", () => {
        const document = migrateProjectAudioTrackDocument({ tracks: [custom({ id: "ui" })] });
        expect(JSON.stringify(document)).not.toContain("null");
        expect(Object.values(document.tracks[3]).every(value => value !== undefined)).toBe(true);
    });
});

describe("resolveAudioTrack", () => {
    const tracks = normalizeProjectAudioTracks([custom({ id: "ambience", channel: "bgm", gain: 0.4 })]);

    it("returns the track a live reference names", () => {
        expect(resolveAudioTrack(tracks, "ambience").id).toBe("ambience");
        expect(resolveAudioTrack(tracks, "  ambience  ").id).toBe("ambience");
    });

    it("falls back to the built-in for the caller's channel when the id is absent", () => {
        expect(resolveAudioTrack(tracks, undefined, "bgm").id).toBe(AUDIO_TRACK_ID_MUSIC);
        expect(resolveAudioTrack(tracks, null, "voice").id).toBe(AUDIO_TRACK_ID_VOICE);
        expect(resolveAudioTrack(tracks, "", "sound").id).toBe(AUDIO_TRACK_ID_SFX);
    });

    /** A deleted track must not silently mute the rows that still point at it. */
    it("falls back the same way for an id nothing answers to", () => {
        expect(resolveAudioTrack(tracks, "deleted-track", "bgm").id).toBe(AUDIO_TRACK_ID_MUSIC);
    });

    it("treats an unqualified caller as the sound bus", () => {
        expect(resolveAudioTrack(tracks, undefined).id).toBe(AUDIO_TRACK_ID_SFX);
    });

    it("answers even from a list that never went through the normalizer", () => {
        expect(resolveAudioTrack([], "anything", "bgm")).toEqual(BUILTIN_AUDIO_TRACKS[0]);
    });
});

describe("resolveAudioTrackPlayback", () => {
    const music = BUILTIN_AUDIO_TRACKS[0];

    it("takes the track's own defaults when the action overrides nothing", () => {
        expect(resolveAudioTrackPlayback(music)).toEqual({
            channel: "bgm",
            volume: 1,
            fadeInMs: 800,
            fadeOutMs: 800,
            loop: true,
        });
    });

    it("multiplies the action volume by the track gain", () => {
        const quiet = custom({ id: "quiet", gain: 0.5 });
        expect(resolveAudioTrackPlayback(quiet, { volume: 0.5 }).volume).toBe(0.25);
    });

    /** The point of a >1 gain: an action volume of 0.5 on a doubled track is unity, not 0.5. */
    it("clamps the product rather than either factor", () => {
        const loud = custom({ id: "loud", gain: 2 });
        expect(resolveAudioTrackPlayback(loud, { volume: 0.5 }).volume).toBe(1);
        expect(resolveAudioTrackPlayback(loud, { volume: 1 }).volume).toBe(1);
        expect(resolveAudioTrackPlayback(loud, { volume: 0.25 }).volume).toBe(0.5);
    });

    it("clamps a negative product to zero", () => {
        expect(resolveAudioTrackPlayback(music, { volume: -1 }).volume).toBe(0);
    });

    it("applies one action fade to both directions", () => {
        expect(resolveAudioTrackPlayback(music, { fadeMs: 0 })).toMatchObject({ fadeInMs: 0, fadeOutMs: 0 });
        expect(resolveAudioTrackPlayback(music, { fadeMs: 250 })).toMatchObject({ fadeInMs: 250, fadeOutMs: 250 });
    });

    it("floors a negative action fade rather than passing it on", () => {
        expect(resolveAudioTrackPlayback(music, { fadeMs: -50 })).toMatchObject({ fadeInMs: 0, fadeOutMs: 0 });
    });

    it("lets an explicit false override a looping track", () => {
        expect(resolveAudioTrackPlayback(music, { loop: false }).loop).toBe(false);
        expect(resolveAudioTrackPlayback(music, { loop: null }).loop).toBe(true);
        expect(resolveAudioTrackPlayback(music, {}).loop).toBe(true);
    });

    it("ignores overrides that are not numbers", () => {
        expect(resolveAudioTrackPlayback(music, { volume: Number.NaN, fadeMs: Number.NaN })).toEqual({
            channel: "bgm",
            volume: 1,
            fadeInMs: 800,
            fadeOutMs: 800,
            loop: true,
        });
    });

    it("routes to the track's own bus, never the action's", () => {
        expect(resolveAudioTrackPlayback(custom({ id: "ui", channel: "voice" })).channel).toBe("voice");
    });
});

describe("countAudioTrackReferences", () => {
    const ids = [AUDIO_TRACK_ID_MUSIC, "ambience"];

    it("reports zero for every known track when nothing references them", () => {
        expect(countAudioTrackReferences([{ scenes: [] }], ids)).toEqual({ [AUDIO_TRACK_ID_MUSIC]: 0, ambience: 0 });
    });

    it("counts both spellings, at any depth, across every root", () => {
        const story = { blocks: [{ audio: { audioTrackId: "ambience" } }, { audio: { trackId: "ambience" } }] };
        const graph = { nodes: { a: { params: { audioTrackId: AUDIO_TRACK_ID_MUSIC } } } };
        expect(countAudioTrackReferences([story, graph], ids)).toEqual({
            [AUDIO_TRACK_ID_MUSIC]: 1,
            ambience: 2,
        });
    });

    /** `trackId` is also what a story-motion timeline calls its rows; only known ids may count. */
    it("ignores a trackId that names something other than an audio track", () => {
        const timeline = { tracks: [{ id: "t1" }], selection: { trackId: "t1" } };
        expect(countAudioTrackReferences([timeline], ids)).toEqual({ [AUDIO_TRACK_ID_MUSIC]: 0, ambience: 0 });
    });

    it("does not count an id that merely appears under some other key", () => {
        expect(countAudioTrackReferences([{ name: "ambience", id: "ambience" }], ids).ambience).toBe(0);
    });

    it("terminates on a document that shares a sub-object with itself", () => {
        const shared: Record<string, unknown> = { audioTrackId: "ambience" };
        const root: Record<string, unknown> = { a: shared, b: shared };
        root.self = root;
        expect(countAudioTrackReferences([root], ids).ambience).toBe(1);
    });
});
