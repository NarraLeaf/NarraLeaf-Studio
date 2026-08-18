import { fnv1aHex } from "@shared/utils/contentHash";
import {
  characterAvatarBakePath,
  characterAvatarTargets,
  type CharacterAvatarTarget
} from "@shared/utils/characterAvatar";
import type { CharacterAppearanceSummary } from "@shared/types/devMode";
import type {
  CharacterAvatarEntry,
  CharacterAvatarTable,
  PortraitCrop
} from "@/lib/workspace/services/character/types";

/**
 * Baking a character's dialog avatars — one PNG per differential.
 *
 * This runs at authoring time rather than at build time for the same reason the project icons do:
 * the baked files are project content. They travel in the package and belong in version control, so
 * a teammate who pulls the project gets the avatars without re-deriving them.
 *
 * Which makes byte-stability the whole game. Nothing writes unless the bytes differ, and nothing
 * re-renders unless the fingerprint moved — otherwise opening the character panel would show up as
 * a change nobody made.
 *
 * A layered character has no single image to crop, which is why this exists at all: its avatar has
 * to be composited first, and compositing at runtime for every line of dialogue is not an option.
 */

/**
 * Ceiling on a baked avatar's long edge — **not** a target size.
 *
 * The crop is written at the source sprite's own resolution and is never scaled up; this only
 * bounds the pathological case. It used to be a target of 256, which is where the avatars went
 * soft: a 1088×1984 sprite yields a head crop around 478px, and that was being resampled *down* to
 * 256 before anything displayed it. The dialog then asks for more than that — the default template
 * lays the avatar out at up to 180 *design* pixels, and a 1920-wide design space on a 4K window
 * scales ~2× before device pixel ratio multiplies again, so 700-odd device pixels is an ordinary
 * ask. A 256px source in a 700px box is the blur the author reported.
 *
 * 1024 clears that worst case with headroom (4K at DPR 3) while still bounding a 4000px sprite to
 * about a megabyte instead of ten. The bakes are project content — they travel in the package and
 * in version control — so an unbounded ceiling would be a repository problem, and a power of two
 * is what every downstream texture path prefers anyway.
 */
export const AVATAR_BAKE_MAX_PX = 1024;

/**
 * Bumped when the rendering itself changes (crop rule, size, encoding), so that every existing bake
 * is considered stale even though its sources did not move.
 *
 * `2`: bakes at source resolution under {@link AVATAR_BAKE_MAX_PX} instead of resampling every crop
 * to 256. Without this bump every avatar already on disk would keep its fingerprint and stay soft.
 */
const AVATAR_BAKE_RECIPE = "2";

/** The canvas half, injected so the orchestration below is testable without a DOM. */
export type AvatarRenderer = (input: {
  /** Asset ids to draw, bottom to top; `null` entries draw nothing. */
  layers: readonly (string | null)[];
  /** Author's framing, or undefined to locate the head from the composited silhouette. */
  crop: PortraitCrop | undefined;
  /** Ceiling on the output's long edge. The crop is never scaled up to reach it. */
  maxSize: number;
}) => Promise<Uint8Array | null>;

export interface AvatarBakeIO {
  /**
   * Content hash of an asset, or null when it is missing. Read from the asset record rather than
   * from the bytes: the hash is already stored, and a bake must not decode an image just to find
   * out it did not need to.
   */
  assetHash(assetId: string): string | null;
  readProjectFile(relativePath: string): Promise<Uint8Array | null>;
  projectFileExists(relativePath: string): Promise<boolean>;
  /** Returns true when the bytes actually changed on disk. */
  writeProjectFile(relativePath: string, bytes: Uint8Array): Promise<boolean>;
  deleteProjectFile(relativePath: string): Promise<void>;
}

export type AvatarBakeReport = {
  /** The table to persist onto the appearance. */
  avatars: CharacterAvatarTable;
  /** Keys whose PNG changed on disk. Empty means the character was already current. */
  written: string[];
  /** Keys whose layers could not be drawn — a differential with no art, or an unreadable asset. */
  unresolved: string[];
  /** Keys whose bake was dropped because the differential no longer exists. */
  removed: string[];
};

/**
 * What a bake depends on: the ordered layer hashes, the framing, and the recipe.
 *
 * Layer *ids* are deliberately not in it. Renaming a layer or reordering the axes does not change
 * the picture, and re-baking on a rename would churn the repository for nothing. What changes the
 * picture is which bytes are drawn, in what order, cropped how.
 *
 * The output's pixel size is not in it either, and does not need to be: it is a function of the
 * source resolution and the crop, and the source resolution is a function of the layer bytes —
 * both of which are already here. What is here is the *ceiling*, because that one can move without
 * any of the inputs moving.
 */
export function avatarBakeFingerprint(input: {
  layerHashes: readonly (string | null)[];
  crop: PortraitCrop | undefined;
  /** {@link AVATAR_BAKE_MAX_PX} as it stood for this bake. */
  maxSize: number;
}): string {
  const crop = input.crop
    ? `${input.crop.x},${input.crop.y},${input.crop.w},${input.crop.h}`
    : "auto";
  return fnv1aHex(
    [
      AVATAR_BAKE_RECIPE,
      String(input.maxSize),
      crop,
      input.layerHashes.map((hash) => hash ?? "-").join("|")
    ].join(" ")
  );
}

/**
 * The appearance-side questions the baker asks. Narrower than `CharacterAppearance` on purpose, so
 * the orchestration can be driven from a plain object in a test.
 */
export type AvatarBakeAppearance = {
  summary: CharacterAppearanceSummary;
  /** Asset ids to draw for one selection, bottom to top. */
  resolveDrawList: (selection: CharacterAvatarTarget["selection"]) => (string | null)[];
  /**
   * The framing to fall back to when this differential's own avatar entry carries none: a
   * `preset` pose's crop, then the character-wide one. The entry's crop is applied here rather
   * than by the caller — see {@link bakeCharacterAvatars} — so a caller cannot forget it.
   */
  portraitFor: (target: CharacterAvatarTarget) => PortraitCrop | undefined;
  /** The avatar table as it stands, carrying existing bakes and author overrides. */
  avatars: CharacterAvatarTable;
};

/**
 * Re-attach the author's own fields to an entry the bake rebuilt.
 *
 * The bake owns `baked` and nothing else on the entry. Rebuilding it from the fingerprint alone
 * would delete `portrait` — the framing the author just dragged — on the very next panel open, and
 * the deletion then moves the fingerprint back, so the two would take turns undoing each other
 * forever. Returned undefined when there is nothing left to remember, which is what tells the
 * caller to drop the key rather than persist an empty record.
 */
function withAuthorFields(
  existing: CharacterAvatarEntry | undefined,
  baked: CharacterAvatarEntry
): CharacterAvatarEntry | undefined {
  const entry = existing?.portrait ? { ...baked, portrait: existing.portrait } : baked;
  return Object.keys(entry).length > 0 ? entry : undefined;
}

/** Record an entry, or leave the key absent so the caller drops it. */
function assign(
  table: CharacterAvatarTable,
  key: string,
  entry: CharacterAvatarEntry | undefined
): void {
  if (entry) {
    table[key] = entry;
  }
}

/**
 * Bring every baked avatar in line with the character, and return the table to persist.
 *
 * Safe to call on every character-panel open: a character that is already current performs reads
 * only. A differential the author overrode with their own artwork is never baked — the override is
 * the answer, and rendering a second one would be work whose output nothing reads.
 */
export async function bakeCharacterAvatars(
  io: AvatarBakeIO,
  render: AvatarRenderer,
  input: { characterId: string; appearance: AvatarBakeAppearance }
): Promise<AvatarBakeReport> {
  const { characterId, appearance } = input;
  const targets = characterAvatarTargets(appearance.summary);
  const avatars: CharacterAvatarTable = {};
  const written: string[] = [];
  const unresolved: string[] = [];
  const removed: string[] = [];

  for (const target of targets) {
    const existing: CharacterAvatarEntry | undefined = appearance.avatars[target.key];
    const override = existing?.overrideAssetId?.trim();
    const relativePath = characterAvatarBakePath(characterId, target.key);

    if (override) {
      // The author's own artwork wins, so any bake under this key is dead weight on disk.
      if (existing?.baked) {
        await io.deleteProjectFile(relativePath);
      }
      assign(avatars, target.key, withAuthorFields(existing, { overrideAssetId: override }));
      continue;
    }

    const layers = appearance.resolveDrawList(target.selection);
    const layerHashes = layers.map((assetId) => (assetId ? io.assetHash(assetId) : null));
    if (layerHashes.every((hash) => hash === null)) {
      // Nothing draws: a differential whose art was never assigned, or whose assets are gone.
      // Reported rather than baked as an empty square, and any stale bake is cleared.
      if (existing?.baked) {
        await io.deleteProjectFile(relativePath);
        removed.push(target.key);
      }
      // The bake is gone but the framing is not the bake's to throw away: art can be assigned
      // to this differential later, and the crop the author set for it has to still be there.
      assign(avatars, target.key, withAuthorFields(existing, {}));
      unresolved.push(target.key);
      continue;
    }

    // entry → pose → profile. The entry's crop is the only framing a *layered* character can
    // carry per differential — a tag combination exists only as a key, with no object beside
    // the art to hang a rect on — so it has to win, or reframing one look would be silently
    // overruled by the character-wide crop it was written to override.
    const crop = existing?.portrait ?? appearance.portraitFor(target);
    const fingerprint = avatarBakeFingerprint({ layerHashes, crop, maxSize: AVATAR_BAKE_MAX_PX });
    if (existing?.baked === fingerprint && (await io.projectFileExists(relativePath))) {
      assign(avatars, target.key, withAuthorFields(existing, { baked: fingerprint }));
      continue;
    }

    const bytes = await render({ layers, crop, maxSize: AVATAR_BAKE_MAX_PX });
    if (!bytes) {
      assign(avatars, target.key, withAuthorFields(existing, {}));
      unresolved.push(target.key);
      continue;
    }
    if (await io.writeProjectFile(relativePath, bytes)) {
      written.push(target.key);
    }
    assign(avatars, target.key, withAuthorFields(existing, { baked: fingerprint }));
  }

  // Bakes for differentials that no longer exist. Left on disk they would ship in the package and
  // stay referenced by a table nothing rebuilt.
  const live = new Set(targets.map((target) => target.key));
  for (const [key, entry] of Object.entries(appearance.avatars)) {
    if (live.has(key) || !entry.baked) {
      continue;
    }
    await io.deleteProjectFile(characterAvatarBakePath(characterId, key));
    removed.push(key);
  }

  return { avatars, written, unresolved, removed };
}
