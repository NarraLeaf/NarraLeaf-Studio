/**
 * Replaying a spoken line never lays a second voice over one still speaking.
 *
 * Before, every `Play Voice` started a fresh take beside whatever was playing: pressing a backlog
 * row's replay twice, or a second row's, or one row while the story's own line was still being
 * read under the backlog page, played two takes at once.
 */
import { describe, expect, it } from "vitest";
import type { LiveGame } from "narraleaf-react";
import {
    createVoiceReplayer,
    sentenceHasVoice,
    stopStoryVoiceTake,
    type VoiceReplayToken,
} from "./voiceReplayPlayback";

type FakeToken = VoiceReplayToken & { unitId: string; stopped: boolean };

function harness(options: { pending?: boolean } = {}) {
    const started: FakeToken[] = [];
    const storyStops: number[] = [];
    let release: (() => void) | null = null;
    const replayer = createVoiceReplayer({
        start: async unitId => {
            if (unitId === "none") {
                return null;
            }
            if (options.pending) {
                await new Promise<void>(resolve => {
                    release = resolve;
                });
            }
            const token: FakeToken = { unitId, stopped: false, stop: () => { token.stopped = true; } };
            started.push(token);
            return token;
        },
        stopStoryVoice: () => {
            storyStops.push(started.length);
        },
    });
    return { replayer, started, storyStops, release: () => release?.() };
}

describe("replaying a spoken line", () => {
    it("stops the replay still speaking before starting the next, the same line included", async () => {
        const { replayer, started } = harness();
        expect(await replayer.play("a")).toBe(true);
        expect(await replayer.play("b")).toBe(true);
        expect(await replayer.play("b")).toBe(true);
        expect(started.map(token => [token.unitId, token.stopped])).toEqual([["a", true], ["b", true], ["b", false]]);
    });

    it("stops the story's own take before every replay", async () => {
        const { replayer, storyStops } = harness();
        await replayer.play("a");
        await replayer.play("b");
        expect(storyStops).toEqual([0, 1]);
    });

    it("stops a replay overtaken while its clip was loading, as soon as it arrives", async () => {
        const { replayer, started, release } = harness({ pending: true });
        const first = replayer.play("a");
        replayer.stop();
        release();
        expect(await first).toBe(false);
        expect(started.map(token => [token.unitId, token.stopped])).toEqual([["a", true]]);
    });

    it("stops the replay in progress when asked to - the story's next voiced line does", async () => {
        const { replayer, started } = harness();
        await replayer.play("a");
        replayer.stop();
        expect(started[0].stopped).toBe(true);
    });

    it("plays nothing for a line with no take", async () => {
        const { replayer, started } = harness();
        expect(await replayer.play("none")).toBe(false);
        expect(await replayer.play("  ")).toBe(false);
        expect(started).toEqual([]);
    });
});

describe("whether the story's next line speaks", () => {
    it("is told by the sentence's unit id or its own clip", () => {
        expect(sentenceHasVoice({ config: { voiceId: "unit" } })).toBe(true);
        expect(sentenceHasVoice({ config: { voice: "clip.ogg" } })).toBe(true);
        expect(sentenceHasVoice({ config: { voiceId: null, voice: null } })).toBe(false);
        expect(sentenceHasVoice(null)).toBe(false);
    });
});

describe("stopping the story's own take", () => {
    function liveGameWith(history: unknown[], playing: Set<string>) {
        const stopped: string[] = [];
        const sounds = new Map<string, { id: string }>();
        const voiceOf = (id: string) => {
            if (!sounds.has(id)) {
                sounds.set(id, { id });
            }
            return sounds.get(id)!;
        };
        const liveGame = {
            getHistory: () => history,
            getGameState: () => ({
                getLastScene: () => ({ getVoice: voiceOf }),
                audioManager: {
                    isPlaying: (sound: { id: string }) => playing.has(sound.id),
                    stop: (sound: { id: string }) => {
                        stopped.push(sound.id);
                    },
                },
            }),
        } as unknown as LiveGame;
        return { liveGame, stopped };
    }
    const say = (voiceId: string | null) => ({ element: { type: "say", voiceId } });

    it("stops the newest voiced line's take while it is playing", () => {
        const { liveGame, stopped } = liveGameWith([say("old"), say("newest"), say(null), { element: { type: "menu" } }], new Set(["newest"]));
        stopStoryVoiceTake(liveGame);
        expect(stopped).toEqual(["newest"]);
    });

    it("leaves a take that has finished, and older ones, alone", () => {
        const { liveGame, stopped } = liveGameWith([say("old"), say("newest")], new Set(["old"]));
        stopStoryVoiceTake(liveGame);
        expect(stopped).toEqual([]);
    });
});
