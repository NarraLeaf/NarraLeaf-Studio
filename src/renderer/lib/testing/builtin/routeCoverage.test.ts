import { describe, expect, it, vi } from "vitest";
import type { BlueprintDocument, BlueprintOwnerRef } from "@shared/types/blueprint/document";
import { BLUEPRINT_NODE_TYPE_GAME_START_STORY } from "@shared/types/blueprint/graph";
import { STORY_DOCUMENT_SCHEMA_VERSION, type StoryDocument } from "@shared/types/story";
import type { UIDocument } from "@shared/types/ui-editor/document";
import type { PluginStoreReading } from "@shared/utils/pluginStorage";
import { blueprint, document, element, graph, interfaceOf } from "@/lib/workspace/services/references/assetNameTestKit";
import type { ServiceRegistry } from "@/lib/workspace/services/serviceRegistry";
import { Services } from "@/lib/workspace/services/services";
import { TEST_PROTOCOL_VERSION, type TestFinding, type TestRunContext } from "../types";
import type { BuiltInTestHost } from "./index";
import { createRouteCoverageTest } from "./routeCoverage";

// The definition reaches the workspace through its host, so the import graph touches the service
// registry. Nothing here starts a workspace, so an empty bridge is enough.
vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({}),
    getPrivilegedInterface: () => ({}),
}));

/**
 * Where play begins, as route coverage reads it: the same answer the project check and
 * `reachable-endings` take, including a `Start Game` fed from a recollection list's rows.
 */

const STORY = "story-1";
const LIST_OWNER: BlueprintOwnerRef = { kind: "widgetMain", surfaceId: "extra", elementId: "list" };

function story(): StoryDocument {
    const scene = (id: string, blocks: StoryDocument["scenes"][string]["blocks"] = {}) => ({
        id,
        name: id,
        runtimeName: id,
        rootBlockIds: Object.keys(blocks),
        blocks,
    });
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: STORY,
        name: "Main",
        entrySceneId: "opening",
        chapters: [],
        scenes: {
            opening: scene("opening", { j: { id: "j", kind: "jump", parentId: null, childrenIds: [], payload: { targetSceneId: "close" } } }),
            close: scene("close", { e: { id: "e", kind: "control", parentId: null, childrenIds: [], payload: { control: "ending", name: "End" } } as never }),
        },
    } as StoryDocument;
}

const extra: UIDocument = interfaceOf({ id: "extra", name: "Extra", rootElementId: "root" }, [
    element("root", "nl.container", null, { childrenIds: ["list"] }),
    element("list", "nl.list", "root"),
]);

/** The starter template's recollection screen, with `sceneFrom` optionally replacing the row's scene. */
function recollection(sceneFrom?: [string, string], extraNodes: { id: string; type: string; params?: Record<string, unknown> }[] = []): BlueprintDocument {
    return document(blueprint("bp-list", "Recollection", LIST_OWNER, {
        fill: graph(
            [
                { id: "entries", type: "narraleaf.gallery.getEntries", params: { galleryKind: "scene" } },
                { id: "self", type: "blueprint.element.ref", params: { surfaceId: "extra", elementId: "list", elementType: "nl.list" } },
                { id: "fill", type: "blueprint.element.list.setItems" },
            ],
            [["self", "element", "fill", "list"], ["entries", "entries", "fill", "items"]],
        ),
        open: graph(
            [
                { id: "click", type: "blueprint.event.head.itemClick" },
                { id: "rowStory", type: "blueprint.list.getItemField", params: { field: "storyId" } },
                { id: "rowScene", type: "blueprint.list.getItemField", params: { field: "sceneId" } },
                { id: "play", type: BLUEPRINT_NODE_TYPE_GAME_START_STORY },
                ...extraNodes,
            ],
            [
                ["click", "then", "play", "in"],
                ["rowStory", "value", "play", "storyId"],
                [...(sceneFrom ?? ["rowScene", "value"]), "play", "sceneId"],
            ],
        ),
    }));
}

function host(blueprintDocument: BlueprintDocument, pluginStores: PluginStoreReading[]): BuiltInTestHost {
    const services = {
        get: (id: string) => {
            switch (id) {
                case Services.Story:
                    return {
                        getLibraryIndex: () => ({ stories: [{ id: STORY, name: "Main" }] }),
                        loadStory: async () => story(),
                    };
                case Services.UIGraph:
                    return { getDocument: () => ({ blueprintDocument }) };
                case Services.UIDocument:
                    return { getDocument: () => extra };
                case Services.VariableRegistry:
                    return { listEntries: () => [] };
                case Services.ServiceAssets:
                    return { readPluginStores: async () => pluginStores };
                default:
                    throw new Error(`unexpected service ${id}`);
            }
        },
    };
    return { services: () => services as unknown as ServiceRegistry };
}

async function run(testHost: BuiltInTestHost) {
    const findings: TestFinding[] = [];
    const ctx = {
        runId: "run-1",
        protocolVersion: TEST_PROTOCOL_VERSION,
        parameters: {},
        signal: new AbortController().signal,
        log: () => undefined,
        progress: () => undefined,
        report: (finding: TestFinding) => findings.push(finding),
    } as TestRunContext;
    return { verdict: await createRouteCoverageTest(testHost).run(ctx), findings };
}

describe("narraleaf-studio:route-coverage", () => {
    it("runs on a project whose recollection screen replays from the Gallery", async () => {
        // The starter template's shape, with nothing in the Gallery yet: the screen begins nowhere,
        // so it is no reason to decline.
        const { verdict, findings } = await run(host(recollection(), []));

        expect(verdict.status).toBe("passed");
        expect(findings).toEqual([]);
    });

    it("declines, naming the node, when the scene is put together while the game runs", async () => {
        const { verdict, findings } = await run(host(
            recollection(["join", "result"], [{ id: "join", type: "blueprint.string.concat", params: { a: "chapter-", b: "3" } }]),
            [],
        ));

        expect(verdict).toEqual({
            status: "skipped",
            summary: { key: "test.builtin.routeCoverage.skipped.undecidableEntry", params: { blueprint: "Recollection" } },
        });
        expect(findings).toEqual([expect.objectContaining({
            severity: "info",
            message: { key: "test.entryPoint.assembled", params: { blueprint: "Recollection", target: "scene", origin: "Concat" } },
            target: expect.objectContaining({ kind: "blueprint", blueprintId: "bp-list", focusNodeId: "join" }),
        })]);
    });
});
