import { describe, expect, it } from "vitest";
import type { Blueprint, BlueprintDocument, BlueprintGraphEdge } from "@shared/types/blueprint/document";
import { BLUEPRINT_NODE_TYPE_GAME_START_STORY } from "@shared/types/blueprint/graph";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import {
    STORY_DOCUMENT_SCHEMA_VERSION,
    type StoryBlock,
    type StoryDocument,
    type StoryScene,
} from "@shared/types/story";
import {
    blueprintDocumentGraphCarriers,
    blueprintGraphCarriers,
    reachableSceneIds,
    scanStoryEntryPoints,
} from "./storyReachability";

/**
 * The one walk and the one entry scan.
 *
 * Both halves are checked in the direction that costs a shipped game rather than a wasted byte: a
 * scene the sweep keeps but need not have is invisible to the player, while one it drops leaves a
 * story that stops dead at a jump. So the cases here are the four ways an edge can look real and not
 * be - disabled, dangling, seeded from another story, or a target only the running game knows.
 */

// --- fixtures ---------------------------------------------------------------

function block(partial: Partial<StoryBlock> & Pick<StoryBlock, "id" | "kind" | "payload">): StoryBlock {
    return {
        parentId: null,
        childrenIds: [],
        ...partial,
    } as StoryBlock;
}

const jump = (
    id: string,
    targetSceneId: string,
    extra?: { parentId?: string | null; disabled?: boolean },
): StoryBlock => block({ id, kind: "jump", payload: { targetSceneId }, ...extra });

const goto = (id: string, targetLabel: string): StoryBlock =>
    block({ id, kind: "control", payload: { control: "goto", targetLabel } });

function scene(id: string, blocks: StoryBlock[], rootBlockIds?: string[]): StoryScene {
    return {
        id,
        name: id,
        runtimeName: id,
        rootBlockIds: rootBlockIds ?? blocks.filter(entry => entry.parentId === null).map(entry => entry.id),
        blocks: Object.fromEntries(blocks.map(entry => [entry.id, entry])),
    };
}

function document(scenes: StoryScene[], entrySceneId?: string): StoryDocument {
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "story-1",
        name: "Story",
        chapters: [],
        scenes: Object.fromEntries(scenes.map(entry => [entry.id, entry])),
        ...(entrySceneId ? { entrySceneId } : {}),
    };
}

function startStoryBlueprint(
    params: Record<string, unknown>,
    edges: BlueprintGraphEdge[] = [],
): Blueprint {
    return {
        id: "bp-1",
        name: "Title screen",
        owner: { kind: "globalMain" },
        frontend: "visual",
        programKind: "graph",
        program: {
            kind: "graph",
            graphs: {
                events: {
                    "ev-1": {
                        id: "ev-1",
                        graph: {
                            nodes: { "n-1": { id: "n-1", type: BLUEPRINT_NODE_TYPE_GAME_START_STORY, params } },
                            edges,
                        },
                    },
                },
                functions: {},
            },
        },
    } as Blueprint;
}

/** The same blueprint in the container lint holds, with no owner record naming it. */
function asDocument(blueprint: Blueprint): BlueprintDocument {
    return {
        schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
        blueprints: { [blueprint.id]: blueprint },
        ownerRecords: {},
    } as BlueprintDocument;
}

const wiredTo = (port: string): BlueprintGraphEdge => ({
    from: { nodeId: "n-source", port: "value" },
    to: { nodeId: "n-1", port },
});

const everyScene = () => true;

// --- the walk ---------------------------------------------------------------

describe("reachableSceneIds", () => {
    it("follows a jump and nothing else", () => {
        const built = document(
            [
                scene("sc1", [goto("b1", "retry"), jump("b2", "sc2")]),
                scene("sc2", []),
                scene("sc3", []),
            ],
            "sc1",
        );

        expect([...reachableSceneIds(built, { fallback: "none" })]).toEqual(["sc1", "sc2"]);
    });

    it("does not follow a jump inside a disabled subtree", () => {
        // The compiler drops a disabled row before it emits anything, so the jump provably cannot
        // run - and a scene only it reaches is one the package can lose.
        const built = document(
            [
                scene("sc1", [
                    block({ id: "grp", kind: "control", childrenIds: ["b1"], disabled: true, payload: { control: "sequence" } }),
                    jump("b1", "sc2", { parentId: "grp" }),
                    jump("b2", "sc3", { disabled: true }),
                ], ["grp", "b2"]),
                scene("sc2", []),
                scene("sc3", []),
            ],
            "sc1",
        );

        expect([...reachableSceneIds(built, { fallback: "none" })]).toEqual(["sc1"]);
    });

    it("ignores a jump naming a scene the document does not have", () => {
        const built = document([scene("sc1", [jump("b1", "sc-deleted")])], "sc1");

        expect([...reachableSceneIds(built, { fallback: "none" })]).toEqual(["sc1"]);
    });

    it("ignores a seed the document does not have", () => {
        // Callers hand over entries collected across the project, and a `Start Story` node can name
        // another story's scene. An unfiltered seed would put an id in the result no scene backs.
        const built = document([scene("sc1", [])], "sc1");

        const reachable = reachableSceneIds(built, {
            entrySceneIds: ["sc1", "sc-of-another-story"],
            fallback: "none",
        });

        expect([...reachable]).toEqual(["sc1"]);
    });

    it("enters the first scene in document order when nothing marks an entry, under documentOrder", () => {
        const built = document([scene("sc1", [jump("b1", "sc2")]), scene("sc2", [])]);

        expect([...reachableSceneIds(built, { fallback: "documentOrder" })]).toEqual(["sc1", "sc2"]);
    });

    it("makes no claim at all when nothing marks an entry, under none", () => {
        const built = document([scene("sc1", [jump("b1", "sc2")]), scene("sc2", [])]);

        expect([...reachableSceneIds(built, { fallback: "none" })]).toEqual([]);
    });

    it("prefers the marked entry over either fallback", () => {
        const built = document([scene("sc1", []), scene("sc2", [jump("b1", "sc3")]), scene("sc3", [])], "sc2");

        expect([...reachableSceneIds(built, { fallback: "documentOrder" })]).toEqual(["sc2", "sc3"]);
        expect([...reachableSceneIds(built, { fallback: "none" })]).toEqual(["sc2", "sc3"]);
    });

    it("falls back when the marked entry names a scene that is gone", () => {
        const built = document([scene("sc1", []), scene("sc2", [])], "sc-deleted");

        expect([...reachableSceneIds(built, { fallback: "documentOrder" })]).toEqual(["sc1"]);
        expect([...reachableSceneIds(built, { fallback: "none" })]).toEqual([]);
    });
});

// --- the entry scan ---------------------------------------------------------

describe("scanStoryEntryPoints", () => {
    it("collects the scene a Start Story node picks, per story", () => {
        const scan = scanStoryEntryPoints(
            blueprintGraphCarriers([startStoryBlueprint({ storyId: "story-1", sceneId: "scene-7" })]),
            everyScene,
        );

        expect(scan.undecidable).toEqual([]);
        expect([...(scan.byStory.get("story-1") ?? [])]).toEqual(["scene-7"]);
        expect(scan.byStory.get("story-2")).toBeUndefined();
    });

    it("keeps only the scenes the story actually has", () => {
        const scan = scanStoryEntryPoints(
            blueprintGraphCarriers([startStoryBlueprint({ storyId: "story-1", sceneId: "scene-gone" })]),
            (storyId, sceneId) => storyId === "story-1" && sceneId === "scene-7",
        );

        expect(scan.byStory.size).toBe(0);
    });

    it("reports a blank target as undecidable", () => {
        const scan = scanStoryEntryPoints(
            blueprintGraphCarriers([startStoryBlueprint({ storyId: "story-1", sceneId: "  " })]),
            everyScene,
        );

        expect(scan.byStory.size).toBe(0);
        expect(scan.undecidable).toEqual([{
            blueprintId: "bp-1",
            blueprintName: "Title screen",
            graphKind: "event",
            graphId: "ev-1",
            nodeId: "n-1",
            missing: ["sceneId"],
        }]);
    });

    it("names both targets when a node picked neither", () => {
        const scan = scanStoryEntryPoints(blueprintGraphCarriers([startStoryBlueprint({})]), everyScene);

        expect(scan.undecidable[0]?.missing).toEqual(["storyId", "sceneId"]);
    });

    it("reports a wired sceneId pin as undecidable even with a scene still picked", () => {
        // The pin beats the inspector's stored value at execution time (`resolveStartStoryTarget`),
        // so a stale picked scene beside a wired one is a launcher whose scene only the running game
        // knows. Reading the param alone called this decided and swept on it.
        const scan = scanStoryEntryPoints(
            blueprintGraphCarriers([
                startStoryBlueprint({ storyId: "story-1", sceneId: "scene-7" }, [wiredTo("sceneId")]),
            ]),
            everyScene,
        );

        expect(scan.byStory.size).toBe(0);
        expect(scan.undecidable[0]?.missing).toEqual(["sceneId"]);
    });

    it("reports a wired storyId pin the same way", () => {
        const scan = scanStoryEntryPoints(
            blueprintGraphCarriers([
                startStoryBlueprint({ storyId: "story-1", sceneId: "scene-7" }, [wiredTo("storyId")]),
            ]),
            everyScene,
        );

        expect(scan.undecidable[0]?.missing).toEqual(["storyId"]);
    });

    it("leaves a node alone when the wire lands on another pin", () => {
        // `startBlockId` narrows the launch to a row inside the scene the node already names, so it
        // cannot move play to a different scene.
        const scan = scanStoryEntryPoints(
            blueprintGraphCarriers([
                startStoryBlueprint({ storyId: "story-1", sceneId: "scene-7" }, [wiredTo("startBlockId")]),
            ]),
            everyScene,
        );

        expect(scan.undecidable).toEqual([]);
        expect([...(scan.byStory.get("story-1") ?? [])]).toEqual(["scene-7"]);
    });

    it("reads the same blueprint the same way through either container", () => {
        // Lint holds a document and the bundle assembler holds loaded blueprints; two answers to one
        // project is the whole failure this module exists to prevent. The document has no owner
        // record naming this blueprint, which the entry scan reads anyway.
        const blueprint = startStoryBlueprint({ storyId: "story-1", sceneId: "scene-7" });

        expect([...blueprintDocumentGraphCarriers(asDocument(blueprint))])
            .toEqual([...blueprintGraphCarriers([blueprint])]);
    });

    it("finds nothing in a TypeScript blueprint and nothing in no document", () => {
        const script = {
            id: "bp-2",
            name: "Script",
            owner: { kind: "globalMain" },
            frontend: "typescript",
            programKind: "scriptModule",
            program: { kind: "scriptModule", source: { language: "typescript", code: "" } },
        } as Blueprint;

        expect([...blueprintGraphCarriers([script])]).toEqual([]);
        expect([...blueprintDocumentGraphCarriers(null)]).toEqual([]);
    });
});
