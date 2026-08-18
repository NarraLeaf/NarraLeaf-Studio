import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CharacterAppearanceSummary } from "@shared/types/devMode";
import type { CharacterAvatarTable } from "@/lib/workspace/services/character/types";
import {
  AVATAR_BAKE_MAX_PX,
  avatarBakeFingerprint,
  bakeCharacterAvatars,
  type AvatarBakeAppearance,
  type AvatarBakeIO,
  type AvatarRenderer
} from "./avatarBake";

const PRESET: CharacterAppearanceSummary = {
  kind: "preset",
  poses: [
    { id: "p-neutral", name: "Neutral", assetId: "asset-neutral" },
    { id: "p-angry", name: "Angry", assetId: "asset-angry" }
  ],
  defaultPoseId: "p-neutral"
};

/** Every write lands here, so a test can tell a real write from a no-op reconcile. */
function createIO(overrides: Partial<AvatarBakeIO> = {}) {
  const files = new Map<string, Uint8Array>();
  const deleted: string[] = [];
  const io: AvatarBakeIO = {
    assetHash: (assetId) => `hash-of-${assetId}`,
    readProjectFile: async (path) => files.get(path) ?? null,
    projectFileExists: async (path) => files.has(path),
    writeProjectFile: async (path, bytes) => {
      const existing = files.get(path);
      if (
        existing &&
        existing.length === bytes.length &&
        existing.every((b, i) => b === bytes[i])
      ) {
        return false;
      }
      files.set(path, bytes);
      return true;
    },
    deleteProjectFile: async (path) => {
      files.delete(path);
      deleted.push(path);
    },
    ...overrides
  };
  return { io, files, deleted };
}

function appearanceOf(
  summary: CharacterAppearanceSummary,
  avatars: CharacterAvatarTable = {},
  drawList: (selection: { poseId?: string; tags?: Record<string, string> }) => (string | null)[] = (
    selection
  ) => [
    summary.kind === "preset"
      ? (summary.poses.find((pose) => pose.id === selection.poseId)?.assetId ?? null)
      : null
  ]
): AvatarBakeAppearance {
  return {
    summary,
    avatars,
    resolveDrawList: drawList,
    portraitFor: () => undefined
  };
}

describe("bakeCharacterAvatars", () => {
  let render: AvatarRenderer;

  beforeEach(() => {
    render = vi.fn(async () => new Uint8Array([1, 2, 3]));
  });

  it("bakes one PNG per differential, into the project", async () => {
    const { io, files } = createIO();
    const report = await bakeCharacterAvatars(io, render, {
      characterId: "alice",
      appearance: appearanceOf(PRESET)
    });

    expect(report.written.sort()).toEqual(["p-angry", "p-neutral"]);
    expect([...files.keys()].sort()).toEqual([
      "resources/characters/avatars/alice/p-angry.png",
      "resources/characters/avatars/alice/p-neutral.png"
    ]);
    expect(Object.keys(report.avatars).sort()).toEqual(["p-angry", "p-neutral"]);
  });

  it("performs reads only when the character is already current", async () => {
    const { io } = createIO();
    const first = await bakeCharacterAvatars(io, render, {
      characterId: "alice",
      appearance: appearanceOf(PRESET)
    });

    const second = await bakeCharacterAvatars(io, render, {
      characterId: "alice",
      appearance: appearanceOf(PRESET, first.avatars)
    });

    // The baked files are version-controlled project content: a reconcile that rewrote them
    // would show up as a change nobody made, on every panel open.
    expect(second.written).toEqual([]);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("re-bakes when a sprite's bytes change", async () => {
    const { io } = createIO();
    const first = await bakeCharacterAvatars(io, render, {
      characterId: "alice",
      appearance: appearanceOf(PRESET)
    });

    const moved = createIO({
      assetHash: (assetId) => (assetId === "asset-angry" ? "hash-v2" : `hash-of-${assetId}`)
    });
    // Carry the first run's files across so only the fingerprint differs.
    moved.io.projectFileExists = async () => true;
    const second = await bakeCharacterAvatars(moved.io, render, {
      characterId: "alice",
      appearance: appearanceOf(PRESET, first.avatars)
    });

    expect(second.written).toEqual(["p-angry"]);
  });

  it("never bakes a differential the author overrode, and clears its stale bake", async () => {
    const { io, deleted } = createIO();
    const first = await bakeCharacterAvatars(io, render, {
      characterId: "alice",
      appearance: appearanceOf(PRESET)
    });

    // Fresh IO so nothing is current: `p-neutral` must render, and `p-angry` must not. Reusing
    // the first run's store would have skipped both - for two different reasons - and the test
    // would have proved nothing about the override.
    const fresh = createIO();
    (render as ReturnType<typeof vi.fn>).mockClear();
    const second = await bakeCharacterAvatars(fresh.io, render, {
      characterId: "alice",
      appearance: appearanceOf(PRESET, {
        "p-angry": { baked: first.avatars["p-angry"].baked, overrideAssetId: "asset-hand-drawn" }
      })
    });

    expect(render).toHaveBeenCalledTimes(1);
    expect(second.written).toEqual(["p-neutral"]);
    // The override is the answer, so the bake under that key is dead weight on disk.
    expect(second.avatars["p-angry"]).toEqual({ overrideAssetId: "asset-hand-drawn" });
    expect(fresh.deleted).toContain("resources/characters/avatars/alice/p-angry.png");
    expect(deleted).toEqual([]);
  });

  it("reports a differential with no art instead of baking an empty square", async () => {
    const { io, files } = createIO({ assetHash: () => null });
    const report = await bakeCharacterAvatars(io, render, {
      characterId: "alice",
      appearance: appearanceOf(PRESET)
    });

    expect(report.unresolved.sort()).toEqual(["p-angry", "p-neutral"]);
    expect(report.written).toEqual([]);
    expect(files.size).toBe(0);
  });

  it("drops the bake of a differential that no longer exists", async () => {
    const { io, deleted } = createIO();
    const first = await bakeCharacterAvatars(io, render, {
      characterId: "alice",
      appearance: appearanceOf(PRESET)
    });

    const withoutAngry: CharacterAppearanceSummary = {
      kind: "preset",
      poses: [PRESET.kind === "preset" ? PRESET.poses[0] : { id: "x", name: "x", assetId: null }],
      defaultPoseId: "p-neutral"
    };
    const second = await bakeCharacterAvatars(io, render, {
      characterId: "alice",
      appearance: appearanceOf(withoutAngry, first.avatars)
    });

    // Left behind it would ship in the package, referenced by a table nothing rebuilt.
    expect(second.removed).toEqual(["p-angry"]);
    expect(deleted).toContain("resources/characters/avatars/alice/p-angry.png");
    expect(Object.keys(second.avatars)).toEqual(["p-neutral"]);
  });

  it("re-bakes when the file is gone even though the fingerprint matches", async () => {
    const { io } = createIO();
    const first = await bakeCharacterAvatars(io, render, {
      characterId: "alice",
      appearance: appearanceOf(PRESET)
    });

    const wiped = createIO();
    const second = await bakeCharacterAvatars(wiped.io, render, {
      characterId: "alice",
      appearance: appearanceOf(PRESET, first.avatars)
    });

    // A fingerprint alone is not evidence the PNG is there - a teammate may have pulled the
    // appearance without the derived files.
    expect(second.written.sort()).toEqual(["p-angry", "p-neutral"]);
  });
});

describe("avatarBakeFingerprint", () => {
  it("moves when a layer's bytes move", () => {
    const a = avatarBakeFingerprint({ layerHashes: ["h1", "h2"], crop: undefined, maxSize: 256 });
    const b = avatarBakeFingerprint({ layerHashes: ["h1", "h9"], crop: undefined, maxSize: 256 });
    expect(a).not.toBe(b);
  });

  it("moves when the layers are reordered", () => {
    const a = avatarBakeFingerprint({ layerHashes: ["h1", "h2"], crop: undefined, maxSize: 256 });
    const b = avatarBakeFingerprint({ layerHashes: ["h2", "h1"], crop: undefined, maxSize: 256 });
    // Stacking order is what the picture is; this is not a set.
    expect(a).not.toBe(b);
  });

  it("moves when the framing moves", () => {
    const a = avatarBakeFingerprint({ layerHashes: ["h1"], crop: undefined, maxSize: 256 });
    const b = avatarBakeFingerprint({
      layerHashes: ["h1"],
      crop: { x: 0, y: 0, w: 0.5, h: 0.5 },
      maxSize: 256
    });
    expect(a).not.toBe(b);
  });

  it("moves when the resolution ceiling moves", () => {
    // The reason `AVATAR_BAKE_RECIPE` had to be bumped: raising the ceiling changes every
    // picture, and a fingerprint that ignored it would leave every avatar on disk stale.
    const a = avatarBakeFingerprint({ layerHashes: ["h1"], crop: undefined, maxSize: 256 });
    const b = avatarBakeFingerprint({ layerHashes: ["h1"], crop: undefined, maxSize: 1024 });
    expect(a).not.toBe(b);
  });

  it("holds still when nothing that affects the picture changed", () => {
    const crop = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
    expect(avatarBakeFingerprint({ layerHashes: ["h1", null], crop, maxSize: 256 })).toBe(
      avatarBakeFingerprint({ layerHashes: ["h1", null], crop, maxSize: 256 })
    );
  });
});

describe("avatar bake resolution", () => {
  it("hands the renderer a ceiling big enough for a dialog box on a high-DPI screen", async () => {
    // The complaint this pins: every avatar was a 256px square, and the default dialog template
    // lays one out at up to 180 *design* pixels — which a 1920-wide design space on a 4K window
    // scales past 700 device pixels once DPR is applied. 256 was blurry by construction.
    const render = vi.fn<AvatarRenderer>(async () => new Uint8Array([1]));
    await bakeCharacterAvatars(createIO().io, render, {
      characterId: "alice",
      appearance: appearanceOf(PRESET)
    });

    expect(AVATAR_BAKE_MAX_PX).toBeGreaterThanOrEqual(720);
    expect(render).toHaveBeenCalledWith(expect.objectContaining({ maxSize: AVATAR_BAKE_MAX_PX }));
  });
});

describe("per-differential framing", () => {
  const ENTRY_CROP = { x: 0.1, y: 0.1, w: 0.2, h: 0.1 };
  const FALLBACK_CROP = { x: 0.4, y: 0.4, w: 0.2, h: 0.1 };

  /** A pose/profile crop for every target, so the entry's own crop has something to beat. */
  function withFallback(appearance: AvatarBakeAppearance): AvatarBakeAppearance {
    return { ...appearance, portraitFor: () => FALLBACK_CROP };
  }

  /**
   * Bytes that depend on the framing, so "this key was written" means the picture actually
   * changed. A renderer returning a constant would make every rewrite a byte-identical no-op and
   * the reframing assertions would pass without proving anything.
   */
  function cropSensitiveRenderer(): AvatarRenderer {
    return vi.fn<AvatarRenderer>(
      async ({ crop }) => new Uint8Array([crop ? Math.round(crop.x * 100) : 0])
    );
  }

  it("frames a differential by its own crop, not the character's", async () => {
    const render = cropSensitiveRenderer();
    await bakeCharacterAvatars(createIO().io, render, {
      characterId: "alice",
      appearance: withFallback(appearanceOf(PRESET, { "p-angry": { portrait: ENTRY_CROP } }))
    });

    expect(render).toHaveBeenCalledWith(expect.objectContaining({ crop: ENTRY_CROP }));
    expect(render).toHaveBeenCalledWith(expect.objectContaining({ crop: FALLBACK_CROP }));
  });

  it("re-bakes exactly the differential that was reframed", async () => {
    const { io } = createIO();
    const render = cropSensitiveRenderer();
    const first = await bakeCharacterAvatars(io, render, {
      characterId: "alice",
      appearance: withFallback(appearanceOf(PRESET))
    });

    const reframed = {
      ...first.avatars,
      "p-angry": { ...first.avatars["p-angry"], portrait: ENTRY_CROP }
    };
    const second = await bakeCharacterAvatars(io, render, {
      characterId: "alice",
      appearance: withFallback(appearanceOf(PRESET, reframed))
    });

    expect(second.written).toEqual(["p-angry"]);
  });

  it("keeps the author's crop on an entry it rebuilds", async () => {
    // Rebuilding the entry from the fingerprint alone deleted `portrait`, which moved the
    // fingerprint back, which rebuilt it again: the crop and the bake took turns undoing each
    // other and the framing never survived a panel open.
    const { io } = createIO();
    const render = cropSensitiveRenderer();
    const first = await bakeCharacterAvatars(io, render, {
      characterId: "alice",
      appearance: withFallback(appearanceOf(PRESET, { "p-angry": { portrait: ENTRY_CROP } }))
    });
    expect(first.avatars["p-angry"].portrait).toEqual(ENTRY_CROP);

    const second = await bakeCharacterAvatars(io, render, {
      characterId: "alice",
      appearance: withFallback(appearanceOf(PRESET, first.avatars))
    });
    expect(second.avatars["p-angry"].portrait).toEqual(ENTRY_CROP);
    expect(second.written).toEqual([]);
  });

  it("keeps the crop of a differential whose art is missing", async () => {
    // Art can be assigned later; the framing set for it is not the bake's to discard.
    const { io } = createIO({ assetHash: () => null });
    const report = await bakeCharacterAvatars(
      io,
      vi.fn<AvatarRenderer>(async () => null),
      {
        characterId: "alice",
        appearance: appearanceOf(PRESET, { "p-angry": { portrait: ENTRY_CROP } })
      }
    );

    expect(report.unresolved.sort()).toEqual(["p-angry", "p-neutral"]);
    expect(report.avatars["p-angry"]).toEqual({ portrait: ENTRY_CROP });
    expect(report.avatars["p-neutral"]).toBeUndefined();
  });
});
