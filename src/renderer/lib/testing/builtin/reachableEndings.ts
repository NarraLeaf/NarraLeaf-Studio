import { scanProjectStoryEntryPoints } from "@shared/story/storyReachability";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type {
    StoryBlock,
    StoryBlockId,
    StoryDocument,
    StoryEnding,
    StoryScene,
    StorySceneId,
} from "@shared/types/story";
import { listStoryEndings } from "@shared/types/story";
import { buildSceneFlowGraph } from "@/apps/workspace/modules/story-flow/sceneFlowModel";
import { collectSceneFlowContinuations } from "@/apps/workspace/modules/story-flow/sceneFlowRoutes";
import type { SearchJumpTarget } from "@/lib/workspace/services/search/searchJumpTarget";
import { Services } from "@/lib/workspace/services/services";
// Type-only, the same call `projectDiagnostics` makes and for the same reason: a value import would
// pull a service - and everything it depends on - into the import graph of the registry the picker
// touches on open. The instances come off the service registry.
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
import type { UIGraphService } from "@/lib/workspace/services/ui-editor/UIGraphService";
import type { TestDefinition, TestVerdict } from "../types";
import type { BuiltInTestHost } from "./index";

/**
 * `narraleaf-studio:reachable-endings` - does every way through the story reach an ending.
 *
 * Starting from every entry point, this walks the scene graph and looks for somewhere a path
 * *stops*: a scene with no way out and no `/ending` row, or a choice option with nothing written
 * after it in a scene that has no unguarded exit left. Those are the two shapes a run can end in
 * without the story ever saying it ended, and a player meeting one is left looking at a frozen
 * screen.
 *
 * **A walk of terminals, not an enumeration of routes.** The route rail caps itself at
 * `MAX_ROUTES = 200` because listing every path through a branching story is combinatorial. This
 * question is not: a place where a path runs out is a property of one scene, so every scene is
 * visited once and there is no cap, no sampling, and nothing for the report to disclaim.
 *
 * **Where a path may go comes from `buildSceneFlowGraph` and `collectSceneFlowContinuations`**, the
 * same two functions the drawn flow map is built from. Which arm owns which jump, and which
 * fall-through arm has nowhere to fall through into, are decided in one place - so this test cannot
 * report a path the map does not draw, nor stay silent about one it does.
 *
 * Four things it deliberately does not answer:
 *
 *  - **A story that marks no endings is not analysed.** Per story, exactly as `story/dead-end`
 *    decides it: before `/ending` existed a story's final scene and a forgotten branch were the same
 *    shape, and reporting every one of them is how a check gets switched off. Adopting endings is
 *    what turns this on, and it turns on for the story that adopted them.
 *  - **A loop is not a path that runs out.** A cycle with no way to an ending never stops, so no
 *    terminal is reached and nothing is reported. Saying "this story never ends" is a different
 *    question with a different walk.
 *  - **An `if` with no `else` has no arm standing for "the condition was false"**, so a scene whose
 *    only exit is inside one is walked as though the exit always runs. That limit belongs to the
 *    graph and is stated on it; `story/dead-end` is the check that reads the scene's own rows in
 *    order and does report that shape.
 *  - **Which conditions can actually hold.** Every arm of every fork is treated as walkable, which
 *    is what makes this a check on the script rather than a solver.
 */

export const REACHABLE_ENDINGS_TEST_ID = "narraleaf-studio:reachable-endings";

/**
 * The i18n namespace this test's keys live under: `test.builtin.<slug>.*`.
 *
 * Written out literally and asserted against `deriveBuiltInTestSlug(id)` by the registry test, so
 * renaming the id cannot leave dead keys behind.
 */
export const REACHABLE_ENDINGS_SLUG = "reachableEndings";

/** One story, loaded, as both halves of this test read it. */
type ReachableEndingsStory = { id: string; name: string; document: StoryDocument };

/** Somewhere a path stops without reaching an ending. */
type StoryRunOut = {
    scene: StoryScene;
    /** The row play stops on, or absent when the scene has no live row to name. */
    blockId?: StoryBlockId;
    /** The fork arm's own text, when the run ran out inside one and the arm has any. */
    option?: string;
};

export function createReachableEndingsTest(host: BuiltInTestHost): TestDefinition {
    return {
        id: REACHABLE_ENDINGS_TEST_ID,
        title: { key: "test.builtin.reachableEndings.title" },
        description: { key: "test.builtin.reachableEndings.description" },
        category: "integrity",
        // A read-only sweep of documents already in memory: no window, and therefore runnable while
        // the workspace is frozen - which is exactly when a sweep like this is wanted.
        presentation: "headless",
        // Not `project.read`: a built-in closes over the workspace directly, and `TestProjectHandle`
        // exists to give a *plugin* a bounded way in. Declaring it would claim a door it never uses.
        requires: [],
        async run(ctx) {
            const services = host.services();
            const storyService = services.get<StoryService>(Services.Story);
            const uiGraphService = services.get<UIGraphService>(Services.UIGraph);

            const stories = await loadStories(storyService);
            if (!stories) {
                // A story that will not open takes its scenes, its jumps and its endings with it, so
                // every claim below would be about a project nobody has. The lint report already
                // says which document failed; this one declines rather than piling on.
                return skip("storiesUnread");
            }

            // The same reading the project report takes (`LintContext.blueprintDocument`): a graph
            // document that will not load means no blueprint names an entry. A second reading of it
            // here would let the report and this check disagree about where play begins.
            let blueprintDocument: BlueprintDocument | null = null;
            try {
                blueprintDocument = uiGraphService.getDocument().blueprintDocument;
            } catch (error) {
                console.warn("[reachable-endings] blueprint document unavailable", error);
            }

            const { byStory, undecidable } = scanProjectStoryEntryPoints(stories, blueprintDocument);
            if (undecidable.length > 0) {
                // The same guard `story/unreachable-scene` takes, and mandatory for the same reason:
                // a check that reports every path in the project because it could not find the entry
                // is one an author switches off in the first five minutes.
                return skip("undecidableEntry");
            }
            if (byStory.size === 0) {
                return skip("noEntryPoint");
            }

            const analysed: {
                story: ReachableEndingsStory;
                entrySceneIds: ReadonlySet<StorySceneId>;
                endings: StoryEnding[];
            }[] = [];
            for (const story of stories) {
                const entrySceneIds = byStory.get(story.id);
                if (!entrySceneIds || entrySceneIds.size === 0) {
                    // Nothing starts this story, so nothing about it can be walked - the same
                    // silence `story/unreachable-scene` keeps about a story with no entry.
                    continue;
                }
                const endings = listStoryEndings(story.document);
                if (endings.length === 0) {
                    // Per story, exactly as `story/dead-end` decides it: a story that has not
                    // adopted `/ending` has nothing for a path to reach, so every path in it would
                    // be reported and the check would be worth nothing.
                    continue;
                }
                analysed.push({ story, entrySceneIds, endings });
            }
            if (analysed.length === 0) {
                return skip("noEndings");
            }

            // Counted over the stories actually walked, not over the project: a summary that said
            // "0 of 7 endings never reached" while three of the seven are in a story nothing starts
            // would be describing a sweep that did not happen.
            let errors = 0;
            let unreached = 0;
            let endings = 0;
            for (const [index, entry] of analysed.entries()) {
                if (ctx.signal.aborted) {
                    break;
                }
                // A real fraction: the stories are known before the walk starts, and each one is one
                // step. The scenes inside a story are not a denominator - the walk discovers them.
                ctx.progress({ completed: index, total: analysed.length, label: { text: entry.story.name } });

                const walk = walkStory(entry.story, entry.entrySceneIds);
                endings += entry.endings.length;
                for (const runOut of walk.runOuts) {
                    errors += 1;
                    ctx.report({
                        severity: "error",
                        message: runOut.option
                            ? { key: "test.builtin.reachableEndings.finding.optionRunsOut", params: { option: runOut.option } }
                            : { key: "test.builtin.reachableEndings.finding.pathRunsOut" },
                        target: rowTarget(entry.story, runOut.scene, runOut.blockId),
                    });
                }
                // The mirror image, and worth saying separately: a path that runs out is content a
                // player falls off, an ending nothing reaches is content they can never see.
                for (const ending of entry.endings) {
                    if (walk.reachedEndingIds.has(ending.endingId)) {
                        continue;
                    }
                    unreached += 1;
                    ctx.report({
                        severity: "info",
                        message: ending.name
                            ? { key: "test.builtin.reachableEndings.finding.endingUnreached", params: { name: ending.name } }
                            : { key: "test.builtin.reachableEndings.finding.endingUnreachedUnnamed" },
                        target: endingTarget(entry.story, ending),
                    });
                }
            }
            ctx.progress({ completed: analysed.length, total: analysed.length });

            // Reported before this line, kept after it: a cancelled run is still evidence. Nothing
            // here throws on its own, so without this a run the author stopped halfway would come
            // back "passed" - a clean bill from a sweep that never finished.
            ctx.signal.throwIfAborted();

            const params = { errors, unreached, endings };
            return errors > 0
                ? { status: "failed", summary: { key: "test.builtin.reachableEndings.summary.failed", params } }
                : { status: "passed", summary: { key: "test.builtin.reachableEndings.summary.passed", params } };
        },
    };
}

/** Declining is a verdict, not an error: see the header for what each reason means. */
function skip(reason: "storiesUnread" | "undecidableEntry" | "noEntryPoint" | "noEndings"): TestVerdict {
    return { status: "skipped", summary: { key: `test.builtin.reachableEndings.skipped.${reason}` } };
}

/**
 * Every story in the library, loaded, or null when even one of them could not be read.
 *
 * All or nothing, unlike the lint sweep's partial answer: a rule reports per row and can stay silent
 * about a document it does not have, while this test's verdict is one sentence about the whole
 * project. "Every path reaches an ending" said over a story nobody could open is the wrong answer.
 */
async function loadStories(storyService: StoryService): Promise<ReachableEndingsStory[] | null> {
    try {
        const index = storyService.getLibraryIndex();
        const stories: ReachableEndingsStory[] = [];
        for (const entry of index.stories) {
            stories.push({ id: entry.id, name: entry.name, document: await storyService.loadStory(entry.id) });
        }
        return stories;
    } catch (error) {
        console.warn("[reachable-endings] story library unavailable", error);
        return null;
    }
}

/**
 * One story's walk: where paths run out, and which endings a path reaches.
 *
 * Breadth-first over the scenes, one visit each. A scene is entered when something can reach it, and
 * what it can do next is whatever `collectSceneFlowContinuations` says - so the analysis is the
 * distinction that model already draws between an arm that leaves (an edge), an arm that stops
 * (`stop`), and a row that ends the story (`ending`).
 */
function walkStory(
    story: ReachableEndingsStory,
    entrySceneIds: ReadonlySet<StorySceneId>,
): { runOuts: StoryRunOut[]; reachedEndingIds: Set<StoryBlockId> } {
    const graph = buildSceneFlowGraph(story.document);
    const continuations = collectSceneFlowContinuations(graph, story.document);
    const armsById = new Map(graph.branches.map(branch => [branch.id, branch]));

    const runOuts: StoryRunOut[] = [];
    const reachedEndingIds = new Set<StoryBlockId>();
    const queue: StorySceneId[] = [];
    const seen = new Set<StorySceneId>();
    const enter = (sceneId: StorySceneId): void => {
        if (seen.has(sceneId) || !story.document.scenes[sceneId]) {
            return;
        }
        seen.add(sceneId);
        queue.push(sceneId);
    };
    for (const sceneId of entrySceneIds) {
        enter(sceneId);
    }

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const sceneId = queue[cursor];
        const scene = story.document.scenes[sceneId];
        const exits = continuations.get(sceneId) ?? [];
        if (exits.length === 0) {
            // Nothing leaves and nothing ends it. A scene with no way out has no arms either - an
            // arm always contributes a continuation of its own - so the row play stops on is the
            // scene's last live one, which is the row `story/dead-end` anchors on too.
            runOuts.push({ scene, ...blockIdOf(lastLiveRootBlock(scene)) });
            continue;
        }
        for (const exit of exits) {
            if (exit.kind === "ending") {
                reachedEndingIds.add(exit.endingId);
                continue;
            }
            if (exit.kind === "stop") {
                // The arm runs, the scene has no unguarded exit left, and nothing says the story
                // ended. The finding lands on the arm's own row: it is the option the author has to
                // write something after.
                const arm = armsById.get(exit.branchId);
                runOuts.push({
                    scene,
                    ...blockIdOf(arm ? scene.blocks[arm.blockId] : undefined),
                    ...(arm?.label ? { option: arm.label } : {}),
                });
                continue;
            }
            enter(exit.target);
        }
    }

    return { runOuts, reachedEndingIds };
}

/** The scene's last row the compiler would keep, or undefined when it has none. */
function lastLiveRootBlock(scene: StoryScene | undefined): StoryBlock | undefined {
    let last: StoryBlock | undefined;
    for (const rootId of scene?.rootBlockIds ?? []) {
        const block = scene?.blocks[rootId];
        if (block && !block.disabled) {
            last = block;
        }
    }
    return last;
}

/** An optional `blockId` field, so a missing row leaves the key off rather than storing undefined. */
function blockIdOf(block: StoryBlock | undefined): { blockId?: StoryBlockId } {
    return block ? { blockId: block.id } : {};
}

/**
 * Where the report tab jumps to. The row when there is one, the scene otherwise.
 *
 * The same `SearchJumpTarget` shapes lint findings carry, so click-to-jump is the existing
 * `jumpToSearchTarget()` rather than a second navigation layer that could disagree with it.
 */
function rowTarget(story: ReachableEndingsStory, scene: StoryScene, blockId?: StoryBlockId): SearchJumpTarget {
    return blockId
        ? {
            kind: "storyBlock",
            storyId: story.id,
            sceneId: scene.id,
            blockId,
            storyName: story.name,
            sceneName: scene.name,
        }
        : { kind: "storyScene", storyId: story.id, sceneId: scene.id, storyName: story.name, sceneName: scene.name };
}

/** An ending's own row - its block id IS the ending's identity. */
function endingTarget(story: ReachableEndingsStory, ending: StoryEnding): SearchJumpTarget {
    return {
        kind: "storyBlock",
        storyId: story.id,
        sceneId: ending.sceneId,
        blockId: ending.endingId,
        storyName: story.name,
        sceneName: ending.sceneName,
    };
}
