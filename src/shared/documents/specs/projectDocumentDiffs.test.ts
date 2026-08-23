import {describe, expect, it} from "vitest";
import type {DocumentChange, DocumentDiff} from "@shared/documents/diff";
import {diffAppTags} from "@shared/documents/specs/appTags";
import {diffAudioTracks} from "@shared/documents/specs/audioTracks";
import {diffBrand} from "@shared/documents/specs/brand";
import {diffDictionary} from "@shared/documents/specs/dictionary";
import {diffSaveSchema} from "@shared/documents/specs/saveSchema";
import {diffVariableRegistry} from "@shared/documents/specs/variables";
import {
    appTagsSpec,
    audioTracksSpec,
    brandSpec,
    dictionarySpec,
    saveSchemaSpec,
    variableRegistrySpec,
} from "@shared/documents/specs";
import {APP_TAG_SCHEMA_VERSION, type ProjectAppTagDocument} from "@shared/types/appTag";
import {
    AUDIO_TRACK_SCHEMA_VERSION,
    createSeededAudioTrackDocument,
    type ProjectAudioTrack,
    type ProjectAudioTrackDocument,
} from "@shared/types/audioTrack";
import {createEmptyProjectBrandDocument, type ProjectBrandDocument} from "@shared/types/brand";
import {
    DEFAULT_DICTIONARY_OPTIONS,
    PROJECT_DICTIONARY_SCHEMA_VERSION,
    type ProjectDictionaryDocument,
    type ProjectDictionaryEntry,
} from "@shared/types/dictionary";
import {SAVE_SCHEMA_VERSION, type SaveSchema, type SaveSchemaField} from "@shared/types/saveSchema";
import {
    VARIABLE_REGISTRY_SCHEMA_VERSION,
    type VariableRegistry,
    type VariableRegistryEntry,
} from "@shared/types/variables/registry";

/**
 * The six documents that used to report "changed, in a way the summary does not show".
 *
 * Each case is one edit an author really makes - re-routing a bus, moving a default, deleting a save
 * field - compared against the document as it stood before, and asserted down to the words and the
 * two values the row carries. A smoke test that only counted rows would pass on a diff that names
 * the wrong track or quotes the wrong side's name, which is the failure worth catching: these rows
 * are the only account of the change an author ever sees.
 */

const LIMIT = {limit: 200};

/** The row at one path, or undefined. Paths are the document's own structure, so they are stable. */
function rowAt(diff: DocumentDiff, path: string): DocumentChange | undefined {
    return diff.changes.find(change => change.path.join("/") === path);
}

/** Every row's path, in the order the diff put them in. */
function paths(diff: DocumentDiff): string[] {
    return diff.changes.map(change => change.path.join("/"));
}

describe("the brand palette diff", () => {
    const seeded = createEmptyProjectBrandDocument();
    const withColor = (extra: ProjectBrandDocument["colors"], fonts: ProjectBrandDocument["fonts"] = []): ProjectBrandDocument => ({
        ...seeded,
        colors: [...seeded.colors, ...extra],
        fonts,
    });

    it("is registered on the spec", () => {
        expect(typeof brandSpec.diff).toBe("function");
    });

    it("reports a recoloured project one colour at a time", () => {
        const base = withColor([
            {id: "sky", name: "Sky", value: "#8EC5D6"},
            {id: "dusk", name: "Dusk", value: "#3B2F4A"},
        ]);
        const head: ProjectBrandDocument = {
            ...base,
            colors: base.colors
                .filter(color => color.id !== "dusk")
                .map(color => {
                    if (color.id === "primary") {
                        return {...color, value: "#2B7F99"};
                    }
                    return color.id === "sky" ? {...color, name: "Sky blue", value: "#7FB8CC"} : color;
                }),
        };

        const diff = diffBrand(base, head, LIMIT);

        expect(diff.tier).toBe("semantic");
        expect(paths(diff)).toEqual(["colors/dusk", "colors/primary/value", "colors/sky/name", "colors/sky/value"]);

        expect(rowAt(diff, "colors/dusk")).toMatchObject({
            kind: "removed",
            subject: "Dusk",
            label: {key: "documentDiff.brand.removed", params: {from: "#3B2F4A"}},
        });
        // The seeded slot carries no subject: its name is a translated string the panel supplies,
        // so the row is the two colours and nothing the author did not write.
        expect(rowAt(diff, "colors/primary/value")).toStrictEqual({
            path: ["colors", "primary", "value"],
            kind: "changed",
            label: {key: "documentDiff.brand.value", params: {from: "#40A8C4", to: "#2B7F99"}},
        });
        expect(rowAt(diff, "colors/sky/name")).toMatchObject({
            subject: "Sky blue",
            label: {key: "documentDiff.brand.renamed", params: {from: "Sky", to: "Sky blue"}},
        });
        expect(rowAt(diff, "colors/sky/value")?.label.params).toStrictEqual({from: "#8EC5D6", to: "#7FB8CC"});
    });

    it("reports the default font stack as one row, and never as an asset id", () => {
        const base = withColor([], [{assetId: "font-serif"}]);
        const head = withColor([], [{assetId: "font-serif"}, {assetId: "font-cjk", locales: ["ja"]}]);

        const diff = diffBrand(base, head, LIMIT);

        expect(paths(diff)).toEqual(["fonts"]);
        expect(rowAt(diff, "fonts")).toStrictEqual({
            path: ["fonts"],
            kind: "changed",
            label: {key: "documentDiff.brand.fonts"},
        });
    });

    it("says nothing about a flag the author cannot set", () => {
        const base = withColor([{id: "sky", name: "Sky", value: "#8EC5D6"}]);
        const head = withColor([{id: "sky", name: "Sky", value: "#8EC5D6", builtin: true}]);

        expect(diffBrand(base, head, LIMIT).changes).toEqual([]);
    });
});

describe("the build variants diff", () => {
    const document = (tags: ProjectAppTagDocument["tags"], rest: Partial<ProjectAppTagDocument> = {}): ProjectAppTagDocument => ({
        schemaVersion: APP_TAG_SCHEMA_VERSION,
        tags,
        ...rest,
    });

    it("is registered on the spec", () => {
        expect(typeof appTagsSpec.diff).toBe("function");
    });

    it("reports what a variant now says differently, and what it went back to inheriting", () => {
        const base = document(
            [
                {id: "t-demo", name: "Demo", overrides: {displayName: "Chronicle Demo", version: "1.0.0"}},
                {id: "t-press", name: "Press", overrides: {}},
            ],
            {assetAxes: {rating: "teen"}},
        );
        const head = document(
            [
                {
                    id: "t-demo",
                    name: "Demo",
                    overrides: {displayName: "Chronicle Trial"},
                    assetAxes: {rating: "everyone"},
                },
                {id: "t-press", name: "Press kit", overrides: {}},
            ],
            {assetAxes: {rating: "mature"}},
        );

        const diff = diffAppTags(base, head, LIMIT);

        expect(diff.tier).toBe("semantic");
        expect(paths(diff)).toEqual([
            "tags/t-demo/displayName",
            "tags/t-demo/version",
            "tags/t-demo/assetAxes",
            "tags/t-press/name",
            "assetAxes",
        ]);

        expect(rowAt(diff, "tags/t-demo/displayName")).toMatchObject({
            kind: "changed",
            subject: "Demo",
            label: {key: "documentDiff.appTags.displayName", params: {from: "Chronicle Demo", to: "Chronicle Trial"}},
        });
        // Cleared, which is this variant going back to the project's version number. One side of the
        // pair is simply absent, which is what the surface draws for a value given up.
        expect(rowAt(diff, "tags/t-demo/version")).toMatchObject({
            kind: "removed",
            subject: "Demo",
            label: {key: "documentDiff.appTags.version", params: {from: "1.0.0"}},
        });
        expect(rowAt(diff, "tags/t-demo/assetAxes")).toMatchObject({
            kind: "added",
            subject: "Demo",
            label: {key: "documentDiff.appTags.assetAxes"},
        });
        expect(rowAt(diff, "tags/t-press/name")).toMatchObject({
            subject: "Press kit",
            label: {key: "documentDiff.appTags.renamed", params: {from: "Press", to: "Press kit"}},
        });
        // The project's own position on the axis - what every variant that states none inherits.
        // Nothing here names a variant, because this row does not belong to one.
        expect(rowAt(diff, "assetAxes")).toStrictEqual({
            path: ["assetAxes"],
            kind: "changed",
            label: {key: "documentDiff.appTags.assetAxes"},
        });
    });

    it("reports an added and a removed variant by the author's name for it", () => {
        const base = document([{id: "t-demo", name: "Demo", overrides: {}}]);
        const head = document([{id: "t-press", name: "Press kit", overrides: {}}]);

        const diff = diffAppTags(base, head, LIMIT);

        expect(rowAt(diff, "tags/t-demo")).toMatchObject({kind: "removed", subject: "Demo", label: {key: "documentDiff.appTags.removed"}});
        expect(rowAt(diff, "tags/t-press")).toMatchObject({kind: "added", subject: "Press kit", label: {key: "documentDiff.appTags.added"}});
    });

    it("reports the same variants in a different order as a reorder and nothing else", () => {
        const tags: ProjectAppTagDocument["tags"] = [
            {id: "t-demo", name: "Demo", overrides: {}},
            {id: "t-press", name: "Press", overrides: {}},
        ];

        const diff = diffAppTags(document(tags), document([tags[1], tags[0]]), LIMIT);

        expect(paths(diff)).toEqual(["tags"]);
        expect(rowAt(diff, "tags")).toMatchObject({kind: "moved", label: {key: "documentDiff.appTags.order"}});
    });
});

describe("the audio tracks diff", () => {
    const seeded = createSeededAudioTrackDocument();
    const document = (tracks: ProjectAudioTrack[]): ProjectAudioTrackDocument => ({
        schemaVersion: AUDIO_TRACK_SCHEMA_VERSION,
        tracks,
    });

    it("is registered on the spec", () => {
        expect(typeof audioTracksSpec.diff).toBe("function");
    });

    it("names the track and both buses when a track is re-routed", () => {
        const base = document([
            ...seeded.tracks,
            {id: "amb", name: "Ambience", parentId: "bgm", volume: 0.8, loop: true},
            {id: "ui", name: "Interface", parentId: "sound", volume: 1, loop: false},
        ]);
        const head = document([
            // The SFX bus is renamed in the same version, which is why each bus name is read from
            // the side it belongs to rather than from one of them.
            ...seeded.tracks.map(track => track.id === "sound" ? {...track, name: "Sound effects"} : track),
            {id: "amb", name: "Ambience", parentId: "sound", volume: 0.65, loop: false},
            {id: "ui", name: "Interface", parentId: null, volume: 1, loop: false},
        ]);

        const diff = diffAudioTracks(base, head, LIMIT);

        expect(diff.tier).toBe("semantic");
        expect(paths(diff)).toEqual([
            "tracks/amb/parentId",
            "tracks/amb/volume",
            "tracks/amb/loop",
            "tracks/sound/name",
            "tracks/ui/parentId",
        ]);

        // The row this whole spec exists for.
        expect(rowAt(diff, "tracks/amb/parentId")).toStrictEqual({
            path: ["tracks", "amb", "parentId"],
            kind: "moved",
            subject: "Ambience",
            label: {
                key: "documentDiff.audioTracks.rerouted",
                params: {from: "Music", to: "Sound effects"},
            },
        });
        // The fader's own number, not the stored 0..1.
        expect(rowAt(diff, "tracks/amb/volume")).toMatchObject({
            subject: "Ambience",
            label: {key: "documentDiff.audioTracks.volume", params: {from: "80", to: "65"}},
        });
        expect(rowAt(diff, "tracks/amb/loop")).toMatchObject({
            subject: "Ambience",
            label: {key: "documentDiff.audioTracks.loopOff"},
        });
        expect(rowAt(diff, "tracks/sound/name")).toMatchObject({
            subject: "Sound effects",
            label: {key: "documentDiff.audioTracks.renamed", params: {from: "SFX", to: "Sound effects"}},
        });
        // Nothing to name on the far side, so the row says where it landed instead of half a pair.
        // The bus it left is named as the OLDER document named it - it was still "SFX" when this
        // track hung off it, and quoting the new name would describe a mixer that never existed.
        expect(rowAt(diff, "tracks/ui/parentId")).toStrictEqual({
            path: ["tracks", "ui", "parentId"],
            kind: "moved",
            subject: "Interface",
            label: {key: "documentDiff.audioTracks.reroutedToMaster", params: {from: "SFX"}},
        });
    });

    it("reports an added and a removed track by the author's name for it", () => {
        const base = document([...seeded.tracks, {id: "amb", name: "Ambience", parentId: "bgm", volume: 1, loop: true}]);
        const head = document([...seeded.tracks, {id: "cro", name: "Crowd", parentId: "sound", volume: 1, loop: true}]);

        const diff = diffAudioTracks(base, head, LIMIT);

        expect(rowAt(diff, "tracks/amb")).toMatchObject({kind: "removed", subject: "Ambience", label: {key: "documentDiff.audioTracks.removed"}});
        expect(rowAt(diff, "tracks/cro")).toMatchObject({kind: "added", subject: "Crowd", label: {key: "documentDiff.audioTracks.added"}});
    });

    it("says nothing when only the timestamps moved", () => {
        const base = {...document([...seeded.tracks]), meta: {createdAt: "2026-01-01", updatedAt: "2026-01-01"}};
        const head = {...document([...seeded.tracks]), meta: {createdAt: "2026-01-01", updatedAt: "2026-08-23"}};

        expect(diffAudioTracks(base, head, LIMIT).changes).toEqual([]);
    });
});

describe("the variable registry diff", () => {
    const registry = (entries: VariableRegistryEntry[]): VariableRegistry => ({
        schemaVersion: VARIABLE_REGISTRY_SCHEMA_VERSION,
        entries: Object.fromEntries(entries.map(entry => [entry.id, entry])),
    });

    it("is registered on the spec", () => {
        expect(typeof variableRegistrySpec.diff).toBe("function");
    });

    it("reports a moved default, a moved scope and a new variable", () => {
        const base = registry([
            {id: "v-affection", name: "Affection", scope: "saved", valueType: "number", defaultValue: 0, storageKey: "v-affection"},
            {id: "v-seen", name: "Seen the prologue", scope: "persistent", valueType: "boolean", defaultValue: false, storageKey: "v-seen"},
        ]);
        const head = registry([
            {id: "v-affection", name: "Affection", scope: "saved", valueType: "number", defaultValue: 10, storageKey: "v-affection"},
            {id: "v-seen", name: "Seen the prologue", scope: "saved", valueType: "boolean", defaultValue: false, storageKey: "v-seen"},
            {id: "v-route", name: "Route", scope: "saved", valueType: "string", defaultValue: "none", storageKey: "v-route"},
        ]);

        const diff = diffVariableRegistry(base, head, LIMIT);

        expect(diff.tier).toBe("semantic");
        expect(paths(diff)).toEqual(["entries/v-affection/defaultValue", "entries/v-route", "entries/v-seen/scope"]);

        // The row this spec exists for: the shipped game starts every playthrough somewhere else now.
        expect(rowAt(diff, "entries/v-affection/defaultValue")).toStrictEqual({
            path: ["entries", "v-affection", "defaultValue"],
            kind: "changed",
            subject: "Affection",
            label: {key: "documentDiff.variables.defaultValue", params: {from: "0", to: "10"}},
        });
        expect(rowAt(diff, "entries/v-route")).toMatchObject({kind: "added", subject: "Route", label: {key: "documentDiff.variables.added"}});
        // The scope it is now in, rather than a pair of the file's own two words.
        expect(rowAt(diff, "entries/v-seen")).toBeUndefined();
        expect(rowAt(diff, "entries/v-seen/scope")).toStrictEqual({
            path: ["entries", "v-seen", "scope"],
            kind: "changed",
            subject: "Seen the prologue",
            label: {key: "documentDiff.variables.scopeSaved"},
        });
    });

    it("reports a moved storage key, which is what orphans the values already written", () => {
        const base = registry([{id: "v-affection", name: "Affection", scope: "saved", valueType: "number", storageKey: "affection"}]);
        const head = registry([{id: "v-affection", name: "Affection", scope: "saved", valueType: "number", storageKey: "affection2"}]);

        expect(rowAt(diffVariableRegistry(base, head, LIMIT), "entries/v-affection/storageKey")).toStrictEqual({
            path: ["entries", "v-affection", "storageKey"],
            kind: "changed",
            subject: "Affection",
            label: {key: "documentDiff.variables.storageKey"},
        });
    });
});

describe("the save schema diff", () => {
    const schema = (fields: SaveSchemaField[]): SaveSchema => ({
        schemaVersion: SAVE_SCHEMA_VERSION,
        fields: Object.fromEntries(fields.map(field => [field.id, field])),
    });

    it("is registered on the spec", () => {
        expect(typeof saveSchemaSpec.diff).toBe("function");
    });

    it("reports a removed field as the thing that breaks the saves players hold", () => {
        const base = schema([
            {id: "f-chapter", name: "Chapter", valueType: "string", storageKey: "chapter", order: 0},
            {id: "f-place", name: "Place", valueType: "string", storageKey: "place", order: 1},
        ]);
        const head = schema([
            {id: "f-chapter", name: "Chapter name", valueType: "string", defaultValue: "Prologue", storageKey: "chapter", order: 0},
            {id: "f-playtime", name: "Play time", valueType: "integer", storageKey: "playtime", order: 1},
        ]);

        const diff = diffSaveSchema(base, head, LIMIT);

        expect(diff.tier).toBe("semantic");
        expect(paths(diff)).toEqual([
            "fields/f-chapter/name",
            "fields/f-chapter/defaultValue",
            "fields/f-place",
            "fields/f-playtime",
        ]);

        // The row this spec exists for. The words are the catalogue's; what matters here is that a
        // removal is its own line, marked as a loss, and named after what the author called it.
        expect(rowAt(diff, "fields/f-place")).toStrictEqual({
            path: ["fields", "f-place"],
            kind: "removed",
            subject: "Place",
            label: {key: "documentDiff.saveSchema.removed"},
        });
        // Adding one is the safe half of the same pair, and reads as an addition rather than as a
        // warning.
        expect(rowAt(diff, "fields/f-playtime")).toMatchObject({
            kind: "added",
            subject: "Play time",
            label: {key: "documentDiff.saveSchema.added"},
        });
        expect(rowAt(diff, "fields/f-chapter/name")).toMatchObject({
            subject: "Chapter name",
            label: {key: "documentDiff.saveSchema.renamed", params: {from: "Chapter", to: "Chapter name"}},
        });
        expect(rowAt(diff, "fields/f-chapter/defaultValue")?.label).toStrictEqual({
            key: "documentDiff.saveSchema.defaultValue",
            params: {to: "Prologue"},
        });
    });

    it("keeps a re-ordered pin apart from a change to what the game stores", () => {
        const base = schema([{id: "f-chapter", name: "Chapter", valueType: "string", storageKey: "chapter", order: 0}]);
        const head = schema([{id: "f-chapter", name: "Chapter", valueType: "string", storageKey: "chapter", order: 3}]);

        expect(rowAt(diffSaveSchema(base, head, LIMIT), "fields/f-chapter/order")).toStrictEqual({
            path: ["fields", "f-chapter", "order"],
            kind: "moved",
            subject: "Chapter",
            label: {key: "documentDiff.saveSchema.reordered"},
        });
    });
});

describe("the project dictionary diff", () => {
    const document = (entries: ProjectDictionaryEntry[], options = DEFAULT_DICTIONARY_OPTIONS): ProjectDictionaryDocument => ({
        schemaVersion: PROJECT_DICTIONARY_SCHEMA_VERSION,
        entries,
        options: {...options},
    });

    it("is registered on the spec", () => {
        expect(typeof dictionarySpec.diff).toBe("function");
    });

    it("reports what changed about a term, and what the dictionary now does", () => {
        const base = document([
            {term: "Anyo", reading: "アンヨ"},
            {term: "Kamurocho", variants: ["Kamurocyo"], note: "The district"},
        ]);
        const head = document(
            [
                {term: "Anyo", reading: "アンヨォ"},
                {term: "Kamurocho", variants: ["Kamurocyo", "Kamuro-cho"], note: "The district"},
            ],
            {suggestReadings: true, checkVariants: false},
        );

        const diff = diffDictionary(base, head, LIMIT);

        expect(diff.tier).toBe("semantic");
        expect(paths(diff)).toEqual(["entries/Anyo/reading", "entries/Kamurocho/variants", "options/checkVariants"]);

        expect(rowAt(diff, "entries/Anyo/reading")).toStrictEqual({
            path: ["entries", "Anyo", "reading"],
            kind: "changed",
            subject: "Anyo",
            label: {key: "documentDiff.dictionary.reading", params: {from: "アンヨ", to: "アンヨォ"}},
        });
        // A list, so the row says which term gained one and leaves the two lists to the panel.
        expect(rowAt(diff, "entries/Kamurocho/variants")).toStrictEqual({
            path: ["entries", "Kamurocho", "variants"],
            kind: "changed",
            subject: "Kamurocho",
            label: {key: "documentDiff.dictionary.variants"},
        });
        // Said as what the dictionary does now: it decides what is marked in every script.
        expect(rowAt(diff, "options/checkVariants")).toStrictEqual({
            path: ["options", "checkVariants"],
            kind: "changed",
            label: {key: "documentDiff.dictionary.variantsOff"},
        });
    });

    it("reports a respelt term as one gone and one arrived, because the spelling is the identity", () => {
        const base = document([{term: "Kamurocho", note: "The district"}]);
        const head = document([{term: "Kamurochō", note: "The district"}]);

        const diff = diffDictionary(base, head, LIMIT);

        expect(paths(diff)).toEqual(["entries/Kamurocho", "entries/Kamurochō"]);
        expect(rowAt(diff, "entries/Kamurocho")).toMatchObject({kind: "removed", subject: "Kamurocho", label: {key: "documentDiff.dictionary.removed"}});
        expect(rowAt(diff, "entries/Kamurochō")).toMatchObject({kind: "added", subject: "Kamurochō", label: {key: "documentDiff.dictionary.added"}});
    });
});
