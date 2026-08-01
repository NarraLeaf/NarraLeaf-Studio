/**
 * The transport's half of the audio track model.
 *
 * Everything a `Play Sound` node leaves unwired is supposed to come from the track, and everything a
 * graph written before tracks existed said is supposed to keep meaning what it meant. Both are
 * invisible at the node - the node just forwards `undefined` - so this is where they can be proved.
 *
 * The other thing guarded here is the volume write after `playSound`. `LiveGame.playSound` forwards
 * to `AudioManager.playSoundToken` with its default `{end: 1}`, which sets the token to full volume
 * regardless of the `Sound`'s configured volume; without the explicit write the track gain and the
 * Volume pin are both silently discarded.
 */
import { describe, expect, it, vi } from "vitest";
import type { ProjectAudioTrack } from "@shared/types/audioTrack";
import type { LiveGame } from "narraleaf-react";
import { createSoundTransport, resolveSoundPlayback } from "./soundTransport";

const AMBIENCE: ProjectAudioTrack = {
    id: "ambience",
    name: "Ambience",
    channel: "sound",
    gain: 0.5,
    fadeInMs: 2000,
    fadeOutMs: 3000,
    loop: true,
};

const TRACKS: ProjectAudioTrack[] = [
    { id: "music", name: "Music", channel: "bgm", gain: 1, fadeInMs: 800, fadeOutMs: 800, loop: true, builtin: true },
    { id: "sfx", name: "SFX", channel: "sound", gain: 1, fadeInMs: 0, fadeOutMs: 0, loop: false, builtin: true },
    { id: "voice", name: "Voice", channel: "voice", gain: 1, fadeInMs: 0, fadeOutMs: 0, loop: false, builtin: true },
    AMBIENCE,
];

describe("resolveSoundPlayback", () => {
    it("takes bus, loop and fade from the track when nothing is wired", () => {
        expect(resolveSoundPlayback({ assetId: "a1", audioTrackId: "music" }, TRACKS)).toEqual({
            channel: "bgm",
            volume: 1,
            fadeInMs: 800,
            fadeOutMs: 800,
            loop: true,
        });
    });

    it("multiplies the authored volume by the track gain", () => {
        // The clamp is on the product, which is the whole reason exposing the gain is worth it.
        expect(resolveSoundPlayback({ assetId: "a1", audioTrackId: "ambience", volume: 0.8 }, TRACKS).volume)
            .toBeCloseTo(0.4);
    });

    it("lets a wired pin override the track's loop and fade-in", () => {
        const playback = resolveSoundPlayback(
            { assetId: "a1", audioTrackId: "ambience", loop: false, fadeInMs: 0 },
            TRACKS,
        );

        expect(playback.loop).toBe(false);
        // An explicit 0 is a real request ("start at full volume now"), not "unset".
        expect(playback.fadeInMs).toBe(0);
        // A play carries only a fade-in; the track's fade-out still governs the eventual stop.
        expect(playback.fadeOutMs).toBe(3000);
    });

    it("maps a pre-track soundChannel to that channel's built-in", () => {
        // The legacy arm: a graph that reached the runtime unmigrated must still land on the BGM
        // bus and inherit Music's loop-and-fade defaults.
        expect(resolveSoundPlayback({ assetId: "a1", channel: "bgm" }, TRACKS)).toMatchObject({
            channel: "bgm",
            loop: true,
            fadeInMs: 800,
        });
    });

    it("prefers an explicit track over a legacy channel", () => {
        expect(resolveSoundPlayback({ assetId: "a1", audioTrackId: "voice", channel: "bgm" }, TRACKS).channel)
            .toBe("voice");
    });

    it("falls back to the built-ins when the host carries no track list", () => {
        expect(resolveSoundPlayback({ assetId: "a1", audioTrackId: "music" }, undefined)).toMatchObject({
            channel: "bgm",
            loop: true,
        });
        // A deleted track is not a reason to go silent.
        expect(resolveSoundPlayback({ assetId: "a1", audioTrackId: "gone" }, TRACKS).channel).toBe("sound");
    });
});

type TokenStub = {
    setVolume: ReturnType<typeof vi.fn>;
    fade: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
};

function createHarness(tracks: ProjectAudioTrack[] = TRACKS) {
    const token: TokenStub = { setVolume: vi.fn(), fade: vi.fn(), stop: vi.fn() };
    const created: unknown[] = [];
    const liveGame = { playSound: vi.fn(async () => token) } as unknown as LiveGame;
    const transport = createSoundTransport({
        getLiveGame: () => liveGame,
        resolveAssetUrl: () => "blob:clip",
        getAudioTracks: () => tracks,
        createSound: input => {
            created.push(input);
            return input;
        },
        log: () => undefined,
    });
    return { transport, token, created };
}

describe("createSoundTransport play", () => {
    it("builds the Sound on the track's bus and writes the resolved volume onto the token", async () => {
        const { transport, token, created } = createHarness();

        await transport.play({ assetId: "a1", audioTrackId: "ambience", volume: 0.8, fadeInMs: 0 });

        expect(created[0]).toMatchObject({ channel: "sound", loop: true, volume: 0.4, assetId: "a1" });
        // Without this the engine's `{end: 1}` default leaves the clip at full volume.
        expect(token.setVolume).toHaveBeenCalledWith(0.4);
        expect(token.fade).not.toHaveBeenCalled();
    });

    it("ramps from silence to the resolved volume when the track has a fade-in", async () => {
        const { transport, token } = createHarness();

        await transport.play({ assetId: "a1", audioTrackId: "music" });

        expect(token.setVolume).toHaveBeenCalledWith(0);
        expect(token.fade).toHaveBeenCalledWith(0, 1, 800);
    });

    it("honours a fade-in of zero rather than the track's default", async () => {
        const { transport, token } = createHarness();

        await transport.play({ assetId: "a1", audioTrackId: "music", fadeInMs: 0 });

        expect(token.fade).not.toHaveBeenCalled();
        expect(token.setVolume).toHaveBeenCalledWith(1);
    });
});
