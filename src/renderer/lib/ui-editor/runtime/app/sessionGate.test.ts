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
    stageVisible: { current: false }
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

    expect(() => gate.requireLiveGame("Save Game")).toThrow(
      "Save Game: game runtime is not available"
    );
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

  it("names the operation in the failure, because an author reads it in the issues panel", () => {
    const gate = createSessionGate<LiveGameStub>(createRefs());
    expect(() => gate.requireLiveGame("Set Sentence Speed")).toThrow(
      "Set Sentence Speed: game runtime is not available"
    );
  });
});
