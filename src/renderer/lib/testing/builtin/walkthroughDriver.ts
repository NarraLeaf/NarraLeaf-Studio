import type { WalkthroughDecision, WalkthroughPlan } from "@/apps/workspace/modules/story-flow/walkthroughPlan";
import type { TestGameChoiceOption, TestGameCommand, TestGameEvent, TestGameExit } from "../types";

/**
 * Playing one route, once the game is up.
 *
 * Split from the test definition so it can be run against a fake session: everything here is a
 * function of the events a game pushes and the commands it accepts, and none of it needs a process,
 * a window or a workspace.
 *
 * The loop is deliberately dumb between decisions - advance on a cadence, and let the game tell it
 * what happened. Anything cleverer would be a second interpreter of the story running beside the
 * real one, and the whole value of a headed run is that the real one is what answers.
 *
 * Every way out is bounded. A route that turns out not to be walkable, a game that dies, a story
 * that ends somewhere else, an author who cancels, and a playthrough that simply stops going
 * anywhere all reach a stated outcome; none of them waits forever.
 */

/** The half of a game session this needs. Narrow so a fake is a few lines. */
export type WalkthroughSession = {
    onEvent(listener: (event: TestGameEvent) => void): () => void;
    sendCommand(command: TestGameCommand): Promise<boolean>;
};

export type WalkthroughOutcome =
    /** The ending the author picked. The only pass. */
    | { kind: "reachedTarget" }
    /** An `/ending` row ran, but not that one. Both are named in the finding. */
    | { kind: "reachedOtherEnding"; endingId: string; endingName: string }
    /**
     * The game offered a menu without the option the route needs.
     *
     * A `hiddenWhen` condition took it away, which means the route is not walkable with the values
     * this playthrough is carrying. A real answer about the story, not a fault of the walk.
     */
    | { kind: "optionMissing"; decision: WalkthroughDecision; offered: readonly TestGameChoiceOption[] }
    /** The story ran out of rows. It ended, but at no ending anyone declared. */
    | { kind: "endedWithoutEnding" }
    /** The process is gone. `exit` carries the host's classification of why. */
    | { kind: "exited"; exit: TestGameExit }
    /** The step ceiling or the idle deadline. Either way it stopped going anywhere. */
    | { kind: "stalled"; steps: number }
    /** The author cancelled. */
    | { kind: "cancelled"; steps: number };

export type WalkthroughDriverInput = {
    session: WalkthroughSession;
    plan: WalkthroughPlan;
    /** The story to start, at the plan's own entry scene. */
    storyId: string;
    /** The ending row this run is walking to. */
    endingId: string;
    signal: AbortSignal;
    /** A decision the plan named has been taken, and how many that makes. */
    onDecision(taken: number, decision: WalkthroughDecision): void;
    /**
     * A menu the route did not depend on was answered anyway, with this option.
     *
     * Reported rather than logged here, because what a run says to an author is a translated string
     * and this module has no catalogue - it hands over the fact and the caller words it.
     */
    onImprovised(option: TestGameChoiceOption): void;
    /** How long between advances. */
    stepIntervalMs?: number;
    /** How many advances before the run is called stopped. */
    maxSteps?: number;
    /** How long the game may say nothing at all before the run is called stopped. */
    idleTimeoutMs?: number;
    /** How long the game gets to become reachable at all, before the first command lands. */
    startTimeoutMs?: number;
    /** Injected so a test does not wait in real time. Resolves after `ms`, or when `signal` aborts. */
    wait?: (ms: number, signal: AbortSignal) => Promise<void>;
};

/**
 * One click on the dialogue every 250ms.
 *
 * Slow enough that a line's typing animation and a scene transition finish on their own - a click
 * during a transition is swallowed by the engine, and a walk that outran the stage would lose steps
 * silently. Fast enough that a scene of dialogue is seconds rather than a minute.
 */
const DEFAULT_STEP_INTERVAL_MS = 250;

/**
 * Enough advances for a long route, and far short of forever.
 *
 * A story that loops - a hub scene the route keeps falling back into - is the case this exists for,
 * and the number is what turns "it never finished" into "it stopped advancing after N steps".
 */
const DEFAULT_MAX_STEPS = 4000;

/**
 * How long the game may push nothing at all.
 *
 * Every event resets it, console lines included, so a game that is running normally never reaches
 * it. What it catches is the game wedged on a screen nothing advances - a modal a blueprint opened,
 * a load that never completed - which no number of further clicks would fix.
 */
const DEFAULT_IDLE_TIMEOUT_MS = 60_000;

/**
 * How long the game gets to become reachable before the run gives up on speaking to it.
 *
 * The host dials the control socket for thirty seconds after the spawn, and the compile that
 * precedes it is unbounded in principle, so this is that window plus room for a cold one. It is
 * not the idle deadline: nothing has been asked of the story yet, so nothing is stalling.
 */
const DEFAULT_START_TIMEOUT_MS = 90_000;

export async function driveWalkthrough(input: WalkthroughDriverInput): Promise<WalkthroughOutcome> {
    const stepIntervalMs = input.stepIntervalMs ?? DEFAULT_STEP_INTERVAL_MS;
    const maxSteps = input.maxSteps ?? DEFAULT_MAX_STEPS;
    const idleTimeoutMs = input.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    const startTimeoutMs = input.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS;
    const wait = input.wait ?? waitForMilliseconds;

    let settled: WalkthroughOutcome | null = null;
    let announce: (() => void) | null = null;
    const settle = (outcome: WalkthroughOutcome): void => {
        if (!settled) {
            settled = outcome;
            announce?.();
        }
    };
    /** Resolves the moment an outcome is reached, so a wait between steps can be cut short. */
    const reached = new Promise<void>(resolve => {
        announce = resolve;
    });

    let steps = 0;
    let taken = 0;
    let lastEventAt = now();
    /** The story ended, and nothing has named an ending for it yet. Settled by the loop. */
    let endedWithoutName = false;
    /**
     * Choices are answered from the front of this queue rather than matched by scene, because the
     * game reports a menu and not where in the story it is. The consequence is stated where it
     * bites: an option the route needs that the menu does not offer ends the run and says so.
     */
    const pending = [...input.plan.decisions];
    /**
     * The menu last answered, so the same one reported twice running is answered once.
     *
     * A choice is reported as its slot registers with the game, and a re-render registers the same
     * menu again without anything having happened in the story. Consuming a second decision for it
     * would walk the route off course while every event still looked correct.
     *
     * Cleared by anything that means the story has moved on - another event, or a click this run
     * sent - so a menu genuinely returned to, in a loop or after a rollback, is a new question.
     */
    let answered: string | null = null;

    const dispose = input.session.onEvent(event => {
        // Once there is an answer nothing changes it, and the run must stop acting on the game -
        // picking an option after the verdict would leave a window doing things nobody asked for.
        if (settled) {
            return;
        }
        lastEventAt = now();
        if (event.kind === "exit") {
            settle({ kind: "exited", exit: event.exit });
            return;
        }
        if (event.kind === "ending") {
            settle(event.endingId === input.endingId
                ? { kind: "reachedTarget" }
                : { kind: "reachedOtherEnding", endingId: event.endingId, endingName: event.name });
            return;
        }
        if (event.kind === "game-end") {
            /**
             * Recorded, not acted on.
             *
             * An `/ending` row produces both events, `game-end` first, and they cross as two
             * separate messages - so deciding here would call every authored ending "the story
             * ended without one" by reading the first half of the pair. The loop settles it a beat
             * later, by which time the `ending` that names it has either arrived or was never
             * coming, which is exactly the distinction being drawn.
             */
            endedWithoutName = true;
            return;
        }
        if (event.kind !== "choice") {
            answered = null;
            return;
        }
        const menu = describeMenu(event.options);
        if (menu === answered) {
            return;
        }
        answered = menu;
        const decision = pending[0];
        if (!decision) {
            // The route did not depend on this question, so any answer keeps it going. Improvising
            // is better than stopping: if the walk still lands on the ending, the ending is reachable
            // - and if it lands somewhere else, that is what the run reports, naming both.
            const fallback = event.options.find(option => !option.disabled);
            if (!fallback) {
                settle({ kind: "stalled", steps });
                return;
            }
            input.onImprovised(fallback);
            void input.session.sendCommand({ kind: "choose", index: fallback.index });
            return;
        }
        const offered = event.options.find(option => option.index === decision.optionIndex);
        if (!offered || offered.disabled) {
            settle({ kind: "optionMissing", decision, offered: event.options });
            return;
        }
        pending.shift();
        taken += 1;
        input.onDecision(taken, decision);
        void input.session.sendCommand({ kind: "choose", index: decision.optionIndex });
    });

    try {
        if (input.signal.aborted) {
            return { kind: "cancelled", steps };
        }
        // The launch resolves when the session exists, not when the game can be spoken to: the
        // runtime only starts listening on its control socket once it has read (and, for a protected
        // project, decrypted) its pack, and the host dials it for up to thirty seconds. A `start`
        // sent in that window is refused for being EARLY, which is not the same as there being
        // nothing on the far end - so it is retried until it lands, the session ends, or the window
        // closes. Sending it once is how a run that was working looked like a game that never moved.
        let started = false;
        const startDeadline = now() + startTimeoutMs;
        // Bounded by attempts as well as by the clock. A caller may inject a `wait` that resolves
        // instantly, and a loop that only watched the wall clock would spin against it.
        let startAttemptsLeft = Math.max(1, Math.ceil(startTimeoutMs / Math.max(1, stepIntervalMs)));
        while (!started) {
            if (input.signal.aborted) {
                return { kind: "cancelled", steps };
            }
            if (settled) {
                // The process reported its exit while we were still waiting to speak to it.
                return settled;
            }
            started = await input.session.sendCommand({
                kind: "start",
                storyId: input.storyId,
                sceneId: input.plan.entrySceneId,
            });
            if (started) {
                break;
            }
            startAttemptsLeft -= 1;
            if (startAttemptsLeft <= 0 || now() >= startDeadline) {
                // Nothing is listening on the far end and nothing is going to be. No click would
                // land, so the run stops here rather than clicking at nothing for the ceiling.
                return settled ?? { kind: "stalled", steps };
            }
            await Promise.race([reached, wait(stepIntervalMs, input.signal)]);
        }
        // The clock the idle deadline runs on starts when the game can hear us, not when the test
        // did - a slow compile is not the story failing to advance.
        lastEventAt = now();

        while (!settled) {
            if (input.signal.aborted) {
                return { kind: "cancelled", steps };
            }
            if (steps >= maxSteps) {
                return { kind: "stalled", steps };
            }
            if (now() - lastEventAt > idleTimeoutMs) {
                return { kind: "stalled", steps };
            }
            await Promise.race([reached, wait(stepIntervalMs, input.signal)]);
            if (settled || input.signal.aborted) {
                continue;
            }
            if (endedWithoutName) {
                // A whole beat has passed since the story ended and nothing named an ending, so
                // there was none to name - it ran out of rows.
                return { kind: "endedWithoutEnding" };
            }
            steps += 1;
            // The story is about to move, so whatever menu was last answered is behind us.
            answered = null;
            await input.session.sendCommand({ kind: "advance" });
        }
        return settled;
    } finally {
        dispose();
    }
}

function now(): number {
    return Date.now();
}

/** What makes one menu the same menu as another: the options it offers, and their state. */
function describeMenu(options: readonly TestGameChoiceOption[]): string {
    return options.map(option => `${option.index}:${option.disabled ? "-" : "+"}${option.text}`).join("\n");
}

/** The real wait. Cut short by an abort so a cancelled run does not sit out its own cadence. */
function waitForMilliseconds(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
        return Promise.resolve();
    }
    return new Promise<void>(resolve => {
        const done = () => {
            clearTimeout(timer);
            signal.removeEventListener("abort", done);
            resolve();
        };
        const timer = setTimeout(done, ms);
        signal.addEventListener("abort", done, { once: true });
    });
}
