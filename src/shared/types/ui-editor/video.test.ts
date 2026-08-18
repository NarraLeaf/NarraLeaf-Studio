import { describe, expect, it } from "vitest";
import {
  UI_VIDEO_MAX_PLAYBACK_RATE,
  UI_VIDEO_MIN_PLAYBACK_RATE,
  defaultVideoWidgetProps,
  normalizeVideoProps
} from "./video";

describe("UI video prop normalizer", () => {
  it("falls back to defaults for missing and unrecognized values", () => {
    expect(normalizeVideoProps(undefined)).toEqual(defaultVideoWidgetProps);
    expect(normalizeVideoProps({ objectFit: "scale-down", preload: "eager" })).toMatchObject({
      objectFit: defaultVideoWidgetProps.objectFit,
      preload: defaultVideoWidgetProps.preload
    });
  });

  it("treats blank and non-string asset ids as absent", () => {
    expect(normalizeVideoProps({ assetId: "   ", posterAssetId: 7 })).toMatchObject({
      assetId: null,
      posterAssetId: null
    });
    expect(normalizeVideoProps({ assetId: "  clip-1  ", posterAssetId: "poster-1" })).toMatchObject(
      {
        assetId: "clip-1",
        posterAssetId: "poster-1"
      }
    );
  });

  it("clamps volume into 0-1 and playback rate into the range Chromium accepts", () => {
    expect(normalizeVideoProps({ volume: 4 }).volume).toBe(1);
    expect(normalizeVideoProps({ volume: -1 }).volume).toBe(0);
    expect(normalizeVideoProps({ volume: 0.35 }).volume).toBe(0.35);

    // Assigning outside this window throws NotSupportedError, which would break the whole
    // renderer effect rather than merely play at the wrong speed.
    expect(normalizeVideoProps({ playbackRate: 0 }).playbackRate).toBe(UI_VIDEO_MIN_PLAYBACK_RATE);
    expect(normalizeVideoProps({ playbackRate: 999 }).playbackRate).toBe(
      UI_VIDEO_MAX_PLAYBACK_RATE
    );
    expect(normalizeVideoProps({ playbackRate: Number.NaN }).playbackRate).toBe(1);
  });

  it("keeps booleans authored as booleans and ignores truthy strings", () => {
    expect(
      normalizeVideoProps({ loop: true, autoplay: true, muted: true, controls: true })
    ).toMatchObject({
      loop: true,
      autoplay: true,
      muted: true,
      controls: true
    });
    expect(normalizeVideoProps({ loop: "yes" }).loop).toBe(false);
  });
});
