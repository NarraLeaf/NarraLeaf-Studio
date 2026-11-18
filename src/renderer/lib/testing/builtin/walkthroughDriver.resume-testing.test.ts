import { describe, expect, it, vi } from "vitest";
import type { TestGameCommand, TestGameEvent } from "../types";
import { driveWalkthrough, type WalkthroughSession } from "./walkthroughDriver";

const choice: TestGameEvent = {
    kind: "choice",
    options: [{ index: 0, text: "Continue", disabled: false }],
};

function drive(session: WalkthroughSession, signal: AbortSignal) {
    const onImprovised = vi.fn();
    const onDecision = vi.fn();
    const outcome = driveWalkthrough({
        session,
        signal,
        storyId: "story",
        endingId: "ending",
        plan: { entrySceneId: "scene", sceneIds: ["scene"], decisions: [] },
        onImprovised,
        onDecision,
        wait: async () => undefined,
    });
    return { outcome, onImprovised, onDecision };
}

describe("walkthrough cancellation", () => {
    it("does not act on events replayed after the run was cancelled", async () => {
        const controller = new AbortController();
        controller.abort();
        const commands: TestGameCommand[] = [];
        const session: WalkthroughSession = {
            onEvent: listener => {
                listener(choice);
                return () => undefined;
            },
            sendCommand: async command => {
                commands.push(command);
                return true;
            },
        };

        const run = drive(session, controller.signal);
        await expect(run.outcome).resolves.toEqual({ kind: "cancelled", steps: 0 });
        expect(commands).toEqual([]);
        expect(run.onImprovised).not.toHaveBeenCalled();
    });

    it("does not answer a choice delivered after cancellation during a command", async () => {
        const controller = new AbortController();
        const commands: TestGameCommand[] = [];
        let listener: (event: TestGameEvent) => void = () => undefined;
        const session: WalkthroughSession = {
            onEvent: next => {
                listener = next;
                return () => undefined;
            },
            sendCommand: async command => {
                commands.push(command);
                if (command.kind === "start") {
                    controller.abort();
                    listener(choice);
                }
                return true;
            },
        };

        const run = drive(session, controller.signal);
        await expect(run.outcome).resolves.toEqual({ kind: "cancelled", steps: 0 });
        expect(commands).toEqual([{ kind: "start", storyId: "story", sceneId: "scene" }]);
        expect(run.onImprovised).not.toHaveBeenCalled();
    });

    it.each(["planned", "improvised"] as const)("does not send a %s choice if its callback cancels", async kind => {
        const controller = new AbortController();
        const commands: TestGameCommand[] = [];
        let listener: (event: TestGameEvent) => void = () => undefined;
        const session: WalkthroughSession = {
            onEvent: next => {
                listener = next;
                return () => undefined;
            },
            sendCommand: async command => {
                commands.push(command);
                if (command.kind === "start") {
                    listener(choice);
                }
                return true;
            },
        };
        const decisions = kind === "planned" ? [{
            choiceBlockId: "choice",
            optionBlockId: "option",
            optionIndex: 0,
            optionText: "Continue",
            sceneId: "scene",
            sceneName: "Scene",
        }] : [];

        await expect(driveWalkthrough({
            session,
            signal: controller.signal,
            storyId: "story",
            endingId: "ending",
            plan: { entrySceneId: "scene", sceneIds: ["scene"], decisions },
            onImprovised: () => controller.abort(),
            onDecision: () => controller.abort(),
            wait: async () => undefined,
        })).resolves.toEqual({ kind: "cancelled", steps: 0 });
        expect(commands).toEqual([{ kind: "start", storyId: "story", sceneId: "scene" }]);
    });
});
