import { planWalkthrough, type WalkthroughPlan } from "@/apps/workspace/modules/story-flow/walkthroughPlan";
import { translate } from "@/lib/i18n";
import { blueprintDocumentGraphCarriers, scanStoryEntryPoints } from "@shared/story/storyReachability";
import { listStoryEndings, type StoryDocument, type StoryEnding, type StorySceneId } from "@shared/types/story";
import { findStoryEnding } from "@shared/types/story/endings";
import type { SearchJumpTarget } from "@/lib/workspace/services/search/searchJumpTarget";
import type { ServiceRegistry } from "@/lib/workspace/services/serviceRegistry";
import { Services } from "@/lib/workspace/services/services";
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
import type { UIGraphService } from "@/lib/workspace/services/ui-editor/UIGraphService";
import type {
    TestDefinition,
    TestGameExitReason,
    TestGameSession,
    TestParameterOption,
    TestRunContext,
    TestText,
    TestVerdict,
} from "../types";
import type { BuiltInTestHost } from "./index";
import { driveWalkthrough, type WalkthroughOutcome } from "./walkthroughDriver";

/**
 * `narraleaf-studio:walkthrough` - play the real game to an ending the author picks.
 *
 * The one test in the pipeline whose answer no static check can give. A lint rule can say a scene is
 * orphaned; only a playthrough can say that this ending is still arrived at by a player who takes
 * this route, in a build made from the project as it stands.
 *
 * Two halves, and the order matters. The route is planned from the document **before anything is
 * launched**, so an ending nothing leads to is reported in a moment rather than after a minute of an
 * author watching a game that could never arrive. Only then is a window opened, and from there the
 * game is the authority: the walk clicks and picks, and every verdict is read off what the game
 * pushed back.
 *
 * Where it starts is the story's own entry, never a scene this test chose. "Does this ending happen"
 * is a question about the game a player gets, and a run that began somewhere convenient would be
 * answering a different one.
 */

export const WALKTHROUGH_TEST_ID = "narraleaf-studio:walkthrough";

/**
 * The i18n namespace this test's keys live under: `test.builtin.<slug>.*`.
 *
 * Written out literally and asserted against `deriveBuiltInTestSlug(id)` by the registry test, so
 * renaming the id cannot leave dead keys behind.
 */
export const WALKTHROUGH_SLUG = "walkthrough";

/** The one thing the author is asked before Start. */
export const WALKTHROUGH_ENDING_PARAMETER = "ending";

/**
 * An ending's identity across the whole project, which is what a parameter value has to be.
 *
 * `StoryEnding.endingId` is a block id and unique inside its document; the picker lists every story,
 * so the story it belongs to travels with it. Story ids are UUIDs and carry no separator, so the
 * first one splits the pair.
 */
export function encodeWalkthroughEnding(storyId: string, endingId: string): string {
    return `${storyId}/${endingId}`;
}

export function decodeWalkthroughEnding(value: string): { storyId: string; endingId: string } | null {
    const separator = value.indexOf("/");
    if (separator <= 0 || separator === value.length - 1) {
        return null;
    }
    return { storyId: value.slice(0, separator), endingId: value.slice(separator + 1) };
}

export function createWalkthroughTest(host: BuiltInTestHost): TestDefinition {
    return {
        id: WALKTHROUGH_TEST_ID,
        title: { key: "test.builtin.walkthrough.title" },
        description: { key: "test.builtin.walkthrough.description" },
        category: "runtime",
        presentation: "windowed",
        requires: ["game.launch"],
        parameters: [{
            id: WALKTHROUGH_ENDING_PARAMETER,
            kind: "select",
            label: { key: "test.builtin.walkthrough.parameter.ending.label" },
            description: { key: "test.builtin.walkthrough.parameter.ending.description" },
            // Synchronous and over what is already in memory, as the contract requires. The picker
            // loads the project's stories before it opens (see `prepareParameterSources`), which is
            // what makes "already in memory" the whole library rather than whatever was open.
            options: () => listEndingOptions(host.services()),
        }],
        run: ctx => runWalkthrough(host, ctx),
    };
}

/**
 * Every ending in the project, as rows an author can tell apart.
 *
 * Labelled story / scene / name because none of the three is enough on its own: "Bad End" is a name
 * two rows may legitimately share, and a scene name repeats across stories. Built from
 * `listStoryEndings` - the one scan the compiler emits from - so the list can never offer an ending
 * the build does not have.
 */
function listEndingOptions(services: ServiceRegistry): TestParameterOption[] {
    const story = services.get<StoryService>(Services.Story);
    const options: TestParameterOption[] = [];
    for (const entry of story.getLibraryIndex().stories) {
        const document = story.getLoadedStoryDocument(entry.id);
        if (!document) {
            continue;
        }
        for (const ending of listStoryEndings(document)) {
            options.push({
                value: encodeWalkthroughEnding(entry.id, ending.endingId),
                label: {
                    key: "test.builtin.walkthrough.parameter.ending.option",
                    params: { story: entry.name, scene: ending.sceneName, ending: endingName(ending) },
                },
            });
        }
    }
    return options;
}

/** An ending the author has not named yet still has to be pickable. */
function endingName(ending: StoryEnding): string {
    return ending.name || translate("test.builtin.walkthrough.parameter.ending.unnamed");
}

async function runWalkthrough(host: BuiltInTestHost, ctx: TestRunContext): Promise<TestVerdict> {
    // Untranslated, like every other message addressed to whoever wrote the test rather than to the
    // author: reaching either of these means the host handed over a context its own contract says it
    // cannot produce.
    if (!ctx.game) {
        throw new Error(`${WALKTHROUGH_TEST_ID} declared game.launch but was given no game handle`);
    }
    const target = decodeWalkthroughEnding(String(ctx.parameters[WALKTHROUGH_ENDING_PARAMETER] ?? ""));
    if (!target) {
        throw new Error(`${WALKTHROUGH_TEST_ID} was started without an ending to walk to`);
    }

    const services = host.services();
    const story = services.get<StoryService>(Services.Story);
    const entry = story.getLibraryIndex().stories.find(candidate => candidate.id === target.storyId);
    const storyName = entry?.name ?? target.storyId;
    const document = await story.loadStory(target.storyId);

    const ending = findStoryEnding(document, target.endingId);
    if (!ending) {
        // The row was deleted or disabled between the picker opening and Start. Nothing to walk to,
        // and nothing to anchor a finding on either - the row it would point at is gone.
        const message: TestText = { key: "test.builtin.walkthrough.finding.endingMissing" };
        ctx.report({ severity: "error", message });
        return { status: "failed", summary: message };
    }
    const anchor = endingTarget(target.storyId, storyName, ending);
    const label = { ending: endingName(ending), story: storyName };

    const planned = planWalkthrough(document, {
        endingId: ending.endingId,
        entrySceneIds: collectEntrySceneIds(services, target.storyId, document),
    });
    if (!planned.ok) {
        // Before the launch, which is the whole point of planning first: a run that could never
        // arrive costs the author a minute of watching a game play itself into the wrong scene.
        const message: TestText = planned.failure.reason === "noEntryPoint"
            ? { key: "test.builtin.walkthrough.finding.noEntryPoint", params: label }
            : { key: "test.builtin.walkthrough.finding.unreachable", params: label };
        ctx.report({ severity: "error", message, target: anchor });
        return { status: "failed", summary: message };
    }

    const plan = planned.plan;
    ctx.log("info", {
        key: "test.builtin.walkthrough.log.planned",
        params: { scenes: plan.sceneIds.length, decisions: plan.decisions.length },
    });
    reportProgress(ctx, plan, 0, null);

    const session = await ctx.game.launch();
    let outcome: WalkthroughOutcome;
    try {
        outcome = await driveWalkthrough({
            session,
            plan,
            storyId: target.storyId,
            endingId: ending.endingId,
            signal: ctx.signal,
            onDecision: (taken, decision) => {
                ctx.log("info", {
                    key: "test.builtin.walkthrough.log.choosing",
                    params: { scene: decision.sceneName, option: decision.optionText },
                });
                reportProgress(ctx, plan, taken, decision);
            },
            // Worth saying out loud: the walk answered a question the route did not turn on, so
            // where it goes next is not something the plan vouched for.
            onImprovised: option => ctx.log("warning", {
                key: "test.builtin.walkthrough.log.improvised",
                params: { option: option.text },
            }),
        });
    } finally {
        // Whatever happened, including a throw and a cancel: the window belongs to this run and
        // nothing else will close it.
        await stopQuietly(session);
    }
    return verdictFor(ctx, outcome, { anchor, label });
}

/**
 * The decisions taken, out of the decisions the route needs.
 *
 * A real fraction, which is the only case where a determinate bar is honest - the plan knows how many
 * questions the route turns on before the first one is asked. A route with no decisions at all has no
 * fraction to report and goes back to the indeterminate bar rather than sitting at 0/0.
 */
function reportProgress(
    ctx: TestRunContext,
    plan: WalkthroughPlan,
    taken: number,
    decision: { optionText: string } | null,
): void {
    if (plan.decisions.length === 0) {
        ctx.progress({ completed: 0 });
        return;
    }
    ctx.progress({
        completed: taken,
        total: plan.decisions.length,
        // The option's own text, as a literal: it is the author's words, not prose this test wrote.
        ...(decision?.optionText ? { label: { text: decision.optionText } } : {}),
    });
}

function verdictFor(
    ctx: TestRunContext,
    outcome: WalkthroughOutcome,
    context: { anchor: StoryBlockJumpTarget; label: Record<string, string> },
): TestVerdict {
    if (outcome.kind === "reachedTarget") {
        return { status: "passed", summary: { key: "test.builtin.walkthrough.summary.passed", params: context.label } };
    }
    const message = failureMessage(outcome, context.label);
    ctx.report({
        // A cancel is the author's own decision and not a defect of the game, so the run says so
        // without dressing it as one. Everything else is the test failing to see what it came for.
        severity: outcome.kind === "cancelled" ? "info" : "error",
        message,
        // The option the game did not offer, when there is one - that row is what the author edits.
        // Everything else points at the ending, which is what the run was about.
        target: outcome.kind === "optionMissing"
            ? {
                ...context.anchor,
                sceneId: outcome.decision.sceneId,
                sceneName: outcome.decision.sceneName,
                blockId: outcome.decision.optionBlockId,
            }
            : context.anchor,
    });
    return { status: "failed", summary: message };
}

function failureMessage(
    outcome: Exclude<WalkthroughOutcome, { kind: "reachedTarget" }>,
    label: Record<string, string>,
): TestText {
    switch (outcome.kind) {
        case "reachedOtherEnding":
            return {
                key: "test.builtin.walkthrough.finding.otherEnding",
                params: {
                    ...label,
                    reached: outcome.endingName
                        || translate("test.builtin.walkthrough.parameter.ending.unnamed"),
                },
            };
        case "optionMissing":
            return {
                key: "test.builtin.walkthrough.finding.optionMissing",
                params: { option: outcome.decision.optionText, scene: outcome.decision.sceneName },
            };
        case "endedWithoutEnding":
            return { key: "test.builtin.walkthrough.finding.endedWithoutEnding", params: label };
        case "exited":
            return { key: EXIT_MESSAGE_KEYS[outcome.exit.reason], params: label };
        case "cancelled":
            return { key: "test.builtin.walkthrough.finding.cancelled", params: { steps: outcome.steps } };
        default:
            return {
                key: "test.builtin.walkthrough.finding.stalled",
                params: { ...label, steps: outcome.steps },
            };
    }
}

/**
 * One key per exit reason, addressed by the reason itself.
 *
 * The classification is the host's and is not re-derived from the exit code here - see
 * `GameTestExitReason`, where the four are the whole set and the order they are decided in is
 * load-bearing.
 */
const EXIT_MESSAGE_KEYS = {
    "closed-by-user": "test.builtin.walkthrough.finding.exit.closed",
    "stopped-by-host": "test.builtin.walkthrough.finding.exit.stopped",
    crashed: "test.builtin.walkthrough.finding.exit.crashed",
    "failed-to-start": "test.builtin.walkthrough.finding.exit.failedToStart",
} as const satisfies Record<TestGameExitReason, string>;

/**
 * Where a blueprint says play can begin - `scanStoryEntryPoints`, the same scan the lint rules read.
 *
 * Deliberately that scan and not a walk of its own: a test that started somewhere the build does not
 * would be reporting on a game nobody plays. The scene the author marked on the document is the
 * planner's own to read, so it is not collected twice here.
 *
 * A project whose blueprints cannot be read contributes nothing rather than failing the run - the
 * marked entry is usually the whole answer anyway.
 */
function collectEntrySceneIds(
    services: ServiceRegistry,
    storyId: string,
    document: StoryDocument,
): StorySceneId[] {
    const sceneIds = new Set<StorySceneId>();
    try {
        const blueprintDocument = services.get<UIGraphService>(Services.UIGraph).getDocument().blueprintDocument;
        const scan = scanStoryEntryPoints(
            blueprintDocumentGraphCarriers(blueprintDocument),
            (candidateStoryId, sceneId) =>
                candidateStoryId === storyId && Boolean(document.scenes[sceneId]),
        );
        for (const sceneId of scan.byStory.get(storyId) ?? []) {
            sceneIds.add(sceneId);
        }
    } catch (error) {
        console.warn(`[${WALKTHROUGH_TEST_ID}] could not read the project's blueprints`, error);
    }
    return [...sceneIds];
}

/** The navigation vocabulary's story-row variant, named so a finding can be built by changing a field. */
type StoryBlockJumpTarget = Extract<SearchJumpTarget, { kind: "storyBlock" }>;

function endingTarget(storyId: string, storyName: string, ending: StoryEnding): StoryBlockJumpTarget {
    return {
        kind: "storyBlock",
        storyId,
        storyName,
        sceneId: ending.sceneId,
        sceneName: ending.sceneName,
        blockId: ending.endingId,
    };
}

/**
 * A stop that cannot become the run's verdict.
 *
 * The session is already being torn down on the way out of a run that has its answer; a failure to
 * close a window must not replace it with one about the window.
 */
async function stopQuietly(session: TestGameSession): Promise<void> {
    try {
        await session.stop();
    } catch (error) {
        console.warn(`[${WALKTHROUGH_TEST_ID}] stopping the game session failed`, error);
    }
}
