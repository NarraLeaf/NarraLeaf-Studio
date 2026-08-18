/**
 * What a variant build is allowed to carry.
 *
 * A demo that merely refuses to *play* the rest of the script still ships it: unpacking a visual
 * novel is a five-minute job, so anything present in the package is public. The scene drop that runs
 * before this file removes the story rows; these helpers remove the three payloads that are keyed by
 * something other than a scene and therefore survive it - translations, voice lines, and the asset
 * library itself.
 *
 * The asset rule here is deliberately **syntactic**: an asset ships when its id occurs anywhere in
 * the bytes that ship. It is not a reference walk. A reference walk has to know every field that can
 * name an asset, and a field it does not know about becomes an asset that silently disappears from
 * a shipped game; the id sweep has no such list to be incomplete about, and its one blind spot - an
 * id the running game computes instead of storing - is a construct the build refuses outright rather
 * than guesses at.
 */

import type { GameLocalizationBundle } from "@shared/types/localization";
import type { GameVoiceBundle } from "@shared/types/voice";

/**
 * Unit id prefixes that name something no scene owns: a UI element's text, a character's display
 * name, an author-named key. A scene drop cannot take any of them away, so they ship whole.
 * Everything without one of these prefixes is a story `textId`, which belongs to exactly one row.
 */
const SCENE_INDEPENDENT_UNIT_PREFIXES = ["ui:", "char:", "key:"] as const;

/**
 * Canonical id shape - assets and characters both. Matched anywhere in a string, so an id embedded
 * in a URL or a bundle path counts.
 */
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export function isSceneIndependentUnitId(unitId: string): boolean {
  return SCENE_INDEPENDENT_UNIT_PREFIXES.some((prefix) => unitId.startsWith(prefix));
}

/**
 * Every `textId` reachable in `value`.
 *
 * A deep key sweep rather than a walk over story block payloads: the set of payload shapes that
 * carry translatable text grows with the command vocabulary, and a walk that missed one would drop
 * that line's translation from every localized build without failing anything.
 */
export function collectTextIds(value: unknown): Set<string> {
  const found = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item);
      }
      return;
    }
    if (!node || typeof node !== "object") {
      return;
    }
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      if (key === "textId" && typeof child === "string" && child) {
        found.add(child);
        continue;
      }
      visit(child);
    }
  };
  visit(value);
  return found;
}

/** Drop translation units whose story row is no longer in the build. */
export function restrictLocalizationToTextIds(
  bundle: GameLocalizationBundle,
  textIds: ReadonlySet<string>
): { bundle: GameLocalizationBundle; removedUnitCount: number } {
  let removedUnitCount = 0;
  const tables: GameLocalizationBundle["tables"] = {};
  for (const [locale, table] of Object.entries(bundle.tables)) {
    const kept: Record<string, string> = {};
    for (const [unitId, target] of Object.entries(table)) {
      if (isSceneIndependentUnitId(unitId) || textIds.has(unitId)) {
        kept[unitId] = target;
      } else {
        removedUnitCount += 1;
      }
    }
    if (Object.keys(kept).length > 0) {
      tables[locale] = kept;
    }
  }
  return { bundle: { ...bundle, tables }, removedUnitCount };
}

/** Drop voice lines whose story row is no longer in the build; their audio then has no reference left. */
export function restrictVoiceToTextIds(
  bundle: GameVoiceBundle,
  textIds: ReadonlySet<string>
): { bundle: GameVoiceBundle; removedUnitCount: number } {
  let removedUnitCount = 0;
  const tables: GameVoiceBundle["tables"] = {};
  for (const [locale, table] of Object.entries(bundle.tables)) {
    const kept: Record<string, string> = {};
    for (const [unitId, assetId] of Object.entries(table)) {
      if (textIds.has(unitId)) {
        kept[unitId] = assetId;
      } else {
        removedUnitCount += 1;
      }
    }
    if (Object.keys(kept).length > 0) {
      tables[locale] = kept;
    }
  }
  return { bundle: { ...bundle, tables }, removedUnitCount };
}

/**
 * The library assets named by `payload`.
 *
 * `payload` must be everything the package will carry **except** the maps that are keyed by asset id
 * over the whole library - an asset name table lists every asset by construction, so sweeping it
 * would answer "all of them" no matter what the story does. Those maps are narrowed to this result
 * afterwards; being subsets of it, they add nothing back.
 */
export function collectReferencedAssetIds(
  payload: unknown,
  libraryAssetIds: ReadonlySet<string>
): Set<string> {
  return collectReferencedIds(payload, libraryAssetIds);
}

/**
 * Every id from `knownIds` that occurs anywhere in `payload`.
 *
 * The same syntactic rule the asset sweep is built on, applied to whichever id space the caller
 * names. Characters use it for the reason assets do: the set of places that can name one grows with
 * the command vocabulary and the widget library, and a walk that missed a place would ship a
 * character - and therefore that character's portraits - out of an edition that cannot reach them,
 * or worse, drop one an edition can.
 */
export function collectReferencedIds(payload: unknown, knownIds: ReadonlySet<string>): Set<string> {
  const referenced = new Set<string>();
  if (knownIds.size === 0) {
    return referenced;
  }
  const text = JSON.stringify(payload) ?? "";
  for (const match of text.matchAll(UUID_PATTERN)) {
    const candidate = match[0];
    if (knownIds.has(candidate)) {
      referenced.add(candidate);
      continue;
    }
    // Ids are stored lower-case; a hand-written document may not be.
    const lowered = candidate.toLowerCase();
    if (knownIds.has(lowered)) {
      referenced.add(lowered);
    }
  }
  return referenced;
}

/**
 * Drop the display name of every character this edition does not carry.
 *
 * `char:` units survive the scene drop by construction - they belong to a character, not to a row -
 * so an edition that stops shipping a character still shipped their name in every language. The
 * name is often the spoiler ("who is in chapter three"), which is the whole reason the character was
 * dropped.
 *
 * A unit whose id is not `char:<known character>` is left alone: `ui:` and `key:` are other spaces
 * entirely, and a `char:` id belonging to no character at all is a stale row this is not the place
 * to tidy.
 */
export function restrictCharacterUnits(
  bundle: GameLocalizationBundle,
  characterIds: ReadonlySet<string>
): { bundle: GameLocalizationBundle; removedUnitCount: number } {
  let removedUnitCount = 0;
  const tables: GameLocalizationBundle["tables"] = {};
  for (const [locale, table] of Object.entries(bundle.tables)) {
    const kept: Record<string, string> = {};
    for (const [unitId, target] of Object.entries(table)) {
      if (isDroppedCharacterUnitId(unitId, characterIds)) {
        removedUnitCount += 1;
        continue;
      }
      kept[unitId] = target;
    }
    tables[locale] = kept;
  }
  return { bundle: { ...bundle, tables }, removedUnitCount };
}

function isDroppedCharacterUnitId(unitId: string, characterIds: ReadonlySet<string>): boolean {
  if (!unitId.startsWith("char:")) {
    return false;
  }
  const characterId = unitId.slice("char:".length).split(":")[0];
  return characterId.length > 0 && !characterIds.has(characterId);
}

/** Keep only the entries whose key is a shipped asset. */
export function restrictRecordToAssetIds<T>(
  record: Readonly<Record<string, T>>,
  assetIds: ReadonlySet<string>
): { record: Record<string, T>; removedCount: number } {
  const kept: Record<string, T> = {};
  let removedCount = 0;
  for (const [assetId, value] of Object.entries(record)) {
    if (assetIds.has(assetId)) {
      kept[assetId] = value;
    } else {
      removedCount += 1;
    }
  }
  return { record: kept, removedCount };
}
