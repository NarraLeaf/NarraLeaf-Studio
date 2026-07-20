import { describe, expect, it } from "vitest";
import {
    extractAssetEntries,
    extractBlueprintEntries,
    extractLocalizationKeyEntries,
    extractStoryEntries,
    indexEntries,
    parseSearchQuery,
    querySearchIndex,
    type SearchIndexEntry,
} from "./searchIndexModel";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import type { StoryBlock, StoryDocument } from "@shared/types/story";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { LocalizationKeysDocument } from "@shared/types/localization";

function dialogueBlock(id: string, text: string): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        parentId: null,
        childrenIds: [],
        payload: { action: "dialogue", text: { value: text, textId: `t-${id}`, role: "dialogue" } },
    } as StoryBlock;
}

function storyDoc(): StoryDocument {
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "story-1",
        name: "Main Story",
        entrySceneId: "scene-1",
        chapters: [{ id: "ch-1", name: "Chapter 1", sceneIds: ["scene-1"] }],
        scenes: {
            "scene-1": {
                id: "scene-1",
                name: "Opening",
                runtimeName: "opening",
                rootBlockIds: ["b1", "b2", "v1", "sv1"],
                blocks: {
                    b1: dialogueBlock("b1", "Good morning, Inko!"),
                    b2: {
                        id: "b2",
                        kind: "jump",
                        parentId: null,
                        childrenIds: [],
                        payload: {},
                    } as unknown as StoryBlock,
                    v1: {
                        id: "v1",
                        kind: "declaration",
                        parentId: null,
                        childrenIds: [],
                        payload: { scope: "scene", name: "Affection", valueType: "number", storageKey: "v1" },
                    } as StoryBlock,
                    sv1: {
                        id: "sv1",
                        kind: "declaration",
                        parentId: null,
                        childrenIds: [],
                        payload: { scope: "saved", name: "Route Flag", valueType: "boolean", storageKey: "sv1" },
                    } as StoryBlock,
                },
            },
        },
    } as unknown as StoryDocument;
}

function blueprintDoc(): BlueprintDocument {
    return {
        schemaVersion: 1,
        ownerRecords: {
            globalMain: { activeBlueprintId: "bp-global", privateBlueprintIds: ["bp-global"] },
            "surfaceMain:surf-1": { activeBlueprintId: "bp-1", privateBlueprintIds: ["bp-1"] },
        },
        persistentVariables: {
            pv1: { id: "pv1", name: "Total Playtime" } as never,
        },
        blueprints: {
            "bp-global": {
                id: "bp-global",
                name: "Global",
                owner: {} as never,
                frontend: "graph",
                programKind: "graph",
                program: { kind: "graph", graphs: { events: {}, functions: {} } },
            },
            "bp-1": {
                id: "bp-1",
                name: "Main Menu Logic",
                owner: {} as never,
                frontend: "graph",
                programKind: "graph",
                members: {
                    variables: { mv1: { id: "mv1", name: "Menu Open" } as never },
                    fields: {},
                },
                program: {
                    kind: "graph",
                    graphs: {
                        events: {
                            "ev-1": { graph: { nodes: { n1: { id: "n1", type: "flow.branch" } } } } as never,
                        },
                        functions: {
                            "fn-1": { graph: { nodes: { n2: { id: "n2", type: "custom.unknown" } } } } as never,
                        },
                    },
                },
            },
            "bp-orphan": {
                id: "bp-orphan",
                name: "Orphan",
                owner: {} as never,
                frontend: "graph",
                programKind: "graph",
                members: { variables: { ov: { id: "ov", name: "Unreachable" } as never }, fields: {} },
                program: { kind: "graph", graphs: { events: {}, functions: {} } },
            },
        },
    } as unknown as BlueprintDocument;
}

const keysDoc: LocalizationKeysDocument = {
    schemaVersion: 1,
    keys: {
        "menu.start": { sourceText: "Start Game" },
        "menu.quit": { sourceText: "Quit" },
    },
} as LocalizationKeysDocument;

describe("extractStoryEntries", () => {
    const entries = extractStoryEntries(storyDoc());

    it("indexes block prose with story › scene context and a block jump target", () => {
        const prose = entries.find(e => e.group === "story");
        expect(prose).toMatchObject({
            text: "Good morning, Inko!",
            detail: "Main Story › Opening",
            target: { kind: "storyBlock", storyId: "story-1", sceneId: "scene-1", blockId: "b1" },
        });
    });

    it("skips blocks without a text segment", () => {
        expect(entries.filter(e => e.group === "story")).toHaveLength(1);
    });

    it("indexes scene variable declarations as variable entries jumping to their row", () => {
        const sceneVar = entries.find(e => e.text === "Affection");
        expect(sceneVar).toMatchObject({
            group: "variable",
            target: { kind: "storyBlock", sceneId: "scene-1", blockId: "v1" },
        });
    });

    it("indexes saved variable declarations against their declaring row", () => {
        const savedVar = entries.find(e => e.text === "Route Flag");
        expect(savedVar).toMatchObject({
            group: "variable",
            target: { kind: "storyBlock", sceneId: "scene-1", blockId: "sv1" },
        });
    });
});

describe("extractBlueprintEntries", () => {
    const entries = extractBlueprintEntries(blueprintDoc(), type =>
        type === "flow.branch" ? "Branch" : undefined,
    );

    it("indexes member variables with the owner key for jumping", () => {
        const memberVar = entries.find(e => e.text === "Menu Open");
        expect(memberVar).toMatchObject({
            group: "variable",
            detail: "Main Menu Logic",
            target: { kind: "blueprint", blueprintId: "bp-1", ownerKey: "surfaceMain:surf-1" },
        });
    });

    it("indexes persistent variables against the global blueprint", () => {
        const persistent = entries.find(e => e.text === "Total Playtime");
        expect(persistent).toMatchObject({ target: { kind: "blueprint", blueprintId: "bp-global", ownerKey: "globalMain" } });
    });

    it("resolves node labels through the catalog and falls back to the raw type", () => {
        const branch = entries.find(e => e.group === "blueprintNode" && e.text === "Branch");
        expect(branch).toMatchObject({
            target: { kind: "blueprint", blueprintId: "bp-1", focusEventId: "ev-1", focusNodeId: "n1" },
        });
        const raw = entries.find(e => e.group === "blueprintNode" && e.text === "custom.unknown");
        expect(raw).toMatchObject({
            target: { kind: "blueprint", focusFunctionId: "fn-1", focusNodeId: "n2" },
        });
    });

    it("skips blueprints without an owner record", () => {
        expect(entries.find(e => e.text === "Unreachable")).toBeUndefined();
    });
});

describe("extractLocalizationKeyEntries", () => {
    it("indexes key names with source text as detail", () => {
        const entries = extractLocalizationKeyEntries(keysDoc);
        expect(entries).toHaveLength(2);
        expect(entries[0]).toMatchObject({
            group: "uiTextKey",
            text: "menu.start",
            detail: "Start Game",
            target: { kind: "localizationKey", keyName: "menu.start" },
        });
    });
});

describe("extractAssetEntries", () => {
    it("indexes assets by name with tags/description as detail and a typed target", () => {
        const entries = extractAssetEntries([
            { id: "a1", type: "image", name: "background.webp", tags: ["bg", "day"], description: "Town square" },
            { id: "a2", type: "audio", name: "bgm-main.ogg" },
        ]);
        expect(entries[0]).toMatchObject({
            group: "asset",
            text: "background.webp",
            detail: "bg, day, Town square",
            target: { kind: "asset", assetId: "a1", assetType: "image" },
        });
        expect(entries[1]?.detail).toBeUndefined();
    });

    it("skips unnamed assets", () => {
        expect(extractAssetEntries([{ id: "a3", type: "image", name: "" }])).toHaveLength(0);
    });
});

describe("parseSearchQuery", () => {
    it("lowercases terms and splits on whitespace", () => {
        expect(parseSearchQuery("Good MORNING").terms).toEqual(["good", "morning"]);
    });

    it("keeps a quoted phrase as one term", () => {
        expect(parseSearchQuery('"good morning" inko').terms).toEqual(["good morning", "inko"]);
    });

    it("pulls known key:value pairs out as filters", () => {
        const parsed = parseSearchQuery("morning type:story scene:Opening speaker:Inko");
        expect(parsed.terms).toEqual(["morning"]);
        expect(parsed.filters).toMatchObject({
            groups: ["story"],
            sceneName: "opening",
            speaker: "inko",
        });
    });

    it("leaves an unknown prefix as a literal term so URLs stay searchable", () => {
        expect(parseSearchQuery("https://example.com").terms).toEqual(["https://example.com"]);
        expect(parseSearchQuery("nope:value").terms).toEqual(["nope:value"]);
    });

    it("treats an unrecognized group name as a literal term, not a silent empty filter", () => {
        const parsed = parseSearchQuery("type:nonsense");
        expect(parsed.terms).toEqual(["type:nonsense"]);
        expect(parsed.filters.groups).toBeUndefined();
    });
});

describe("querySearchIndex", () => {
    const entries = indexEntries([
        { id: "1", group: "story", text: "Good morning, Inko!", detail: "Main Story › Opening", fields: { sceneName: "Opening", speaker: "Inko" }, target: { kind: "localizationKey", keyName: "x" } },
        { id: "2", group: "story", text: "It is a fine morning.", detail: "Main Story › Opening", fields: { sceneName: "Opening" }, target: { kind: "localizationKey", keyName: "x" } },
        { id: "3", group: "variable", text: "MorningFlag", target: { kind: "localizationKey", keyName: "x" } },
        { id: "4", group: "uiTextKey", text: "menu.start", detail: "Start the morning", target: { kind: "localizationKey", keyName: "x" } },
        { id: "5", group: "asset", text: "bgm-dawn.ogg", aux: "morning theme", fields: { assetType: "audio" }, target: { kind: "localizationKey", keyName: "x" } },
    ] satisfies SearchIndexEntry[]);

    it("returns empty for a blank query", () => {
        expect(querySearchIndex(entries, "   ")).toEqual([]);
    });

    it("matches case-insensitively and reports the highlight range", () => {
        const groups = querySearchIndex(entries, "MORNING");
        const story = groups.find(g => g.group === "story");
        expect(story?.hits).toHaveLength(2);
        const hit = story?.hits.find(h => h.entry.id === "1");
        // "morning" in "Good morning, Inko!" starts at index 5
        expect(hit?.titleRanges).toEqual([[5, 12]]);
    });

    it("groups results in the fixed group order", () => {
        const groups = querySearchIndex(entries, "morning");
        expect(groups.map(g => g.group)).toEqual(["story", "asset", "variable", "uiTextKey"]);
    });

    it("matches detail at a lower score without a title highlight", () => {
        const groups = querySearchIndex(entries, "morning");
        const keyHit = groups.find(g => g.group === "uiTextKey")?.hits[0];
        expect(keyHit?.titleRanges).toEqual([]);
        expect(keyHit?.matchReason).toBe("detail");
        const titleHit = groups.find(g => g.group === "variable")?.hits[0];
        expect(titleHit && keyHit && titleHit.score > keyHit.score).toBe(true);
    });

    it("matches hidden aux text and says so", () => {
        const asset = querySearchIndex(entries, "morning").find(g => g.group === "asset")?.hits[0];
        expect(asset?.entry.id).toBe("5");
        expect(asset?.matchReason).toBe("aux");
        expect(asset?.titleRanges).toEqual([]);
    });

    it("ranks a word-boundary start above a mid-word occurrence", () => {
        const boundary = querySearchIndex(entries, "morning").find(g => g.group === "story");
        // "morning" at word boundary in both; id 2's match is later in the text → lower score
        expect(boundary?.hits[0]?.entry.id).toBe("1");
    });

    it("ANDs terms regardless of word order, across text and detail", () => {
        const forward = querySearchIndex(entries, "good morning");
        const reversed = querySearchIndex(entries, "morning good");
        expect(forward.find(g => g.group === "story")?.hits.map(h => h.entry.id)).toEqual(["1"]);
        expect(reversed.find(g => g.group === "story")?.hits.map(h => h.entry.id)).toEqual(["1"]);
        // "inko" is in the title, "opening" only in the detail line - both must still match.
        expect(querySearchIndex(entries, "inko opening").find(g => g.group === "story")?.hits).toHaveLength(1);
    });

    it("drops an entry when any term is missing", () => {
        expect(querySearchIndex(entries, "morning nonexistent")).toEqual([]);
    });

    it("highlights every matched term in the title", () => {
        const hit = querySearchIndex(entries, "good inko").find(g => g.group === "story")?.hits[0];
        expect(hit?.titleRanges).toEqual([[0, 4], [14, 18]]);
    });

    it("honours a quoted phrase as a single term", () => {
        expect(querySearchIndex(entries, '"fine morning"').find(g => g.group === "story")?.hits.map(h => h.entry.id))
            .toEqual(["2"]);
        expect(querySearchIndex(entries, '"morning fine"')).toEqual([]);
    });

    it("narrows by a group filter from query syntax", () => {
        const groups = querySearchIndex(entries, "morning type:variable");
        expect(groups.map(g => g.group)).toEqual(["variable"]);
    });

    it("narrows by a field filter from query syntax", () => {
        expect(querySearchIndex(entries, "morning speaker:inko").find(g => g.group === "story")?.hits.map(h => h.entry.id))
            .toEqual(["1"]);
        expect(querySearchIndex(entries, "morning speaker:nobody")).toEqual([]);
    });

    it("intersects supplied filters with query-syntax filters", () => {
        const groups = querySearchIndex(entries, "morning type:story", { filters: { groups: ["variable"] } });
        expect(groups).toEqual([]);
    });

    it("returns nothing for a facet-only query", () => {
        expect(querySearchIndex(entries, "type:story")).toEqual([]);
    });

    it("caps per group and reports the uncapped total", () => {
        const many = indexEntries(
            Array.from({ length: 30 }, (_, i) => ({
                id: `m${i}`,
                group: "story" as const,
                text: `morning line ${i}`,
                target: { kind: "localizationKey" as const, keyName: "x" },
            })),
        );
        const groups = querySearchIndex(many, "morning", { maxPerGroup: 5 });
        expect(groups[0]?.hits).toHaveLength(5);
        expect(groups[0]?.total).toBe(30);
    });

    it("lifts the cap for an expanded group only", () => {
        const many = indexEntries([
            ...Array.from({ length: 30 }, (_, i) => ({
                id: `s${i}`,
                group: "story" as const,
                text: `morning line ${i}`,
                target: { kind: "localizationKey" as const, keyName: "x" },
            })),
            ...Array.from({ length: 30 }, (_, i) => ({
                id: `v${i}`,
                group: "variable" as const,
                text: `morning var ${i}`,
                target: { kind: "localizationKey" as const, keyName: "x" },
            })),
        ]);
        const groups = querySearchIndex(many, "morning", { maxPerGroup: 5, expandedGroups: ["story"] });
        expect(groups.find(g => g.group === "story")?.hits).toHaveLength(30);
        expect(groups.find(g => g.group === "variable")?.hits).toHaveLength(5);
    });
});

describe("indexEntries", () => {
    it("precomputes case-folded haystacks", () => {
        const [entry] = indexEntries([
            { id: "1", group: "story", text: "Good Morning", detail: "Ch. ONE", aux: "TAG", target: { kind: "localizationKey", keyName: "x" } },
        ]);
        expect(entry.textLower).toBe("good morning");
        expect(entry.detailLower).toBe("ch. one");
        expect(entry.auxLower).toBe("tag");
        expect(entry.textFoldable).toBe(true);
    });

    it("flags text whose folding is not length-preserving so ranges are not misreported", () => {
        // "İ" (U+0130) folds to two code units, desyncing folded indices from the original.
        const [entry] = indexEntries([
            { id: "1", group: "story", text: "İstanbul", target: { kind: "localizationKey", keyName: "x" } },
        ]);
        expect(entry.textFoldable).toBe(false);
        const hit = querySearchIndex([entry], "stanbul")[0]?.hits[0];
        expect(hit).toBeDefined();
        expect(hit?.titleRanges).toEqual([]);
    });
});
