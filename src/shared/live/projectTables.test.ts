import { describe, expect, it } from "vitest";
import { makeAssetSetAxis, type AssetSet } from "@shared/types/assetSet";
import type { ProjectAudioTrack } from "@shared/types/audioTrack";
import type { ProjectDictionaryDocument } from "@shared/types/dictionary";
import { assetSetsDigest, audioTracksDigest, dictionaryDigest } from "./projectTables";

const DICTIONARY: ProjectDictionaryDocument = {
    schemaVersion: 2,
    entries: [{ term: "Kagurazaka", reading: "かぐらざか" }],
    options: { suggestReadings: true, checkVariants: true },
};

const TRACKS: ProjectAudioTrack[] = [
    { id: "bgm", name: "Music", parentId: null, volume: 1, loop: false },
];

const SETS: AssetSet[] = [
    { id: "s1", name: "Alice", type: "image", filter: [], axis: makeAssetSetAxis("release", []) },
];

/**
 * The three whole-document fingerprints, which exist to catch **disagreement** rather than change.
 *
 * What every case below is really about is the same question: does this digest answer differently
 * for two machines that hold the same table? Every "yes" it gets wrong ejects somebody from a room
 * over a difference no file can hold.
 */
describe("the fingerprints of the three project tables", () => {
    it("answers a value for a table this machine does not hold, never nothing", () => {
        // The reason absence is a value: all three are read as the workspace starts, so arriving at
        // an effect without one means this machine failed at something. Answering null would rule
        // `unproven` on exactly the effect that proves two copies have parted company.
        expect(dictionaryDigest(null)).toEqual(expect.any(String));
        expect(audioTracksDigest(null)).toEqual(expect.any(String));
        expect(assetSetsDigest(null)).toEqual(expect.any(String));
        expect(dictionaryDigest(null)).not.toBe(dictionaryDigest(DICTIONARY));
        expect(audioTracksDigest(null)).not.toBe(audioTracksDigest([]));
        expect(assetSetsDigest(null)).not.toBe(assetSetsDigest([]));
    });

    it("does not depend on the schema version a machine read the file at", () => {
        // A machine that migrated an older document on load holds the same table as one that did
        // not, and ejecting it would be ejecting it for having read the file.
        expect(dictionaryDigest({ ...DICTIONARY, schemaVersion: 1 })).toBe(dictionaryDigest(DICTIONARY));
    });

    it("sees a term, a reading and either check moving", () => {
        expect(dictionaryDigest({ ...DICTIONARY, entries: [{ term: "Kagurazaka" }] }))
            .not.toBe(dictionaryDigest(DICTIONARY));
        expect(dictionaryDigest({
            ...DICTIONARY,
            options: { suggestReadings: false, checkVariants: true },
        })).not.toBe(dictionaryDigest(DICTIONARY));
    });

    it("sees a bus re-routed, re-faded and re-ordered", () => {
        const rerouted = [{ ...TRACKS[0]!, parentId: "other" }];
        const quieter = [{ ...TRACKS[0]!, volume: 0.5 }];
        expect(audioTracksDigest(rerouted)).not.toBe(audioTracksDigest(TRACKS));
        expect(audioTracksDigest(quieter)).not.toBe(audioTracksDigest(TRACKS));

        const second: ProjectAudioTrack = { id: "sfx", name: "Sound", parentId: null, volume: 1, loop: false };
        expect(audioTracksDigest([TRACKS[0]!, second])).not.toBe(audioTracksDigest([second, TRACKS[0]!]));
    });

    it("sees a set renamed and a set filed somewhere else", () => {
        expect(assetSetsDigest([{ ...SETS[0]!, name: "Ben" }])).not.toBe(assetSetsDigest(SETS));
        expect(assetSetsDigest([{ ...SETS[0]!, groupId: "cast" }])).not.toBe(assetSetsDigest(SETS));
    });

    it("reads a key that is absent and a key set to undefined as one document", () => {
        // ⚠ `JSON.stringify` writes neither, so the two are the same bytes on disk. Hashing them
        // apart would eject a machine from the room over a difference no file can hold - and the
        // canonical encoder refuses `undefined` by name, so without the pruning this would throw
        // inside an applier and take the session down with it.
        const withUndefined = [{ ...SETS[0]!, groupId: undefined }] as unknown as AssetSet[];
        expect(assetSetsDigest(withUndefined)).toBe(assetSetsDigest(SETS));
    });
});
