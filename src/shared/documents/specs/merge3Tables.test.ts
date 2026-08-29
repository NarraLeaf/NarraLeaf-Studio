import {describe, expect, it} from "vitest";
import {
    AUDIO_TRACKS_DOCUMENT_PATH,
    audioTracksSpec,
    LOCALIZATION_KEYS_DOCUMENT_PATH,
    localizationKeysSpec,
    VARIABLE_REGISTRY_DOCUMENT_PATH,
    variableRegistrySpec,
} from "@shared/documents/specs";
import {applyMergeDecisions, mergeDecisionKey} from "@shared/documents/mergeApply";
import {DocumentCorruptError, DocumentParseContext} from "@shared/documents/types";
import {
    AUDIO_TRACK_ID_BGM,
    AUDIO_TRACK_ID_SOUND,
    AUDIO_TRACK_ID_VOICE,
    AUDIO_TRACK_SCHEMA_VERSION,
    BUILTIN_AUDIO_TRACKS,
    type ProjectAudioTrack,
    type ProjectAudioTrackDocument,
} from "@shared/types/audioTrack";
import {
    LOCALIZATION_KEYS_SCHEMA_VERSION,
    type LocalizationKeysDocument,
} from "@shared/types/localization";
import {
    VARIABLE_REGISTRY_SCHEMA_VERSION,
    type VariableRegistry,
    type VariableRegistryEntry,
} from "@shared/types/variables/registry";

/**
 * `spec.merge3` for the three project tables, which are the documents that used to make joining
 * somebody else's work expensive for no reason.
 *
 * All three are small maps of independent records - a variable, a named string, a mixer bus - and
 * all three are edited by whoever happens to need one. Without a semantic merge, two people who
 * each declared one variable in the same week collided over the whole file and one of them lost
 * everything they had written into it. That is the case each of these formats is measured against
 * first, and it must merge with nothing for the author to decide.
 *
 * The mixer earns a second half of its own. Its tracks are a LIST on disk, because sibling order is
 * the author's arrangement, and a keyed collection to a merge, because identity is the id every
 * story row and blueprint pin points at. Both halves have to hold at once, which means the
 * decisions have to be applicable - so the tests here go through `applyMergeDecisions` rather than
 * stopping at what `merge3` handed back.
 */

function contextFor(
    path: string,
    kind: "variables" | "localization-keys" | "audio-tracks",
    text: string,
): DocumentParseContext {
    return {
        path,
        corrupt(reason: string): never {
            throw new DocumentCorruptError({kind, path, reason, text});
        },
    };
}

/* ------------------------------------------------------------------------ variables */

function variable(id: string, overrides: Partial<VariableRegistryEntry> = {}): VariableRegistryEntry {
    return {
        id,
        name: id,
        scope: "saved",
        valueType: "number",
        storageKey: id,
        ...overrides,
    };
}

function registry(entries: Record<string, VariableRegistryEntry>): VariableRegistry {
    return {schemaVersion: VARIABLE_REGISTRY_SCHEMA_VERSION, entries};
}

function reparseRegistry(document: VariableRegistry): VariableRegistry {
    const text = variableRegistrySpec.serialize(document);
    return variableRegistrySpec.parse(
        JSON.parse(text),
        contextFor(VARIABLE_REGISTRY_DOCUMENT_PATH, "variables", text),
    );
}

describe("variable registry merge3", () => {
    const base = registry({affection: variable("affection"), chapter: variable("chapter")});

    it("takes one variable from each side when two authors each declared their own", () => {
        // The case the whole tier exists for: a variable is declared once and read from a hundred
        // places, so this file is touched by whoever needs a new one - and two people needing one
        // in the same week used to cost one of them everything they had written into it.
        const mine = registry({...base.entries, trust: variable("trust")});
        const theirs = registry({...base.entries, guilt: variable("guilt")});

        const merged = variableRegistrySpec.merge3!(base, mine, theirs);

        expect(merged.conflicts).toBe(0);
        expect(Object.keys(merged.document.entries).sort())
            .toEqual(["affection", "chapter", "guilt", "trust"]);
        expect(merged.decisions.map(one => [one.path.join("/"), one.outcome])).toEqual([
            ["entries/trust", "auto-mine"],
            ["entries/guilt", "auto-theirs"],
        ]);
        expect(reparseRegistry(merged.document)).toStrictEqual(merged.document);
    });

    it("conflicts on one variable both sides changed, and holds base until it is settled", () => {
        const mine = registry({...base.entries, chapter: variable("chapter", {defaultValue: 1})});
        const theirs = registry({...base.entries, chapter: variable("chapter", {defaultValue: 9})});

        const merged = variableRegistrySpec.merge3!(base, mine, theirs);

        expect(merged.conflicts).toBe(1);
        const [row] = merged.decisions;
        expect(row.path).toEqual(["entries", "chapter"]);
        // The author's own label for it, never the generated id - which is what the panel shows
        // and the only word on the row they will recognise.
        expect(row.subject).toBe("chapter");
        // ⚠ A whole entry per side. `storageKey` is where every save already written keeps this
        // variable's value and `valueType` says what may be in it: an entry built half from each
        // describes a variable whose stored values are of the wrong shape.
        expect((row.mine.value as VariableRegistryEntry).defaultValue).toBe(1);
        expect((row.theirs.value as VariableRegistryEntry).defaultValue).toBe(9);
        expect(merged.document.entries.chapter.defaultValue).toBeUndefined();
    });

    it("treats an absent base as add/add rather than as an empty registry", () => {
        const mine = registry({trust: variable("trust")});
        const theirs = registry({guilt: variable("guilt")});

        const merged = variableRegistrySpec.merge3!(undefined, mine, theirs);

        // An empty base would make both additions merge silently and hand the author a registry
        // neither of them wrote - and "theirs does not have it" is also what a removal looks like.
        expect(merged.decisions.every(one => one.outcome === "conflict")).toBe(true);
        expect(merged.conflicts).toBe(2);
        expect(merged.document.entries.trust).toBeDefined();
        expect(merged.document.entries.guilt).toBeUndefined();
    });

    it("keeps the timestamps out of the decisions", () => {
        // `meta` holds when the file was written and nothing an author decided. A row for it would
        // be a conflict every merge produces and nobody can answer.
        const mine: VariableRegistry = {...base, meta: {updatedAt: "2026-01-01T00:00:00.000Z"}};
        const theirs: VariableRegistry = {...base, meta: {updatedAt: "2026-02-02T00:00:00.000Z"}};

        const merged = variableRegistrySpec.merge3!(base, mine, theirs);

        expect(merged.decisions).toEqual([]);
        expect(merged.document.meta?.updatedAt).toBe("2026-01-01T00:00:00.000Z");
    });

    it("is pure: neither side is mutated", () => {
        const mine = registry({...base.entries, trust: variable("trust")});
        const theirs = registry({...base.entries, guilt: variable("guilt")});
        const before = JSON.stringify([mine, theirs]);

        variableRegistrySpec.merge3!(base, mine, theirs);

        expect(JSON.stringify([mine, theirs])).toBe(before);
    });
});

/* ----------------------------------------------------------------- named strings */

function keys(entries: Record<string, {sourceText: string; note?: string}>): LocalizationKeysDocument {
    return {schemaVersion: LOCALIZATION_KEYS_SCHEMA_VERSION, keys: entries};
}

function reparseKeys(document: LocalizationKeysDocument): LocalizationKeysDocument {
    const text = localizationKeysSpec.serialize(document);
    return localizationKeysSpec.parse(
        JSON.parse(text),
        contextFor(LOCALIZATION_KEYS_DOCUMENT_PATH, "localization-keys", text),
    );
}

describe("localization keys merge3", () => {
    const base = keys({"menu.start": {sourceText: "Start"}});

    it("takes a named string from each side", () => {
        const mine = keys({...base.keys, "menu.load": {sourceText: "Load"}});
        const theirs = keys({...base.keys, "menu.quit": {sourceText: "Quit"}});

        const merged = localizationKeysSpec.merge3!(base, mine, theirs);

        expect(merged.conflicts).toBe(0);
        expect(Object.keys(merged.document.keys).sort())
            .toEqual(["menu.load", "menu.quit", "menu.start"]);
        expect(reparseKeys(merged.document)).toStrictEqual(merged.document);
    });

    it("conflicts on a name both sides declared differently, rather than keeping both", () => {
        // ⚠ The name IS the identity: every `t()` call and every translation unit points at it, so
        // two definitions of one name cannot both survive the way two assets with the same file
        // name can.
        const mine = keys({...base.keys, "menu.load": {sourceText: "Load"}});
        const theirs = keys({...base.keys, "menu.load": {sourceText: "Continue"}});

        const merged = localizationKeysSpec.merge3!(base, mine, theirs);

        expect(merged.conflicts).toBe(1);
        expect(merged.decisions[0].path).toEqual(["keys", "menu.load"]);
        // The key is the rare case where the map's key is the author's own word for the row.
        expect(merged.decisions[0].subject).toBe("menu.load");
        // There is no base to hold - both sides added this name - so the merged document keeps
        // mine, which is the value already in this author's tree. That is `mergeKeyed`'s rule and
        // it is about keeping the document complete and writable while the row is open; the
        // outcome is still `conflict`, so nothing is settled by it.
        expect(merged.decisions[0].outcome).toBe("conflict");
        expect(merged.document.keys["menu.load"].sourceText).toBe("Load");
    });

    it("keeps the note with the source it belongs to", () => {
        // A note is a translator's instruction about that source line. Kept from one side over the
        // other side's rewritten source, it would be an instruction about a line that no longer
        // says that - which is why a definition is one decision rather than two fields.
        const mine = keys({"menu.start": {sourceText: "Begin", note: "Title screen"}});
        const theirs = keys({"menu.start": {sourceText: "Start game", note: "Verb, imperative"}});

        const merged = localizationKeysSpec.merge3!(base, mine, theirs);

        expect(merged.conflicts).toBe(1);
        expect(merged.decisions[0].mine.value).toEqual({sourceText: "Begin", note: "Title screen"});
        expect(merged.decisions[0].theirs.value)
            .toEqual({sourceText: "Start game", note: "Verb, imperative"});
    });

    it("is pure and survives an empty document on either side", () => {
        const mine = keys({...base.keys});
        const empty = keys({});
        const before = JSON.stringify([mine, empty]);

        expect(() => localizationKeysSpec.merge3!(undefined, empty, empty)).not.toThrow();
        localizationKeysSpec.merge3!(base, mine, empty);

        expect(JSON.stringify([mine, empty])).toBe(before);
    });
});

/* ------------------------------------------------------------------------ the mixer */

function track(id: string, overrides: Partial<ProjectAudioTrack> = {}): ProjectAudioTrack {
    return {id, name: id, parentId: null, volume: 1, loop: false, ...overrides};
}

function mixer(tracks: ProjectAudioTrack[]): ProjectAudioTrackDocument {
    return {schemaVersion: AUDIO_TRACK_SCHEMA_VERSION, tracks};
}

/** The three tracks every project has, which the normalizer re-seeds if a document loses them. */
const SEEDED = BUILTIN_AUDIO_TRACKS.map(seed => ({...seed}));

function reparseMixer(document: ProjectAudioTrackDocument): ProjectAudioTrackDocument {
    const text = audioTracksSpec.serialize(document);
    return audioTracksSpec.parse(
        JSON.parse(text),
        contextFor(AUDIO_TRACKS_DOCUMENT_PATH, "audio-tracks", text),
    );
}

describe("audio tracks merge3", () => {
    const base = mixer([...SEEDED]);

    it("takes a track from each side, mine's order first and then the ids only theirs has", () => {
        const mine = mixer([...SEEDED, track("ambience")]);
        const theirs = mixer([...SEEDED, track("ui")]);

        const merged = audioTracksSpec.merge3!(base, mine, theirs);

        expect(merged.conflicts).toBe(0);
        // Appended rather than interleaved: two people who each added a track have not disagreed
        // about the order of anything, and a guessed interleaving is an arrangement neither made.
        expect(merged.document.tracks.map(one => one.id)).toEqual([
            AUDIO_TRACK_ID_BGM, AUDIO_TRACK_ID_SOUND, AUDIO_TRACK_ID_VOICE, "ambience", "ui",
        ]);
        expect(merged.decisions.map(one => [one.path.join("/"), one.outcome])).toEqual([
            ["tracks/ambience", "auto-mine"],
            ["tracks/ui", "auto-theirs"],
        ]);
        expect(reparseMixer(merged.document)).toStrictEqual(merged.document);
    });

    it("conflicts on one track both sides changed, and holds base", () => {
        const quiet = SEEDED.map(one => (one.id === AUDIO_TRACK_ID_BGM ? {...one, volume: 0.3} : one));
        const loud = SEEDED.map(one => (one.id === AUDIO_TRACK_ID_BGM ? {...one, volume: 0.9} : one));

        const merged = audioTracksSpec.merge3!(base, mixer(quiet), mixer(loud));

        expect(merged.conflicts).toBe(1);
        expect(merged.decisions[0].path).toEqual(["tracks", AUDIO_TRACK_ID_BGM]);
        expect((merged.decisions[0].mine.value as ProjectAudioTrack).volume).toBe(0.3);
        expect((merged.decisions[0].theirs.value as ProjectAudioTrack).volume).toBe(0.9);
        expect(merged.document.tracks.find(one => one.id === AUDIO_TRACK_ID_BGM)?.volume).toBe(1);
    });

    it("repairs a routing the merge itself invented", () => {
        // ⚠ The tree neither side had. I re-routed a track under a bus they deleted, so the merged
        // list holds a track pointing at nothing. The normalizer's answer - unknown parent to the
        // root - is the format's own and every reader applies it, so doing it here means the
        // merged document is one nothing has to repair rather than one that repairs differently
        // depending on who opens it.
        const withBus = mixer([...SEEDED, track("stems"), track("strings")]);
        const mine = mixer([...SEEDED, track("stems"), track("strings", {parentId: "stems"})]);
        const theirs = mixer([...SEEDED, track("strings")]);

        const merged = audioTracksSpec.merge3!(withBus, mine, theirs);

        const strings = merged.document.tracks.find(one => one.id === "strings");
        expect(strings?.parentId).toBeNull();
        expect(merged.document.tracks.some(one => one.id === "stems")).toBe(false);
    });

    it("puts the three built-in tracks back if a side lost them", () => {
        // They cannot be deleted through the interface, so a document without one is corrupt -
        // and a merge is exactly where two corrupt halves meet.
        const merged = audioTracksSpec.merge3!(mixer([]), mixer([track("ambience")]), mixer([]));

        expect(merged.document.tracks.map(one => one.id)).toEqual([
            AUDIO_TRACK_ID_BGM, AUDIO_TRACK_ID_SOUND, AUDIO_TRACK_ID_VOICE, "ambience",
        ]);
    });

    it("settles a conflict by id, through the applier, without moving anything else", () => {
        // ⚠ The half that makes the rest of this real. A track is addressed by its id and lives in
        // a list, so the applier has to find it by id: settling by position would renumber what the
        // other decisions in the same list name.
        const quiet = SEEDED.map(one => (one.id === AUDIO_TRACK_ID_BGM ? {...one, volume: 0.3} : one));
        const loud = SEEDED.map(one => (one.id === AUDIO_TRACK_ID_BGM ? {...one, volume: 0.9} : one));
        const mine = mixer([...quiet, track("ambience")]);
        const theirs = mixer([...loud, track("ui")]);

        const merged = audioTracksSpec.merge3!(base, mine, theirs);
        const settled = applyMergeDecisions(
            AUDIO_TRACKS_DOCUMENT_PATH,
            merged.document,
            merged.decisions,
            {[mergeDecisionKey(["tracks", AUDIO_TRACK_ID_BGM])]: "theirs"},
        );

        expect(settled.tracks.find(one => one.id === AUDIO_TRACK_ID_BGM)?.volume).toBe(0.9);
        // Both additions survived the applier and stayed where the merge put them.
        expect(settled.tracks.map(one => one.id)).toEqual([
            AUDIO_TRACK_ID_BGM, AUDIO_TRACK_ID_SOUND, AUDIO_TRACK_ID_VOICE, "ambience", "ui",
        ]);
        expect(reparseMixer(settled)).toStrictEqual(settled);
    });

    it("takes a track out by id when the chosen side does not have it", () => {
        // Removing by position is refused because it renumbers what the other decisions address.
        // Removing by id moves nothing any decision names, which is the whole difference.
        const withExtra = mixer([...SEEDED, track("ambience")]);
        const mine = mixer([...SEEDED, track("ambience", {volume: 0.5})]);
        const theirs = mixer([...SEEDED]);

        const merged = audioTracksSpec.merge3!(withExtra, mine, theirs);
        const settled = applyMergeDecisions(
            AUDIO_TRACKS_DOCUMENT_PATH,
            merged.document,
            merged.decisions,
            {[mergeDecisionKey(["tracks", "ambience"])]: "theirs"},
        );

        expect(settled.tracks.map(one => one.id)).toEqual([
            AUDIO_TRACK_ID_BGM, AUDIO_TRACK_ID_SOUND, AUDIO_TRACK_ID_VOICE,
        ]);
    });

    it("is pure: neither side is mutated by a merge that normalizes its output", () => {
        // The normalizer rewrites `parentId` in place on what it is given, so a merge that handed
        // it the caller's own track objects would edit the document it was comparing.
        const mine = mixer([...SEEDED, track("stems"), track("strings", {parentId: "stems"})]);
        const theirs = mixer([...SEEDED, track("strings")]);
        const before = JSON.stringify([mine, theirs]);

        audioTracksSpec.merge3!(mixer([...SEEDED, track("stems"), track("strings")]), mine, theirs);

        expect(JSON.stringify([mine, theirs])).toBe(before);
    });
});
