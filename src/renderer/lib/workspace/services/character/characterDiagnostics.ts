import type { CharacterAppearance } from "./CharacterAppearance";
import { enumerateCombinations } from "./characterCombinations";
import type { CharacterTagSelection } from "./types";
import { characterAvatarAxisIds } from "@shared/utils/characterAvatar";

export type LayerSize = { width: number; height: number };

/**
 * What a diagnostic row selects when it is clicked.
 *
 * `tags` exists because half the layered findings are about *a look* rather than about an object in
 * the inspector: "this combination draws nothing" highlighted a card and left the preview on whatever
 * was already showing, so the author read a complaint about a picture they could not see. A target
 * carrying a selection puts the offending look on screen, which for a layered character is the whole
 * point of clicking the row. `kind: "combination"` names no inspector card on purpose — the picture
 * *is* the target.
 */
export type CharacterDiagnosticTarget = {
  kind: "layer" | "axis" | "pose" | "combination";
  id: string;
  /** Layered only: the tag selection that shows what the finding is about. */
  tags?: CharacterTagSelection;
};

export type CharacterDiagnostic = {
  /** Which message to render. The editor owns the wording; this module owns the finding. */
  code:
    | "offCanvas"
    | "constantNoImage"
    | "layerNoImage"
    | "axisNoTags"
    | "axisUnused"
    | "duplicateTag"
    | "occluded"
    | "avatarCombinations"
    | "combinationNoArt"
    | "axisDefaultMissing"
    | "duplicateAxis"
    | "snapshotStale"
    | "poseNoImage"
    | "noPoses"
    | "defaultPoseMissing"
    | "duplicatePose";
  severity: "error" | "warning";
  /**
   * What to select when the author clicks the row, or `null` when the finding names no single
   * object — "this character has no poses" is about the absence, and there is nothing to jump to.
   */
  target: CharacterDiagnosticTarget | null;
  values: Record<string, string>;
};

function format(size: LayerSize): string {
  return `${size.width}×${size.height}`;
}

/**
 * Everything wrong with a layered appearance, in one pass.
 *
 * Kept out of the editor because two of these are load-bearing rather than cosmetic. A layer whose
 * axis has no tags, and a constant layer with no image, are both *silently dropped* by
 * `toLayeredDefinition` — the stack compiles and simply misses a layer. Saying so here is the only
 * place an author finds out.
 *
 * `sizes` comes from the decoded bitmaps the preview already measured (asset metadata does not carry
 * pixel size), keyed by layer id; a layer that has not been measured yet is skipped rather than
 * guessed at.
 *
 * `occluded` is passed in rather than computed: deciding that a layer is completely covered needs the
 * alpha of every layer intersected, which is the compositor's offscreen pass. Computing it here too
 * would mean two answers to one question.
 */
/**
 * Above this many baked avatars the count is worth saying out loud. Not a limit - an author whose
 * character genuinely needs them should have them - just the point where the number stops being
 * obvious from the axes on screen.
 */
const AVATAR_COMBINATION_BUDGET = 32;

/**
 * Everything wrong with a preset appearance.
 *
 * A preset character used to report nothing at all, which made the one mistake it can actually make
 * — a named pose with no art — completely silent: the pose is listed, the story row that names it
 * compiles, and the character simply does not appear. The other three are the same class of thing:
 * a state the editor renders as if it worked.
 */
function collectPresetDiagnostics(appearance: CharacterAppearance): CharacterDiagnostic[] {
  const found: CharacterDiagnostic[] = [];
  const poses = appearance.getPoses();
  if (poses.length === 0) {
    // Nothing else can be said, and everything below would say it about no poses.
    return [{ code: "noPoses", severity: "error", target: null, values: {} }];
  }

  // `getDefaultPoseId` falls back to the first pose, so a declaration pointing at a deleted pose
  // never surfaces through it — the *stored* value is the only place the dangling id is visible.
  const stored = appearance.toJSON();
  const declared = stored.kind === "preset" ? stored.defaultPoseId : null;
  if (declared && !poses.some((pose) => pose.id === declared)) {
    found.push({
      code: "defaultPoseMissing",
      severity: "warning",
      target: { kind: "pose", id: poses[0].id },
      values: { name: poses[0].name }
    });
  }

  const seen = new Set<string>();
  for (const pose of poses) {
    if (!pose.assetId) {
      found.push({
        code: "poseNoImage",
        severity: "error",
        target: { kind: "pose", id: pose.id },
        values: { name: pose.name }
      });
    }
    // Two poses of one name are not illegal — ids are what rows store — but the author has no
    // way to tell them apart in a picker, which is where the mistake gets made.
    const key = pose.name.trim().toLowerCase();
    if (seen.has(key)) {
      found.push({
        code: "duplicatePose",
        severity: "warning",
        target: { kind: "pose", id: pose.id },
        values: { name: pose.name }
      });
    }
    seen.add(key);
  }
  return found;
}

export function collectCharacterDiagnostics(
  appearance: CharacterAppearance,
  sizes: Record<string, LayerSize> = {},
  occluded: Record<string, boolean> = {}
): CharacterDiagnostic[] {
  if (appearance.getKind() === "preset") {
    return collectPresetDiagnostics(appearance);
  }
  // A puppet's interior belongs to a runtime Studio cannot inspect, so there is nothing here to
  // find that would not be a guess.
  if (appearance.getKind() !== "layered") {
    return [];
  }
  const found: CharacterDiagnostic[] = [];
  const axes = appearance.getAxes();
  const avatarAxisIds = new Set(
    characterAvatarAxisIds({
      kind: "layered",
      canvas: null,
      layers: [],
      axes: appearance.getAxes(),
      avatarAxisIds: appearance.getAvatarAxisIds()
    })
  );
  const layers = appearance.getLayers();
  // With no declared canvas the *largest* measured layer stands in as the reference. A stack either
  // agrees with itself or it does not, and saying so needs no author input - but the guess has to
  // survive a reorder, which "the bottom layer" does not: dragging an accessory under the body
  // would otherwise flip every finding. The canvas is the document size, so the biggest layer
  // present is the closest thing to it until the author declares one.
  const canvas =
    appearance.getCanvas() ??
    layers
      .map((layer) => sizes[layer.id])
      .filter(Boolean)
      .sort((a, b) => b.width * b.height - a.width * a.height)[0] ??
    null;

  // Every avatar axis multiplies into the bake. Three axes of four tags is sixty-four PNGs in the
  // repository, which is a number the author should meet here rather than in a diff. Reported
  // against the widest avatar axis, so clicking the row selects the one worth narrowing.
  const avatarAxes = axes.filter((axis) => avatarAxisIds.has(axis.id) && axis.tags.length > 0);
  const combinations = avatarAxes.reduce((total, axis) => total * axis.tags.length, 1);
  if (avatarAxes.length > 0 && combinations > AVATAR_COMBINATION_BUDGET) {
    const widest = [...avatarAxes].sort((a, b) => b.tags.length - a.tags.length)[0];
    found.push({
      code: "avatarCombinations",
      severity: "warning",
      target: { kind: "axis", id: widest.id },
      values: { count: String(combinations), name: widest.name }
    });
  }

  for (const layer of layers) {
    const size = sizes[layer.id];
    if (canvas && size && (size.width !== canvas.width || size.height !== canvas.height)) {
      found.push({
        code: "offCanvas",
        severity: "error",
        target: { kind: "layer", id: layer.id },
        values: { name: layer.name, size: format(size), canvas: format(canvas) }
      });
    }

    if (occluded[layer.id]) {
      found.push({
        code: "occluded",
        severity: "warning",
        target: { kind: "layer", id: layer.id },
        values: { name: layer.name }
      });
    }

    if (!layer.axisId) {
      if (!layer.assetId) {
        found.push({
          code: "constantNoImage",
          severity: "error",
          target: { kind: "layer", id: layer.id },
          values: { name: layer.name }
        });
      }
      continue;
    }

    // A bound layer that draws nothing under *some* tags is the scoped-layer idiom the whole
    // model rests on ("only the casual outfit has a jacket"), so only an entirely empty layer is
    // a mistake. This is why the check is on every option rather than on any of them.
    const options = Object.values(layer.options ?? {});
    if (options.length > 0 && options.every((assetId) => !assetId)) {
      found.push({
        code: "layerNoImage",
        severity: "error",
        // Any tag of its axis shows the empty layer, so the first one is as good a look as
        // any — what matters is that clicking the row puts *a* look on screen where the
        // complaint can be checked.
        target: {
          kind: "layer",
          id: layer.id,
          tags: { [layer.axisId]: appearance.getAxis(layer.axisId)?.tags[0]?.id ?? "" }
        },
        values: { name: layer.name }
      });
    }
  }

  const axisNames = new Set<string>();
  for (const axis of axes) {
    if (axis.tags.length === 0) {
      found.push({
        code: "axisNoTags",
        severity: "error",
        target: { kind: "axis", id: axis.id },
        values: { name: axis.name }
      });
    } else if (!layers.some((layer) => layer.axisId === axis.id)) {
      found.push({
        code: "axisUnused",
        severity: "error",
        target: { kind: "axis", id: axis.id },
        values: { name: axis.name }
      });
    }

    // Exactly the preset `defaultPoseMissing` finding, one kind over: `defaultTagSelection` falls
    // back to the first tag, so an axis whose declared default is missing or dangling poses the
    // character differently from what the store says and never says so.
    if (axis.tags.length > 0 && !axis.tags.some((tag) => tag.id === axis.defaultTagId)) {
      found.push({
        code: "axisDefaultMissing",
        severity: "warning",
        target: { kind: "axis", id: axis.id, tags: { [axis.id]: axis.tags[0].id } },
        values: { axis: axis.name, name: axis.tags[0].name }
      });
    }

    // Two axes of one name is worse than two tags of one name: a story `/face` row names the axis
    // as well as the tag, so the ambiguity reaches the script rather than staying in the editor.
    const axisKey = axis.name.trim().toLowerCase();
    if (axisNames.has(axisKey)) {
      found.push({
        code: "duplicateAxis",
        severity: "warning",
        target: { kind: "axis", id: axis.id },
        values: { name: axis.name }
      });
    }
    axisNames.add(axisKey);

    const seen = new Set<string>();
    for (const tag of axis.tags) {
      const key = tag.name.trim().toLowerCase();
      if (seen.has(key)) {
        found.push({
          code: "duplicateTag",
          severity: "warning",
          target: { kind: "axis", id: axis.id, tags: { [axis.id]: tag.id } },
          values: { axis: axis.name, name: tag.name }
        });
      }
      seen.add(key);
    }
  }

  // A snapshot is resolved when it is written, so a stale one means the tag or axis it named was
  // deleted afterwards. `resolveTagSelection` silently substitutes the defaults, so the bookmark
  // still opens *a* look — just not the one it was saved as, with nothing to say so.
  for (const snapshot of appearance.getSnapshots()) {
    const live: CharacterTagSelection = {};
    let stale = false;
    for (const [axisId, tagId] of Object.entries(snapshot.tags)) {
      if (appearance.getAxis(axisId)?.tags.some((tag) => tag.id === tagId)) {
        live[axisId] = tagId;
      } else {
        stale = true;
      }
    }
    if (stale) {
      found.push({
        code: "snapshotStale",
        severity: "warning",
        target: { kind: "combination", id: snapshot.id, tags: live },
        values: { name: snapshot.name }
      });
    }
  }

  // "This whole look draws nothing" is the layered form of `poseNoImage`, and until now it was said
  // only as prose beside the avatar preview, about whichever look happened to be on screen. A
  // character nobody has started drawing yet is silent: every layer is already reported empty, and
  // repeating it once per combination would bury the findings that name a real hole.
  const started = layers.some((layer) =>
    layer.axisId ? Object.values(layer.options ?? {}).some(Boolean) : Boolean(layer.assetId)
  );
  if (started) {
    for (const combination of enumerateCombinations(appearance).combinations) {
      if (appearance.resolveDrawList({ tags: combination.tags }).every((assetId) => !assetId)) {
        found.push({
          code: "combinationNoArt",
          severity: "error",
          target: { kind: "combination", id: combination.key, tags: combination.tags },
          values: { name: combination.labels.join(" · ") }
        });
      }
    }
  }

  return found;
}
