import { describe, expect, it } from "vitest";
import { assetsDigest } from "@shared/live/assets";
import { castDigest, characterAt, characterRecordDigest } from "@shared/live/cast";
import { takesDigest, translationsDigest } from "@shared/live/libraries";
import { sceneDigest } from "@shared/live/sceneDigest";
import { makeAssetSetAxis } from "@shared/types/assetSet";
import {
    CLAIMED_OPS,
    assetClaimKey,
    characterClaimKey,
    opClaimKeys,
    opDocumentKind,
    storyRowClaimKey,
    translationClaimKey,
    type LiveAssetFolder,
    type LiveAssetRecord,
    type LiveDocument,
    type LiveEffect,
    type LiveIntent,
    type LiveMessage,
    type LiveOp,
    type LiveRefusal,
    type LiveRefusalReason,
} from "@shared/live/ops";
import type { CharacterGroup, StoredCharacter } from "@shared/types/character/model";
import type { LocalizationUnit } from "@shared/types/localization";
import type { VoiceUnit } from "@shared/types/voice";
import type {
    StoryBlock,
    StoryBlockId,
    StoryControlBlock,
    StoryNoteBlock,
    StoryScene,
    StorySceneId,
} from "@shared/types/story";
import {
    deleteBlockFromScene,
    insertBlockInScene,
    moveBlockInScene,
    updateBlockPayload,
} from "@/lib/workspace/services/story/storyModel";
import { CLAIM_REASSERT_MS, DEFAULT_CLAIM_TIMEOUT_MS, LiveClaimStore } from "./claims";
import { LiveHost, type LiveOutbound } from "./liveHost";

const STORY = "story-1";

/* ----------------------------------------------------------------- a document to edit */

function note(id: StoryBlockId, value: string = id): StoryNoteBlock {
    return {
        id,
        kind: "note",
        parentId: null,
        childrenIds: [],
        payload: { text: { textId: `text-${id}`, value, role: "note" } },
    };
}

function group(id: StoryBlockId): StoryControlBlock {
    return { id, kind: "control", parentId: null, childrenIds: [], payload: { control: "sequence" } };
}

/** A scene built the way the story service builds one, so the tests edit a real document. */
function makeScene(id: StorySceneId, rows: { block: StoryBlock; parentId?: StoryBlockId | null }[]): StoryScene {
    const scene: StoryScene = { id, name: `Scene ${id}`, runtimeName: id, rootBlockIds: [], blocks: {} };
    for (const row of rows) {
        insertBlockInScene(scene, row.block, { parentId: row.parentId ?? null, beforeBlockId: null });
    }
    return scene;
}

/** The row ids of a scene in document order, flattened, so an arrangement can be asserted as one line. */
function order(scene: StoryScene, parentId: StoryBlockId | null = null): StoryBlockId[] {
    const ids = parentId === null ? scene.rootBlockIds : scene.blocks[parentId].childrenIds;
    return ids.flatMap(id => [id, ...order(scene, id)]);
}

/* --------------------------------------------------------------------- a host to test */

type World = {
    host: LiveHost;
    scenes: Record<StorySceneId, StoryScene>;
    story: { name: string; entrySceneId: StorySceneId | null; chapterIds: readonly string[] };
    /** The cast, the second document a session carries. Mutated by the applier below. */
    cast: { characters: Record<string, StoredCharacter>; order: string[]; groups: Record<string, CharacterGroup> };
    /** The libraries this session carries, by language. */
    translations: Record<string, Record<string, LocalizationUnit>>;
    takes: Record<string, Record<string, VoiceUnit>>;
    /** The asset metadata shards this session carries, by type. */
    assets: Record<string, Record<string, LiveAssetRecord>>;
    /** The folder shards this session carries, by section. */
    folders: Record<string, Record<string, LiveAssetFolder>>;
    /** The mixer and the asset sets, two of the three tables a session always carries. */
    tracks: { id: string }[];
    sets: { id: string }[];
    /** Every operation the applier was actually handed, in order. */
    applied: LiveOp[];
};

/** The languages every host in these tests carries libraries for. */
const LOCALES = { translations: ["ja"], voice: ["ja"] };

/** The asset shards every host in these tests carries. */
const ASSET_TYPES = ["image", "audio"];

/** The sections every host in these tests carries folders for. */
const ASSET_CATEGORIES = ["image", "media"];

/** An asset record with nothing on it but what addresses it and what an edit can move. */
function asset(id: string, name = `${id}.png`, groupId?: string): LiveAssetRecord {
    return { id, type: "image", name, hash: `hash-${id}`, tags: [], description: "", ...(groupId ? { groupId } : {}) };
}

/** A translation with nothing on it but what a comparison needs. */
function translation(target: string): LocalizationUnit {
    return { target, sourceHash: "h", status: "translated" };
}

/** A take with nothing on it but what a comparison needs. */
function take(assetId: string): VoiceUnit {
    return { assetId, sourceHash: "h", status: "linked" };
}

/** A character record with nothing on it but what addresses it. */
function record(id: string, name = id): StoredCharacter {
    return {
        profile: {
            id,
            name,
            description: "",
            tags: [],
            attributes: {},
            thumbnail: null,
            nicknames: [],
            appearance: { kind: "preset", poses: [], defaultPoseId: null },
        },
    };
}

function makeWorld(options: {
    scenes?: StoryScene[];
    members?: string[];
    /** Claim key to the instance holding it, answered INSTEAD of the host's own store. */
    claims?: Record<string, string>;
    /** The cast this host starts with. Empty when a test is only about the story. */
    cast?: StoredCharacter[];
    /** The Japanese translations this host starts with. */
    translations?: Record<string, LocalizationUnit>;
    /** The Japanese voice takes this host starts with. */
    takes?: Record<string, VoiceUnit>;
    /** The image records this host starts with. */
    assets?: Record<string, LiveAssetRecord>;
    /** The image folders this host starts with. */
    folders?: Record<string, LiveAssetFolder>;
    /** The host's own record, when a test wants to set the clock a claim lapses against. */
    claimStore?: LiveClaimStore;
    /**
     * Instance to account. Absent means every instance is its own account, which is the shorthand
     * the claim assertions below read in; a table present makes an instance it does not name one
     * this host cannot put a person's name to.
     */
    accounts?: Record<string, string>;
    receiptLimit?: number;
} = {}): World {
    const scenes: Record<StorySceneId, StoryScene> = {};
    for (const scene of options.scenes ?? [makeScene("s1", [{ block: note("a") }, { block: note("b") }, { block: note("c") }])]) {
        scenes[scene.id] = scene;
    }
    const story = { name: "Skeleton", entrySceneId: "s1" as StorySceneId | null, chapterIds: ["c1", "c2"] as readonly string[] };
    const cast: World["cast"] = { characters: {}, order: [], groups: {} };
    for (const member of options.cast ?? []) {
        cast.characters[member.profile.id] = member;
        cast.order.push(member.profile.id);
    }
    const translations: World["translations"] = { ja: { ...(options.translations ?? {}) } };
    const takes: World["takes"] = { ja: { ...(options.takes ?? {}) } };
    const assets: World["assets"] = { image: { ...(options.assets ?? {}) }, audio: {} };
    const folders: World["folders"] = { image: { ...(options.folders ?? {}) }, media: {} };
    // One of each is enough for the two refusals these documents have: the host asks only whether a
    // record is there, and everything else about them is last-writer-wins.
    const tracks: World["tracks"] = [{ id: "bgm" }];
    const sets: World["sets"] = [{ id: "alice" }];
    const applied: LiveOp[] = [];
    let seq = 0;

    const world: World = {
        scenes,
        story,
        cast,
        translations,
        takes,
        assets,
        folders,
        tracks,
        sets,
        applied,
        host: new LiveHost({
            self: "host",
            stories: [STORY],
            locales: LOCALES,
            assetTypes: ASSET_TYPES,
            readScene: (_storyId, id) => scenes[id] ?? null,
            readCharacter: id => cast.characters[id] ?? null,
            hasAsset: (assetType, assetId) => assets[assetType]?.[assetId] !== undefined,
            assetCategories: ASSET_CATEGORIES,
            readAssetFolders: category => folders[category] ?? null,
            hasAudioTrack: trackId => tracks.some(track => track.id === trackId),
            hasAssetSet: setId => sets.some(set => set.id === setId),
            digestOf: scope => {
                if (scope.of === "scene") {
                    const scene = scenes[scope.sceneId];
                    return scene ? sceneDigest(scene) : null;
                }
                if (scope.of === "character") {
                    return characterRecordDigest(characterAt(cast, scope.characterId));
                }
                if (scope.of === "translations") {
                    return translationsDigest(translations[scope.locale] ?? null);
                }
                if (scope.of === "takes") {
                    return takesDigest(takes[scope.locale] ?? null);
                }
                if (scope.of === "assets") {
                    return assetsDigest(assets[scope.assetType] ?? null);
                }
                if (scope.of === "asset-groups") {
                    return assetsDigest(folders[scope.category] ?? null);
                }
                return castDigest(cast);
            },
            applyOp: op => {
                applied.push(op);
                apply(scenes, story, cast, translations, takes, assets, folders, op);
            },
            nextSeq: () => ++seq,
            isMember: options.members ? instance => options.members?.includes(instance) ?? false : undefined,
            claimBlocking: options.claims
                // A real predicate answers with the account holding the row; here the instance ids
                // stand in for accounts, which is all the host needs to be told.
                ? (key, by) => {
                    const holder = options.claims?.[key];
                    return holder && holder !== by ? holder : null;
                }
                : undefined,
            accountOf: instance => (options.accounts ? options.accounts[instance] ?? null : instance),
            ...(options.claimStore === undefined ? {} : { claims: options.claimStore }),
            receiptLimit: options.receiptLimit,
        }),
    };
    return world;
}

function apply(
    scenes: Record<StorySceneId, StoryScene>,
    story: World["story"],
    cast: World["cast"],
    translations: World["translations"],
    takes: World["takes"],
    assets: World["assets"],
    folders: World["folders"],
    op: LiveOp,
): void {
    switch (op.op) {
        // The three project tables are last-writer-wins apart from the two presence checks above,
        // so nothing here has to model them - what the tests below read is `world.applied`.
        case "set-dictionary-entry":
        case "set-dictionary-options":
        case "create-audio-track":
        case "update-audio-track":
        case "delete-audio-track":
        case "move-audio-track":
        case "create-asset-sets":
        case "update-asset-set":
        case "delete-asset-sets":
        case "move-asset-sets":
            return;
        case "create-assets":
            for (const create of op.creates) {
                assets[op.assetType][String(create.record.id)] = structuredClone(create.record) as LiveAssetRecord;
            }
            return;
        case "replace-asset-content":
            assets[op.assetType][op.assetId] = structuredClone(op.record) as LiveAssetRecord;
            return;
        case "delete-assets":
            for (const assetId of op.assetIds) {
                delete assets[op.assetType][assetId];
            }
            return;
        case "set-asset-folder":
            folders[op.category][op.folderId] = structuredClone(op.folder) as LiveAssetFolder;
            return;
        case "delete-asset-folder":
            delete folders[op.category][op.folderId];
            return;
        case "restore-asset-folder":
            for (const folder of op.folders) {
                folders[op.category][String(folder.id)] = structuredClone(folder) as LiveAssetFolder;
            }
            return;
        case "update-asset":
            assets[op.assetType][op.assetId] = structuredClone(op.record) as LiveAssetRecord;
            return;
        case "move-assets":
            for (const move of op.moves) {
                const record = assets[op.assetType][move.assetId];
                if (!record) {
                    continue;
                }
                if (move.groupId === null) {
                    delete (record as Record<string, unknown>).groupId;
                } else {
                    (record as Record<string, unknown>).groupId = move.groupId;
                }
            }
            return;
        case "set-translation":
            writeLibrary(translations[op.locale], [{ unitId: op.unitId, unit: op.unit }]);
            return;
        case "set-translations":
            writeLibrary(translations[op.locale], op.units);
            return;
        case "set-take":
            writeLibrary(takes[op.locale], [{ unitId: op.unitId, unit: op.unit }]);
            return;
        case "set-takes":
            writeLibrary(takes[op.locale], op.units);
            return;
        case "create-character":
            cast.characters[op.character.profile.id] = structuredClone(op.character);
            if (!cast.order.includes(op.character.profile.id)) {
                cast.order.push(op.character.profile.id);
            }
            return;
        case "update-character":
            cast.characters[op.characterId] = structuredClone(op.character);
            return;
        case "set-character-group":
            cast.groups[op.groupId] = { ...op.group };
            for (const memberId of op.members ?? []) {
                const member = cast.characters[memberId];
                if (member) {
                    member.profile.groupId = op.groupId;
                }
            }
            return;
        case "delete-character-group":
            delete cast.groups[op.groupId];
            for (const member of Object.values(cast.characters)) {
                if (member.profile.groupId === op.groupId) {
                    delete member.profile.groupId;
                }
            }
            return;
        case "insert-block":
            // A clone, because the block arrived from somebody else's memory and the document keeps
            // what it is given - the same thing writing it through IPC would do.
            insertBlockInScene(scenes[op.sceneId], structuredClone(op.block), op.target);
            return;
        case "update-block":
            updateBlockPayload(scenes[op.sceneId], op.blockId, op.payload);
            return;
        case "update-blocks":
            for (const edit of op.edits) {
                updateBlockPayload(scenes[edit.sceneId], edit.blockId, edit.payload);
            }
            return;
        case "insert-blocks":
            for (const insert of op.inserts) {
                insertBlockInScene(scenes[op.sceneId], structuredClone(insert.block), insert.target);
            }
            return;
        case "delete-block":
            deleteBlockFromScene(scenes[op.sceneId], op.blockId);
            return;
        case "delete-blocks":
            for (const blockId of op.blockIds) {
                deleteBlockFromScene(scenes[op.sceneId], blockId);
            }
            return;
        case "move-block":
            moveBlockInScene(scenes[op.sceneId], op.blockId, op.target);
            return;
        case "move-blocks":
            for (const move of op.moves) {
                for (const blockId of move.blockIds) {
                    moveBlockInScene(scenes[op.sceneId], blockId, move.target);
                }
            }
            return;
        case "set-block-disabled": {
            const block = scenes[op.sceneId].blocks[op.blockId];
            if (op.disabled) {
                block.disabled = true;
            } else {
                delete block.disabled;
            }
            return;
        }
        case "rename-scene":
            scenes[op.sceneId].name = op.name;
            return;
        case "set-entry-scene":
            story.entrySceneId = op.sceneId;
            return;
        case "rename-story":
            story.name = op.name;
            return;
        case "reorder-chapters":
            story.chapterIds = [...op.chapterIds];
            return;
    }
}

/** One library applier for both kinds: a null entry removes, anything else replaces. */
function writeLibrary<T>(units: Record<string, T> | undefined, entries: readonly { unitId: string; unit: T | null }[]): void {
    if (!units) {
        return;
    }
    for (const entry of entries) {
        if (entry.unit === null) {
            delete units[entry.unitId];
        } else {
            units[entry.unitId] = entry.unit;
        }
    }
}

let nextClientId = 0;

function intent(op: LiveOp, clientId: string = `c${++nextClientId}`): LiveIntent {
    return { kind: "intent", clientId, document: documentOf(op), op };
}

/**
 * The address the message carries, which the host checks against the verb.
 *
 * Defensive about the shape because one of the cases below sends an operation that is not an object
 * at all - the message came off a channel another Studio wrote to - and the address has to be built
 * before the host has had a chance to refuse it.
 */
function documentOf(op: LiveOp): LiveDocument {
    const kind = op === null || typeof op !== "object" ? undefined : opDocumentKind(op);
    switch (kind) {
        case "characters":
            return { doc: "characters" };
        // Read off the operation, which is the only way the address and the verb can be guaranteed
        // to agree - and what `opAddresses` checks on arrival.
        case "localization":
            return { doc: "localization", locale: (op as { locale: string }).locale };
        case "voice":
            return { doc: "voice", locale: (op as { locale: string }).locale };
        case "assets":
            return { doc: "assets", assetType: (op as { assetType: string }).assetType };
        case "asset-groups":
            return { doc: "asset-groups", category: (op as { category: string }).category };
        // One of each per project, so the kind is the whole address.
        case "dictionary":
            return { doc: "dictionary" };
        case "audio-tracks":
            return { doc: "audio-tracks" };
        case "asset-sets":
            return { doc: "asset-sets" };
        default:
            return { doc: "story", storyId: STORY };
    }
}

function send(world: World, op: LiveOp, from = "guest-1"): LiveOutbound | null {
    return world.host.receive(intent(op), from);
}

function asEffect(outbound: LiveOutbound | null): LiveEffect {
    expect(outbound?.kind).toBe("effect");
    return outbound as LiveEffect;
}

function asRefusal(outbound: LiveOutbound | null): LiveRefusal {
    expect(outbound?.kind).toBe("refusal");
    return outbound as LiveRefusal;
}

/* ---------------------------------------------------------------------------- the rules */

describe("a live host turning intents into effects", () => {
    it("applies intents one at a time, in arrival order, and numbers what it did", () => {
        const world = makeWorld();
        const first = asEffect(send(world, { op: "rename-scene", sceneId: "s1", name: "Corridor" }));
        const second = asEffect(send(world, { op: "rename-scene", sceneId: "s1", name: "Rooftop" }));

        expect([first.seq, second.seq]).toEqual([1, 2]);
        expect(world.applied.map(op => (op.op === "rename-scene" ? op.name : ""))).toEqual(["Corridor", "Rooftop"]);
        expect(world.scenes.s1.name).toBe("Rooftop");
        expect(world.host.log.after(0).map(effect => effect.seq)).toEqual([1, 2]);
    });

    it("says who asked, on every effect", () => {
        const world = makeWorld();
        expect(asEffect(send(world, { op: "rename-story", name: "Rain" }, "guest-7")).by).toBe("guest-7");
    });

    it("carries a paste's derived entries on to the room", () => {
        // Nobody else can look them up: the copier read them out of its own memory at the moment of
        // copying, so if the effect does not carry them they exist on one machine only.
        const world = makeWorld();
        const derived = { translations: { ja: { "text-new": { target: "遅いよ。", sourceHash: "h", status: "reviewed" as const } } } };
        const effect = asEffect(world.host.receive(
            {
                kind: "intent",
                clientId: "paste",
                document: { doc: "story", storyId: STORY },
                op: { op: "insert-block", sceneId: "s1", block: note("new"), target: { parentId: null } },
                derived,
            },
            "guest-1",
        ));

        expect(effect.derived).toEqual(derived);
    });
});

describe("an intent that arrives twice", () => {
    it("produces one effect, and the repeat gets the original back", () => {
        const world = makeWorld();
        const op: LiveOp = { op: "insert-block", sceneId: "s1", block: note("new"), target: { parentId: null, beforeBlockId: "b" } };
        const first = world.host.receive(intent(op, "retry-me"), "guest-1");
        const again = world.host.receive(intent(op, "retry-me"), "guest-1");

        expect(again).toBe(first);
        expect(world.applied).toHaveLength(1);
        expect(world.host.log.length).toBe(1);
        expect(order(world.scenes.s1)).toEqual(["a", "new", "b", "c"]);
    });

    it("answers a repeated refusal with the same refusal", () => {
        const world = makeWorld();
        const op: LiveOp = { op: "update-block", sceneId: "s1", blockId: "gone", payload: note("gone").payload };
        const first = world.host.receive(intent(op, "retry-me"), "guest-1");

        expect(world.host.receive(intent(op, "retry-me"), "guest-1")).toBe(first);
    });

    it("applies a retry that arrives after its answer has been forgotten", () => {
        // What the bound on the receipt memory costs, stated as a test so nobody discovers it as a
        // surprise: the answer to `first` is dropped once two later intents have been answered, and
        // the third copy of it is an intent the host has never seen.
        const world = makeWorld({ receiptLimit: 2 });
        const op: LiveOp = { op: "rename-scene", sceneId: "s1", name: "Corridor" };
        const first = asEffect(world.host.receive(intent(op, "old-news"), "guest-1"));
        send(world, { op: "rename-story", name: "Rain" });
        send(world, { op: "rename-story", name: "Snow" });
        const late = asEffect(world.host.receive(intent(op, "old-news"), "guest-1"));

        expect(late).not.toBe(first);
        expect(late.seq).toBeGreaterThan(first.seq);
    });
});

describe("an operation on a row that is gone", () => {
    const cases: { name: string; op: LiveOp }[] = [
        { name: "update", op: { op: "update-block", sceneId: "s1", blockId: "b", payload: note("b", "edited").payload } },
        { name: "delete", op: { op: "delete-block", sceneId: "s1", blockId: "b" } },
        { name: "disable", op: { op: "set-block-disabled", sceneId: "s1", blockId: "b", disabled: true } },
        { name: "move", op: { op: "move-block", sceneId: "s1", blockId: "b", target: { parentId: null, beforeBlockId: "a" } } },
    ];

    for (const { name, op } of cases) {
        it(`refuses a ${name} with row-gone and changes nothing`, () => {
            const world = makeWorld();
            send(world, { op: "delete-block", sceneId: "s1", blockId: "b" });
            const before = sceneDigest(world.scenes.s1);

            const refusal = asRefusal(send(world, op));

            expect(refusal.reason).toBe("row-gone");
            expect(sceneDigest(world.scenes.s1)).toBe(before);
            expect(world.applied).toHaveLength(1);
        });
    }

    it("says the row is gone and nothing whatever about the words", () => {
        // The interface built on this tells the author their line has vanished and leaves the box
        // exactly as they left it. A refusal that carried anything else - a payload to fall back to,
        // a flag, a scene to reload - would be an invitation to throw away what they had typed.
        const world = makeWorld();
        send(world, { op: "delete-block", sceneId: "s1", blockId: "b" });
        const refusal = asRefusal(send(world, { op: "update-block", sceneId: "s1", blockId: "b", payload: note("b", "mine").payload }));

        expect(Object.keys(refusal).sort()).toEqual(["clientId", "kind", "reason"]);
    });
});

describe("an insert aimed at a row that has been deleted", () => {
    it("lands where that row was, and says so", () => {
        const world = makeWorld();
        send(world, { op: "delete-block", sceneId: "s1", blockId: "b" });

        const effect = asEffect(send(world, {
            op: "insert-block",
            sceneId: "s1",
            block: note("new"),
            target: { parentId: null, beforeBlockId: "b" },
        }));

        expect(order(world.scenes.s1)).toEqual(["a", "new", "c"]);
        // The effect carries the operation as APPLIED: a guest replaying it must land in the same
        // place, and it was never told about the anchor the sender was aiming at.
        expect(effect.op.op === "insert-block" && effect.op.target).toEqual({ parentId: null, beforeBlockId: "c" });
    });

    it("lands at the end when the deleted row was the last one", () => {
        const world = makeWorld();
        send(world, { op: "delete-block", sceneId: "s1", blockId: "c" });

        const effect = asEffect(send(world, {
            op: "insert-block",
            sceneId: "s1",
            block: note("new"),
            target: { parentId: null, beforeBlockId: "c" },
        }));

        expect(order(world.scenes.s1)).toEqual(["a", "b", "new"]);
        expect(effect.op.op === "insert-block" && effect.op.target).toEqual({ parentId: null, beforeBlockId: null });
    });

    it("walks past a second deleted row to the first one still standing", () => {
        const world = makeWorld();
        send(world, { op: "delete-block", sceneId: "s1", blockId: "b" });
        send(world, { op: "delete-block", sceneId: "s1", blockId: "c" });

        const effect = asEffect(send(world, {
            op: "insert-block",
            sceneId: "s1",
            block: note("new"),
            target: { parentId: null, beforeBlockId: "b" },
        }));

        expect(order(world.scenes.s1)).toEqual(["a", "new"]);
        expect(effect.op.op === "insert-block" && effect.op.target).toEqual({ parentId: null, beforeBlockId: null });
    });

    it("lands where a deleted group stood when the row was inside it", () => {
        const world = makeWorld({
            scenes: [makeScene("s1", [
                { block: note("a") },
                { block: group("g") },
                { block: note("inside"), parentId: "g" },
                { block: note("z") },
            ])],
        });
        send(world, { op: "delete-block", sceneId: "s1", blockId: "g" });

        const effect = asEffect(send(world, {
            op: "insert-block",
            sceneId: "s1",
            block: note("new"),
            target: { parentId: "g", beforeBlockId: "inside" },
        }));

        expect(order(world.scenes.s1)).toEqual(["a", "new", "z"]);
        expect(effect.op.op === "insert-block" && effect.op.target).toEqual({ parentId: null, beforeBlockId: "z" });
    });

    it("refuses an anchor it never saw, rather than inventing a place for it", () => {
        const world = makeWorld();
        const refusal = asRefusal(send(world, {
            op: "insert-block",
            sceneId: "s1",
            block: note("new"),
            target: { parentId: null, beforeBlockId: "never-existed" },
        }));

        expect(refusal.reason).toBe("anchor-gone");
        expect(world.applied).toHaveLength(0);
    });
});

describe("rearranging a scene", () => {
    it("refuses a move whose destination is gone, and does nothing", () => {
        const world = makeWorld();
        send(world, { op: "delete-block", sceneId: "s1", blockId: "c" });
        const before = sceneDigest(world.scenes.s1);

        const refusal = asRefusal(send(world, {
            op: "move-block",
            sceneId: "s1",
            blockId: "a",
            target: { parentId: null, beforeBlockId: "c" },
        }));

        expect(refusal.reason).toBe("anchor-gone");
        expect(sceneDigest(world.scenes.s1)).toBe(before);
    });

    it("applies both moves when two people rearrange one scene", () => {
        // There is no conflict here to detect. Two moves are two moves, and the arrangement the room
        // ends up with is the one the second author saw themselves make.
        const world = makeWorld();
        asEffect(world.host.receive(intent({ op: "move-block", sceneId: "s1", blockId: "c", target: { parentId: null, beforeBlockId: "a" } }), "guest-1"));
        asEffect(world.host.receive(intent({ op: "move-block", sceneId: "s1", blockId: "a", target: { parentId: null, beforeBlockId: null } }), "guest-2"));

        expect(order(world.scenes.s1)).toEqual(["c", "b", "a"]);
        expect(world.applied).toHaveLength(2);
    });
});

describe("a batch, which is one gesture", () => {
    it("moves a whole selection as one operation, with one sequence number", () => {
        // The reason the vocabulary has this verb at all: sent as four moves it would be four
        // effects, and every other machine would draw three arrangements nobody wrote on the way.
        const world = makeWorld({
            scenes: [makeScene("s1", [{ block: note("a") }, { block: note("b") }, { block: note("c") }, { block: note("d") }])],
        });

        const effect = asEffect(send(world, {
            op: "move-blocks",
            sceneId: "s1",
            moves: [{ blockIds: ["a", "b"], target: { parentId: null, beforeBlockId: null } }],
        }));

        expect(effect.seq).toBe(1);
        expect(world.applied).toHaveLength(1);
        expect(order(world.scenes.s1)).toEqual(["c", "d", "a", "b"]);
    });

    it("pastes a whole tree as one operation, resolving only the anchors that face the document", () => {
        // A paste is one gesture. The rows inside the container it creates name that container as
        // their parent - a place this very operation is making - so there is nothing in the document
        // to resolve them against and nothing to check; only the container's own anchor faces the
        // scene, and that one resolves exactly as a single insert's does.
        const world = makeWorld({
            scenes: [makeScene("s1", [{ block: note("a") }, { block: note("z") }])],
        });

        const effect = asEffect(send(world, {
            op: "insert-blocks",
            sceneId: "s1",
            inserts: [
                { block: group("g2"), target: { parentId: null, beforeBlockId: "z" } },
                { block: note("k1"), target: { parentId: "g2" } },
            ],
        }));

        expect(effect.seq).toBe(1);
        expect(world.applied).toHaveLength(1);
        // Flattened depth first, so the row inside the container follows it.
        expect(order(world.scenes.s1)).toEqual(["a", "g2", "k1", "z"]);
        expect(order(world.scenes.s1, "g2")).toEqual(["k1"]);
    });

    it("lands a paste where a deleted anchor used to be, as a single insert does", () => {
        const world = makeWorld({
            scenes: [makeScene("s1", [{ block: note("a") }, { block: note("b") }, { block: note("z") }])],
        });
        send(world, { op: "delete-block", sceneId: "s1", blockId: "b" });

        const effect = asEffect(send(world, {
            op: "insert-blocks",
            sceneId: "s1",
            inserts: [{ block: note("p1"), target: { parentId: null, beforeBlockId: "b" } }],
        }));

        // The effect carries the target that was used, never the one that was asked for.
        expect(effect.op).toMatchObject({ op: "insert-blocks" });
        expect(order(world.scenes.s1)).toEqual(["a", "p1", "z"]);
    });

    it("refuses a whole delete batch when one row of it is claimed", () => {
        // Deleting a selection is one gesture, so it is refused whole. Letting the unheld rows go
        // would leave the author with a selection half deleted and one line they were told nothing
        // about still sitting in it.
        const world = makeWorld({ claims: { [storyRowClaimKey("b")]: "guest-2" } });

        const refusal = asRefusal(send(world, {
            op: "delete-blocks",
            sceneId: "s1",
            blockIds: ["a", "b"],
        }, "guest-1"));

        expect(refusal.reason).toBe("row-claimed");
        expect(refusal.heldBy).toBe("guest-2");
        expect(world.applied).toHaveLength(0);
        expect(world.scenes.s1.blocks.a).toBeDefined();
    });

    it("deletes a container and the rows inside it in one operation", () => {
        // ⚠ A row named after its own container is not missing. The container takes its children
        // with it, so by the time the child's turn comes it is already gone - and refusing there
        // would make a paste of a subtree impossible to take back.
        const world = makeWorld({
            scenes: [makeScene("s1", [
                { block: group("g2") },
                { block: note("k1"), parentId: "g2" },
                { block: note("z") },
            ])],
        });

        const effect = asEffect(send(world, { op: "delete-blocks", sceneId: "s1", blockIds: ["g2", "k1"] }));

        expect(effect.seq).toBe(1);
        expect(order(world.scenes.s1)).toEqual(["z"]);
    });

    it("refuses a delete batch naming a row nobody ever had", () => {
        const world = makeWorld({});

        const refusal = asRefusal(send(world, {
            op: "delete-blocks",
            sceneId: "s1",
            blockIds: ["a", "never-here"],
        }));

        expect(refusal.reason).toBe("row-gone");
        expect(world.applied).toHaveLength(0);
    });

    it("refuses the whole of a batch when one row of it is claimed, and writes none of it", () => {
        // Half a replace is the arrangement this verb exists to prevent: the rows nobody holds would
        // carry the new text and the held one would keep the old, with nothing anywhere saying so.
        const world = makeWorld({ claims: { [storyRowClaimKey("b")]: "guest-2" } });

        const refusal = asRefusal(send(world, {
            op: "update-blocks",
            edits: [
                { sceneId: "s1", blockId: "a", payload: note("a", "replaced").payload },
                { sceneId: "s1", blockId: "b", payload: note("b", "replaced").payload },
            ],
        }, "guest-1"));

        expect(refusal.reason).toBe("row-claimed");
        expect(refusal.heldBy).toBe("guest-2");
        expect(world.applied).toHaveLength(0);
    });

    it("refuses the whole of a batch when one row of it is gone", () => {
        const world = makeWorld();
        send(world, { op: "delete-block", sceneId: "s1", blockId: "c" });
        const before = sceneDigest(world.scenes.s1);

        const refusal = asRefusal(send(world, {
            op: "update-blocks",
            edits: [
                { sceneId: "s1", blockId: "a", payload: note("a", "replaced").payload },
                { sceneId: "s1", blockId: "c", payload: note("c", "replaced").payload },
            ],
        }));

        expect(refusal.reason).toBe("row-gone");
        expect(sceneDigest(world.scenes.s1)).toBe(before);
    });

    it("refuses a whole selection's move when one of its anchors is gone", () => {
        const world = makeWorld();
        send(world, { op: "delete-block", sceneId: "s1", blockId: "c" });
        const before = sceneDigest(world.scenes.s1);

        const refusal = asRefusal(send(world, {
            op: "move-blocks",
            sceneId: "s1",
            moves: [{ blockIds: ["a", "b"], target: { parentId: null, beforeBlockId: "c" } }],
        }));

        expect(refusal.reason).toBe("anchor-gone");
        expect(sceneDigest(world.scenes.s1)).toBe(before);
    });

    it("carries a digest for a batch inside one scene, and none for one that spans two", () => {
        const world = makeWorld({
            scenes: [
                makeScene("s1", [{ block: note("a") }, { block: note("b") }]),
                makeScene("s2", [{ block: note("x") }]),
            ],
        });

        const inside = asEffect(send(world, {
            op: "update-blocks",
            edits: [
                { sceneId: "s1", blockId: "a", payload: note("a", "one").payload },
                { sceneId: "s1", blockId: "b", payload: note("b", "two").payload },
            ],
        }));
        const afterInside = sceneDigest(world.scenes.s1);
        const across = asEffect(send(world, {
            op: "update-blocks",
            edits: [
                { sceneId: "s1", blockId: "a", payload: note("a", "three").payload },
                { sceneId: "s2", blockId: "x", payload: note("x", "four").payload },
            ],
        }));

        expect(inside.digests?.[0].hash).toBe(afterInside);
        // Nothing dishonest to send: a digest names one scene, and this operation changed two.
        expect(across.digests?.[0].hash).toBeUndefined();
    });
});

describe("single-valued operations", () => {
    it("lets the last writer win, with no claim and no refusal", () => {
        const world = makeWorld();
        const cases: { first: LiveOp; second: LiveOp; read: () => unknown; expected: unknown }[] = [
            {
                first: { op: "rename-scene", sceneId: "s1", name: "Corridor" },
                second: { op: "rename-scene", sceneId: "s1", name: "Rooftop" },
                read: () => world.scenes.s1.name,
                expected: "Rooftop",
            },
            {
                first: { op: "rename-story", name: "Rain" },
                second: { op: "rename-story", name: "Snow" },
                read: () => world.story.name,
                expected: "Snow",
            },
            {
                first: { op: "set-entry-scene", sceneId: null },
                second: { op: "set-entry-scene", sceneId: "s1" },
                read: () => world.story.entrySceneId,
                expected: "s1",
            },
            {
                first: { op: "reorder-chapters", chapterIds: ["c2", "c1"] },
                second: { op: "reorder-chapters", chapterIds: ["c1", "c2"] },
                read: () => world.story.chapterIds,
                expected: ["c1", "c2"],
            },
        ];

        for (const testCase of cases) {
            asEffect(world.host.receive(intent(testCase.first), "guest-1"));
            asEffect(world.host.receive(intent(testCase.second), "guest-2"));
            expect(testCase.read()).toEqual(testCase.expected);
        }
    });
});

describe("the digest an effect carries", () => {
    it("is the scene after applying, and changes when the scene does", () => {
        const world = makeWorld();
        const first = asEffect(send(world, { op: "delete-block", sceneId: "s1", blockId: "b" }));
        expect(first.digests?.[0].hash).toBe(sceneDigest(world.scenes.s1));

        const second = asEffect(send(world, { op: "rename-scene", sceneId: "s1", name: "Corridor" }));
        expect(second.digests?.[0].hash).toBe(sceneDigest(world.scenes.s1));
        expect(second.digests?.[0].hash).not.toBe(first.digests?.[0].hash);
    });

    it("is absent from the operations that are about the story rather than a scene", () => {
        const world = makeWorld();
        expect(asEffect(send(world, { op: "rename-story", name: "Rain" })).digests?.[0].hash).toBeUndefined();
        expect(asEffect(send(world, { op: "reorder-chapters", chapterIds: ["c2", "c1"] })).digests?.[0].hash).toBeUndefined();
        expect(asEffect(send(world, { op: "set-entry-scene", sceneId: "s1" })).digests?.[0].hash).toBeUndefined();
    });
});

describe("an intent the host will not read", () => {
    const cases: { name: string; make: (world: World) => LiveOutbound | null; reason: LiveRefusalReason }[] = [
        {
            name: "a vocabulary this build does not have",
            make: world => world.host.receive(intent({ op: "burn-it-down" } as unknown as LiveOp), "guest-1"),
            reason: "unknown-op",
        },
        {
            name: "an operation that is not an object at all",
            make: world => world.host.receive(intent(undefined as unknown as LiveOp), "guest-1"),
            reason: "unknown-op",
        },
        {
            name: "another story document",
            make: world => world.host.receive(
                {
                    kind: "intent",
                    clientId: "x",
                    document: { doc: "story", storyId: "story-2" },
                    op: { op: "rename-story", name: "Rain" },
                },
                "guest-1",
            ),
            reason: "document-not-shared",
        },
        {
            name: "an operation that could not be about the document it names",
            make: world => world.host.receive(
                {
                    kind: "intent",
                    clientId: "x",
                    document: { doc: "characters" },
                    op: { op: "rename-story", name: "Rain" },
                },
                "guest-1",
            ),
            reason: "document-not-shared",
        },
        {
            name: "a scene that is gone",
            make: world => world.host.receive(intent({ op: "rename-scene", sceneId: "s9", name: "Nowhere" }), "guest-1"),
            reason: "scene-gone",
        },
    ];

    for (const { name, make, reason } of cases) {
        it(`refuses ${name} with ${reason}, without throwing`, () => {
            const world = makeWorld();
            expect(asRefusal(make(world)).reason).toBe(reason);
            expect(world.applied).toHaveLength(0);
        });
    }

    it("refuses an instance that is not in the session", () => {
        const world = makeWorld({ members: ["guest-1"] });
        expect(asRefusal(send(world, { op: "rename-story", name: "Rain" }, "stranger")).reason).toBe("not-in-session");
        expect(asEffect(send(world, { op: "rename-story", name: "Rain" }, "guest-1")).seq).toBe(1);
    });
});

describe("the claim check", () => {
    it("is permissive when nobody hands one in", () => {
        const world = makeWorld();
        expect(asEffect(send(world, { op: "set-block-disabled", sceneId: "s1", blockId: "b", disabled: true })).seq).toBe(1);
    });

    it("refuses a claimed row and names who holds it", () => {
        const world = makeWorld({ claims: { [storyRowClaimKey("b")]: "guest-2" } });
        const refusal = asRefusal(send(world, { op: "update-block", sceneId: "s1", blockId: "b", payload: note("b", "mine").payload }, "guest-1"));

        expect(refusal.reason).toBe("row-claimed");
        expect(refusal.heldBy).toBe("guest-2");
        expect(world.applied).toHaveLength(0);
    });

    it("lets the holder write its own row", () => {
        const world = makeWorld({ claims: { [storyRowClaimKey("b")]: "guest-2" } });
        expect(asEffect(send(world, { op: "update-block", sceneId: "s1", blockId: "b", payload: note("b", "mine").payload }, "guest-2")).seq).toBe(1);
    });

    it("is not consulted for the operations a claim does not govern", () => {
        const world = makeWorld({ claims: { [storyRowClaimKey("b")]: "guest-2" } });
        expect(asEffect(send(world, { op: "move-block", sceneId: "s1", blockId: "b", target: { parentId: null, beforeBlockId: "a" } }, "guest-1")).seq).toBe(1);
    });

    /**
     * ⚠ **The check lives in each case of `plan`, not at one door.** A verb added to `CLAIMED_OPS`
     * whose case forgets `this.claimed(op, by) ??` is not checked at all, and nothing anywhere says
     * so - the operation simply applies over the paragraph somebody was writing. This walks every
     * claimed verb so that adding one without its check fails here rather than in a session.
     */
    it("is reached from every claimed verb, because the check lives in each case", () => {
        const samples: Record<string, LiveOp> = {
            "update-block": { op: "update-block", sceneId: "s1", blockId: "b", payload: note("b", "x").payload },
            "update-blocks": { op: "update-blocks", edits: [{ sceneId: "s1", blockId: "b", payload: note("b", "x").payload }] },
            "delete-block": { op: "delete-block", sceneId: "s1", blockId: "b" },
            "delete-blocks": { op: "delete-blocks", sceneId: "s1", blockIds: ["b"] },
            "set-block-disabled": { op: "set-block-disabled", sceneId: "s1", blockId: "b", disabled: true },
            "update-character": { op: "update-character", characterId: "c1", character: record("c1", "Ada") },
            "delete-character": { op: "delete-character", characterId: "c1" },
            "set-translation": { op: "set-translation", locale: "ja", unitId: "text-b", unit: translation("遅いよ。") },
            "set-translations": {
                op: "set-translations",
                locale: "ja",
                units: [{ unitId: "text-b", unit: translation("遅いよ。") }],
            },
            "update-asset": { op: "update-asset", assetType: "image", assetId: "a1", record: asset("a1", "hall.png") },
            "replace-asset-content": {
                op: "replace-asset-content",
                assetType: "image",
                assetId: "a1",
                record: asset("a1", "hall.png"),
                bytes: { from: "trash" },
            },
            "delete-assets": { op: "delete-assets", assetType: "image", assetIds: ["a1"] },
        };
        expect(Object.keys(samples).sort()).toEqual([...CLAIMED_OPS].sort());

        for (const [kind, op] of Object.entries(samples)) {
            // Held by somebody else, on every key the operation names.
            const claims = Object.fromEntries(opClaimKeys(op).map(key => [key, "guest-2"]));
            const world = makeWorld({ claims, cast: [record("c1", "Ada")], assets: { a1: asset("a1") } });
            const refusal = asRefusal(send(world, op, "guest-1"));
            expect(refusal.reason, kind).toBe("row-claimed");
            expect(world.applied, kind).toHaveLength(0);
        }
    });
});

describe("the translation and voice libraries a session carries", () => {
    it("writes one entry, and removes it when the translator clears the box", () => {
        // Absence is a value in this document rather than a state to be found missing: an entry
        // holding an empty string is what an untranslated line already looks like, so there is one
        // verb and `null` is one of its answers.
        const world = makeWorld();
        expect(asEffect(send(world, {
            op: "set-translation", locale: "ja", unitId: "text-b", unit: translation("遅いよ。"),
        })).seq).toBe(1);
        expect(world.translations.ja["text-b"]?.target).toBe("遅いよ。");

        send(world, { op: "set-translation", locale: "ja", unitId: "text-b", unit: null });
        expect(world.translations.ja["text-b"]).toBeUndefined();
    });

    it("writes an import as one operation, because an import is one gesture", () => {
        const world = makeWorld();
        const effect = asEffect(send(world, {
            op: "set-translations",
            locale: "ja",
            units: [
                { unitId: "text-a", unit: translation("早いね。") },
                { unitId: "text-b", unit: translation("遅いよ。") },
            ],
        }));

        expect(effect.seq).toBe(1);
        expect(world.applied).toHaveLength(1);
        expect(Object.keys(world.translations.ja).sort()).toEqual(["text-a", "text-b"]);
    });

    it("refuses an entry somebody else is translating, and lets its holder write it", () => {
        const world = makeWorld({ claims: { [translationClaimKey("ja", "text-b")]: "guest-2" } });
        const refusal = asRefusal(send(world, {
            op: "set-translation", locale: "ja", unitId: "text-b", unit: translation("mine"),
        }, "guest-1"));

        expect(refusal.reason).toBe("row-claimed");
        expect(refusal.heldBy).toBe("guest-2");
        expect(asEffect(send(world, {
            op: "set-translation", locale: "ja", unitId: "text-b", unit: translation("hers"),
        }, "guest-2")).seq).toBe(1);
    });

    it("refuses a whole import when one of its entries is held", () => {
        // Half an import is a library nobody produced, and the translator whose file it was would be
        // told a line was taken while watching the rest of it land.
        const world = makeWorld({ claims: { [translationClaimKey("ja", "text-b")]: "guest-2" } });
        const refusal = asRefusal(send(world, {
            op: "set-translations",
            locale: "ja",
            units: [{ unitId: "text-a", unit: translation("a") }, { unitId: "text-b", unit: translation("b") }],
        }, "guest-1"));

        expect(refusal.reason).toBe("row-claimed");
        expect(world.applied).toHaveLength(0);
    });

    it("does not claim a take, so two directors race and the loser loses a note", () => {
        const world = makeWorld({ claims: { [translationClaimKey("ja", "text-b")]: "guest-2" } });
        expect(asEffect(send(world, {
            op: "set-take", locale: "ja", unitId: "text-b", unit: take("clip-1"),
        }, "guest-1")).seq).toBe(1);
        expect(world.takes.ja["text-b"]?.assetId).toBe("clip-1");
    });

    it("fingerprints the language the operation names", () => {
        const world = makeWorld();
        const effect = asEffect(send(world, {
            op: "set-translation", locale: "ja", unitId: "text-b", unit: translation("遅いよ。"),
        }));

        expect(effect.digests).toEqual([
            { scope: { of: "translations", locale: "ja" }, hash: translationsDigest(world.translations.ja) },
        ]);
    });

    it("refuses a message whose language disagrees with the operation's", () => {
        // Two spellings of one fact are two chances to be wrong, and the wrong one writes a Japanese
        // line into the French file - a translation nobody made, in a document whose digest agrees
        // with itself.
        const world = makeWorld();
        const refusal = asRefusal(world.host.receive({
            kind: "intent",
            clientId: "mismatched",
            document: { doc: "localization", locale: "fr" },
            op: { op: "set-translation", locale: "ja", unitId: "text-b", unit: translation("遅いよ。") },
        }, "guest-1"));

        expect(refusal.reason).toBe("document-not-shared");
        expect(world.applied).toHaveLength(0);
    });

    it("refuses a language this session does not carry", () => {
        const world = makeWorld();
        const refusal = asRefusal(send(world, {
            op: "set-translation", locale: "fr", unitId: "text-b", unit: translation("Trop tard."),
        }));

        expect(refusal.reason).toBe("document-not-shared");
        expect(world.applied).toHaveLength(0);
    });
});

describe("the cast, the second document a session carries", () => {
    it("creates a record without asking anything, because a fresh id can collide with nothing", () => {
        const world = makeWorld();
        const effect = asEffect(send(world, { op: "create-character", character: record("c1", "Ada") }));

        expect(world.cast.characters.c1?.profile.name).toBe("Ada");
        // Not claimed and not checked against what is already there: the id was minted by whoever
        // built the record, so two of them colliding is a uuid collision rather than a race, and a
        // *retry* of one creation is what the receipts answer.
        expect(effect.digests).toEqual([{
            scope: { of: "character", characterId: "c1" },
            hash: characterRecordDigest(characterAt(world.cast, "c1")),
        }]);
    });

    it("refuses an update naming a record that is gone, and never turns it into a creation", () => {
        const world = makeWorld();
        const refusal = asRefusal(send(world, {
            op: "update-character",
            characterId: "stranger",
            character: record("stranger", "Nobody"),
        }));

        // ⚠ Says the record is gone. It never says the author's typing is: the panel is full of
        // their own work. Creating it here would put a character somebody else deleted back on every
        // machine in the room.
        expect(refusal.reason).toBe("character-gone");
        expect(world.applied).toHaveLength(0);
    });

    it("refuses an update to a record somebody else is inside, and names them", () => {
        const world = makeWorld({
            cast: [record("c1", "Ada")],
            claims: { [characterClaimKey("c1")]: "guest-2" },
        });
        const refusal = asRefusal(send(world, {
            op: "update-character",
            characterId: "c1",
            character: record("c1", "Mine"),
        }, "guest-1"));

        expect(refusal.reason).toBe("row-claimed");
        expect(refusal.heldBy).toBe("guest-2");
        expect(world.cast.characters.c1?.profile.name).toBe("Ada");
    });

    it("lets the holder write the record it is inside", () => {
        const world = makeWorld({
            cast: [record("c1", "Ada")],
            claims: { [characterClaimKey("c1")]: "guest-2" },
        });
        expect(asEffect(send(world, {
            op: "update-character",
            characterId: "c1",
            character: record("c1", "Ada Lovelace"),
        }, "guest-2")).seq).toBe(1);
    });

    it("takes a group and its membership as one operation, and fingerprints the cast", () => {
        const world = makeWorld({ cast: [record("c1", "Ada")] });
        const effect = asEffect(send(world, {
            op: "set-character-group",
            groupId: "g1",
            group: { id: "g1", name: "Cast", createdAt: 1, updatedAt: 2 },
            members: ["c1"],
        }));

        expect(world.cast.groups.g1?.name).toBe("Cast");
        expect(world.cast.characters.c1?.profile.groupId).toBe("g1");
        // The cast's shape rather than any one record: a group deletion moves members out, and no
        // update is sent for any of them.
        expect(effect.digests).toEqual([{ scope: { of: "cast" }, hash: castDigest(world.cast) }]);
    });

    it("takes a second deletion of one group as agreement rather than a conflict", () => {
        const world = makeWorld();
        // Last-writer-wins, and deliberately tolerant: the second of two deletions changes nothing,
        // and refusing it would report a conflict where there is only agreement.
        expect(asEffect(send(world, { op: "delete-character-group", groupId: "never-existed" })).seq).toBe(1);
    });

    it("refuses an operation about the cast from a message that names another document", () => {
        const world = makeWorld();
        const refusal = asRefusal(world.host.receive(
            {
                kind: "intent",
                clientId: "x",
                document: { doc: "story", storyId: STORY },
                op: { op: "create-character", character: record("c1", "Ada") },
            },
            "guest-1",
        ));
        expect(refusal.reason).toBe("document-not-shared");
        expect(world.applied).toHaveLength(0);
    });

    it("stamps the document it changed on every effect, so nothing is applied to the wrong one", () => {
        const world = makeWorld();
        expect(asEffect(send(world, { op: "create-character", character: record("c1", "Ada") })).document)
            .toEqual({ doc: "characters" });
        expect(asEffect(send(world, { op: "rename-story", name: "Rain" })).document)
            .toEqual({ doc: "story", storyId: STORY });
    });
});

describe("taking a row and giving it back", () => {
    /** What the set says, which is the only thing anybody outside the host ever sees. */
    function held(world: World): Record<string, string> {
        return { ...world.host.claims.snapshot().held };
    }

    it("records a guest's claim against the account behind it", () => {
        // An account and never the instance: a refusal names a PERSON, and an instance id means
        // nothing at all to whoever reads it.
        const world = makeWorld({ accounts: { "guest-1": "ada" } });
        world.host.receive({ kind: "claim", key: storyRowClaimKey("b"), holding: true }, "guest-1");

        expect(held(world)).toEqual({ [storyRowClaimKey("b")]: "ada" });
    });

    it("gives the row back, and only to the machine holding it", () => {
        const world = makeWorld({ accounts: { "guest-1": "ada", "guest-2": "bob" } });
        world.host.receive({ kind: "claim", key: storyRowClaimKey("b"), holding: true }, "guest-1");

        // Honouring somebody else's release would be a way to take a row off the person writing it
        // without ever being refused.
        world.host.receive({ kind: "claim", key: storyRowClaimKey("b"), holding: false }, "guest-2");
        expect(held(world)).toEqual({ [storyRowClaimKey("b")]: "ada" });

        world.host.receive({ kind: "claim", key: storyRowClaimKey("b"), holding: false }, "guest-1");
        expect(held(world)).toEqual({});
    });

    it("leaves a row somebody else holds where it is, and says nothing back", () => {
        // The set the asker already has names the holder, so there is nothing to send it that it
        // does not know - which is why this message has no refusal of its own.
        const world = makeWorld({ accounts: { "guest-1": "ada", "guest-2": "bob" } });
        world.host.receive({ kind: "claim", key: storyRowClaimKey("b"), holding: true }, "guest-1");

        expect(world.host.receive({ kind: "claim", key: storyRowClaimKey("b"), holding: true }, "guest-2")).toBeNull();
        expect(held(world)).toEqual({ [storyRowClaimKey("b")]: "ada" });
    });

    it("records nothing for an instance it cannot put a person's name to", () => {
        // A set carrying ids would name nobody in a refusal, and an editor comparing the holder
        // against its own account would read its own author's line as taken by a stranger.
        const world = makeWorld({ accounts: {} });
        world.host.receive({ kind: "claim", key: storyRowClaimKey("b"), holding: true }, "guest-1");

        expect(held(world)).toEqual({});
    });

    it("puts the host's own row in the set, through the same door", () => {
        // A row the host took without recording it would be held by nobody as far as the set is
        // concerned: no mark on any other screen, and nothing refusing a guest writing over it.
        const world = makeWorld({ accounts: { host: "ada" } });
        world.host.claimLocal(storyRowClaimKey("b"), true);
        expect(held(world)).toEqual({ [storyRowClaimKey("b")]: "ada" });

        world.host.claimLocal(storyRowClaimKey("b"), false);
        expect(held(world)).toEqual({});
    });

    it("refuses everybody else's edit to a claimed row, naming the holder", () => {
        const world = makeWorld({ accounts: { "guest-1": "ada", "guest-2": "bob" } });
        world.host.receive({ kind: "claim", key: storyRowClaimKey("b"), holding: true }, "guest-1");

        const refusal = asRefusal(send(world, {
            op: "update-block", sceneId: "s1", blockId: "b", payload: note("b", "mine").payload,
        }, "guest-2"));
        expect(refusal.reason).toBe("row-claimed");
        expect(refusal.heldBy).toBe("ada");
        expect(world.applied).toHaveLength(0);

        // And the holder still writes its own line, which is what a claim is for.
        expect(asEffect(send(world, {
            op: "update-block", sceneId: "s1", blockId: "b", payload: note("b", "hers").payload,
        }, "guest-1")).seq).toBe(1);
    });

    it("forgets the claim on a row that has been deleted", () => {
        const world = makeWorld({ accounts: { "guest-1": "ada" } });
        world.host.receive({ kind: "claim", key: storyRowClaimKey("b"), holding: true }, "guest-1");
        send(world, { op: "delete-block", sceneId: "s1", blockId: "b" }, "guest-1");

        expect(held(world)).toEqual({});
    });

    it("drops everything a window that has left the room was writing", () => {
        const world = makeWorld({ accounts: { "guest-1": "ada", "guest-2": "bob" } });
        world.host.receive({ kind: "claim", key: storyRowClaimKey("a"), holding: true }, "guest-1");
        world.host.receive({ kind: "claim", key: storyRowClaimKey("b"), holding: true }, "guest-2");

        world.host.forgetInstance("guest-1");
        expect(held(world)).toEqual({ [storyRowClaimKey("b")]: "bob" });
    });

    it("keeps a row past the raw timeout while its author keeps typing", () => {
        // The deadline is measured against a PAUSE in typing, not against how long a paragraph
        // takes to write - which only works because the box asserts the claim again as it goes.
        let clock = 0;
        const world = makeWorld({
            accounts: { "guest-1": "ada" },
            claimStore: new LiveClaimStore({ now: () => clock }),
        });

        world.host.receive({ kind: "claim", key: storyRowClaimKey("b"), holding: true }, "guest-1");
        let assertions = 1;
        // Four minutes of writing, asserting on the interval the editor actually uses.
        while (clock < 240_000) {
            clock += CLAIM_REASSERT_MS;
            world.host.receive({ kind: "claim", key: storyRowClaimKey("b"), holding: true }, "guest-1");
            assertions += 1;
        }

        expect(held(world)).toEqual({ [storyRowClaimKey("b")]: "ada" });
        // Bounded, and by the interval rather than by how much was typed: one message per author
        // per ten seconds, for a paragraph that could have been thousands of keystrokes.
        expect(assertions).toBe(1 + 240_000 / CLAIM_REASSERT_MS);

        // And it lapses once the assertions stop, which is the safety net for a machine that died
        // holding a line.
        clock += DEFAULT_CLAIM_TIMEOUT_MS + 1;
        expect(held(world)).toEqual({});
    });
});

describe("catching a guest up", () => {
    it("answers a resync with everything after the sequence it names, addressed to who asked", () => {
        const world = makeWorld();
        send(world, { op: "rename-story", name: "Rain" });
        send(world, { op: "rename-story", name: "Snow" });
        send(world, { op: "rename-story", name: "Hail" });

        const catchUp = world.host.receive({ kind: "resync", by: "guest-3", after: 1 }, "guest-3");

        expect(catchUp?.kind).toBe("catch-up");
        expect(catchUp?.kind === "catch-up" && catchUp.to).toBe("guest-3");
        expect(catchUp?.kind === "catch-up" && catchUp.effects.map(effect => effect.seq)).toEqual([2, 3]);
    });

    it("says nothing about the messages the host itself produces", () => {
        const world = makeWorld();
        const own: LiveMessage[] = [
            {
                kind: "effect",
                by: "host",
                seq: 1,
                document: { doc: "story", storyId: STORY },
                op: { op: "rename-story", name: "Rain" },
            },
            { kind: "refusal", clientId: "x", reason: "row-gone" },
            { kind: "claims", seq: 1, held: {} },
            { kind: "catch-up", to: "guest-1", effects: [] },
        ];

        for (const message of own) {
            expect(world.host.receive(message, "host")).toBeNull();
        }
        expect(world.applied).toHaveLength(0);
    });
});

describe("the host's own edits", () => {
    it("go through the same door, take the same numbers and reach the log", () => {
        const world = makeWorld();
        const effect = world.host.applyLocal({ op: "rename-scene", sceneId: "s1", name: "Corridor" }, documentOf({ op: "rename-scene", sceneId: "s1", name: "Corridor" })) as LiveEffect;

        expect(effect.kind).toBe("effect");
        expect(effect.by).toBe("host");
        expect(effect.clientId).toBeUndefined();
        expect(world.scenes.s1.name).toBe("Corridor");
        expect(world.host.log.after(0)).toEqual([effect]);
    });

    it("leave the position of a row the host deleted behind, so a guest can still aim at it", () => {
        const world = makeWorld();
        world.host.applyLocal({ op: "delete-block", sceneId: "s1", blockId: "b" }, documentOf({ op: "delete-block", sceneId: "s1", blockId: "b" }));

        const effect = asEffect(send(world, {
            op: "insert-block",
            sceneId: "s1",
            block: note("new"),
            target: { parentId: null, beforeBlockId: "b" },
        }));

        expect(effect.op.op === "insert-block" && effect.op.target).toEqual({ parentId: null, beforeBlockId: "c" });
        expect(order(world.scenes.s1)).toEqual(["a", "new", "c"]);
    });
});

/**
 * The asset library's half of the vocabulary, at the host.
 *
 * Two verbs and two refusals, and what the cases below are really about is the second one: a record
 * that is gone is a file somebody deleted, and the author on the other end has an inspector full of
 * their own typing that this must never be read as licence to clear.
 */
describe("the asset library a session carries", () => {
    it("replaces one record whole, because a record's fields hold each other up", () => {
        const world = makeWorld({ assets: { a1: asset("a1", "room.png") } });

        const effect = asEffect(send(world, {
            op: "update-asset", assetType: "image", assetId: "a1", record: asset("a1", "hall.jpg"),
        }));

        expect(effect.seq).toBe(1);
        expect(world.assets.image.a1?.name).toBe("hall.jpg");
        expect(effect.digests?.[0]?.scope).toEqual({ of: "assets", assetType: "image" });
    });

    it("refuses an update whose record is gone, and says the record is gone", () => {
        // ⚠ It says nothing about the panel. An update that created what it could not find would put
        // a record back after somebody deleted the file, leaving a row with no bytes under it.
        const world = makeWorld();

        const refusal = asRefusal(send(world, {
            op: "update-asset", assetType: "image", assetId: "a1", record: asset("a1"),
        }));

        expect(refusal.reason).toBe("asset-gone");
        expect(world.applied).toHaveLength(0);
    });

    it("files a whole selection as one operation, each row in its own folder", () => {
        const world = makeWorld({ assets: { a1: asset("a1", "a1.png", "old"), a2: asset("a2") } });

        asEffect(send(world, {
            op: "move-assets",
            assetType: "image",
            moves: [{ assetId: "a1", groupId: "chapter-2" }, { assetId: "a2", groupId: null }],
        }));

        expect(world.assets.image.a1?.groupId).toBe("chapter-2");
        expect(world.assets.image.a2?.groupId).toBeUndefined();
        expect(world.applied).toHaveLength(1);
    });

    it("refuses a whole drag when one row is gone, rather than filing the rest", () => {
        // Half a drag is an arrangement the author never asked for, sitting in everybody's library
        // with nothing on any screen saying the other half was refused.
        const world = makeWorld({ assets: { a1: asset("a1") } });

        const refusal = asRefusal(send(world, {
            op: "move-assets",
            assetType: "image",
            moves: [{ assetId: "a1", groupId: "chapter-2" }, { assetId: "gone", groupId: null }],
        }));

        expect(refusal.reason).toBe("asset-gone");
        expect(world.assets.image.a1?.groupId).toBeUndefined();
    });

    it("does not claim a drag, and does claim a record", () => {
        const world = makeWorld({
            assets: { a1: asset("a1"), a2: asset("a2") },
            claims: { [assetClaimKey("a1")]: "guest-2" },
        });

        // Filing is a drag: the loser loses a drag, which is cheaper than asking to hold a row.
        expect(asEffect(send(world, {
            op: "move-assets", assetType: "image", moves: [{ assetId: "a1", groupId: "x" }],
        }, "guest-1")).seq).toBe(1);
        // Editing the record is a paragraph somebody may be halfway through writing.
        expect(asRefusal(send(world, {
            op: "update-asset", assetType: "image", assetId: "a1", record: asset("a1", "mine.png"),
        }, "guest-1")).reason).toBe("row-claimed");
    });

    it("refuses a record aimed at the wrong shard, which nothing else would ever report", () => {
        // A record written into a sibling type's shard is a file the browser no longer draws
        // anywhere, sitting in a document whose own digest agrees with itself.
        const world = makeWorld({ assets: { a1: asset("a1") } });

        const refusal = asRefusal(world.host.receive({
            kind: "intent",
            clientId: "c-mismatched",
            document: { doc: "assets", assetType: "audio" },
            op: { op: "update-asset", assetType: "image", assetId: "a1", record: asset("a1") },
        }, "guest-1"));

        expect(refusal.reason).toBe("document-not-shared");
        expect(world.applied).toHaveLength(0);
    });

    it("refuses a shard this session does not carry at all", () => {
        const world = makeWorld({ assets: { a1: asset("a1") } });

        expect(asRefusal(world.host.receive({
            kind: "intent",
            clientId: "c-unknown-shard",
            document: { doc: "assets", assetType: "font" },
            op: { op: "update-asset", assetType: "font", assetId: "f1", record: asset("f1") },
        }, "guest-1")).reason).toBe("document-not-shared");
    });
});

describe("the three project tables", () => {
    /** A message about one of the tables, which are addressed by kind alone. */
    function say(world: World, op: LiveOp, document: LiveDocument) {
        return world.host.receive(
            { kind: "intent", clientId: `c-${op.op}`, document, op },
            "guest",
        );
    }

    it("takes a term nobody has, because in this document absence is a value", () => {
        // The translation library's rule, one document along: an operation naming a term nobody
        // holds is an author teaching the project a spelling, which is the ordinary case rather
        // than a race. There is deliberately no `entry-gone` to pair with `row-gone`.
        const world = makeWorld();
        const answer = say(
            world,
            { op: "set-dictionary-entry", term: "Nattou", entry: { term: "Nattou" } },
            { doc: "dictionary" },
        );
        expect(answer?.kind).toBe("effect");
        expect(world.applied).toHaveLength(1);
    });

    it("fingerprints the dictionary whole, because a rename is one entry leaving and another arriving", () => {
        const world = makeWorld();
        const answer = say(
            world,
            { op: "set-dictionary-entry", term: "Nattou", entry: { term: "Nattou" } },
            { doc: "dictionary" },
        );
        expect(answer?.kind === "effect" && answer.digests?.map(digest => digest.scope))
            .toEqual([{ of: "dictionary" }]);
    });

    it("refuses to write a bus that is gone, and says so by name", () => {
        const world = makeWorld();
        const answer = say(
            world,
            {
                op: "update-audio-track",
                trackId: "missing",
                track: { id: "missing", name: "x", parentId: null, volume: 1, loop: false },
            },
            { doc: "audio-tracks" },
        );
        expect(answer).toMatchObject({ kind: "refusal", reason: "track-gone" });
        expect(world.applied).toHaveLength(0);
    });

    it("refuses to write a set that is gone", () => {
        const world = makeWorld();
        const answer = say(
            world,
            {
                op: "update-asset-set",
                setId: "missing",
                set: { id: "missing", name: "x", type: "image", filter: [], axis: makeAssetSetAxis("release", []) },
            },
            { doc: "asset-sets" },
        );
        expect(answer).toMatchObject({ kind: "refusal", reason: "set-gone" });
    });

    it("refuses a drag whole when one set of it has gone", () => {
        // The rule every batch follows: half a drag is an arrangement the author never asked for,
        // and the half that landed would look exactly like the whole of it.
        const world = makeWorld();
        const answer = say(
            world,
            { op: "move-asset-sets", moves: [{ setId: "alice", groupId: "cast" }, { setId: "missing", groupId: "cast" }] },
            { doc: "asset-sets" },
        );
        expect(answer).toMatchObject({ kind: "refusal", reason: "set-gone" });
        expect(world.applied).toHaveLength(0);
    });

    it("takes a deletion of a set that is already gone, because the second one changes nothing", () => {
        const world = makeWorld();
        const answer = say(world, { op: "delete-asset-sets", setIds: ["missing"] }, { doc: "asset-sets" });
        expect(answer?.kind).toBe("effect");
    });

    it("refuses an operation whose message names a document it cannot be about", () => {
        // The two halves of a message disagreeing is malformed rather than out of scope, and one
        // reason covering both would send somebody looking in the wrong place.
        const world = makeWorld();
        const answer = say(
            world,
            { op: "set-dictionary-options", options: { suggestReadings: false, checkVariants: true } },
            { doc: "audio-tracks" },
        );
        expect(answer).toMatchObject({ kind: "refusal", reason: "document-not-shared" });
    });
});
