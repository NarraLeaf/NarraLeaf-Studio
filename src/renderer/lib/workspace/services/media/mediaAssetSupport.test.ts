import { describe, expect, it } from "vitest";
import { AssetSource, type Asset } from "../assets/types";
import { AssetType } from "../assets/assetTypes";
import type { MediaProbeOutcome } from "@shared/types/mediaProbe";
import type { MediaSupportVerdict } from "@shared/utils/mediaSupport";
import {
  MEDIA_SUPPORT_CACHE_VERSION,
  blocksShipping,
  imageSupportRecord,
  mediaSupportCheckKind,
  mediaSupportRecordFromProbe,
  parseMediaSupportCache,
  pruneMediaSupportCache,
  serializeMediaSupportCache,
  type MediaAssetSupportRecord
} from "./mediaAssetSupport";

function asset(patch: Partial<Asset> & { type: AssetType; name: string }): Asset {
  return {
    id: "00000000-0000-4000-8000-000000000000",
    hash: "h",
    source: AssetSource.Local,
    meta: {},
    tags: [],
    description: "",
    ...patch
  } as Asset;
}

function verdict(patch: Partial<MediaSupportVerdict>): MediaSupportVerdict {
  return {
    tier: "accept",
    reason: "playable",
    container: { names: ["mp4"], demuxable: true, knownUnsupported: false },
    streams: [],
    unsupportedCodecs: [],
    target: null,
    ...patch
  };
}

function probed(
  patch: Partial<MediaSupportVerdict>,
  durationUs: number | null = 1_000
): MediaProbeOutcome {
  return { status: "probed", verdict: verdict(patch), durationUs };
}

describe("mediaSupportCheckKind", () => {
  it("probes sound and video, whatever they are called", () => {
    // The extension is not the criterion for these two: the same .mp4 plays with H.264 inside
    // and is a black rectangle with HEVC inside, so only the bytes can answer.
    expect(mediaSupportCheckKind(asset({ type: AssetType.Video, name: "intro.mp4" }))).toBe(
      "probe"
    );
    expect(mediaSupportCheckKind(asset({ type: AssetType.Audio, name: "theme.mp3" }))).toBe(
      "probe"
    );
    expect(mediaSupportCheckKind(asset({ type: AssetType.Video, name: "recording.mkv" }))).toBe(
      "probe"
    );
  });

  it("checks only the three image formats no browser decodes, by name", () => {
    expect(mediaSupportCheckKind(asset({ type: AssetType.Image, name: "scan.tif" }))).toBe("image");
    expect(mediaSupportCheckKind(asset({ type: AssetType.Image, name: "scan.TIFF" }))).toBe(
      "image"
    );
    expect(mediaSupportCheckKind(asset({ type: AssetType.Image, name: "cursor.xbm" }))).toBe(
      "image"
    );
    // Everything else is passed over rather than probed: ffprobe would describe a PNG happily
    // and the answer would never be news.
    expect(mediaSupportCheckKind(asset({ type: AssetType.Image, name: "sprite.png" }))).toBeNull();
  });

  it("reads the extension off `ext` when the name does not carry one", () => {
    expect(mediaSupportCheckKind(asset({ type: AssetType.Image, name: "scan", ext: "tif" }))).toBe(
      "image"
    );
    // ...and does not append it twice when the name already ends with it.
    expect(
      mediaSupportCheckKind(asset({ type: AssetType.Image, name: "scan.tif", ext: "tif" }))
    ).toBe("image");
  });

  it("has no opinion about fonts, data or anything under Other", () => {
    for (const type of [AssetType.Font, AssetType.JSON, AssetType.Other, AssetType.Model]) {
      expect(mediaSupportCheckKind(asset({ type, name: "thing.bin" }))).toBeNull();
    }
  });
});

describe("imageSupportRecord", () => {
  it("offers a PNG, and promises nothing is lost", () => {
    const record = imageSupportRecord(asset({ type: AssetType.Image, name: "scan.tif" }));

    expect(record).toEqual({
      state: "convertible",
      target: { kind: "image", container: "png" },
      durationUs: null,
      lossy: false
    });
  });
});

describe("mediaSupportRecordFromProbe", () => {
  it("carries the duration through on an accepted file, for a conversion that never comes", () => {
    expect(mediaSupportRecordFromProbe(probed({ tier: "accept" }, 42))).toEqual({
      state: "playable",
      target: null,
      durationUs: 42,
      lossy: false
    });
  });

  it("calls a container swap convertible and not lossy", () => {
    const record = mediaSupportRecordFromProbe(
      probed({
        tier: "remux",
        reason: "container-unsupported",
        target: { kind: "remux", container: "mp4", audioOnly: false }
      })
    );

    expect(record?.state).toBe("convertible");
    expect(record?.lossy).toBe(false);
  });

  it("marks a re-encode lossy, which is the only thing that changes the sentence shown", () => {
    const record = mediaSupportRecordFromProbe(
      probed({
        tier: "reencode",
        reason: "codec-unsupported",
        unsupportedCodecs: ["hevc"],
        target: { kind: "reencode", container: "webm", video: "vp9", audio: "vorbis" }
      })
    );

    expect(record?.state).toBe("convertible");
    expect(record?.lossy).toBe(true);
    expect(record?.target).toEqual({
      kind: "reencode",
      container: "webm",
      video: "vp9",
      audio: "vorbis"
    });
  });

  it("has nothing to offer for a file with no streams", () => {
    const record = mediaSupportRecordFromProbe(
      probed({ tier: "refuse", reason: "no-streams" }, null)
    );

    expect(record).toEqual({ state: "unplayable", target: null, durationUs: null, lossy: false });
  });

  it("answers null when the probe answered nothing at all", () => {
    // The whole point. A host with no ffprobe and a probe that timed out are not evidence that
    // the author's file is broken, and a caller that read them as a verdict would refuse builds
    // on a machine that merely lacks a tool.
    expect(mediaSupportRecordFromProbe(null)).toBeNull();
    expect(
      mediaSupportRecordFromProbe({ status: "unavailable", detail: "", searched: [] })
    ).toBeNull();
    expect(
      mediaSupportRecordFromProbe({ status: "failed", reason: "timeout", detail: "" })
    ).toBeNull();
  });
});

describe("blocksShipping", () => {
  it("stops the build for both kinds of unplayable file", () => {
    expect(
      blocksShipping({
        state: "convertible",
        target: { kind: "image", container: "png" },
        durationUs: null,
        lossy: false
      })
    ).toBe(true);
    expect(
      blocksShipping({ state: "unplayable", target: null, durationUs: null, lossy: false })
    ).toBe(true);
  });

  it("lets a playable file through", () => {
    expect(blocksShipping({ state: "playable", target: null, durationUs: 1, lossy: false })).toBe(
      false
    );
  });
});

describe("the cache", () => {
  const record: MediaAssetSupportRecord = {
    state: "convertible",
    target: { kind: "remux", container: "webm", audioOnly: false },
    durationUs: 900,
    lossy: false
  };

  it("round-trips what it stored", () => {
    const entries = new Map([["hash-a", record]]);
    const parsed = parseMediaSupportCache(
      JSON.parse(JSON.stringify(serializeMediaSupportCache(entries)))
    );

    expect(parsed.get("hash-a")).toEqual(record);
  });

  it("empties itself on a version it does not recognise", () => {
    // Nothing is worth migrating: every entry is reproducible by probing the file again, so a
    // migration would be code written to avoid a few seconds of work once.
    const document = { version: MEDIA_SUPPORT_CACHE_VERSION + 1, entries: { "hash-a": record } };

    expect(parseMediaSupportCache(document).size).toBe(0);
  });

  it("survives a file that is not a cache at all", () => {
    for (const raw of [null, 3, "text", [], {}, { version: MEDIA_SUPPORT_CACHE_VERSION }]) {
      expect(parseMediaSupportCache(raw).size).toBe(0);
    }
  });

  it("drops an entry that would offer a conversion with nothing to convert into", () => {
    const document = {
      version: MEDIA_SUPPORT_CACHE_VERSION,
      entries: {
        broken: { state: "convertible", target: null, durationUs: null, lossy: false },
        fine: record
      }
    };
    const parsed = parseMediaSupportCache(document);

    // A miss costs one probe. A badge offering a conversion the dialog cannot start costs the
    // author's trust in the badge.
    expect(parsed.has("broken")).toBe(false);
    expect(parsed.has("fine")).toBe(true);
  });

  it("drops an entry whose state is not one of the three", () => {
    const document = {
      version: MEDIA_SUPPORT_CACHE_VERSION,
      entries: { odd: { state: "probably-fine", target: null, durationUs: null, lossy: false } }
    };

    expect(parseMediaSupportCache(document).size).toBe(0);
  });

  it("forgets hashes the library no longer holds", () => {
    const entries = new Map([
      ["live", record],
      ["gone", record]
    ]);

    const pruned = pruneMediaSupportCache(entries, new Set(["live"]));

    expect([...pruned.keys()]).toEqual(["live"]);
  });
});
