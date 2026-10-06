/**
 * A story blueprint reads and writes the saved variables the story itself does.
 *
 * It did not: the blueprint was handed the saved namespace by the name the compiler created it
 * under, and the engine registers every `Persistent` under a prefixed one. So `Get Saved Var` in a
 * branch condition threw `Namespace ... is not initialized`, the condition swallowed it and tested
 * false, and an ending gated on an affection counter could never be reached - with nothing in the
 * problems list. The fakes elsewhere create any namespace they are asked for, which is why no test
 * saw it; the store here refuses a name the engine never registered, as the engine's does.
 *
 * Comments in English per project convention.
 */

import { describe, expect, it } from "vitest";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_CALL,
    BLUEPRINT_NODE_TYPE_SAVED_GET,
} from "@shared/types/blueprint/graph";
import type { StoryDocument } from "@shared/types/story";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import type { VariableRegistryEntry } from "@shared/types/variables/registry";
import { storyActionOwnerKey } from "@/lib/workspace/services/ui-editor/blueprint/ownerKeys";
import { compileStudioStoryToNlr } from "./storyCompiler";

const AFFECTION = "var-affection";
const CONDITION_BP = "bp-condition";

const affection: VariableRegistryEntry = {
    id: AFFECTION,
    name: "affection",
    scope: "saved",
    valueType: "number",
    defaultValue: 0,
    storageKey: AFFECTION,
};

/** `On Call -> Get Saved Var affection -> Return Value`, the value read being the answer. */
function conditionBlueprint(): BlueprintDocument {
    return {
        blueprints: {
            [CONDITION_BP]: {
                id: CONDITION_BP,
                name: "Story Condition",
                owner: { kind: "storyAction", blueprintId: CONDITION_BP, mode: "condition" },
                graphs: {
                    eventIds: ["onCall"],
                    events: {
                        onCall: {
                            id: "onCall",
                            graph: {
                                nodes: {
                                    call: { id: "call", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_CALL, params: {} },
                                    read: { id: "read", type: BLUEPRINT_NODE_TYPE_SAVED_GET, params: { savedVariableId: AFFECTION } },
                                    give: { id: "give", type: BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE, params: {} },
                                },
                                edges: [
                                    { from: { nodeId: "call", port: "then" }, to: { nodeId: "read", port: "in" } },
                                    { from: { nodeId: "read", port: "next" }, to: { nodeId: "give", port: "in" } },
                                    { from: { nodeId: "read", port: "value" }, to: { nodeId: "give", port: "value" } },
                                ],
                            },
                        },
                    },
                    functions: {},
                },
                members: { variables: {}, fields: {}, functions: {} },
                bindings: {},
            },
        },
        ownerRecords: { [storyActionOwnerKey(CONDITION_BP)]: { blueprintId: CONDITION_BP } },
    } as unknown as BlueprintDocument;
}

/** One `/if` whose branch is the graph condition above. */
function storyDocument(): StoryDocument {
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "story-1",
        name: "Story",
        chapters: [{ id: "chapter-1", name: "Chapter", sceneIds: ["scene-1"] }],
        scenes: {
            "scene-1": {
                id: "scene-1",
                name: "Scene 1",
                runtimeName: "Scene 1",
                rootBlockIds: ["cond"],
                blocks: {
                    cond: { id: "cond", kind: "control", parentId: null, childrenIds: ["if"], payload: { control: "condition" } },
                    if: {
                        id: "if",
                        kind: "control",
                        parentId: "cond",
                        childrenIds: [],
                        payload: { control: "conditionBranch", branch: "if", condition: { kind: "blueprint", blueprintId: CONDITION_BP } },
                    },
                },
            },
        },
    } as unknown as StoryDocument;
}

type AnyAction = {
    type?: string;
    contentNode?: { getContent: () => any };
    getFutureActions?: (story: unknown, options: { allowFutureScene: boolean }) => AnyAction[];
};

function walkActions(root: AnyAction, story: unknown, seen = new Set<AnyAction>()): AnyAction[] {
    if (!root || seen.has(root)) {
        return [];
    }
    seen.add(root);
    const children = typeof root.getFutureActions === "function"
        ? root.getFutureActions(story, { allowFutureScene: true })
        : [];
    return [root, ...children.flatMap(child => walkActions(child, story, seen))];
}

/** A save store that, like the engine's, knows only the namespaces registered with it. */
function strictStorable(registered: Record<string, Record<string, unknown>>) {
    return {
        hasNamespace: (name: string) => name in registered,
        getNamespace: (name: string) => {
            const content = registered[name];
            if (!content) {
                throw new Error(`Namespace ${name} is not initialized`);
            }
            return {
                get: (key: string) => content[key],
                set: (key: string, value: unknown) => { content[key] = value; },
                has: (key: string) => key in content,
            };
        },
    };
}

describe("a story blueprint and the saved variables", () => {
    it("reads a saved variable in a branch condition from the namespace the engine registered", async () => {
        const compiled = await compileStudioStoryToNlr({
            document: storyDocument(),
            sceneId: "scene-1",
            characters: [],
            resolveAssetUrl: async (assetId: string) => `nlr://${assetId}`,
            blueprintDocument: conditionBlueprint(),
            savedVariables: { [AFFECTION]: affection },
        });
        const built = (compiled.story as any).constructStory();
        const root = (compiled.scenes["scene-1"] as any).getSceneRoot();
        const condition = walkActions(root, built).find(action => action.type === "condition:action");
        expect(condition).toBeDefined();
        const data = condition!.contentNode!.getContent();
        const test = (data.conditions ?? data).If.condition;

        const evaluate = (value: number): unknown => {
            const storable = strictStorable({ [compiled.savedNamespaceName]: { [AFFECTION]: value } });
            // What the engine hands a branch test: the running game, whose live game owns the store.
            const gameState = { game: { getLiveGame: () => ({ getStorable: () => storable }) } };
            return test.evaluate({ gameState }).value;
        };
        expect(compiled.savedNamespaceName).not.toBe("");
        expect(evaluate(35)).toBe(true);
        expect(evaluate(0)).toBe(false);
    });
});
