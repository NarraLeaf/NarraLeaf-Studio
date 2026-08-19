/**
 * The two bridged streams that follow the play head: which clip started, and which line was heard.
 *
 * Both exist so a plugin can keep an account of what the player has experienced without a record of
 * its own construction (the built-in Gallery's music and voice columns are the first callers). The
 * failure they guard against is silent in every environment: a table built from the wrong side of
 * the compile, or a text id that outlives its line, produces a column that never fills or one that
 * fills with the wrong entry, and neither shows up until someone plays the shipped game.
 */

import { describe, expect, it } from "vitest";
import type { LiveGame } from "narraleaf-react";
import type { CompiledNlrStory, NlrActionIdBinding } from "@/lib/ui-editor/runtime/game/storyCompiler";
import { RuntimePluginHostController } from "./runtimePluginHostController";
import type { RuntimePluginEventMap } from "./runtimePluginApi";

const token = { cancel: () => undefined };

type GameStateHandler = (payload: never) => void;

/** The narrow slice of the engine `bindEngineEvents` actually subscribes to. */
function createEngine() {
    const gameStateHandlers = new Map<string, GameStateHandler[]>();
    let currentAction: ((payload: { actionId: string | null }) => void) | null = null;

    const gameState = {
        events: {
            on: (event: string, handler: GameStateHandler) => {
                const bucket = gameStateHandlers.get(event) ?? [];
                bucket.push(handler);
                gameStateHandlers.set(event, bucket);
                return token;
            },
        },
    };
    const liveGame = {
        game: {
            onPreloadComplete: () => token,
            onFirstSceneReady: () => token,
            hooks: { hook: () => token },
        },
        onMenuChoose: () => token,
        onCharacterPrompt: () => token,
        onCurrentActionChange: (handler: (payload: { actionId: string | null }) => void) => {
            currentAction = handler;
            return token;
        },
        getGameState: () => gameState,
    };

    return {
        liveGame: liveGame as unknown as LiveGame,
        reachAction: (actionId: string | null) => currentAction?.({ actionId }),
        fire: (event: string, payload: unknown) => {
            for (const handler of gameStateHandlers.get(event) ?? []) {
                (handler as (value: unknown) => void)(payload);
            }
        },
    };
}

const SCENE = { name: "Scene one" };

function compiledStory(overrides: Partial<CompiledNlrStory> = {}): CompiledNlrStory {
    const bindings: NlrActionIdBinding[] = [
        { action: null, staticId: "action:bgm", blockId: "bgm", audioAssetId: "asset-theme" },
        { action: null, staticId: "action:say", blockId: "say", textId: "text-1" },
        { action: null, staticId: "action:wait", blockId: "wait" },
    ] as unknown as NlrActionIdBinding[];
    return {
        storyId: "story-1",
        scenes: { "scene-1": SCENE },
        actionIdBindings: bindings,
        sceneBackgroundMusicAssetIds: { "scene-1": "asset-scene-music" },
        ...overrides,
    } as unknown as CompiledNlrStory;
}

function attach(compiled: CompiledNlrStory = compiledStory()) {
    const controller = new RuntimePluginHostController({});
    const engine = createEngine();
    const audio: RuntimePluginEventMap["audioPlayed"][] = [];
    const dialogue: RuntimePluginEventMap["dialogueEnd"][] = [];
    controller.host.events?.on("audioPlayed", payload => audio.push(payload));
    controller.host.events?.on("dialogueEnd", payload => dialogue.push(payload));
    controller.attachSession({ liveGame: engine.liveGame, compiled });
    return { controller, engine, audio, dialogue };
}

describe("audioPlayed", () => {
    it("reports the clip a row starts as the play head reaches it", () => {
        const { engine, audio } = attach();

        engine.reachAction("action:bgm");

        expect(audio).toEqual([{ assetId: "asset-theme" }]);
    });

    it("reports a scene's configured music on the mount, which no action carries", () => {
        const { engine, audio } = attach();

        engine.fire("event:state.scene.mount", SCENE);

        expect(audio).toEqual([{ assetId: "asset-scene-music" }]);
    });

    it("says nothing for an action that starts no clip", () => {
        const { engine, audio } = attach();

        engine.reachAction("action:say");
        engine.reachAction("action:wait");
        engine.reachAction(null);

        expect(audio).toEqual([]);
    });

    it("is reported as available wherever a game environment exists", () => {
        const { controller } = attach();

        expect(controller.host.events?.supports("audioPlayed")).toBe(true);
    });
});

describe("dialogueEnd", () => {
    it("names the line that just finished", () => {
        const { engine, dialogue } = attach();

        engine.reachAction("action:say");
        engine.fire("event:state.player.lineEnd", undefined);

        expect(dialogue).toEqual([{ textId: "text-1" }]);
    });

    it("survives an action running between the line and its end", () => {
        // The engine steps the play head for branch and async actions too, so the id cannot be read
        // back off "whatever is current" when the line ends.
        const { engine, dialogue } = attach();

        engine.reachAction("action:say");
        engine.reachAction("action:wait");
        engine.fire("event:state.player.lineEnd", undefined);

        expect(dialogue).toEqual([{ textId: "text-1" }]);
    });

    it("reports null rather than the previous line's id", () => {
        const { engine, dialogue } = attach();

        engine.reachAction("action:say");
        engine.fire("event:state.player.lineEnd", undefined);
        engine.fire("event:state.player.lineEnd", undefined);

        expect(dialogue).toEqual([{ textId: "text-1" }, { textId: null }]);
    });

    it("forgets the line when the session is replaced", () => {
        const { controller, engine, dialogue } = attach();

        engine.reachAction("action:say");
        controller.detachSession();
        const next = createEngine();
        controller.attachSession({ liveGame: next.liveGame, compiled: compiledStory() });
        next.fire("event:state.player.lineEnd", undefined);

        expect(dialogue).toEqual([{ textId: null }]);
    });
});
