/**
 * The transport's half of the audio track model.
 *
 * A track is a **bus** now, not a preset: it contributes an engine bus id and a loop policy, and
 * nothing else. The two things that could quietly break that are invisible at the node - which
 * forwards `undefined` for every unwired override - so this is where they can be proved:
 *
 * - the track's gain must **not** be folded into the clip. The bus is a gain node the clip is
 *   routed through, so multiplying it in here as well would apply it twice and freeze it at play
 *   time, where no player slider can reach it. That was the first round's defect.
 * - a graph written before tracks existed must keep meaning what it meant, which is what the
 *   legacy `channel` arm is for.
 *
 * The other thing guarded here is the volume write after `playSound`. `LiveGame.playSound` forwards
 * to `AudioManager.playSoundToken` with its default `{end: 1}`, which sets the token to full volume
 * regardless of the `Sound`'s configured volume; without the explicit write the Volume pin is
 * silently discarded.
 */
import { describe, expect, it, vi } from "vitest";
import type { ProjectAudioTrack } from "@shared/types/audioTrack";
import type { LiveGame } from "narraleaf-react";
import { createSoundTransport, resolveSoundPlayback } from "./soundTransport";

/** A child of `sound` with its own gain - the shape the whole feature exists for. */
const AMBIENCE: ProjectAudioTrack = {
  id: "ambience",
  name: "Ambience",
  parentId: "sound",
  volume: 0.5,
  loop: true
};

const TRACKS: ProjectAudioTrack[] = [
  { id: "bgm", name: "Music", parentId: null, volume: 1, loop: true, builtin: true },
  { id: "sound", name: "SFX", parentId: null, volume: 1, loop: false, builtin: true },
  { id: "voice", name: "Voice", parentId: null, volume: 1, loop: false, builtin: true },
  AMBIENCE
];

describe("resolveSoundPlayback", () => {
  it("takes the bus and the loop policy from the track when nothing is wired", () => {
    expect(resolveSoundPlayback({ assetId: "a1", audioTrackId: "bgm" }, TRACKS)).toEqual({
      busId: "bgm",
      volume: 1,
      loop: true,
      fadeInMs: 0
    });
  });

  it("passes the authored volume through instead of multiplying it by the bus gain", () => {
    // Ambience sits at 0.5, and this used to come back 0.4. It must not: the bus applies its
    // own gain live, so folding it in here would apply it twice and put it beyond the reach of
    // the slider that is the entire point of a bus.
    expect(
      resolveSoundPlayback({ assetId: "a1", audioTrackId: "ambience", volume: 0.8 }, TRACKS).volume
    ).toBeCloseTo(0.8);
  });

  it("routes a nested track to its own bus, not to its parent's", () => {
    // `voice/alice` is what the engine needs to see; collapsing it to `voice` would put the
    // whole cast back on one fader.
    expect(resolveSoundPlayback({ assetId: "a1", audioTrackId: "ambience" }, TRACKS).busId).toBe(
      "ambience"
    );
  });

  it("lets a wired pin override the track's loop, and treats an explicit 0 fade as a request", () => {
    const playback = resolveSoundPlayback(
      { assetId: "a1", audioTrackId: "ambience", loop: false, fadeInMs: 0 },
      TRACKS
    );

    expect(playback.loop).toBe(false);
    expect(playback.fadeInMs).toBe(0);
  });

  it("starts hard when no fade is wired", () => {
    // A track carries no fade any more, so there is no category-level default to inherit -
    // exactly the behaviour before that field was invented.
    expect(resolveSoundPlayback({ assetId: "a1", audioTrackId: "bgm" }, TRACKS).fadeInMs).toBe(0);
  });

  it("maps a pre-track soundChannel to that channel's seeded bus", () => {
    // The legacy arm: a graph that reached the runtime unmigrated must still land on the BGM
    // bus and inherit Music's loop default.
    expect(resolveSoundPlayback({ assetId: "a1", channel: "bgm" }, TRACKS)).toMatchObject({
      busId: "bgm",
      loop: true
    });
  });

  it("resolves a v1 track id through the alias table", () => {
    // v1 seeded `music`/`sfx`; the stored references in graphs were never rewritten, so the
    // old spelling has to keep landing on the bus that took its place.
    expect(resolveSoundPlayback({ assetId: "a1", audioTrackId: "music" }, TRACKS).busId).toBe(
      "bgm"
    );
    expect(resolveSoundPlayback({ assetId: "a1", audioTrackId: "sfx" }, TRACKS).busId).toBe(
      "sound"
    );
  });

  it("prefers an explicit track over a legacy channel", () => {
    expect(
      resolveSoundPlayback({ assetId: "a1", audioTrackId: "voice", channel: "bgm" }, TRACKS).busId
    ).toBe("voice");
  });

  it("falls back to the built-ins when the host carries no track list", () => {
    expect(resolveSoundPlayback({ assetId: "a1", audioTrackId: "bgm" }, undefined)).toMatchObject({
      busId: "bgm",
      loop: true
    });
    // A deleted track is not a reason to go silent.
    expect(resolveSoundPlayback({ assetId: "a1", audioTrackId: "gone" }, TRACKS).busId).toBe(
      "sound"
    );
  });
});

type TokenStub = {
  setVolume: ReturnType<typeof vi.fn>;
  fade: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
};

type MixerStub = {
  getVolume: ReturnType<typeof vi.fn>;
  setVolume: ReturnType<typeof vi.fn>;
};

function createHarness(tracks: ProjectAudioTrack[] = TRACKS) {
  const token: TokenStub = { setVolume: vi.fn(), fade: vi.fn(), stop: vi.fn() };
  const created: unknown[] = [];
  const mixer: MixerStub = { getVolume: vi.fn(() => 0.25), setVolume: vi.fn() };
  const liveGame = {
    playSound: vi.fn(async () => token),
    game: { audioBuses: mixer }
  } as unknown as LiveGame;
  const logged: string[] = [];
  const transport = createSoundTransport({
    getLiveGame: () => liveGame,
    resolveAssetUrl: () => "blob:clip",
    getAudioTracks: () => tracks,
    createSound: (input) => {
      created.push(input);
      return input;
    },
    log: (_level, message) => void logged.push(message)
  });
  return { transport, token, created, mixer, logged };
}

describe("createSoundTransport play", () => {
  it("builds the Sound on the track's own bus and writes the authored volume onto the token", async () => {
    const { transport, token, created } = createHarness();

    await transport.play({ assetId: "a1", audioTrackId: "ambience", volume: 0.8, fadeInMs: 0 });

    // `busId`, not a channel enum: the engine routes an arbitrary declared bus by that string.
    expect(created[0]).toMatchObject({ busId: "ambience", loop: true, volume: 0.8, assetId: "a1" });
    // Without this the engine's `{end: 1}` default leaves the clip at full volume.
    expect(token.setVolume).toHaveBeenCalledWith(0.8);
    expect(token.fade).not.toHaveBeenCalled();
  });

  it("ramps from silence to the authored volume when the play asks for a fade-in", async () => {
    const { transport, token } = createHarness();

    await transport.play({ assetId: "a1", audioTrackId: "bgm", fadeInMs: 800 });

    expect(token.setVolume).toHaveBeenCalledWith(0);
    expect(token.fade).toHaveBeenCalledWith(0, 1, 800);
  });

  it("starts at full volume when no fade is wired", async () => {
    const { transport, token } = createHarness();

    await transport.play({ assetId: "a1", audioTrackId: "bgm" });

    expect(token.fade).not.toHaveBeenCalled();
    expect(token.setVolume).toHaveBeenCalledWith(1);
  });
});

describe("createSoundTransport track volume", () => {
  it("reads and writes the bus through the engine's mixer", async () => {
    const { transport, mixer } = createHarness();

    expect(transport.getTrackVolume("ambience")).toBe(0.25);
    await transport.setTrackVolume("ambience", 0.4);
    expect(mixer.setVolume).toHaveBeenCalledWith("ambience", 0.4);
  });

  it("clamps a write into the range the bus gain accepts", async () => {
    const { transport, mixer } = createHarness();

    await transport.setTrackVolume("ambience", 1.5);
    await transport.setTrackVolume("ambience", -1);
    expect(mixer.setVolume.mock.calls).toEqual([
      ["ambience", 1],
      ["ambience", 0]
    ]);
  });

  it("reads unity and warns instead of throwing when there is no mixer", async () => {
    const transport = createSoundTransport({
      getLiveGame: () => null,
      resolveAssetUrl: () => "blob:clip",
      createSound: (input) => input,
      log: () => undefined
    });

    // Unity, not silence: a slider bound before the game boots must sit at the top rather than
    // read to the player as "muted".
    expect(transport.getTrackVolume("ambience")).toBe(1);
    await expect(transport.setTrackVolume("ambience", 0.5)).resolves.toBeUndefined();
  });

  it("does nothing for an empty track id", async () => {
    const { transport, mixer, logged } = createHarness();

    await transport.setTrackVolume("   ", 0.5);
    expect(mixer.setVolume).not.toHaveBeenCalled();
    expect(logged.some((line) => line.includes("Set Track Volume"))).toBe(true);
  });
});
