import {describe, expect, it} from "vitest";
import {
    ASSETS_METADATA_DOCUMENT_PATH,
    AssetsMetadataShard,
    assetsMetadataSpec,
    STORY_DOCUMENT_PATH,
    storyDocumentSpec,
} from "@shared/documents/specs";
import {countDocumentChanges} from "@shared/documents/diff";
import {resolveDocumentSpecForPath} from "@shared/documents/registry";
import {DocumentCorruptError, DocumentParseContext} from "@shared/documents/types";
import type {
    StoryBlock,
    StoryDocument,
    StoryScene,
} from "@shared/types/story/document";
import {STORY_DOCUMENT_SCHEMA_VERSION} from "@shared/types/story/document";
import {STORY_DOCUMENT_MIN_SUPPORTED_VERSION} from "@shared/story/migrateStoryDocument";

/**
 * `parse` without `loadDocument`, so a rejection can be inspected rather than quarantined. The
 * context is the same one `documentDiff.ts` builds when it parses a revision's blob.
 */
function contextFor(path: string, kind: "story" | "assets-metadata", text: string): DocumentParseContext {
    return {
        path,
        corrupt(reason: string): never {
            throw new DocumentCorruptError({kind, path, reason, text});
        },
    };
}

function parseStory(path: string, value: unknown): StoryDocument {
    return storyDocumentSpec.parse(value, contextFor(path, "story", JSON.stringify(value)));
}

function parseShard(path: string, value: unknown): AssetsMetadataShard {
    return assetsMetadataSpec.parse(value, contextFor(path, "assets-metadata", JSON.stringify(value)));
}

const STORY_PATH = "editor/story/stories/story-1/storydoc.json";
const IMAGE_SHARD = "assets/assets.metadata.image.json";

function block(id: string, text: string, overrides: Partial<StoryBlock> = {}): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        parentId: null,
        childrenIds: [],
        payload: {action: "narration", text: {textId: `t-${id}`, value: text}},
        ...overrides,
    } as StoryBlock;
}

function jump(id: string, targetSceneId: string, returnable?: true): StoryBlock {
    return {
        id,
        kind: "jump",
        parentId: null,
        childrenIds: [],
        payload: {targetSceneId, ...(returnable ? {returnable: true} : {})},
    } as StoryBlock;
}

function scene(id: string, name: string, blocks: StoryBlock[]): StoryScene {
    return {
        id,
        name,
        runtimeName: name,
        rootBlockIds: blocks.map(one => one.id),
        blocks: Object.fromEntries(blocks.map(one => [one.id, one])),
    };
}

function story(...scenes: StoryScene[]): StoryDocument {
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "story-1",
        name: "A Story",
        chapters: [{id: "ch1", name: "Chapter One", sceneIds: scenes.map(one => one.id)}],
        scenes: Object.fromEntries(scenes.map(one => [one.id, one])),
    };
}

function diffStory(base: StoryDocument, head: StoryDocument, limit = 200) {
    return storyDocumentSpec.diff!(base, head, {limit});
}

function shard(assets: Record<string, Record<string, unknown>>): AssetsMetadataShard {
    return {type: "image", assets};
}

function diffAssets(base: AssetsMetadataShard, head: AssetsMetadataShard, limit = 200) {
    return assetsMetadataSpec.diff!(base, head, {limit});
}

describe("story spec: reading", () => {
    it("claims the story document's path and takes the id from it", () => {
        expect(resolveDocumentSpecForPath(STORY_PATH)).toEqual({
            spec: storyDocumentSpec,
            parameters: {storyId: "story-1"},
        });
        expect(storyDocumentSpec.pathFor({storyId: "abc"})).toBe("editor/story/stories/abc/storydoc.json");
        expect(STORY_DOCUMENT_PATH).toBe("editor/story/stories/<storyId>/storydoc.json");
        // The path wins over the document's own `id`, the same rule every spec that captures one
        // follows: the file is found by path, so a document that disagreed would be written back to
        // wherever its contents claimed.
        expect(parseStory(STORY_PATH, {...story(), id: "somewhere-else"}).id).toBe("story-1");
    });

    it("refuses a document a newer Studio wrote", () => {
        expect(() => parseStory(STORY_PATH, {...story(), schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION + 1}))
            .toThrow(/newer version of Studio/);
    });

    it("refuses a scenes map or a chapters list of the wrong shape", () => {
        expect(() => parseStory(STORY_PATH, {...story(), scenes: []})).toThrow(/"scenes"/);
        expect(() => parseStory(STORY_PATH, {...story(), chapters: {}})).toThrow(/"chapters" must be an array/);
    });

    it("refuses a scene whose rows are the wrong shape rather than emptying it", () => {
        // The data-loss shape, pinned. `normalizeStoryDocument` reads `blocks` as a map, so an array
        // would normalize to a scene with nothing in it - and now that `serialize` is real, that
        // empty scene would be written back over every row the author had.
        const broken = story(scene("s1", "Prologue", [block("b1", "hello")]));
        expect(() => parseStory(STORY_PATH, {...broken, scenes: {s1: {...broken.scenes.s1, blocks: []}}}))
            .toThrow(/scene "s1".*blocks/);
        expect(() => parseStory(STORY_PATH, {...broken, scenes: {s1: {...broken.scenes.s1, rootBlockIds: {}}}}))
            .toThrow(/scene "s1".*rootBlockIds/);
        expect(() => parseStory(STORY_PATH, {...broken, scenes: {s1: 7}}))
            .toThrow(/scene "s1" must be an object/);
    });

    it("refuses a document whose schema version is not a number, which is the hole beside it", () => {
        // `rejectNewerSchema` compares numbers and so says nothing at all about a version that is a
        // string, while the ladder reads a non-numeric version as v1 and walks the whole thing over
        // it - so `"schemaVersion": "21"` would be migrated DOWN and stamped. That is the precise
        // silent down-level the old serialize refusal existed to prevent, and with serialize real it
        // has to be refused here instead.
        expect(() => parseStory(STORY_PATH, {...story(), schemaVersion: "21"}))
            .toThrow(/"schemaVersion" must be a number/);
        expect(() => parseStory(STORY_PATH, {...story(), schemaVersion: null}))
            .toThrow(/"schemaVersion" must be a number/);
        expect(() => parseStory(STORY_PATH, {...story(), schemaVersion: "21"}))
            .toThrow(DocumentCorruptError);
    });

    it("counts scenes, chapters and rows", () => {
        const summary = storyDocumentSpec.summarize(story(
            scene("s1", "Prologue", [block("b1", "hello"), block("b2", "there")]),
            scene("s2", "Act One", [block("b3", "again")]),
        ));

        expect(summary.title).toBe("A Story");
        expect(summary.counts).toEqual([
            {key: "storyScenes", value: 2},
            {key: "storyChapters", value: 1},
            {key: "storyBlocks", value: 3},
        ]);
    });
});

/**
 * The invariant `story.ts` states, held as tests rather than as prose.
 *
 * > Every value that leaves `parse` is stamped at exactly `STORY_DOCUMENT_SCHEMA_VERSION`, and is a
 * > fixed point of `parse` itself.
 *
 * This is what replaced the old `serialize` refusal. That refusal existed because `parse` did not
 * run the story migration, so a round trip could stamp an unmigrated document with the current
 * version - a silent down-level. The refusal is gone; what makes the round trip safe now is the
 * property below, so the property is what has to be pinned.
 */
describe("story spec: the parse/serialize round trip", () => {
    /** Exactly what a resolve does: encode, and read the encoding back. */
    function roundTrip(document: StoryDocument): StoryDocument {
        const text = storyDocumentSpec.serialize(document);
        return parseStory(STORY_PATH, JSON.parse(text));
    }

    it("stamps the current schema version on every version the ladder knows", () => {
        // Every rung, not only the current one: a document at any version the ladder still reaches
        // must come out at the current one or not come out at all. There is no third answer, and
        // "half-migrated" is the one the DocumentSpec contract singles out as the outcome that must
        // not happen.
        for (let version = STORY_DOCUMENT_MIN_SUPPORTED_VERSION; version <= STORY_DOCUMENT_SCHEMA_VERSION; version += 1) {
            const parsed = parseStory(STORY_PATH, {
                ...story(scene("s1", "Prologue", [block("b1", "hello")])),
                schemaVersion: version,
            });
            expect(parsed.schemaVersion).toBe(STORY_DOCUMENT_SCHEMA_VERSION);
        }
    });

    it("refuses every version below the ladder's floor, and names it", () => {
        // The other side of the same contract. Below the floor the answer is `corrupt`, and it has
        // to carry both numbers: an author who sees only "could not be read" cannot tell a damaged
        // file from a project made before this build could read one.
        for (const version of [1, 13, 17, STORY_DOCUMENT_MIN_SUPPORTED_VERSION - 1]) {
            expect(() => parseStory(STORY_PATH, {
                ...story(scene("s1", "Prologue", [block("b1", "hello")])),
                schemaVersion: version,
            })).toThrow(new RegExp(`v${version} is older than this Studio version can read`));
        }
    });

    it("treats a document with no schemaVersion as the oldest, not as the newest", () => {
        // Which now means it is refused rather than migrated - the ladder reads an absent version as
        // v1, and v1 is under the floor. The property being pinned is unchanged and is the one that
        // matters: an absent version must never be READ AS CURRENT, because a document a newer
        // Studio wrote would then be accepted and written back with its fields stripped.
        const {schemaVersion: _omitted, ...withoutVersion} = story(scene("s1", "Prologue", [block("b1", "hi")]));
        expect(() => parseStory(STORY_PATH, withoutVersion)).toThrow(/v1 is older than this Studio version can read/);
    });

    it("is a fixed point: parse, write, read gives the same document and the same bytes", () => {
        // The property the whole write-back path rests on. Parsing may legitimately change a
        // document once - it migrates it and fills in what normalize derives - but it must not keep
        // changing it, or the bytes a merge commits would not be the bytes its decision list
        // described, and every save would land in history as a change to the whole file.
        const raw = story(
            scene("s1", "Prologue", [block("b1", "hello"), block("b2", "there")]),
            scene("s2", "Act One", [block("b3", "again")]),
        );

        const once = parseStory(STORY_PATH, raw);
        const twice = roundTrip(once);

        expect(twice).toStrictEqual(once);
        expect(storyDocumentSpec.serialize(twice)).toBe(storyDocumentSpec.serialize(once));
    });

    it("is a fixed point for an OLD document too, where the migration actually does work", () => {
        // The case that matters: at the ladder's floor a step rewrites payloads on the way up - here
        // the transition's percentage hold becomes a length of time. The second pass must then be a
        // no-op, or a merge of a partner's older document would drift on every write.
        const held = jump("j1", "s2");
        (held.payload as Record<string, unknown>).transition = {
            kind: "throughColor",
            durationMs: 800,
            props: {color: "#000000", hold: 25},
        };
        const once = parseStory(STORY_PATH, {
            ...story(scene("s1", "Prologue", [held]), scene("s2", "Act One", [block("b1", "hello")])),
            schemaVersion: STORY_DOCUMENT_MIN_SUPPORTED_VERSION,
        });

        expect((once.scenes.s1.blocks.j1.payload as Record<string, unknown>).transition)
            .toEqual({kind: "throughColor", durationMs: 800, holdMs: 200, props: {color: "#000000"}});
        expect(roundTrip(once)).toStrictEqual(once);
        expect(storyDocumentSpec.serialize(roundTrip(once))).toBe(storyDocumentSpec.serialize(once));
    });

    it("does not read the clock, so the same bytes always parse to the same document", () => {
        // `normalizeStoryDocument` stamps `meta.updatedAt` from a clock when it is given one, and
        // `parse` gives it none. If it did, the three sides of a merge would be stamped at three
        // different instants and this would fail - which is how it would fail in production too,
        // silently, as a whole-file diff on every read.
        const raw = story(scene("s1", "Prologue", [block("b1", "hello")]));
        expect(parseStory(STORY_PATH, raw)).toStrictEqual(parseStory(STORY_PATH, raw));
        expect(parseStory(STORY_PATH, raw).meta).toBeUndefined();
    });

    it("brings a v22 document up without inventing a returnable jump", () => {
        // v23 is additive: the field could not have been written at v22, and absent has to keep
        // reading as the plain jump the row has always been. Absent rather than `false`, because the
        // canonical encoder and the diff both read a key that is there.
        const parsed = parseStory(STORY_PATH, {
            ...story(scene("s1", "Prologue", [jump("j1", "s2")])),
            schemaVersion: 22,
        });

        expect(parsed.schemaVersion).toBe(STORY_DOCUMENT_SCHEMA_VERSION);
        expect("returnable" in (parsed.scenes.s1.blocks.j1.payload as object)).toBe(false);
    });

    it("carries a returnable jump through a write and a read unchanged", () => {
        // The flag is what makes the row a call, so losing it silently is the whole story after it
        // never running. Bytes as well as shape: a field that survived the parse but not the encoder
        // would come back on the next read.
        const raw = {
            ...story(scene("s1", "Prologue", [jump("j1", "s2", true), jump("j2", "s2")])),
            schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        };

        const once = parseStory(STORY_PATH, raw);
        const twice = roundTrip(once);

        expect(once.scenes.s1.blocks.j1.payload).toMatchObject({ targetSceneId: "s2", returnable: true });
        expect("returnable" in (once.scenes.s1.blocks.j2.payload as object)).toBe(false);
        expect(twice).toStrictEqual(once);
        expect(storyDocumentSpec.serialize(twice)).toBe(storyDocumentSpec.serialize(once));
    });

    it("never produces a key holding undefined, whatever the document left out", () => {
        // The half of this that made the format unwritable before. `JSON.stringify` drops an
        // assigned `undefined` in silence; the canonical encoder throws on it. A scene with an
        // unplayable `bgm` and a whitespace background id is the shape that used to produce two.
        const withCleared = story(scene("s1", "Prologue", [block("b1", "hello")]));
        const parsed = parseStory(STORY_PATH, {
            ...withCleared,
            chapters: [],
            scenes: {s1: {...withCleared.scenes.s1, bgm: {assetId: "  "}, defaultBackgroundAssetId: "   "}},
        });

        expect(() => storyDocumentSpec.serialize(parsed)).not.toThrow();
        expect("bgm" in parsed.scenes.s1).toBe(false);
        expect("defaultBackgroundAssetId" in parsed.scenes.s1).toBe(false);
        // No chapter to take one from, so there is no entry scene - and the key is absent rather
        // than present-and-undefined, which is the difference the encoder refuses on.
        expect("entrySceneId" in parsed).toBe(false);
    });
});

describe("story spec: diff", () => {
    it("puts different scenes on different rows and names them by the author's title", () => {
        const base = story(scene("s1", "Prologue", [block("b1", "hello")]), scene("s2", "Act One", [block("b2", "one")]));
        const head = story(
            scene("s1", "Prologue", [block("b1", "hello there")]),
            scene("s2", "Act One", [block("b2", "one more")]),
        );

        const result = diffStory(base, head);

        expect(result.tier).toBe("semantic");
        expect(result.changes.map(change => change.subject)).toEqual(["Prologue", "Act One"]);
        expect(result.changes[0].children).toHaveLength(1);
        expect(result.changes[0].children![0].label.key).toBe("documentDiff.story.blockChanged");
        // The row's own words, so the author can tell which line it is without opening the scene.
        expect(result.changes[0].children![0].subject).toBe("hello there");
    });

    it("reports a whole new scene as one row rather than a row per line in it", () => {
        const result = diffStory(
            story(scene("s1", "Prologue", [block("b1", "hello")])),
            story(scene("s1", "Prologue", [block("b1", "hello")]), scene("s2", "Act One", [
                block("b2", "one"), block("b3", "two"), block("b4", "three"),
            ])),
        );

        expect(result.changes).toHaveLength(1);
        expect(result.changes[0]).toMatchObject({
            kind: "added",
            subject: "Act One",
            label: {key: "documentDiff.story.sceneAdded", params: {blocks: 3}},
        });
        expect(result.changes[0].children).toBeUndefined();
    });

    /**
     * An ordered array gets ONE row for the whole array. Reported element by element, a scene whose
     * rows were resequenced reads as every row after the first change having moved - and when this
     * same list becomes a resolution it would offer to interleave two orderings into a third nobody
     * wrote.
     */
    it("reports a reordered scene as one row about the order", () => {
        const rows = [block("b1", "one"), block("b2", "two"), block("b3", "three")];
        const base = story(scene("s1", "Prologue", rows));
        const head = story({...scene("s1", "Prologue", rows), rootBlockIds: ["b3", "b1", "b2"]});

        const result = diffStory(base, head);

        expect(result.changes[0].children).toHaveLength(1);
        expect(result.changes[0].children![0]).toMatchObject({
            kind: "moved",
            label: {key: "documentDiff.story.blockOrder"},
            path: ["scenes", "s1", "rootBlockIds"],
        });
    });

    it("matches rows by id, so an insertion at the top is one addition and nothing else", () => {
        const existing = [block("b1", "one"), block("b2", "two")];
        const base = story(scene("s1", "Prologue", existing));
        const head = story(scene("s1", "Prologue", [block("b0", "zero"), ...existing]));

        const result = diffStory(base, head);
        const children = result.changes[0].children!;

        // One addition plus the order row - and emphatically not "every row after it changed",
        // which is what a positional walk of the same edit produces.
        expect(children.map(change => change.label.key)).toEqual([
            "documentDiff.story.blockOrder",
            "documentDiff.story.blockAdded",
        ]);
        expect(children[1].subject).toBe("zero");
    });

    it("lists a scene's leaves in script order, not by id", () => {
        const base = story(scene("s1", "Prologue", [block("z", "first"), block("a", "second")]));
        const head = story(scene("s1", "Prologue", [block("z", "FIRST"), block("a", "SECOND")]));

        expect(diffStory(base, head).changes[0].children!.map(change => change.subject)).toEqual(["FIRST", "SECOND"]);
    });

    it("reports a renamed scene, a moved row and a disabled row with their own labels", () => {
        const base = story(scene("s1", "Prologue", [block("b1", "hello"), block("b2", "child")]));
        const head = story({
            ...scene("s1", "Opening", [
                block("b1", "hello", {childrenIds: ["b2"]}),
                block("b2", "child", {parentId: "b1", disabled: true}),
            ]),
            rootBlockIds: ["b1"],
        });

        const keys = diffStory(base, head).changes[0].children!.map(change => change.label.key);

        expect(keys).toContain("documentDiff.story.sceneRenamed");
        expect(keys).toContain("documentDiff.story.blockMoved");
        expect(keys).toContain("documentDiff.story.blockDisabled");
    });

    /**
     * A chapter's scene list changes whenever a scene is written, so comparing it raw would report
     * every new scene twice. It is compared over the scenes both sides hold, which leaves exactly
     * the acts the author performed on the CHAPTER.
     */
    it("does not repeat a new scene as a chapter change, but does report a scene moved between chapters", () => {
        const prologue = scene("s1", "Prologue", [block("b1", "hello")]);
        const act = scene("s2", "Act One", [block("b2", "one")]);
        const twoChapters = (first: string[], second: string[]): StoryDocument => ({
            ...story(prologue, act),
            chapters: [
                {id: "ch1", name: "Chapter One", sceneIds: first},
                {id: "ch2", name: "Chapter Two", sceneIds: second},
            ],
        });

        const moved = diffStory(twoChapters(["s1", "s2"], []), twoChapters(["s1"], ["s2"]));

        expect(moved.changes.map(change => change.label.key)).toEqual([
            "documentDiff.story.chapterScenes",
            "documentDiff.story.chapterScenes",
        ]);
    });

    it("gives identical documents an empty, complete diff and never throws on a broken one", () => {
        const document = story(scene("s1", "Prologue", [block("b1", "hello")]));

        expect(diffStory(document, structuredClone(document))).toMatchObject({changes: [], total: 0, complete: true});
        expect(() => diffStory({} as StoryDocument, {scenes: null} as unknown as StoryDocument)).not.toThrow();
    });

    it("respects the budget and reports what it dropped", () => {
        const many = (text: string) => story(scene("s1", "Prologue",
            Array.from({length: 12}, (_, index) => block(`b${index}`, `${text} ${index}`))));

        const result = diffStory(many("was"), many("now"), 5);

        expect(result.total).toBe(12);
        expect(result.complete).toBe(false);
        expect(countDocumentChanges([...result.changes])).toBe(12);
        expect(result.changes[0].children).toHaveLength(5);
        expect(result.changes[0].truncated).toBe(7);
    });
});

describe("assets-metadata spec: reading", () => {
    it("claims a shard's path and takes the asset type from the file name", () => {
        expect(resolveDocumentSpecForPath(IMAGE_SHARD)).toEqual({
            spec: assetsMetadataSpec,
            parameters: {type: "image"},
        });
        expect(assetsMetadataSpec.pathFor({type: "audio"})).toBe("assets/assets.metadata.audio.json");
        expect(ASSETS_METADATA_DOCUMENT_PATH).toBe("assets/assets.metadata.<type>.json");
        expect(parseShard(IMAGE_SHARD, {}).type).toBe("image");
    });

    it("skips an entry that is not an object rather than refusing the whole shard", () => {
        // One bad row must not cost the author every asset of that type - which is also what the
        // reader that owns this file does (`AssetsMetadataManager.assignValidAssets`).
        const parsed = parseShard(IMAGE_SHARD, {good: {id: "good", name: "bg.png"}, bad: 7, worse: null});

        expect(Object.keys(parsed.assets)).toEqual(["good"]);
    });

    it("refuses a root that is not an object", () => {
        expect(() => parseShard(IMAGE_SHARD, [])).toThrow(/at the document root/);
    });

    it("refuses to serialize, naming why", () => {
        expect(() => assetsMetadataSpec.serialize(shard({}))).toThrow(/read-only/);
        expect(() => assetsMetadataSpec.serialize(shard({}))).toThrow(/AssetsService/);
    });
});

describe("assets-metadata spec: diff", () => {
    /** The commonest collaboration case in the whole system, and the one it must not call a conflict. */
    it("reads two people importing different assets as two independent additions", () => {
        const base = shard({a1: {id: "a1", name: "bg.png", hash: "h1"}});
        const head = shard({
            a1: {id: "a1", name: "bg.png", hash: "h1"},
            a2: {id: "a2", name: "hero.png", hash: "h2"},
            a3: {id: "a3", name: "sky.png", hash: "h3"},
        });

        const result = diffAssets(base, head);

        expect(result.tier).toBe("semantic");
        expect(result.changes.map(change => [change.kind, change.subject, change.path.join("/")])).toEqual([
            ["added", "hero.png", "assets/a2"],
            ["added", "sky.png", "assets/a3"],
        ]);
        // Independent means independent: no group, no shared parent, nothing that could resolve one
        // way for both.
        expect(result.changes.every(change => change.children === undefined)).toBe(true);
    });

    it("tells replaced bytes apart from a rename", () => {
        const base = shard({a1: {id: "a1", name: "bg.png", hash: "h1", tags: []}});
        const head = shard({a1: {id: "a1", name: "background.png", hash: "h2", tags: ["outdoor"]}});

        const [row] = diffAssets(base, head).changes;

        expect(row.subject).toBe("background.png");
        expect(row.children!.map(change => change.label.key)).toEqual([
            "documentDiff.assets.renamed",
            "documentDiff.assets.content",
            "documentDiff.assets.field",
        ]);
        expect(row.children![0].label.params).toEqual({from: "bg.png", to: "background.png"});
    });

    it("gives identical shards an empty diff and never throws on a broken one", () => {
        const document = shard({a1: {id: "a1", name: "bg.png"}});

        expect(diffAssets(document, structuredClone(document))).toMatchObject({changes: [], total: 0, complete: true});
        expect(() => diffAssets({} as AssetsMetadataShard, document)).not.toThrow();
    });

    it("sorts by the author's own name before it truncates", () => {
        const head = shard(Object.fromEntries(
            ["yak", "ant", "cow", "bee"].map((name, index) => [`a${index}`, {id: `a${index}`, name: `${name}.png`}]),
        ));

        const result = diffAssets(shard({}), head, 2);

        expect(result.total).toBe(4);
        expect(result.complete).toBe(false);
        expect(result.changes.map(change => change.subject)).toEqual(["ant.png", "bee.png"]);
    });
});
