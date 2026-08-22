import { describe, expect, it } from "vitest";
import type { WalkthroughDecision, WalkthroughPlan } from "@/apps/workspace/modules/story-flow/walkthroughPlan";
import type { TestGameChoiceOption, TestGameCommand, TestGameEvent } from "../types";
import { driveWalkthrough, type WalkthroughSession } from "./walkthroughDriver";

/**
 * A game that answers a script.
 *
 * `react` is handed every command as it arrives and may push events back, which is how a fake plays
 * out a route: the driver clicks, this decides what the game would have done. Commands are recorded
 * so a test can assert what was sent as well as what came of it.
 */
function fakeSession(react: (command: TestGameCommand, push: (event: TestGameEvent) => void) => void): {
    session: WalkthroughSession;
    commands: TestGameCommand[];
} {
    const listeners = new Set<(event: TestGameEvent) => void>();
    const commands: TestGameCommand[] = [];
    const push = (event: TestGameEvent) => {
        for (const listener of [...listeners]) {
            listener(event);
        }
    };
    return {
        commands,
        session: {
            onEvent: listener => {
                listeners.add(listener);
                return () => listeners.delete(listener);
            },
            sendCommand: async command => {
                commands.push(command);
                react(command, push);
                return true;
            },
        },
    };
}

function decision(patch: Partial<WalkthroughDecision> = {}): WalkthroughDecision {
    return {
        choiceBlockId: "c1",
        optionBlockId: "o1",
        optionIndex: 1,
        optionText: "Right",
        sceneId: "start",
        sceneName: "Start",
        ...patch,
    };
}

function plan(decisions: WalkthroughDecision[] = []): WalkthroughPlan {
    return { entrySceneId: "start", sceneIds: ["start"], decisions };
}

function drive(input: {
    session: WalkthroughSession;
    plan?: WalkthroughPlan;
    signal?: AbortSignal;
    maxSteps?: number;
}) {
    const taken: WalkthroughDecision[] = [];
    const improvised: TestGameChoiceOption[] = [];
    return {
        taken,
        improvised,
        outcome: driveWalkthrough({
            session: input.session,
            plan: input.plan ?? plan(),
            storyId: "story-1",
            endingId: "ending-target",
            signal: input.signal ?? new AbortController().signal,
            onDecision: (_count, made) => taken.push(made),
            onImprovised: option => improvised.push(option),
            maxSteps: input.maxSteps ?? 20,
            // No real time: every wait resolves at once, so a run is bounded by its step ceiling
            // rather than by the clock.
            wait: async () => undefined,
        }),
    };
}

describe("driveWalkthrough", () => {
    it("starts the story at the plan's entry scene", async () => {
        const fake = fakeSession((command, push) => {
            if (command.kind === "start") {
                push({ kind: "ending", endingId: "ending-target", name: "The End" });
            }
        });

        await expect(drive({ session: fake.session }).outcome).resolves.toEqual({ kind: "reachedTarget" });
        expect(fake.commands[0]).toEqual({ kind: "start", storyId: "story-1", sceneId: "start" });
    });

    it("answers each choice with the planned option and reaches the ending", async () => {
        const fake = fakeSession((command, push) => {
            if (command.kind === "start") {
                push({
                    kind: "choice",
                    options: [
                        { index: 0, text: "Left", disabled: false },
                        { index: 1, text: "Right", disabled: false },
                    ],
                });
                return;
            }
            if (command.kind === "choose" && command.index === 1) {
                push({ kind: "ending", endingId: "ending-target", name: "The End" });
            }
        });

        const run = drive({ session: fake.session, plan: plan([decision()]) });

        await expect(run.outcome).resolves.toEqual({ kind: "reachedTarget" });
        expect(fake.commands).toContainEqual({ kind: "choose", index: 1 });
        expect(run.taken).toEqual([decision()]);
    });

    it("answers the same menu once when it is reported twice running", async () => {
        const menu: TestGameEvent = {
            kind: "choice",
            options: [
                { index: 0, text: "Left", disabled: false },
                { index: 1, text: "Right", disabled: false },
            ],
        };
        const fake = fakeSession((command, push) => {
            if (command.kind === "start") {
                // A re-render registers the same menu again with nothing having happened in the
                // story; a second decision consumed here would walk the route off course.
                push(menu);
                push(menu);
                return;
            }
            if (command.kind === "advance") {
                push({ kind: "ending", endingId: "ending-target", name: "The End" });
            }
        });

        const run = drive({ session: fake.session, plan: plan([decision(), decision({ optionIndex: 0 })]) });

        await expect(run.outcome).resolves.toEqual({ kind: "reachedTarget" });
        expect(fake.commands.filter(command => command.kind === "choose")).toEqual([{ kind: "choose", index: 1 }]);
    });

    it("names both endings when the walk lands on a different one", async () => {
        const fake = fakeSession((command, push) => {
            if (command.kind === "start") {
                push({ kind: "ending", endingId: "ending-other", name: "Bad End" });
            }
        });

        await expect(drive({ session: fake.session }).outcome).resolves.toEqual({
            kind: "reachedOtherEnding",
            endingId: "ending-other",
            endingName: "Bad End",
        });
    });

    it("stops when the planned option is not among the ones offered", async () => {
        const offered = [{ index: 0, text: "Left", disabled: false }];
        const fake = fakeSession((command, push) => {
            if (command.kind === "start") {
                push({ kind: "choice", options: offered });
            }
        });

        const run = drive({ session: fake.session, plan: plan([decision()]) });

        await expect(run.outcome).resolves.toEqual({
            kind: "optionMissing",
            decision: decision(),
            offered,
        });
        // Nothing was picked, so nothing is reported as taken - the route stops where it stopped.
        expect(run.taken).toEqual([]);
        expect(fake.commands).not.toContainEqual({ kind: "choose", index: 1 });
    });

    it("stops when the offered option is there but switched off by a condition", async () => {
        const fake = fakeSession((command, push) => {
            if (command.kind === "start") {
                push({ kind: "choice", options: [{ index: 1, text: "Right", disabled: true }] });
            }
        });

        await expect(drive({ session: fake.session, plan: plan([decision()]) }).outcome)
            .resolves.toMatchObject({ kind: "optionMissing" });
    });

    it("improvises past a choice the route does not depend on", async () => {
        const fake = fakeSession((command, push) => {
            if (command.kind === "start") {
                push({
                    kind: "choice",
                    options: [
                        { index: 0, text: "Blocked", disabled: true },
                        { index: 1, text: "Anything", disabled: false },
                    ],
                });
                return;
            }
            if (command.kind === "choose") {
                push({ kind: "ending", endingId: "ending-target", name: "The End" });
            }
        });

        const run = drive({ session: fake.session });

        await expect(run.outcome).resolves.toEqual({ kind: "reachedTarget" });
        // The first option that can be picked, and reported as an improvisation rather than a
        // decision the plan made.
        expect(fake.commands).toContainEqual({ kind: "choose", index: 1 });
        expect(run.taken).toEqual([]);
        expect(run.improvised).toEqual([{ index: 1, text: "Anything", disabled: false }]);
    });

    it("reports the process dying with the host's own classification", async () => {
        const fake = fakeSession((command, push) => {
            if (command.kind === "start") {
                push({ kind: "exit", exit: { reason: "crashed", code: 1, signal: null } });
            }
        });

        await expect(drive({ session: fake.session }).outcome).resolves.toEqual({
            kind: "exited",
            exit: { reason: "crashed", code: 1, signal: null },
        });
    });

    it("separates a story that simply ran out of rows from one that reached an ending", async () => {
        const fake = fakeSession((command, push) => {
            if (command.kind === "start") {
                push({ kind: "game-end" });
            }
        });

        await expect(drive({ session: fake.session }).outcome)
            .resolves.toEqual({ kind: "endedWithoutEnding" });
    });

    it("reads the ending that follows the game ending, not the game ending alone", async () => {
        // An authored ending pushes both, the generic one first. Deciding on that first half would
        // call every ending in the project "the story ended without one".
        const fake = fakeSession((command, push) => {
            if (command.kind === "start") {
                push({ kind: "game-end" });
                push({ kind: "ending", endingId: "ending-target", name: "The End" });
            }
        });

        await expect(drive({ session: fake.session }).outcome).resolves.toEqual({ kind: "reachedTarget" });
    });

    it("gives up at the step ceiling instead of clicking forever", async () => {
        const fake = fakeSession(() => undefined);

        await expect(drive({ session: fake.session, maxSteps: 5 }).outcome)
            .resolves.toEqual({ kind: "stalled", steps: 5 });
        expect(fake.commands.filter(command => command.kind === "advance")).toHaveLength(5);
    });

    it("stops when the author cancels, counting the steps it had taken", async () => {
        const controller = new AbortController();
        let advances = 0;
        const fake = fakeSession(command => {
            if (command.kind === "advance") {
                advances += 1;
                if (advances === 3) {
                    controller.abort();
                }
            }
        });

        await expect(drive({ session: fake.session, signal: controller.signal }).outcome)
            .resolves.toEqual({ kind: "cancelled", steps: 3 });
    });

    it("does not start at all when the run was already cancelled", async () => {
        const controller = new AbortController();
        controller.abort();
        const fake = fakeSession(() => undefined);

        await expect(drive({ session: fake.session, signal: controller.signal }).outcome)
            .resolves.toEqual({ kind: "cancelled", steps: 0 });
        expect(fake.commands).toEqual([]);
    });

    it("stops when nothing is listening on the far end", async () => {
        const session: WalkthroughSession = {
            onEvent: () => () => undefined,
            sendCommand: async () => false,
        };

        await expect(drive({ session }).outcome).resolves.toEqual({ kind: "stalled", steps: 0 });
    });
});
