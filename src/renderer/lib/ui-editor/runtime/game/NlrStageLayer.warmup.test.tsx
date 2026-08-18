// @vitest-environment jsdom
/**
 * Boot-time stage warm-up. NLR derives its preload set from the *mounted* scene, and nothing is
 * mounted until `newGame()` — so unless the layer hands the preloader the entry scene while the
 * host is still on its loading step, the whole fetch/base64/decode pass for the first scene lands
 * between "Start Game" and the first painted frame (~1s on a real project).
 */
import type { ReactNode } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NlrStageLayer, type NlrStageSession } from "./NlrStageLayer";

const captured = vi.hoisted(() => ({
  props: null as { onReady?: (ctx: unknown) => void } | null
}));

vi.mock("narraleaf-react", () => ({
  DevTools: { setActionId: vi.fn() },
  GameProviders: ({ children }: { children?: ReactNode }) => <>{children}</>,
  Player: (props: { children?: ReactNode; onReady?: (ctx: unknown) => void }) => {
    captured.props = props;
    return <div data-testid="nlr-player">{props.children}</div>;
  }
}));

afterEach(cleanup);

const NOOP = () => undefined;
const ENTRY_SCENE = { id: "entry-scene" };

function makeGameState(overrides?: Partial<Record<"preloadingScene" | "lastScene", unknown>>) {
  return {
    preloadScene: vi.fn(),
    getPreloadingScene: vi.fn(() => overrides?.preloadingScene ?? null),
    getLastScene: vi.fn(() => overrides?.lastScene ?? null)
  };
}

function makeSession(): NlrStageSession {
  return {
    id: "session-1",
    game: {} as NlrStageSession["game"],
    compiled: {
      story: {},
      scene: ENTRY_SCENE,
      actionIdBindings: []
    } as unknown as NlrStageSession["compiled"],
    width: 1280,
    height: 720
  };
}

function renderLayer(onError = NOOP as (error: Error, sessionId: string) => void) {
  const onLiveGameReady = vi.fn();
  const result = render(
    <NlrStageLayer
      session={makeSession()}
      interactive={false}
      visible={false}
      renderOnStage={false}
      onLiveGameReady={onLiveGameReady}
      onEnvironmentReady={NOOP}
      onFirstSceneReady={NOOP}
      onError={onError}
    />
  );
  return { ...result, onLiveGameReady };
}

async function fireReady(gameState: unknown) {
  await act(async () => {
    captured.props?.onReady?.({ gameState, liveGame: {} });
  });
}

beforeEach(() => {
  captured.props = null;
});

describe("NlrStageLayer boot warm-up", () => {
  it("registers the compiled entry scene with the preloader as soon as the Player is ready", async () => {
    const gameState = makeGameState();
    renderLayer();
    await fireReady(gameState);

    expect(gameState.preloadScene).toHaveBeenCalledWith(ENTRY_SCENE);
  });

  it("still hands the live game to the host", async () => {
    const gameState = makeGameState();
    const { onLiveGameReady } = renderLayer();
    await fireReady(gameState);

    expect(onLiveGameReady).toHaveBeenCalledTimes(1);
    expect(onLiveGameReady.mock.calls[0][0]).toBe("session-1");
  });

  it("leaves an engine that already warms the entry scene alone", async () => {
    const gameState = makeGameState({ preloadingScene: ENTRY_SCENE });
    renderLayer();
    await fireReady(gameState);

    expect(gameState.preloadScene).not.toHaveBeenCalled();
  });

  it("does not re-register once a scene is mounted", async () => {
    const gameState = makeGameState({ lastScene: { id: "already-playing" } });
    renderLayer();
    await fireReady(gameState);

    expect(gameState.preloadScene).not.toHaveBeenCalled();
  });

  it("reports a rejected warm-up instead of taking the stage down", async () => {
    const onError = vi.fn();
    const gameState = makeGameState();
    gameState.preloadScene.mockImplementation(() => {
      throw new Error("no entry scene");
    });
    const { onLiveGameReady } = renderLayer(onError);
    await fireReady(gameState);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toBe("no entry scene");
    // The environment still comes up: the game just pays the preload on entry, as before.
    expect(onLiveGameReady).toHaveBeenCalledTimes(1);
  });
});
