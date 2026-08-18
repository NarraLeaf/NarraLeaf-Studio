import { describe, expect, it } from "vitest";
import {
  APP_TAG_ID_RELEASE,
  appTagMechanismKey,
  RELEASE_APP_TAG,
  type ProjectAppTag
} from "@shared/types/appTag";
import type { Blueprint } from "@shared/types/blueprint/document";
import { BLUEPRINT_NODE_TYPE_GAME_START_STORY } from "@shared/types/blueprint/graph";
import {
  STORY_DOCUMENT_SCHEMA_VERSION,
  type StoryBlock,
  type StoryDocument,
  type StoryScene
} from "@shared/types/story";
import type { AssetReference } from "../workspace/services/references/referenceModel";
import {
  solveReleaseContent,
  type ReleaseContentInput,
  type ReleaseContentStory
} from "./releaseContent";

/**
 * What a package under one variant comes to.
 *
 * The story fixture is the acceptance project, block for block: Prologue leads to Fork, Fork
 * branches to Path North and Path South, Path North leads to Recollection, Recollection leads back
 * to Path South, Path South is cut for the demo before its jump to Chapter Two, Chapter Two leads to
 * Recollection and Ending, and Orphan is named by nothing.
 *
 * Recollection is the case worth having a fixture for: it is entered from *before* the cut and named
 * again from *after* it, so an answer that justified it by the later route would be citing an edge
 * the demo does not carry.
 */

// --- fixtures ---------------------------------------------------------------

function block(
  partial: Partial<StoryBlock> & Pick<StoryBlock, "id" | "kind" | "payload">
): StoryBlock {
  return { parentId: null, childrenIds: [], ...partial } as StoryBlock;
}

const line = (id: string, value = "line"): StoryBlock =>
  block({
    id,
    kind: "nodeAction",
    payload: { action: "narration", text: { textId: `t-${id}`, value, role: "narration" } }
  });

const jump = (id: string, targetSceneId: string): StoryBlock =>
  block({ id, kind: "jump", payload: { targetSceneId } });

const cut = (id: string, appTagId: string): StoryBlock =>
  block({ id, kind: "control", payload: { control: "cut", appTagId } });

function scene(id: string, name: string, blocks: StoryBlock[]): StoryScene {
  return {
    id,
    name,
    runtimeName: id,
    rootBlockIds: blocks.map((entry) => entry.id),
    blocks: Object.fromEntries(blocks.map((entry) => [entry.id, entry]))
  };
}

const DEMO: ProjectAppTag = { id: "tag-demo", name: "Demo", overrides: {} };

/** The acceptance project's one story. */
function skeleton(): ReleaseContentStory {
  const scenes = [
    scene("prologue", "Prologue", [line("p1"), jump("p-jump", "fork")]),
    scene("fork", "Fork", [line("f1"), jump("f-north", "north"), jump("f-south", "south")]),
    scene("north", "Path North", [line("n1"), jump("n-jump", "recollection")]),
    scene("south", "Path South", [
      line("s1"),
      cut("s-cut", "tag-demo"),
      line("s2", "the secret ending"),
      jump("s-jump", "chapter-two")
    ]),
    scene("recollection", "Recollection", [line("r1"), jump("r-jump", "south")]),
    scene("chapter-two", "Chapter Two", [
      line("c1"),
      jump("c-jump", "recollection"),
      jump("c-end", "ending")
    ]),
    scene("ending", "Ending", [line("e1")]),
    scene("orphan", "Orphan", [line("o1")])
  ];
  const document: StoryDocument = {
    schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
    id: "story-1",
    name: "Skeleton",
    entrySceneId: "prologue",
    chapters: [{ id: "ch-1", name: "Chapter 1", sceneIds: scenes.map((entry) => entry.id) }],
    scenes: Object.fromEntries(scenes.map((entry) => [entry.id, entry]))
  };
  return { id: "story-1", name: "Skeleton", document };
}

function graphBlueprint(nodes: Record<string, unknown>, edges: unknown[] = []): Blueprint {
  return {
    id: "bp-1",
    name: "Title screen",
    owner: { kind: "globalMain" },
    frontend: "visual",
    programKind: "graph",
    program: {
      kind: "graph",
      graphs: { events: { "ev-1": { id: "ev-1", graph: { nodes, edges } } }, functions: {} }
    }
  } as unknown as Blueprint;
}

const startStory = (params: Record<string, string>) => ({
  "n-1": { id: "n-1", type: BLUEPRINT_NODE_TYPE_GAME_START_STORY, params }
});

const WIRED_SCENE_PIN = [
  { from: { nodeId: "n-src", port: "value" }, to: { nodeId: "n-1", port: "sceneId" } }
];

const START_STORY_MECHANISM = appTagMechanismKey({
  kind: "startStoryNode",
  blueprintId: "bp-1",
  graphKind: "event",
  graphId: "ev-1",
  nodeId: "n-1"
});

function input(extra?: Partial<ReleaseContentInput>): ReleaseContentInput {
  return {
    appTag: DEMO,
    projectDeclaredScenes: {},
    stories: [skeleton()],
    blueprints: [],
    surfaces: [],
    assets: [],
    assetReferences: new Map(),
    localizationKeys: [],
    plugins: [],
    ...extra
  };
}

const sceneNames = (answer: ReturnType<typeof solveReleaseContent>): string[] =>
  answer.members.filter((member) => member.kind === "scene").map((member) => member.name);

// --- the scene answer -------------------------------------------------------

describe("release content scenes", () => {
  it("keeps what the demo can still reach and drops the rest", () => {
    const answer = solveReleaseContent(input());

    expect(sceneNames(answer)).toEqual([
      "Prologue",
      "Fork",
      "Path North",
      "Path South",
      "Recollection"
    ]);
    expect(answer.removedScenes.map((removed) => removed.sceneName)).toEqual([
      "Chapter Two",
      "Ending",
      "Orphan"
    ]);
  });

  it("keeps the whole story for the release variant", () => {
    // The cut point names a variant this build is not, so nothing truncates and every scene is
    // still reachable.
    const answer = solveReleaseContent(input({ appTag: RELEASE_APP_TAG }));

    expect(answer.removedScenes).toEqual([]);
    expect(sceneNames(answer)).toHaveLength(8);
  });

  it("justifies a kept scene by a route the package still carries", () => {
    // Recollection is named from Chapter Two as well, and Chapter Two is gone. Citing that edge
    // would explain a kept scene by one the demo does not have.
    const answer = solveReleaseContent(input());
    const recollection = answer.members.find((member) => member.name === "Recollection");

    expect(recollection?.provenance).toEqual({
      kind: "storyJump",
      storyId: "story-1",
      sceneId: "north",
      blockId: "n-jump"
    });
  });

  it("says which scene is the story's marked entry", () => {
    const answer = solveReleaseContent(input());

    expect(answer.members.find((member) => member.name === "Prologue")?.provenance).toEqual({
      kind: "storyEntryScene"
    });
  });

  it("names the node behind a scene a blueprint starts", () => {
    const answer = solveReleaseContent(
      input({
        blueprints: [graphBlueprint(startStory({ storyId: "story-1", sceneId: "orphan" }))]
      })
    );

    expect(answer.members.find((member) => member.name === "Orphan")?.provenance).toEqual({
      kind: "startStoryNode",
      blueprintId: "bp-1",
      blueprintName: "Title screen",
      graphId: "ev-1",
      nodeId: "n-1"
    });
    expect(answer.removedScenes.map((removed) => removed.sceneName)).toEqual([
      "Chapter Two",
      "Ending"
    ]);
  });

  it("carries no story line numbers", () => {
    // Rows are located at the reporting surface through `createStoryRowLocator`, never counted
    // here. Two row counts is how two surfaces come to name different rows.
    const answer = solveReleaseContent(input());

    expect(JSON.stringify(answer)).not.toContain('"line"');
  });
});

// --- the other four ---------------------------------------------------------

describe("release content beyond scenes", () => {
  it("says a surface, a key and a plugin are in because every package has them", () => {
    const answer = solveReleaseContent(
      input({
        surfaces: [{ id: "sf-1", name: "Title" }],
        localizationKeys: ["menu.start"],
        plugins: [
          { id: "narraleaf.gallery", name: "Gallery", runtimeCapabilities: ["store", "events"] }
        ]
      })
    );

    for (const kind of ["surface", "localizationKey", "plugin"] as const) {
      expect(answer.members.find((member) => member.kind === kind)?.provenance).toEqual({
        kind: "shipsWithEveryVariant"
      });
    }
  });

  it("names the retained row that references an asset", () => {
    const answer = solveReleaseContent(
      input({
        assets: [{ id: "asset-1", name: "outside.jpg" }],
        assetReferences: new Map([["asset-1", [storyReference("asset-1", "prologue", "p1")]]])
      })
    );

    expect(answer.members.find((member) => member.kind === "asset")?.provenance).toEqual({
      kind: "storyRow",
      storyId: "story-1",
      sceneId: "prologue",
      blockId: "p1"
    });
    expect(answer.unreferencedAssetIds).toEqual([]);
  });

  it("reports an asset only dropped content referenced, without claiming it was dropped", () => {
    const answer = solveReleaseContent(
      input({
        assets: [{ id: "asset-2", name: "ending.jpg" }],
        assetReferences: new Map([["asset-2", [storyReference("asset-2", "ending", "e1")]]])
      })
    );

    expect(answer.unreferencedAssetIds).toEqual(["asset-2"]);
    expect(answer.members.some((member) => member.kind === "asset")).toBe(false);
  });

  it("keeps an asset a surface references, because nothing trims surfaces", () => {
    const reference: AssetReference = {
      id: "ui:el-1:backgroundImage",
      assetId: "asset-3",
      kind: "uiElement",
      label: "Title",
      field: "backgroundImage"
    };
    const answer = solveReleaseContent(
      input({
        assets: [{ id: "asset-3", name: "menu.jpg" }],
        assetReferences: new Map([["asset-3", [reference]]])
      })
    );

    expect(answer.members.find((member) => member.kind === "asset")?.provenance).toEqual({
      kind: "referenceSite",
      siteKind: "uiElement",
      label: "Title",
      field: "backgroundImage"
    });
  });
});

function storyReference(assetId: string, sceneId: string, blockId: string): AssetReference {
  return {
    id: `story:story-1:${sceneId}:${blockId}:background.assetId`,
    assetId,
    kind: "story",
    label: sceneId,
    field: "background.assetId",
    target: {
      kind: "storyBlock",
      storyId: "story-1",
      sceneId,
      blockId,
      storyName: "Skeleton",
      sceneName: sceneId
    }
  };
}

// --- refusals ---------------------------------------------------------------

describe("release content blockers", () => {
  it("stops a build whose Start Story node picks its scene while the game runs", () => {
    const answer = solveReleaseContent(
      input({
        blueprints: [
          graphBlueprint(startStory({ storyId: "story-1", sceneId: "prologue" }), WIRED_SCENE_PIN)
        ]
      })
    );

    expect(answer.blockers).toEqual([
      {
        reason: "unreadableStartStoryTarget",
        mechanism: {
          kind: "startStoryNode",
          blueprintId: "bp-1",
          graphKind: "event",
          graphId: "ev-1",
          nodeId: "n-1"
        },
        mechanismKey: START_STORY_MECHANISM,
        location: "Title screen",
        missing: ["sceneId"]
      }
    ]);
  });

  it("stops a build carrying a TypeScript blueprint", () => {
    const script = {
      id: "bp-2",
      name: "Launcher",
      owner: { kind: "globalMain" },
      frontend: "typescript",
      programKind: "scriptModule",
      program: { kind: "scriptModule", source: { language: "typescript", code: "" } }
    } as unknown as Blueprint;
    const answer = solveReleaseContent(input({ blueprints: [script] }));

    expect(answer.blockers.map((blocker) => [blocker.reason, blocker.location])).toEqual([
      ["scriptBlueprint", "Launcher"]
    ]);
  });

  it("lets the built-in plugins through, because none of them can start a story", () => {
    // The test this replaced was "does the package carry any plugin", and the built-in Gallery
    // ships in every package - so no project could ever drop a scene.
    const answer = solveReleaseContent(
      input({
        plugins: [
          { id: "narraleaf.gallery", name: "Gallery", runtimeCapabilities: ["store", "events"] },
          {
            id: "narraleaf.quick-save",
            name: "Quick Save",
            runtimeCapabilities: ["saves.read", "saves.write"]
          }
        ]
      })
    );

    expect(answer.blockers).toEqual([]);
    expect(answer.removedScenes).toHaveLength(3);
  });

  it("says nothing when the variant removes nothing, however unreadable the project is", () => {
    // A release build cuts nothing, so there is no answer a wired node could make wrong. A build
    // that has always worked must not start refusing.
    const answer = solveReleaseContent(
      input({
        appTag: { ...RELEASE_APP_TAG, id: APP_TAG_ID_RELEASE },
        blueprints: [graphBlueprint(startStory({ storyId: "story-1" }), WIRED_SCENE_PIN)]
      })
    );

    expect(answer.removedScenes).toEqual([]);
    expect(answer.blockers).toEqual([]);
  });

  it("takes the author's declaration instead of stopping, and keeps what it names", () => {
    const answer = solveReleaseContent(
      input({
        blueprints: [
          graphBlueprint(startStory({ storyId: "story-1", sceneId: "prologue" }), WIRED_SCENE_PIN)
        ],
        projectDeclaredScenes: {
          [START_STORY_MECHANISM]: [{ storyId: "story-1", sceneId: "ending" }]
        }
      })
    );

    expect(answer.blockers).toEqual([]);
    expect(sceneNames(answer)).toContain("Ending");
    expect(answer.members.find((member) => member.name === "Ending")?.provenance).toEqual({
      kind: "declaredScene",
      mechanism: {
        kind: "startStoryNode",
        blueprintId: "bp-1",
        graphKind: "event",
        graphId: "ev-1",
        nodeId: "n-1"
      }
    });
  });

  it("lets a variant declare a smaller set than the project", () => {
    // The demo's chapter select offers one chapter where the main build offers ten.
    const answer = solveReleaseContent(
      input({
        appTag: { ...DEMO, reachableScenes: { [START_STORY_MECHANISM]: [] } },
        blueprints: [
          graphBlueprint(startStory({ storyId: "story-1", sceneId: "prologue" }), WIRED_SCENE_PIN)
        ],
        projectDeclaredScenes: {
          [START_STORY_MECHANISM]: [{ storyId: "story-1", sceneId: "ending" }]
        }
      })
    );

    // Declared to start nothing here, which answers the question without keeping a scene.
    expect(answer.blockers).toEqual([]);
    expect(sceneNames(answer)).not.toContain("Ending");
  });

  it("reports a declaration naming a scene the project no longer has", () => {
    const answer = solveReleaseContent(
      input({
        blueprints: [
          graphBlueprint(startStory({ storyId: "story-1", sceneId: "prologue" }), WIRED_SCENE_PIN)
        ],
        projectDeclaredScenes: {
          [START_STORY_MECHANISM]: [{ storyId: "story-1", sceneId: "deleted" }]
        }
      })
    );

    expect(answer.staleDeclarations).toEqual([
      {
        mechanismKey: START_STORY_MECHANISM,
        // Named, because the scene it points at has no name left to print.
        location: "Title screen",
        storyId: "story-1",
        sceneId: "deleted"
      }
    ]);
    // Still not a blocker: the author answered, and a stale entry is a finding about the answer.
    expect(answer.blockers).toEqual([]);
  });
});
