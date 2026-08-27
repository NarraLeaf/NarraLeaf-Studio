import { scanProjectStoryEntryPoints } from "@shared/story/storyReachability";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { StoryDocument, StorySceneId } from "@shared/types/story";
import { listSceneBlocksInDocumentOrder, listScenesInDocumentOrder, listStoryEndings, storyVariableRefKey } from "@shared/types/story";
import { buildSceneFlowGraph } from "@/apps/workspace/modules/story-flow/sceneFlowModel";
import { computeSceneFlowCoverage } from "@/apps/workspace/modules/story-flow/sceneFlowCoverage";
import { collectBlueprintVariableWrites } from "@/apps/workspace/modules/story-flow/sceneFlowVariables";
import type { SearchJumpTarget } from "@/lib/workspace/services/search/searchJumpTarget";
import { Services } from "@/lib/workspace/services/services";
// Type-only, for the reason `reachableEndings` states: a value import pulls a service, and
// everything it depends on, into the import graph of the registry the picker touches on open.
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
import type { UIGraphService } from "@/lib/workspace/services/ui-editor/UIGraphService";
import type { VariableRegistryEntry } from "@shared/types/variables/registry";
import type { VariableRegistryService } from "@/lib/workspace/services/variables/VariableRegistryService";
import type { TestDefinition, TestVerdict } from "../types";
import type { BuiltInTestHost } from "./index";

/**
 * `narraleaf-studio:route-coverage` — what a player can reach once the conditions are read.
 *
 * The third integrity test, and the first one in Studio that does not treat every branch as walkable.
 * `reachable-endings` asks whether the script's *shape* leads somewhere; this asks whether the
 * *state* ever gets there — an ending gated on `好感 >= 50` in a story whose every route tops out at
 * 30 passes that check and fails this one.
 *
 * **It reports only the difference.** Everything structurally unreachable is already named by
 * `story/unreachable-scene`, `story/dead-end` and `reachable-endings`, and repeating it here would
 * bury the one thing this can say that they cannot. So a finding always means: the rows lead here,
 * and the numbers never do.
 *
 * **Every claim is negative, and that is what makes them safe.** The walk widens wherever it cannot
 * be sure — an unevaluable guard is taken, an unreadable write poisons its counter, a loop widens —
 * and widening can only ever make more of the story reachable. A project it cannot read at all
 * (a plugin marker, a TypeScript blueprint) collapses onto the structural answer and reports nothing,
 * which is why there is no state in which this has to be switched off.
 *
 * Severity is `warning` throughout, and deliberately not `error`: unreachable content is a mistake
 * about the script rather than a broken artifact, and an author who has written chapter five's
 * ending before chapter two's affection rows is in an ordinary intermediate state, not a broken one.
 */

export const ROUTE_COVERAGE_TEST_ID = "narraleaf-studio:route-coverage";

/** `test.builtin.<slug>.*`, asserted against `deriveBuiltInTestSlug(id)` by the registry test. */
export const ROUTE_COVERAGE_SLUG = "routeCoverage";

type CoverageStory = { id: string; name: string; document: StoryDocument };

export function createRouteCoverageTest(host: BuiltInTestHost): TestDefinition {
    return {
        id: ROUTE_COVERAGE_TEST_ID,
        title: { key: "test.builtin.routeCoverage.title" },
        description: { key: "test.builtin.routeCoverage.description" },
        category: "integrity",
        // A read-only sweep of documents already in memory, like the other two integrity tests, and
        // therefore runnable while the workspace is frozen.
        presentation: "headless",
        requires: [],
        async run(ctx) {
            const services = host.services();
            const storyService = services.get<StoryService>(Services.Story);
            const uiGraphService = services.get<UIGraphService>(Services.UIGraph);

            const stories = await loadStories(storyService);
            if (!stories) {
                return skip("storiesUnread");
            }

            let blueprintDocument: BlueprintDocument | null = null;
            try {
                blueprintDocument = uiGraphService.getDocument().blueprintDocument;
            } catch (error) {
                console.warn("[route-coverage] blueprint document unavailable", error);
            }

            const { byStory, undecidable } = scanProjectStoryEntryPoints(stories, blueprintDocument);
            if (undecidable.length > 0) {
                // The same guard `story/unreachable-scene` and `reachable-endings` take: a check that
                // reports the whole project because it could not find where play begins is a check
                // an author switches off in the first five minutes.
                return skip("undecidableEntry");
            }
            if (byStory.size === 0) {
                return skip("noEntryPoint");
            }

            const registry = readRegistry(services);
            const blueprintWrites = collectBlueprintVariableWrites(blueprintDocument, registry);
            // A program that is not a graph has no nodes to scan, so what it assigns is unknowable.
            // Whole-project, because a `saved` counter it moves is a counter every story shares.
            const opaqueWriters = Object.values(blueprintDocument?.blueprints ?? {})
                .some(blueprint => blueprint && blueprint.program?.kind !== "graph");

            const writtenByStory = new Map(stories.map(story => [story.id, storyWrittenKeys(story.document)]));
            const analysed = stories.filter(story => (byStory.get(story.id)?.size ?? 0) > 0);
            if (analysed.length === 0) {
                return skip("noEntryPoint");
            }

            let unreachableScenes = 0;
            let unreachableOptions = 0;
            let unreachableEndings = 0;

            for (const [index, story] of analysed.entries()) {
                if (ctx.signal.aborted) {
                    break;
                }
                // A real fraction: the stories are known before the walk, and each is one step.
                ctx.progress({ completed: index, total: analysed.length, label: { text: story.name } });

                const entrySceneIds = byStory.get(story.id);
                if (!entrySceneIds) {
                    continue;
                }
                const graph = buildSceneFlowGraph(story.document);
                // What this story's own graph cannot bound: a counter another story moves, or one a
                // surface handler writes on the player's own schedule.
                const externallyWrittenKeys = new Set(blueprintWrites.ambient);
                for (const [storyId, keys] of writtenByStory) {
                    if (storyId === story.id) {
                        continue;
                    }
                    for (const key of keys) {
                        externallyWrittenKeys.add(key);
                    }
                }
                const coverage = computeSceneFlowCoverage(story.document, entrySceneIds, {
                    graph,
                    registry,
                    blueprintWrites,
                    opaqueWriters,
                    externallyWrittenKeys,
                });
                if (!coverage.settled) {
                    // The walk hit its own guard rail, so it does not know which scenes had settled.
                    // Every set it returned is the structural one and every difference below is
                    // empty; saying so beats a silent pass.
                    console.warn("[route-coverage] walk did not settle", story.id);
                    continue;
                }

                // The frontier only: a scene behind an unreachable one is unreachable *because* of
                // it, and naming both says one mistake twice.
                for (const sceneId of coverage.frontierUnreachableSceneIds) {
                    const scene = story.document.scenes[sceneId];
                    if (!scene) {
                        continue;
                    }
                    unreachableScenes += 1;
                    ctx.report({
                        severity: "warning",
                        message: { key: "test.builtin.routeCoverage.finding.sceneUnreachable", params: { scene: scene.name } },
                        target: sceneTarget(story, sceneId),
                    });
                }

                for (const branchId of coverage.structuralBranchIds) {
                    if (coverage.takenBranchIds.has(branchId)) {
                        continue;
                    }
                    const arm = graph.branches.find(branch => branch.id === branchId);
                    // An arm in a scene nothing reaches is the scene's finding, not its own: one
                    // sentence about a hallway beats one about each of the five doors in it.
                    if (!arm || !coverage.reachableSceneIds.has(arm.sceneId)) {
                        continue;
                    }
                    unreachableOptions += 1;
                    ctx.report({
                        severity: "warning",
                        message: arm.label
                            ? { key: "test.builtin.routeCoverage.finding.optionUnreachable", params: { option: arm.label } }
                            : { key: "test.builtin.routeCoverage.finding.branchUnreachable" },
                        target: rowTarget(story, arm.sceneId, arm.blockId),
                    });
                }

                for (const ending of listStoryEndings(story.document)) {
                    if (coverage.reachedEndingIds.has(ending.endingId)
                        || !coverage.structuralEndingIds.has(ending.endingId)
                        // An ending in a scene nothing reaches belongs to that scene's finding.
                        || !coverage.reachableSceneIds.has(ending.sceneId)) {
                        continue;
                    }
                    unreachableEndings += 1;
                    ctx.report({
                        severity: "warning",
                        message: ending.name
                            ? { key: "test.builtin.routeCoverage.finding.endingUnreachable", params: { name: ending.name } }
                            : { key: "test.builtin.routeCoverage.finding.endingUnreachableUnnamed" },
                        target: rowTarget(story, ending.sceneId, ending.endingId),
                    });
                }
            }
            ctx.progress({ completed: analysed.length, total: analysed.length });

            // Reported before this line, kept after it: a run the author stopped halfway is still
            // evidence, and without this it would come back "passed" from a sweep that never ended.
            ctx.signal.throwIfAborted();

            const params = { scenes: unreachableScenes, options: unreachableOptions, endings: unreachableEndings };
            const total = unreachableScenes + unreachableOptions + unreachableEndings;
            return total > 0
                ? { status: "failed", summary: { key: "test.builtin.routeCoverage.summary.failed", params } }
                : { status: "passed", summary: { key: "test.builtin.routeCoverage.summary.passed", params } };
        },
    };
}

function skip(reason: "storiesUnread" | "undecidableEntry" | "noEntryPoint"): TestVerdict {
    return { status: "skipped", summary: { key: `test.builtin.routeCoverage.skipped.${reason}` } };
}

/**
 * The project's variable registry, both scopes, or nothing.
 *
 * After the declaration migration this is where a `saved` or `persistent` counter's default lives,
 * and a walk seeded without it starts every counter at `unknown` - which prunes nothing and reports
 * nothing, silently. Failing to read it is therefore worth degrading over, not throwing over.
 */
function readRegistry(services: ReturnType<BuiltInTestHost["services"]>): VariableRegistryEntry[] {
    try {
        return services.get<VariableRegistryService>(Services.VariableRegistry).listEntries();
    } catch (error) {
        console.warn("[route-coverage] variable registry unavailable", error);
        return [];
    }
}

/** Every variable key one document assigns, disabled rows included - see `storyGuards` for why. */
function storyWrittenKeys(document: StoryDocument): Set<string> {
    const keys = new Set<string>();
    for (const scene of listScenesInDocumentOrder(document)) {
        if (!scene) {
            continue;
        }
        for (const block of listSceneBlocksInDocumentOrder(scene)) {
            if (block.kind === "action" && block.payload.action === "setVariable") {
                keys.add(storyVariableRefKey(block.payload.target));
            }
        }
    }
    return keys;
}

/** All or nothing, the same bargain `reachable-endings` strikes: one verdict about the whole project. */
async function loadStories(storyService: StoryService): Promise<CoverageStory[] | null> {
    try {
        const index = storyService.getLibraryIndex();
        const stories: CoverageStory[] = [];
        for (const entry of index.stories) {
            stories.push({ id: entry.id, name: entry.name, document: await storyService.loadStory(entry.id) });
        }
        return stories;
    } catch (error) {
        console.warn("[route-coverage] story library unavailable", error);
        return null;
    }
}

/** The same `SearchJumpTarget` shapes lint findings carry, so click-to-jump is existing machinery. */
function sceneTarget(story: CoverageStory, sceneId: StorySceneId): SearchJumpTarget {
    return {
        kind: "storyScene",
        storyId: story.id,
        sceneId,
        storyName: story.name,
        sceneName: story.document.scenes[sceneId]?.name ?? "",
    };
}

function rowTarget(story: CoverageStory, sceneId: StorySceneId, blockId: string): SearchJumpTarget {
    return {
        kind: "storyBlock",
        storyId: story.id,
        sceneId,
        blockId,
        storyName: story.name,
        sceneName: story.document.scenes[sceneId]?.name ?? "",
    };
}
