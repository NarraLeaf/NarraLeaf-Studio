/**
 * The gate exists because of one shipped defect: a Game UI slot surface keeps the host callbacks it
 * was built with for the whole life of its session, so a gate that reads anything captured at build
 * time answers "no game" forever. The skeleton template's quick menu showed it — Auto and Skip did
 * nothing at all, with no diagnostic anywhere, while Log / Save / Load / Config (which never ask for
 * the live game) worked from the same six-button row.
 *
 * So the load-bearing case here is the first one: build the gate *before* anything exists, then
 * populate the refs, and it has to say yes.
 */
import { describe, expect, it } from "vitest";
import { createSessionGate } from "./sessionGate";

type LiveGameStub = { id: string };

function createRefs() {
    return {
        sessionId: { current: null as string | null },
        liveGameSessionId: { current: null as string | null },
        liveGame: { current: null as LiveGameStub | null },
        stageVisible: { current: false },
        gameEntered: { current: false },
    };
}

/** What `mountNlrSession` does, in the order it does it. */
function mount(refs: ReturnType<typeof createRefs>, sessionId: string): LiveGameStub {
    const liveGame = { id: sessionId };
    refs.sessionId.current = sessionId;
    refs.liveGame.current = liveGame;
    refs.liveGameSessionId.current = sessionId;
    refs.stageVisible.current = true;
    return liveGame;
}

/** What `enterMountedGame` does afterwards, which a boot preload never does. */
function enter(refs: ReturnType<typeof createRefs>): void {
    refs.gameEntered.current = true;
}

describe("createSessionGate", () => {
    it("answers for a session mounted after it was built", () => {
        const refs = createRefs();
        const gate = createSessionGate<LiveGameStub>(refs);

        expect(gate.isInGame()).toBe(false);
        expect(() => gate.requireLiveGame("Skip")).toThrow("Skip: game runtime is not available");

        const liveGame = mount(refs, "session-1");

        expect(gate.isInGame()).toBe(true);
        expect(gate.requireLiveGame("Skip")).toBe(liveGame);
    });

    it("keeps answering across a relaunch, without being rebuilt", () => {
        const refs = createRefs();
        const gate = createSessionGate<LiveGameStub>(refs);
        mount(refs, "session-1");

        // Teardown: the stage goes first, then the session.
        refs.stageVisible.current = false;
        refs.sessionId.current = null;
        refs.liveGame.current = null;
        refs.liveGameSessionId.current = null;
        expect(gate.isInGame()).toBe(false);
        expect(() => gate.requireLiveGame("Set Auto Forward")).toThrow(/game runtime is not available/);

        const second = mount(refs, "session-2");
        expect(gate.requireLiveGame("Set Auto Forward")).toBe(second);
    });

    it("refuses a live game left over from a superseded session", () => {
        const refs = createRefs();
        const gate = createSessionGate<LiveGameStub>(refs);
        mount(refs, "session-1");

        // A relaunch has named the new session but its game has not reported ready yet, so what is
        // still in `liveGame` belongs to the one being torn down.
        refs.sessionId.current = "session-2";

        expect(() => gate.requireLiveGame("Save Game")).toThrow("Save Game: game runtime is not available");
    });

    it("separates a mounted session from a stage that is on screen", () => {
        const refs = createRefs();
        const gate = createSessionGate<LiveGameStub>(refs);
        mount(refs, "session-1");

        // The boot preload mounts the environment without entering a game; a title screen is not
        // "in game", and a held skip key must not advance the story behind it.
        refs.stageVisible.current = false;
        expect(gate.isInGame()).toBe(false);
        // The live game is still reachable, though — that is a different question.
        expect(gate.requireLiveGame("Get Auto Forward").id).toBe("session-1");
    });

    it("answers that a playthrough is running for a session mounted after it was built", () => {
        // The same defect as the first case, in the question that decides whether changing the
        // language mid-game costs a restart. A copy built before the mount used to answer no, so a
        // language picker in a quick menu switched under a running story and never restarted it.
        const refs = createRefs();
        const gate = createSessionGate<LiveGameStub>(refs);

        expect(gate.isPlaythroughRunning()).toBe(false);

        mount(refs, "session-1");
        // Mounted and on screen, but the boot preload never entered a game: there is nothing to
        // serialize, and changing the language here is free.
        expect(gate.isPlaythroughRunning()).toBe(false);

        enter(refs);
        expect(gate.isPlaythroughRunning()).toBe(true);
    });

    it("says no playthrough is running while a relaunch is between sessions", () => {
        const refs = createRefs();
        const gate = createSessionGate<LiveGameStub>(refs);
        mount(refs, "session-1");
        enter(refs);

        // The new session is named before its game reports ready; what is in `liveGame` belongs to
        // the one being torn down, and serializing it would save the wrong run.
        refs.sessionId.current = "session-2";
        expect(gate.isPlaythroughRunning()).toBe(false);
    });

    it("separates having a live game from playing one, for a caller waiting on an environment", () => {
        // What the language-restart resume asks while it waits: a boot preload mounts a live game
        // it never enters, and that is exactly the state a parked run has to be loaded into.
        const refs = createRefs();
        const gate = createSessionGate<LiveGameStub>(refs);

        expect(gate.hasLiveGame()).toBe(false);
        mount(refs, "session-1");
        expect(gate.hasLiveGame()).toBe(true);
        expect(gate.isPlaythroughRunning()).toBe(false);
    });

    it("names the operation in the failure, because an author reads it in the issues panel", () => {
        const gate = createSessionGate<LiveGameStub>(createRefs());
        expect(() => gate.requireLiveGame("Set Sentence Speed"))
            .toThrow("Set Sentence Speed: game runtime is not available");
    });
});
