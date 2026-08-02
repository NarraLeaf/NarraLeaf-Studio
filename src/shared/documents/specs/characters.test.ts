import {beforeEach, describe, expect, it} from "vitest";
import {CHARACTER_STORE_VERSION, CharacterStoreDocument} from "@shared/characters/characterStoreModel";
import {DocumentStorage, loadDocument, saveDocument} from "@shared/documents/documentIo";
import {CHARACTER_STORE_DOCUMENT_PATH, charactersSpec} from "@shared/documents/specs";
import {countDocumentChanges, DocumentChange} from "@shared/documents/diff";
import {resolveDocumentSpecForPath} from "@shared/documents/registry";
import {findCanonicalJsonDefect} from "@shared/documents/canonicalJson";
import type {LayeredAppearance, PresetAppearance, StoredCharacter} from "@shared/types/character/model";

class MemoryStorage implements DocumentStorage {
    public readonly files = new Map<string, string>();
    public readonly writes: string[] = [];

    public read(path: string): Promise<string | null> {
        return Promise.resolve(this.files.get(path) ?? null);
    }

    public write(path: string, text: string): Promise<void> {
        this.writes.push(path);
        this.files.set(path, text);
        return Promise.resolve();
    }

    public copy(fromPath: string, toPath: string): Promise<void> {
        const value = this.files.get(fromPath);
        if (value === undefined) {
            return Promise.reject(new Error(`no such file: ${fromPath}`));
        }
        this.files.set(toPath, value);
        return Promise.resolve();
    }
}

const PATH = CHARACTER_STORE_DOCUMENT_PATH;
let storage: MemoryStorage;

beforeEach(() => {
    storage = new MemoryStorage();
});

function preset(id: string, name: string, poses: PresetAppearance["poses"], defaultPoseId: string | null = null): StoredCharacter {
    return {
        profile: {
            id,
            name,
            description: "",
            tags: [],
            attributes: {},
            thumbnail: null,
            nicknames: [],
            appearance: {kind: "preset", poses, defaultPoseId},
        },
    };
}

function layered(id: string, name: string, appearance: LayeredAppearance): StoredCharacter {
    return {
        profile: {
            id, name, description: "", tags: [], attributes: {}, thumbnail: null, nicknames: [],
            appearance,
        },
    };
}

function store(...characters: StoredCharacter[]): CharacterStoreDocument {
    return {version: CHARACTER_STORE_VERSION, characters, groups: {}};
}

function diff(base: CharacterStoreDocument, head: CharacterStoreDocument, limit = 200) {
    // Through the registered spec rather than the function, so a `diff` the definition failed to
    // forward would fail here rather than pass in a unit test of something nothing calls.
    const spec = resolveDocumentSpecForPath(PATH)?.spec;
    expect(spec).toBe(charactersSpec);
    return spec!.diff!(base, head, {limit});
}

async function loadText(text: string) {
    storage.files.set(PATH, text);
    return loadDocument(charactersSpec, storage, PATH, {now: () => new Date("2026-08-01T00:00:00.000Z")});
}

describe("characters spec: reading and writing", () => {
    it("claims the store's existing path - it did not move house to become a document", () => {
        expect(PATH).toBe("editor/services/character.json");
        expect(charactersSpec.pathFor()).toBe(PATH);
        expect(resolveDocumentSpecForPath(PATH)?.spec.kind).toBe("characters");
    });

    it("round-trips a cast with every optional field absent", async () => {
        const document = store(preset("alice", "Alice", [{id: "p1", name: "angry", assetId: "asset-1"}], "p1"));

        await saveDocument(charactersSpec, storage, PATH, document);
        const result = await loadDocument(charactersSpec, storage, PATH);

        expect(result.status).toBe("loaded");
        // `toStrictEqual`: an absent optional key and one holding `undefined` are the whole subject
        // of this file, and `toEqual` calls them the same.
        expect(result.status === "loaded" && result.document).toStrictEqual(document);
        expect(result.status === "loaded" && result.normalized).toBe(true);
    });

    it("round-trips a cast with every optional field present", async () => {
        const document: CharacterStoreDocument = {
            version: CHARACTER_STORE_VERSION,
            characters: [{
                profile: {
                    id: "alice",
                    name: "Alice",
                    description: "the lead",
                    tags: ["main"],
                    attributes: {height: "165"},
                    thumbnail: "thumb-1",
                    nicknames: ["Al"],
                    groupId: "g1",
                    color: "#40a8c4",
                    portrait: {x: 0.1, y: 0.2, w: 0.3, h: 0.4},
                    defaultAvatarAssetId: "avatar-1",
                    voiceTrackId: "track-1",
                    appearance: {
                        kind: "preset",
                        poses: [{id: "p1", name: "angry", folder: "school", assetId: "a1", portrait: {x: 0, y: 0, w: 1, h: 1}}],
                        defaultPoseId: "p1",
                        avatars: {p1: {baked: "fp", overrideAssetId: null, portrait: {x: 0, y: 0, w: 1, h: 1}}},
                    },
                },
            }],
            groups: {g1: {id: "g1", name: "Heroes", createdAt: 1, updatedAt: 2}},
        };

        await saveDocument(charactersSpec, storage, PATH, document);
        const result = await loadDocument(charactersSpec, storage, PATH);

        expect(result.status === "loaded" && result.document).toStrictEqual(document);
        expect(result.status === "loaded" && result.normalized).toBe(true);
    });

    /**
     * The one byte-shape fact worth pinning: `ServiceAssetsService.writeStore` wrote this file with
     * `JSON.stringify` - one line, insertion order, no trailing newline - and the spec writes
     * canonical JSON. They are NOT the same bytes, which is why `CharacterService` had to be moved
     * onto the spec in the same change: two writers with two layouts would flip the file back and
     * forth and put a whole-file diff in front of the author on every second save.
     */
    it("writes canonical bytes, which are not what the old store writer produced", async () => {
        const document = store(preset("alice", "Alice", [], null));

        await saveDocument(charactersSpec, storage, PATH, document);
        const written = storage.files.get(PATH)!;

        expect(written).not.toBe(JSON.stringify(document));
        expect(written.endsWith("\n")).toBe(true);
        expect(written.indexOf("\"characters\"")).toBeLessThan(written.indexOf("\"version\""));
    });

    it("refuses a store a newer Studio wrote, before the migration can touch it", async () => {
        const result = await loadText(JSON.stringify({
            version: CHARACTER_STORE_VERSION + 5,
            characters: [{profile: {id: "a", name: "A", appearance: {kind: "hologram", frames: []}}}],
        }));

        expect(result.status).toBe("corrupt");
        expect(result.status === "corrupt" && result.error.reason).toContain("newer version of Studio");
        // The kind this build has never heard of is still on disk. Had the migration run, it would
        // have read `hologram` as the pre-rework model and replaced the character with an empty preset.
        expect(storage.files.get(PATH)).toContain("hologram");
        expect(storage.writes).toEqual([]);
        // And the bytes travel on the error, which is how `CharacterService` still shows such a cast.
        expect(result.status === "corrupt" && JSON.parse(result.error.text).characters).toHaveLength(1);
    });

    it("refuses a characters field that is not an array", async () => {
        const result = await loadText("{\"characters\": {\"alice\": {}}}");

        expect(result.status).toBe("corrupt");
        expect(result.status === "corrupt" && result.error.reason).toContain("\"characters\" must be an array");
    });

    it("refuses a groups field that is not a map", async () => {
        expect((await loadText("{\"characters\": [], \"groups\": []}")).status).toBe("corrupt");
    });

    it("treats a store with no characters key as an empty cast rather than as damage", async () => {
        const result = await loadText("{}");

        expect(result.status).toBe("loaded");
        expect(result.status === "loaded" && result.document.characters).toEqual([]);
        expect(result.status === "loaded" && result.normalized).toBe(false);
    });

    /**
     * The migration is the dangerous half of the audit: a `folder: undefined` written by it reaches
     * every project that has not been opened since the appearance rework, and it surfaces as "the
     * spec is broken" rather than as "this file is corrupt".
     */
    it("migrates a pre-rework store into something that can actually be saved", async () => {
        const result = await loadText(JSON.stringify({
            characters: [{
                profile: {
                    id: "alice",
                    name: "Alice",
                    description: "",
                    tags: [],
                    attributes: {},
                    thumbnail: null,
                    nicknames: [],
                    appearance: {forms: [{name: "school", variantAssets: {angry: {data: {id: "asset-1"}}}}]},
                },
            }],
        }));

        expect(result.status).toBe("loaded");
        if (result.status !== "loaded") return;
        const appearance = result.document.characters[0].profile.appearance as PresetAppearance;
        expect(appearance.kind).toBe("preset");
        expect(appearance.poses[0].name).toBe("angry");
        expect(appearance.poses[0].assetId).toBe("asset-1");
        // A single-form legacy character gets no folder, and "no folder" has to mean the key is gone.
        expect("folder" in appearance.poses[0]).toBe(false);
        expect("portrait" in appearance.poses[0]).toBe(false);
        expect(findCanonicalJsonDefect(result.document)).toBeNull();
        await expect(saveDocument(charactersSpec, storage, PATH, result.document)).resolves.toBeUndefined();
    });

    it("summarizes the two counts a revision is checked against", () => {
        const summary = charactersSpec.summarize(store(preset("a", "A", []), preset("b", "B", [])));

        expect(summary.title).toBe("");
        expect(summary.counts).toEqual([
            {key: "characters", value: 2},
            {key: "characterGroups", value: 0},
        ]);
    });
});

describe("characters spec: diff", () => {
    /** The example the whole milestone is named after. */
    it("reports a changed differential as ONE row naming the character and the variant", () => {
        const base = store(preset("alice", "Alice", [
            {id: "p1", name: "angry", assetId: "asset-1"},
            {id: "p2", name: "happy", assetId: "asset-2"},
        ]));
        const head = store(preset("alice", "Alice", [
            {id: "p1", name: "angry", assetId: "asset-9"},
            {id: "p2", name: "happy", assetId: "asset-2"},
        ]));

        const result = diff(base, head);

        expect(result.tier).toBe("semantic");
        expect(result.complete).toBe(true);
        expect(result.changes).toHaveLength(1);
        const [row] = result.changes;
        expect(row.subject).toBe("Alice");
        expect(row.children).toHaveLength(1);
        expect(row.children![0].subject).toBe("angry");
        expect(row.children![0].label.key).toBe("documentDiff.characters.poseAsset");
        expect(row.children![0].path).toEqual(["characters", "alice", "appearance", "poses", "p1", "assetId"]);
    });

    it("says the same thing for a layered character, naming the tag rather than the layer id", () => {
        const appearance = (angryAsset: string): LayeredAppearance => ({
            kind: "layered",
            canvas: {width: 100, height: 100},
            axes: [{id: "x1", name: "expression", tags: [{id: "t1", name: "angry"}], defaultTagId: "t1"}],
            layers: [{id: "l1", name: "face", axisId: "x1", assetId: null, options: {t1: angryAsset}}],
        });

        const result = diff(store(layered("alice", "Alice", appearance("a1"))), store(layered("alice", "Alice", appearance("a9"))));

        expect(result.changes).toHaveLength(1);
        const leaf = result.changes[0].children![0];
        expect(leaf.label.key).toBe("documentDiff.characters.layerOptionAsset");
        expect(leaf.subject).toBe("angry");
        expect(leaf.label.params).toEqual({layer: "face", tag: "angry"});
    });

    it("reports two people adding two characters as two independent rows", () => {
        const base = store(preset("alice", "Alice", []));
        const head = store(preset("alice", "Alice", []), preset("bob", "Bob", []), preset("zoe", "Zoe", []));

        const result = diff(base, head);

        expect(result.changes.map(change => [change.kind, change.subject])).toEqual([
            ["added", "Bob"],
            ["added", "Zoe"],
        ]);
    });

    it("reports a kind switch once, without listing the poses it discarded", () => {
        const base = store(preset("alice", "Alice", [{id: "p1", name: "angry", assetId: "a1"}], "p1"));
        const head = store(layered("alice", "Alice", {kind: "layered", canvas: null, axes: [], layers: []}));

        const result = diff(base, head);

        expect(result.changes[0].children).toHaveLength(1);
        expect(result.changes[0].children![0].label.key).toBe("documentDiff.characters.kindChanged");
        expect(result.changes[0].children![0].label.params).toEqual({from: "preset", to: "layered"});
    });

    it("reports a reordered cast as one row about the order, not a row per character", () => {
        const alice = preset("alice", "Alice", []);
        const bob = preset("bob", "Bob", []);

        const result = diff(store(alice, bob), store(bob, alice));

        expect(result.changes).toHaveLength(1);
        expect(result.changes[0]).toMatchObject({kind: "moved", label: {key: "documentDiff.characters.castOrder"}});
    });

    it("gives identical documents an empty, complete diff", () => {
        const document = store(preset("alice", "Alice", [{id: "p1", name: "angry", assetId: "a1"}]));

        expect(diff(document, structuredClone(document))).toMatchObject({changes: [], total: 0, complete: true});
    });

    /**
     * Key order is not content. Two stores whose objects were built by different code paths - a
     * migration and an editor, which is exactly the pair a diff compares - must not read as changed.
     */
    it("does not report a change when only key order differs", () => {
        const base = store(preset("alice", "Alice", []));
        const reordered = JSON.parse(JSON.stringify(base)) as CharacterStoreDocument;
        reordered.characters[0].profile = {
            appearance: base.characters[0].profile.appearance,
            nicknames: [], thumbnail: null, attributes: {}, tags: [], description: "", name: "Alice", id: "alice",
        };

        expect(diff(base, reordered).changes).toEqual([]);
    });

    it("respects the budget, sorts before it truncates, and says how much is missing", () => {
        const many = (count: number, asset: string) => store(...Array.from({length: count}, (_, index) =>
            preset(`c${index}`, `Char ${String(index).padStart(2, "0")}`, [{id: "p1", name: "angry", assetId: asset}])));

        const result = diff(many(10, "a1"), many(10, "a9"), 4);

        expect(result.total).toBe(10);
        expect(result.complete).toBe(false);
        expect(countDocumentChanges(result.changes as DocumentChange[])).toBe(4);
        // The rows that survived are the first four BY NAME, not the first four that happened to be
        // built - which is the whole reason the list is sorted before `buildDocumentDiff` sees it.
        expect(result.changes.map(change => change.subject)).toEqual(["Char 00", "Char 01", "Char 02", "Char 03"]);
    });

    it("never throws, whatever shape it is handed", () => {
        const broken = {characters: [null, {profile: null}, {profile: {id: "a"}}]} as unknown as CharacterStoreDocument;

        expect(() => diff(broken, {characters: []} as CharacterStoreDocument)).not.toThrow();
        expect(() => diff({} as CharacterStoreDocument, broken)).not.toThrow();
    });
});
