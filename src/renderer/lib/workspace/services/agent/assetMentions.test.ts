import { describe, expect, it, vi } from "vitest";
import type { AgentCallResult } from "@shared/agent/protocol";
import type { StoryDocument } from "@shared/types/story";
import type { UIDocument } from "@shared/types/ui-editor/document";
import { AssetType } from "../assets/assetTypes";
import { Services } from "../services";
import { AgentRefusal, type AgentToolContext } from "./agentCall";
import { findAssetMentions, mentions } from "./assetMentions";
import { assetDelete, assetUsage } from "./tools/assetTools";

/**
 * The second opinion `asset_delete` asks before it deletes, and the second list `asset_usage` prints:
 * the asset's id written anywhere in the stored stories, pages and blueprints, whatever field holds
 * it. The usage index once missed every `/vfx` row, and lint then listed their clips as unused.
 */

function story(blocks: Record<string, unknown>): { name: string; document: StoryDocument } {
    return {
        name: "Main",
        document: {
            id: "story-1",
            name: "Main",
            entrySceneId: "scene-1",
            chapters: [{ id: "ch", name: "Chapter 1", sceneIds: ["scene-1"] }],
            scenes: {
                "scene-1": {
                    id: "scene-1",
                    name: "Opening",
                    rootBlockIds: Object.keys(blocks),
                    blocks: Object.fromEntries(Object.entries(blocks).map(([id, payload]) => [id, { id, kind: "action", parentId: null, childrenIds: [], payload }])),
                },
            },
        } as unknown as StoryDocument,
    };
}

describe("findAssetMentions", () => {
    it("finds a /vfx row's clip, by row, whatever field holds it", () => {
        const found = findAssetMentions({
            assetId: "clip-fire",
            stories: [story({
                a: { action: "audio", assetId: "music" },
                b: { action: "vfx", operation: "create", assetId: "clip-fire", objectName: "fire_6" },
            })],
        });
        expect(found).toEqual([{ kind: "storyRow", where: "Main / Opening:2" }]);
    });

    it("finds it in a page's element and in a blueprint, and says nothing of an asset nobody names", () => {
        const ui = {
            surfaces: [{ id: "title", name: "Title", rootElementId: "root" }],
            elements: {
                root: { id: "root", type: "nl.root", parentId: null, childrenIds: ["art"] },
                art: { id: "art", type: "nl.image", name: "Key art", parentId: "root", childrenIds: [], props: { imageFill: { assetId: "art-1" } } },
            },
        } as unknown as UIDocument;
        const blueprints = { blueprints: { b: { name: "Quit", graphs: { events: { e: { graph: { nodes: { n: { params: { asset: "art-1" } } } } } } } } } };
        const found = findAssetMentions({ assetId: "art-1", stories: [], uiDocument: ui, blueprintDocument: blueprints as never });
        expect(found.map(item => item.where)).toEqual(['page "Title" / Key art', 'blueprint "Quit"']);
        expect(findAssetMentions({ assetId: "unused-1", stories: [story({ a: { action: "audio", assetId: "music" } })], uiDocument: ui })).toEqual([]);
    });

    it("reads keys and nested values", () => {
        expect(mentions({ a: [{ b: "x-id-1" }] }, "x-id-1")).toBe(true);
        expect(mentions({ "x-id-1": true }, "x-id-1")).toBe(true);
        expect(mentions({ a: 1 }, "x-id-1")).toBe(false);
    });
});

describe("asset_delete and asset_usage with a use the index does not count", () => {
    function harness() {
        const clip = { id: "clip-fire", name: "fire", type: AssetType.Video, hash: "h" };
        const deleteAsset = vi.fn(async () => ({ success: true }));
        const assets = {
            getAssets: () => ({ [AssetType.Video]: { [clip.id]: clip } }),
            // The index says nothing uses it - the failure this guards against.
            findAssetReferences: async () => ({ checked: true, references: new Map(), gaps: [] }),
            deleteAsset,
        };
        const stories = story({ b: { action: "vfx", operation: "create", assetId: "clip-fire", objectName: "fire_6" } });
        const storyService = { listStories: () => [{ id: "story-1", name: "Main" }], loadStory: async () => stories.document };
        const services: Record<string, unknown> = {
            [Services.Assets]: assets,
            [Services.Story]: storyService,
            [Services.UIDocument]: { getDocument: () => ({ surfaces: [], elements: {} }) },
            [Services.UIGraph]: { getDocument: () => ({ blueprintDocument: { blueprints: {} } }) },
        };
        const tool = {
            ctx: { services: { get: (name: string) => services[name] } },
            request: { callId: "call" },
            follow: { describeCall: vi.fn() },
            log: vi.fn(),
        } as unknown as AgentToolContext;
        return { tool, deleteAsset };
    }

    it("refuses the delete, listing the row", async () => {
        const { tool, deleteAsset } = harness();
        let refusal: AgentRefusal | null = null;
        try {
            await assetDelete({ asset: "fire" }, tool);
        } catch (error) {
            refusal = error as AgentRefusal;
        }
        expect(refusal).toBeInstanceOf(AgentRefusal);
        expect(refusal?.message).toContain("Main / Opening:1");
        expect(deleteAsset).not.toHaveBeenCalled();
    });

    it("lists the row as a use", async () => {
        const { tool } = harness();
        const result = await assetUsage({ asset: "fire" }, tool) as Extract<AgentCallResult, { ok: true }>;
        expect(result.structured).toMatchObject({ used: true, mentioned: [{ where: "Main / Opening:1" }] });
    });
});
