import { describe, expect, it } from "vitest";
import { CharacterAppearance, emptyAppearance } from "./CharacterAppearance";
import { enumerateCombinations } from "./characterCombinations";

/** Two axes of two tags, one layer bound to each. */
function build() {
  const appearance = new CharacterAppearance(emptyAppearance("layered"));
  const outfit = appearance.createAxis("Outfit")!;
  const uniform = appearance.createTag(outfit.id, "Uniform")!;
  const casual = appearance.createTag(outfit.id, "Casual")!;
  const mood = appearance.createAxis("Mood")!;
  const happy = appearance.createTag(mood.id, "Happy")!;
  const angry = appearance.createTag(mood.id, "Angry")!;

  const body = appearance.createLayer("Body", outfit.id)!;
  appearance.setLayerOption(body.id, uniform.id, "uniform.png");
  appearance.setLayerOption(body.id, casual.id, "casual.png");
  const brows = appearance.createLayer("Brows", mood.id)!;
  appearance.setLayerOption(brows.id, happy.id, "happy.png");
  appearance.setLayerOption(brows.id, angry.id, "angry.png");

  return { appearance, outfit, mood, uniform, casual, happy, angry, body, brows };
}

describe("enumerateCombinations", () => {
  it("is the cartesian product of the axes, labelled in axis order", () => {
    const { appearance } = build();
    const { combinations, total, axisNames } = enumerateCombinations(appearance);
    expect(total).toBe(4);
    expect(combinations).toHaveLength(4);
    expect(axisNames).toEqual(["Outfit", "Mood"]);
    expect(combinations.map((c) => c.labels.join("/"))).toEqual([
      "Uniform/Happy",
      "Uniform/Angry",
      "Casual/Happy",
      "Casual/Angry"
    ]);
  });

  it("says nothing for a preset character or an axis with no tags", () => {
    const preset = new CharacterAppearance(emptyAppearance("preset"));
    expect(enumerateCombinations(preset).combinations).toHaveLength(0);

    const bare = new CharacterAppearance(emptyAppearance("layered"));
    bare.createAxis("Outfit");
    expect(enumerateCombinations(bare).combinations).toHaveLength(0);
  });

  it("flags a hole only in a layer that draws somewhere else", () => {
    const { appearance, brows, angry } = build();
    // Brows now has art for Happy but not Angry: the Angry cells are holes.
    appearance.setLayerOption(brows.id, angry.id, null);
    const withHole = enumerateCombinations(appearance).combinations;
    expect(withHole.filter((c) => c.missing.length > 0).map((c) => c.labels.join("/"))).toEqual([
      "Uniform/Angry",
      "Casual/Angry"
    ]);
    expect(withHole[1].missing).toEqual(["Brows"]);

    // A layer that draws nowhere is unfinished, not a hole — the diagnostics panel owns that.
    appearance.setLayerOption(brows.id, appearance.getAxis(brows.axisId!)!.tags[0].id, null);
    expect(
      enumerateCombinations(appearance).combinations.every((c) => c.missing.length === 0)
    ).toBe(true);
  });

  it("caps the grid and still reports the true total", () => {
    const { appearance } = build();
    const capped = enumerateCombinations(appearance, 3);
    expect(capped.combinations).toHaveLength(3);
    expect(capped.total).toBe(4);
  });
});
