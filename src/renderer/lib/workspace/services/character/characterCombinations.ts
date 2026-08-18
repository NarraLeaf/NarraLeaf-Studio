import type { CharacterAppearance } from "./CharacterAppearance";
import type { CharacterTagSelection } from "./types";

export type Combination = {
  /** Stable across renames: axis and tag ids, sorted. Doubles as the React key. */
  key: string;
  tags: CharacterTagSelection;
  /** One label per axis, in axis order — what the cell is captioned with. */
  labels: string[];
  /** Names of the layers that draw nothing here *and* draw something somewhere else. */
  missing: string[];
};

/** The identity of a look, independent of axis order and of every display name. */
export function combinationKey(tags: CharacterTagSelection): string {
  return Object.entries(tags)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([axis, tag]) => `${axis}=${tag}`)
    .join(",");
}

export type CombinationSet = {
  combinations: Combination[];
  /** How many the axes actually describe, before the cap. */
  total: number;
  /** Axes in the order the labels follow. */
  axisNames: string[];
};

/**
 * Every look a layered character can strike: the cartesian product of its axes.
 *
 * Capped, because the product explodes — four axes of four tags is 256 composites, each of which
 * decodes a whole stack. The cap is reported rather than applied quietly (`total` vs
 * `combinations.length`), so a truncated grid never reads as a complete one.
 *
 * A cell's `missing` is what makes the grid worth having: a layer that draws under *some* tag but not
 * this one is a hole in the art, whereas a layer that never draws anywhere is a layer the author has
 * not started — the diagnostics panel already says so, and repeating it in every cell would bury the
 * real holes.
 */
export function enumerateCombinations(appearance: CharacterAppearance, limit = 64): CombinationSet {
  const axes = appearance.getAxes().filter((axis) => axis.tags.length > 0);
  if (appearance.getKind() !== "layered" || axes.length === 0) {
    return { combinations: [], total: 0, axisNames: [] };
  }

  const total = axes.reduce((product, axis) => product * axis.tags.length, 1);
  const layers = appearance.getLayers();
  // A layer that draws somewhere is one the author has started; only those can have a hole.
  const started = new Set(
    layers
      .filter((layer) =>
        layer.axisId ? Object.values(layer.options ?? {}).some(Boolean) : Boolean(layer.assetId)
      )
      .map((layer) => layer.id)
  );

  const combinations: Combination[] = [];
  const walk = (index: number, tags: CharacterTagSelection, labels: string[]): void => {
    if (combinations.length >= limit) {
      return;
    }
    if (index === axes.length) {
      const drawn = appearance.resolveDrawList({ tags });
      combinations.push({
        key: combinationKey(tags),
        tags: { ...tags },
        labels: [...labels],
        missing: layers
          .filter((layer, position) => started.has(layer.id) && !drawn[position])
          .map((layer) => layer.name)
      });
      return;
    }
    for (const tag of axes[index].tags) {
      walk(index + 1, { ...tags, [axes[index].id]: tag.id }, [...labels, tag.name]);
    }
  };
  walk(0, {}, []);

  return { combinations, total, axisNames: axes.map((axis) => axis.name) };
}
