import { describe, expect, it, vi } from "vitest";
import type { Blueprint, BlueprintDocument } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { BLUEPRINT_NODE_TYPE_GAME_START_STORY } from "@shared/types/blueprint/graph";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import type { StoryBlock, StoryDocument, StoryScene } from "@shared/types/story";
import type { ServiceRegistry } from "@/lib/workspace/services/serviceRegistry";
import { Services } from "@/lib/workspace/services/services";
import { TEST_PROTOCOL_VERSION, type TestFinding, type TestProgress, type TestRunContext } from "../types";
import type { BuiltInTestHost } from "./index";
import { createReachableEndingsTest } from "./reachableEndings";

// The definition reaches the workspace through its host, so the import graph touches the service
// registry. Nothing here starts a workspace, so an empty bridge is enough.
vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({}),
    getPrivilegedInterface: () => ({}),
}));

// ---------------------------------------------------------------------------
// Story fixtures
// ---------------------------------------------------------------------------

function jumpBlock(id: string, targetSceneId: string, parentId: string | null = null): StoryBlock {
    return { id, kind: "jump", parentId, childrenIds: [], payload: { targetSceneId } };
}

function endingBlock(id: string, name: string, parentId: string | null = null): StoryBlock {
    return { id, kind: "control", parentId, childrenIds: [], payload: { control: "ending", name } } as StoryBlock;
}

function emptyBlock(id: string, parentId: string | null = null): StoryBlock {
    return { id, kind: "empty", parentId, childrenIds: [], payload: {} } as StoryBlock;
}

function choiceBlock(id: string, childrenIds: string[], parentId: string | null = null): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        parentId,
        childrenIds,
        payload: { action: "choice", prompt: { textId: `${id}-prompt`, value: "", role: "choicePrompt" } },
    } as StoryBlock;
}

function choiceOptionBlock(id: string, childrenIds: string[], text: string, parentId: string): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        parentId,
        childrenIds,
        payload: { action: "choiceOption", text: { textId: `${id}-text`, value: text, role: "choiceText" } },
    } as StoryBlock;
}

function scene(id: string, name: string, blocks: StoryBlock[]): StoryScene {
    return {
        id,
        name,
        runtimeName: id,
        rootBlockIds: blocks.filter(block => !block.parentId).map(block => block.id),
        blocks: Object.fromEntries(blocks.map(block => [block.id, block])),
    };
}

function document(scenes: StoryScene[], entrySceneId?: string, id = "story-1"): StoryDocument {
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id,
        name: "Story",
        entrySceneId,
        chapters: [{ id: "chapter-1", name: "Chapter", sceneIds: scenes.map(item => item.id) }],
        scenes: Object.fromEntries(scenes.map(item => [item.id, item])),
    } as StoryDocument;
}

/** A fork whose first option leaves and whose second only continues. */
function forkScene(exitTargetSceneId: string, trailing: StoryBlock[] = []): StoryScene {
    return scene("a", "Fork", [
        choiceBlock("c1", ["o0", "o1"]),
        choiceOptionBlock("o0", ["j0"], "Leave", "c1"),
        jumpBlock("j0", exitTargetSceneId, "o0"),
        choiceOptionBlock("o1", [], "Stay", "c1"),
        ...trailing,
    ]);
}

function startStoryDocument(params: Record<string, unknown>): BlueprintDocument {
    const blueprint = {
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
                            edges: [],
                        },
                    },
                },
                functions: {},
            },
        },
    } as Blueprint;
    return {
        schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
        blueprints: { [blueprint.id]: blueprint },
        ownerRecords: {},
    } as BlueprintDocument;
}

// ---------------------------------------------------------------------------
// Workspace stand-ins
// ---------------------------------------------------------------------------

type FixtureStory = { id: string; name: string; document: StoryDocument };

/**
 * A service registry with only the two services this test reads.
 *
 * Deliberately throws for anything else: a built-in that quietly grew a third dependency should
 * fail here rather than in a workspace, where the extra reach is what nobody notices.
 */
function fixtureHost(options: {
    stories: FixtureStory[];
    blueprintDocument?: BlueprintDocument | null;
    unreadableStoryId?: string;
}): BuiltInTestHost {
    const services = {
        get: (id: string) => {
            if (id === Services.Story) {
                return {
                    getLibraryIndex: () => ({
                        stories: options.stories.map(story => ({ id: story.id, name: story.name })),
                    }),
                    loadStory: async (storyId: string) => {
                        if (storyId === options.unreadableStoryId) {
                            throw new Error("document is corrupt");
                        }
                        const story = options.stories.find(item => item.id === storyId);
                        if (!story) {
                            throw new Error(`no story ${storyId}`);
                        }
                        return story.document;
                    },
                };
            }
            if (id === Services.UIGraph) {
                return { getDocument: () => ({ blueprintDocument: options.blueprintDocument ?? null }) };
            }
            throw new Error(`unexpected service ${id}`);
        },
    };
    return { services: () => services as unknown as ServiceRegistry };
}

function runContext(signal?: AbortSignal): {
    ctx: TestRunContext;
    findings: TestFinding[];
    progress: TestProgress[];
} {
    const findings: TestFinding[] = [];
    const progress: TestProgress[] = [];
    const ctx = {
        runId: "run-1",
        protocolVersion: TEST_PROTOCOL_VERSION,
        // This test declares no parameters, so the host resolves it an empty set - which is what a
        // context is required to carry rather than leave absent.
        parameters: {},
        signal: signal ?? new AbortController().signal,
        log: () => undefined,
        progress: (value: TestProgress | null) => {
            if (value) {
                progress.push(value);
            }
        },
        report: (finding: TestFinding) => findings.push(finding),
    } as TestRunContext;
    return { ctx, findings, progress };
}

async function run(host: BuiltInTestHost, signal?: AbortSignal) {
    const { ctx, findings, progress } = runContext(signal);
    const verdict = await createReachableEndingsTest(host).run(ctx);
    return { verdict, findings, progress };
}

const oneStory = (doc: StoryDocument): FixtureStory[] => [{ id: "story-1", name: "Story", document: doc }];

// ---------------------------------------------------------------------------

describe("narraleaf-studio:reachable-endings", () => {
    it("declares itself as a headless integrity check that reaches for nothing", () => {
        const definition = createReachableEndingsTest(fixtureHost({ stories: [] }));

        expect(definition.id).toBe("narraleaf-studio:reachable-endings");
        expect(definition.category).toBe("integrity");
        expect(definition.presentation).toBe("headless");
        expect(definition.requires).toEqual([]);
    });

    it("passes when every path reaches an ending", async () => {
        const { verdict, findings } = await run(fixtureHost({
            stories: oneStory(document([
                scene("a", "Fork", [
                    choiceBlock("c1", ["o0", "o1"]),
                    choiceOptionBlock("o0", ["j0"], "Left", "c1"),
                    jumpBlock("j0", "b", "o0"),
                    choiceOptionBlock("o1", ["j1"], "Right", "c1"),
                    jumpBlock("j1", "c", "o1"),
                ]),
                scene("b", "Left", [endingBlock("end-left", "Left End")]),
                scene("c", "Right", [endingBlock("end-right", "Right End")]),
            ], "a")),
        }));

        expect(verdict).toEqual({
            status: "passed",
            summary: {
                key: "test.builtin.reachableEndings.summary.passed",
                params: { errors: 0, unreached: 0, endings: 2 },
            },
        });
        expect(findings).toEqual([]);
    });

    it("fails and names the option when a fall-through arm runs out", async () => {
        const { verdict, findings } = await run(fixtureHost({
            stories: oneStory(document([
                forkScene("b"),
                scene("b", "Away", [endingBlock("end-away", "Away")]),
            ], "a")),
        }));

        expect(verdict.status).toBe("failed");
        expect(verdict.summary).toEqual({
            key: "test.builtin.reachableEndings.summary.failed",
            params: { errors: 1, unreached: 0, endings: 1 },
        });
        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("error");
        expect(findings[0].message).toEqual({
            key: "test.builtin.reachableEndings.finding.optionRunsOut",
            params: { option: "Stay" },
        });
        // Anchored on the option's own row, so the report tab's click-to-jump lands on the row the
        // author has to write something after.
        expect(findings[0].target).toEqual({
            kind: "storyBlock",
            storyId: "story-1",
            sceneId: "a",
            blockId: "o1",
            storyName: "Story",
            sceneName: "Fork",
        });
    });

    it("anchors on the scene's last row when the scene itself has no way out", async () => {
        const { verdict, findings } = await run(fixtureHost({
            stories: oneStory(document([
                scene("a", "Fork", [
                    choiceBlock("c1", ["o0", "o1"]),
                    choiceOptionBlock("o0", ["j0"], "Left", "c1"),
                    jumpBlock("j0", "b", "o0"),
                    choiceOptionBlock("o1", ["j1"], "Right", "c1"),
                    jumpBlock("j1", "c", "o1"),
                ]),
                scene("b", "Left", [endingBlock("end-left", "Left End")]),
                scene("c", "Forgot", [emptyBlock("blank-1"), emptyBlock("blank-2")]),
            ], "a")),
        }));

        expect(verdict.status).toBe("failed");
        expect(findings).toHaveLength(1);
        expect(findings[0].message).toEqual({ key: "test.builtin.reachableEndings.finding.pathRunsOut" });
        expect(findings[0].target).toMatchObject({ kind: "storyBlock", sceneId: "c", blockId: "blank-2" });
    });

    it("passes but says so when nothing reaches a declared ending", async () => {
        const { verdict, findings } = await run(fixtureHost({
            stories: oneStory(document([
                scene("a", "One", [jumpBlock("j1", "b")]),
                scene("b", "Epilogue", [endingBlock("end-true", "True End")]),
                scene("z", "Cut content", [endingBlock("end-cut", "Cut End")]),
            ], "a")),
        }));

        expect(verdict).toEqual({
            status: "passed",
            summary: {
                key: "test.builtin.reachableEndings.summary.passed",
                params: { errors: 0, unreached: 1, endings: 2 },
            },
        });
        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("info");
        expect(findings[0].message).toEqual({
            key: "test.builtin.reachableEndings.finding.endingUnreached",
            params: { name: "Cut End" },
        });
        // The ending's own row: its block id IS the ending.
        expect(findings[0].target).toMatchObject({ kind: "storyBlock", sceneId: "z", blockId: "end-cut" });
    });

    it("names an unnamed ending nothing reaches without printing an empty word", async () => {
        const { findings } = await run(fixtureHost({
            stories: oneStory(document([
                scene("a", "One", [jumpBlock("j1", "b")]),
                scene("b", "Epilogue", [endingBlock("end-true", "True End")]),
                scene("z", "Cut content", [endingBlock("end-blank", "")]),
            ], "a")),
        }));

        expect(findings).toEqual([expect.objectContaining({
            severity: "info",
            message: { key: "test.builtin.reachableEndings.finding.endingUnreachedUnnamed" },
        })]);
    });

    it("skips a story that marks no endings rather than reporting every path in it", async () => {
        const { verdict, findings } = await run(fixtureHost({
            stories: oneStory(document([
                forkScene("b"),
                scene("b", "Away", []),
            ], "a")),
        }));

        expect(verdict).toEqual({
            status: "skipped",
            summary: { key: "test.builtin.reachableEndings.skipped.noEndings" },
        });
        expect(findings).toEqual([]);
    });

    it("still checks the story that marks endings when another one does not", async () => {
        // Per story, the same bargain `story/dead-end` strikes: adopting endings turns the check on
        // for the story that adopted them, and leaves the rest alone.
        const { verdict, findings } = await run(fixtureHost({
            stories: [
                { id: "story-1", name: "Draft", document: document([forkScene("b"), scene("b", "Away", [])], "a") },
                {
                    id: "story-2",
                    name: "Finished",
                    document: document([
                        forkScene("b"),
                        scene("b", "Away", [endingBlock("end-away", "Away")]),
                    ], "a", "story-2"),
                },
            ],
        }));

        expect(verdict.status).toBe("failed");
        expect(findings).toHaveLength(1);
        expect(findings[0].target).toMatchObject({ storyId: "story-2", blockId: "o1" });
    });

    it("skips when no story marks where play begins", async () => {
        const { verdict } = await run(fixtureHost({
            stories: oneStory(document([
                scene("a", "One", [jumpBlock("j1", "b")]),
                scene("b", "Epilogue", [endingBlock("end-true", "True End")]),
            ])),
        }));

        expect(verdict).toEqual({
            status: "skipped",
            summary: { key: "test.builtin.reachableEndings.skipped.noEntryPoint" },
        });
    });

    it("skips when a Start Story node decides its scene while the game runs", async () => {
        // The guard `story/unreachable-scene` takes, and mandatory for the same reason: entries that
        // cannot be read make every path look like it runs out.
        const { verdict, findings } = await run(fixtureHost({
            stories: oneStory(document([
                forkScene("b"),
                scene("b", "Away", [endingBlock("end-away", "Away")]),
            ], "a")),
            blueprintDocument: startStoryDocument({ storyId: "story-1", sceneId: "" }),
        }));

        expect(verdict).toEqual({
            status: "skipped",
            summary: { key: "test.builtin.reachableEndings.skipped.undecidableEntry" },
        });
        expect(findings).toEqual([]);
    });

    it("takes a Start Story node's scene as an entry point of its own", async () => {
        // The story marks no entry of its own, so nothing but the shared scan puts it in play.
        const { verdict } = await run(fixtureHost({
            stories: oneStory(document([
                scene("a", "One", [jumpBlock("j1", "b")]),
                scene("b", "Epilogue", [endingBlock("end-true", "True End")]),
            ])),
            blueprintDocument: startStoryDocument({ storyId: "story-1", sceneId: "a" }),
        }));

        expect(verdict.status).toBe("passed");
    });

    it("skips when a story cannot be read at all", async () => {
        const { verdict } = await run(fixtureHost({
            stories: oneStory(document([
                forkScene("b"),
                scene("b", "Away", [endingBlock("end-away", "Away")]),
            ], "a")),
            unreadableStoryId: "story-1",
        }));

        expect(verdict).toEqual({
            status: "skipped",
            summary: { key: "test.builtin.reachableEndings.skipped.storiesUnread" },
        });
    });

    it("reports a real fraction of the stories it walks", async () => {
        const { progress } = await run(fixtureHost({
            stories: oneStory(document([
                scene("a", "One", [jumpBlock("j1", "b")]),
                scene("b", "Epilogue", [endingBlock("end-true", "True End")]),
            ], "a")),
        }));

        expect(progress).toEqual([
            { completed: 0, total: 1, label: { text: "Story" } },
            { completed: 1, total: 1 },
        ]);
    });

    it("refuses to answer a cancelled run, and keeps what it had already found", async () => {
        const controller = new AbortController();
        const { ctx, findings } = runContext(controller.signal);
        // Cancelled the moment the first finding lands, which is mid-walk: without the abort check
        // the run would come back "passed" from a sweep that never finished.
        const cancelling = {
            ...ctx,
            report: (finding: TestFinding) => {
                findings.push(finding);
                controller.abort();
            },
        } as TestRunContext;
        const definition = createReachableEndingsTest(fixtureHost({
            stories: [
                {
                    id: "story-1",
                    name: "First",
                    document: document([forkScene("b"), scene("b", "Away", [endingBlock("end-1", "Away")])], "a"),
                },
                {
                    id: "story-2",
                    name: "Second",
                    document: document([forkScene("b"), scene("b", "Away", [endingBlock("end-2", "Away")])], "a", "story-2"),
                },
            ],
        }));

        await expect(definition.run(cancelling)).rejects.toThrow();
        expect(findings).toHaveLength(1);
        expect(findings[0].target).toMatchObject({ storyId: "story-1" });
    });
});
