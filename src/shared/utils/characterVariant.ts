import type { CharacterAppearanceSummary } from "@shared/types/devMode";

/**
 * The asset a `preset` character's pose selection resolves to, or null.
 *
 * Null is a real answer. The model this replaced walked the selection for the first variant that
 * happened to carry an asset and, failing that, returned *any* entry in the map — so a differential
 * that did not exist rendered as some other differential, and the author saw a working sprite
 * instead of a missing one. A selection that names nothing resolvable now resolves to nothing, and
 * the caller reports it.
 */
export function resolvePoseAssetId(
  appearance: CharacterAppearanceSummary | undefined,
  poseId: string | undefined
): string | null {
  if (appearance?.kind !== "preset") {
    return null;
  }
  const wanted = poseId ?? appearance.defaultPoseId ?? appearance.poses[0]?.id;
  if (!wanted) {
    return null;
  }
  return appearance.poses.find((pose) => pose.id === wanted)?.assetId ?? null;
}

/**
 * Fill a partial tag selection out to every axis of a `layered` character.
 *
 * A partial selection is what an expression row stores — only the axes the author touched — because
 * the engine's tag switching is itself incremental: changing the mood leaves the outfit alone. An
 * entry row has to pose the whole character, so it resolves through here first.
 */
export function resolveTagSelection(
  appearance: CharacterAppearanceSummary | undefined,
  partial: Record<string, string> | undefined
): Record<string, string> {
  if (appearance?.kind !== "layered") {
    return {};
  }
  const resolved: Record<string, string> = {};
  for (const axis of appearance.axes) {
    const declared = axis.defaultTagId;
    const valid = declared && axis.tags.some((tag) => tag.id === declared) ? declared : null;
    const tagId = valid ?? axis.tags[0]?.id;
    if (tagId) {
      resolved[axis.id] = tagId;
    }
  }
  for (const [axisId, tagId] of Object.entries(partial ?? {})) {
    const axis = appearance.axes.find((candidate) => candidate.id === axisId);
    if (axis?.tags.some((tag) => tag.id === tagId)) {
      resolved[axisId] = tagId;
    }
  }
  return resolved;
}

/**
 * One src per layer slot, bottom to top, for a layered character under the given tags. `null`
 * entries are layers that draw nothing.
 *
 * Editor surfaces that want a single image have to composite these in order: a layered character
 * has no one asset to show, which is also why the engine's own `Image.getSrcURL` returns null for
 * one.
 */
export function resolveLayerAssetIds(
  appearance: CharacterAppearanceSummary | undefined,
  selection: Record<string, string>
): (string | null)[] {
  if (appearance?.kind !== "layered") {
    return [];
  }
  return appearance.layers
    .filter((layer) => !layer.hidden)
    .map((layer) => {
      if (!layer.axisId) {
        return layer.assetId ?? null;
      }
      const tagId = selection[layer.axisId];
      return (tagId ? layer.options?.[tagId] : null) ?? null;
    });
}

/**
 * A single asset id to stand for a character in a list, a badge or a picker row.
 *
 * For a preset character that is the pose itself. For a layered one there is no such asset, so this
 * answers with the bottom-most layer that draws something — enough to tell two characters apart in
 * a 24px badge, and deliberately not pretending to be the composite. Surfaces that need the real
 * thing composite {@link resolveLayerAssetIds}.
 */
export function representativeAssetId(
  appearance: CharacterAppearanceSummary | undefined,
  selection: { poseId?: string; tags?: Record<string, string> }
): string | null {
  if (appearance?.kind === "preset") {
    return resolvePoseAssetId(appearance, selection.poseId);
  }
  const resolved = resolveTagSelection(appearance, selection.tags);
  return resolveLayerAssetIds(appearance, resolved).find((assetId) => Boolean(assetId)) ?? null;
}
