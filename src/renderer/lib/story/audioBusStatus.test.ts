import { describe, expect, it } from "vitest";
import type { ProjectAudioTrack } from "@shared/types/audioTrack";
import { BUILTIN_AUDIO_TRACKS } from "@shared/types/audioTrack";
import { audioBusStatusLine } from "./audioBusStatus";

/** Keys back, not prose: what is asserted is WHICH slider is named, not how it is worded. */
const t = ((key: string) => key) as never;

function tracks(...extra: ProjectAudioTrack[]): ProjectAudioTrack[] {
  return [...BUILTIN_AUDIO_TRACKS, ...extra];
}

const ALICE: ProjectAudioTrack = {
  id: "t_alice",
  name: "Alice",
  parentId: "voice",
  volume: 1,
  loop: false
};
const WHISPER: ProjectAudioTrack = {
  id: "t_whisper",
  name: "Whisper",
  parentId: "t_alice",
  volume: 0.5,
  loop: false
};
const FIELD: ProjectAudioTrack = {
  id: "t_field",
  name: "Field",
  parentId: null,
  volume: 1,
  loop: false
};

describe("audioBusStatusLine", () => {
  it("names the row's own bus first and the player's slider last", () => {
    expect(audioBusStatusLine(t, tracks(ALICE), "t_alice", "sound")).toBe(
      "Alice → Voice · project.audio.slider.voice"
    );
  });

  it("keeps the seeded slider however many buses of the author's own sit between", () => {
    // The engine's own slot check walks all the way up, so the slider has to as well - stopping
    // at the nearest bus would tell the author to look for a "Whisper Volume" that does not exist.
    expect(audioBusStatusLine(t, tracks(ALICE, WHISPER), "t_whisper", "sound")).toBe(
      "Whisper → Alice → Voice · project.audio.slider.voice"
    );
  });

  it("falls back to the global volume for a bus that reaches master through none of the three", () => {
    expect(audioBusStatusLine(t, tracks(FIELD), "t_field", "sound")).toBe(
      "Field · project.audio.slider.global"
    );
  });

  it("answers the caller's own fallback when the row names no track, and when it names a dead one", () => {
    expect(audioBusStatusLine(t, tracks(), undefined, "bgm")).toBe(
      "Music · project.audio.slider.bgm"
    );
    // A deleted track is not a broken row: it resolves to the seeded bus for the row's shape.
    expect(audioBusStatusLine(t, tracks(), "t_gone", "sound")).toBe(
      "SFX · project.audio.slider.sound"
    );
  });

  it("says nothing about volume", () => {
    // The previous line printed the authored volume pre-multiplied by the track's gain. That
    // product no longer exists - a bus applies live - so any number here would be one the author
    // never typed and could not find on any surface.
    const quiet: ProjectAudioTrack = {
      id: "t_quiet",
      name: "Quiet",
      parentId: "bgm",
      volume: 0.25,
      loop: false
    };
    expect(audioBusStatusLine(t, tracks(quiet), "t_quiet", "bgm")).not.toMatch(/[0-9]/);
  });
});
