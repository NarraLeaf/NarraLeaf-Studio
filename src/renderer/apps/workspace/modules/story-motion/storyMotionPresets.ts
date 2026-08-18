import type {
  StoryAnimationConfig,
  StoryAnimationKeyframe,
  StoryAnimationKeyframeValue,
  StoryAnimationTimeline,
  StoryAnimationTrack,
  StoryAnimationTrackProperty,
  StoryMotionTargetKind
} from "@shared/types/story";

/**
 * The Story Motion preset library — the common visual-novel moves, ready-made.
 *
 * Three rules the whole catalogue obeys, because breaking any of them produces a preset that looks
 * fine in the gallery and misbehaves on a real stage:
 *
 *  1. **A move animates offsets, not alignment.** A keyframe that writes `xalign` sets an *absolute*
 *     stage position, so a shake authored that way teleports a sprite the author had placed on the
 *     left into the centre before shaking it. Only the entrance/exit presets whose whole point is to
 *     arrive somewhere may touch alignment — and none of them currently needs to, so none of them do.
 *     (`cleanTransformSequenceProps` drops the undefined axes and NLR's `Partial<AlignPosition>` keeps
 *     whatever the displayable already had, so an offset-only position is a true relative nudge.)
 *  2. **No endless loops.** A transform action is awaited, and `Transform`'s `repeat` is a finite
 *     number, so an "idle" preset gets a small repeat count rather than a loop that would hang the row.
 *  3. **A preset is a seed, not a reference.** Picking one stamps out a normal, editable motion asset;
 *     nothing keeps pointing back here, so an author can tune the result without forking the library.
 *
 * A preset is deliberately NOT addressable from a command line (`/camera shake`): that would need
 * compile-time resolution of built-in ids, a picker merging two sources, and an editor that can open a
 * read-only asset — three new mechanisms for one shorthand.
 */

export type StoryMotionPresetCategory =
  | "entrance"
  | "exit"
  | "emphasis"
  | "idle"
  | "reaction"
  | "camera";

/**
 * What a preset is authored against. Split rather than an explicit per-preset kind list because the
 * distinction that matters is structural: a camera move is scaled for the whole stage (and reads as a
 * shot), a displayable move is scaled for one object. Which *kind* of displayable barely changes the
 * keyframes — a nod works on a portrait, an image and a layer alike.
 */
export type StoryMotionPresetScope = "displayable" | "camera";

/**
 * Every preset's id, spelled out rather than inferred from the table.
 *
 * The reason is the i18n layer: `TranslationKey` is a closed union built from the catalogues, so
 * `t(\`motion.preset.${id}\`)` only typechecks when `id` is a literal union — which also means a
 * preset added here without its `motion.preset.<id>` entry in **both** catalogues fails to compile
 * instead of rendering a raw key.
 */
export type StoryMotionPresetId =
  | "fadeInSlide"
  | "centerPop"
  | "slideInLeft"
  | "slideInRight"
  | "dropIn"
  | "spinIn"
  | "fadeOutSlide"
  | "shrinkOut"
  | "flash"
  | "pulse"
  | "heartbeat"
  | "jump"
  | "zoomPunch"
  | "breathe"
  | "float"
  | "sway"
  | "shake"
  | "impactShake"
  | "nod"
  | "headShake"
  | "recoil"
  | "dizzy"
  | "lookAround"
  | "fallOver"
  | "cameraShake"
  | "cameraImpact"
  | "cameraPushIn"
  | "cameraPullBack"
  | "cameraPanSweep"
  | "cameraDutchTilt"
  | "cameraZoomPunch"
  | "cameraDriftIn"
  | "cameraQuake";

export type StoryMotionPreset = {
  /** Stable id — also the i18n key suffix (`motion.preset.<id>`) and the gallery's react key. */
  id: StoryMotionPresetId;
  category: StoryMotionPresetCategory;
  scope: StoryMotionPresetScope;
  /** Seeded onto the created asset. Only the looping idle presets carry one. */
  config?: StoryAnimationConfig;
  build: () => StoryAnimationTimeline;
};

/** The preset a blank "New motion" starts from, and the fallback timeline for an asset with none. */
export const STORY_MOTION_DEFAULT_PRESET_ID: StoryMotionPresetId = "fadeInSlide";

export const STORY_MOTION_PRESETS: readonly StoryMotionPreset[] = [
  // ── Entrance ────────────────────────────────────────────────────────────────────────────────
  {
    id: "fadeInSlide",
    category: "entrance",
    scope: "displayable",
    build: () =>
      timeline([
        track("position", [key(0, offset({ x: -120 })), key(420, offset({ x: 0 }), "easeOut")]),
        track("opacity", [key(0, 0), key(420, 1, "easeOut")])
      ])
  },
  {
    id: "centerPop",
    category: "entrance",
    scope: "displayable",
    build: () =>
      timeline([
        track("zoom", [key(0, 0.82), key(220, 1.08, "easeOut"), key(360, 1, "easeOut")]),
        track("opacity", [key(0, 0), key(180, 1, "easeOut")])
      ])
  },
  {
    id: "slideInLeft",
    category: "entrance",
    scope: "displayable",
    build: () => slideIn(-420)
  },
  {
    id: "slideInRight",
    category: "entrance",
    scope: "displayable",
    build: () => slideIn(420)
  },
  {
    id: "dropIn",
    category: "entrance",
    scope: "displayable",
    build: () =>
      timeline([
        // `backOut` is the landing: it overshoots slightly below the resting spot and settles,
        // which is what reads as weight rather than as a slide that happened to be vertical.
        track("position", [key(0, offset({ y: 260 })), key(480, offset({ y: 0 }), "backOut")]),
        track("opacity", [key(0, 0), key(160, 1, "easeOut")])
      ])
  },
  {
    id: "spinIn",
    category: "entrance",
    scope: "displayable",
    build: () =>
      timeline([
        track("rotation", [key(0, -180), key(520, 0, "backOut")]),
        track("zoom", [key(0, 0.6), key(520, 1, "easeOut")]),
        track("opacity", [key(0, 0), key(200, 1, "easeOut")])
      ])
  },

  // ── Exit ────────────────────────────────────────────────────────────────────────────────────
  {
    id: "fadeOutSlide",
    category: "exit",
    scope: "displayable",
    build: () =>
      timeline([
        track("position", [key(0, offset({ x: 0 })), key(380, offset({ x: -120 }), "easeIn")]),
        track("opacity", [key(0, 1), key(380, 0, "easeIn")])
      ])
  },
  {
    id: "shrinkOut",
    category: "exit",
    scope: "displayable",
    build: () =>
      timeline([
        track("zoom", [key(0, 1), key(320, 0.7, "easeIn")]),
        track("opacity", [key(0, 1), key(320, 0, "easeIn")])
      ])
  },

  // ── Emphasis ────────────────────────────────────────────────────────────────────────────────
  {
    id: "flash",
    category: "emphasis",
    scope: "displayable",
    build: () =>
      timeline([
        track("opacity", [
          key(0, 0, "linear"),
          key(80, 1, "linear"),
          key(150, 0.2, "linear"),
          key(280, 1, "easeOut")
        ])
      ])
  },
  {
    id: "pulse",
    category: "emphasis",
    scope: "displayable",
    build: () =>
      timeline([track("zoom", [key(0, 1), key(140, 1.12, "easeOut"), key(320, 1, "easeOut")])])
  },
  {
    id: "heartbeat",
    category: "emphasis",
    scope: "displayable",
    build: () =>
      timeline([
        // Two beats, the second smaller — a single pulse reads as a bump, the pair reads as a pulse.
        track("zoom", [
          key(0, 1),
          key(110, 1.09, "easeOut"),
          key(200, 1, "easeIn"),
          key(300, 1.06, "easeOut"),
          key(420, 1, "easeIn")
        ])
      ])
  },
  {
    id: "jump",
    category: "emphasis",
    scope: "displayable",
    build: () =>
      timeline([
        track("position", [
          key(0, offset({ y: 0 })),
          key(180, offset({ y: 70 }), "easeOut"),
          key(360, offset({ y: 0 }), "circIn")
        ]),
        // The landing squash: without it the return just stops, and the jump has no floor.
        track("scaleY", [
          key(0, 1),
          key(360, 1, "linear"),
          key(430, 0.94, "easeOut"),
          key(520, 1, "easeOut")
        ])
      ])
  },
  {
    id: "zoomPunch",
    category: "emphasis",
    scope: "displayable",
    build: () => zoomPunch(1.18)
  },

  // ── Idle (finite repeats — see rule 2) ──────────────────────────────────────────────────────
  {
    id: "breathe",
    category: "idle",
    scope: "displayable",
    config: { repeat: 3 },
    build: () =>
      timeline([
        track("zoom", [key(0, 1), key(1400, 1.02, "easeInOut"), key(2800, 1, "easeInOut")])
      ])
  },
  {
    id: "float",
    category: "idle",
    scope: "displayable",
    config: { repeat: 3 },
    build: () =>
      timeline([
        track("position", [
          key(0, offset({ y: 0 })),
          key(1500, offset({ y: 14 }), "easeInOut"),
          key(3000, offset({ y: 0 }), "easeInOut")
        ])
      ])
  },
  {
    id: "sway",
    category: "idle",
    scope: "displayable",
    config: { repeat: 2 },
    build: () =>
      timeline([
        track("rotation", [
          key(0, 0),
          key(1200, 1.8, "easeInOut"),
          key(2400, 0, "easeInOut"),
          key(3600, -1.8, "easeInOut"),
          key(4800, 0, "easeInOut")
        ])
      ])
  },

  // ── Reaction ────────────────────────────────────────────────────────────────────────────────
  {
    id: "shake",
    category: "reaction",
    scope: "displayable",
    build: () =>
      timeline([
        track("position", [
          key(0, offset({ x: 0 })),
          key(60, offset({ x: -10 }), "easeOut"),
          key(120, offset({ x: 10 }), "easeInOut"),
          key(180, offset({ x: -7 }), "easeInOut"),
          key(240, offset({ x: 5 }), "easeInOut"),
          key(320, offset({ x: 0 }), "easeOut")
        ])
      ])
  },
  {
    id: "impactShake",
    category: "reaction",
    scope: "displayable",
    build: () =>
      timeline([
        // Two axes plus a rotation jitter, amplitude decaying: an impact is not a rhythm, it is
        // one hit that rings out.
        track("position", [
          key(0, offset({ x: 0, y: 0 })),
          key(60, offset({ x: -14, y: 8 }), "easeOut"),
          key(130, offset({ x: 12, y: -6 }), "easeInOut"),
          key(200, offset({ x: -8, y: 5 }), "easeInOut"),
          key(280, offset({ x: 5, y: -3 }), "easeInOut"),
          key(400, offset({ x: 0, y: 0 }), "easeOut")
        ]),
        track("rotation", [
          key(0, 0),
          key(60, -1.6, "easeOut"),
          key(200, 1.2, "easeInOut"),
          key(400, 0, "easeOut")
        ])
      ])
  },
  {
    id: "nod",
    category: "reaction",
    scope: "displayable",
    build: () =>
      timeline([
        track("position", [
          key(0, offset({ y: 0 })),
          key(140, offset({ y: -16 }), "easeInOut"),
          key(260, offset({ y: 0 }), "easeInOut"),
          key(380, offset({ y: -10 }), "easeInOut"),
          key(480, offset({ y: 0 }), "easeOut")
        ])
      ])
  },
  {
    id: "headShake",
    category: "reaction",
    scope: "displayable",
    build: () =>
      timeline([
        track("position", [
          key(0, offset({ x: 0 })),
          key(120, offset({ x: -14 }), "easeInOut"),
          key(240, offset({ x: 14 }), "easeInOut"),
          key(360, offset({ x: -9 }), "easeInOut"),
          key(460, offset({ x: 0 }), "easeOut")
        ])
      ])
  },
  {
    id: "recoil",
    category: "reaction",
    scope: "displayable",
    build: () =>
      timeline([
        track("position", [
          key(0, offset({ x: 0 })),
          key(130, offset({ x: -46 }), "easeOut"),
          key(520, offset({ x: 0 }), "easeOut")
        ]),
        track("rotation", [key(0, 0), key(130, -5, "easeOut"), key(520, 0, "easeOut")])
      ])
  },
  {
    id: "dizzy",
    category: "reaction",
    scope: "displayable",
    config: { repeat: 2 },
    build: () =>
      timeline([
        track("position", [
          key(0, offset({ x: 0, y: 0 })),
          key(300, offset({ x: 10, y: 6 }), "easeInOut"),
          key(600, offset({ x: 0, y: 12 }), "easeInOut"),
          key(900, offset({ x: -10, y: 6 }), "easeInOut"),
          key(1200, offset({ x: 0, y: 0 }), "easeInOut")
        ]),
        track("rotation", [
          key(0, 0),
          key(300, 6, "easeInOut"),
          key(900, -6, "easeInOut"),
          key(1200, 0, "easeInOut")
        ])
      ])
  },
  {
    id: "lookAround",
    category: "reaction",
    scope: "displayable",
    build: () =>
      timeline([track("rotation", [key(0, -3), key(220, 3, "easeInOut"), key(540, 0, "easeOut")])])
  },
  {
    id: "fallOver",
    category: "reaction",
    scope: "displayable",
    build: () =>
      timeline([
        track("rotation", [key(0, 0), key(620, 82, "circIn")]),
        track("position", [key(0, offset({ y: 0 })), key(620, offset({ y: -40 }), "circIn")]),
        track("opacity", [key(0, 1), key(620, 0.85, "easeIn")])
      ])
  },

  // ── Camera ──────────────────────────────────────────────────────────────────────────────────
  {
    id: "cameraShake",
    category: "camera",
    scope: "camera",
    build: () =>
      timeline([
        track("position", [
          key(0, offset({ x: 0, y: 0 })),
          key(70, offset({ x: -12, y: 7 }), "easeOut"),
          key(150, offset({ x: 10, y: -5 }), "easeInOut"),
          key(230, offset({ x: -7, y: 4 }), "easeInOut"),
          key(310, offset({ x: 4, y: -2 }), "easeInOut"),
          key(420, offset({ x: 0, y: 0 }), "easeOut")
        ])
      ])
  },
  {
    id: "cameraImpact",
    category: "camera",
    scope: "camera",
    build: () =>
      timeline([
        track("position", [
          key(0, offset({ x: 0, y: 0 })),
          key(70, offset({ x: -22, y: 14 }), "easeOut"),
          key(150, offset({ x: 18, y: -10 }), "easeInOut"),
          key(240, offset({ x: -11, y: 6 }), "easeInOut"),
          key(360, offset({ x: 0, y: 0 }), "easeOut")
        ]),
        // The zoom kick is what separates "hit" from "handheld": the frame lurches toward the blow.
        track("zoom", [key(0, 1), key(80, 1.06, "easeOut"), key(360, 1, "easeOut")])
      ])
  },
  {
    id: "cameraPushIn",
    category: "camera",
    scope: "camera",
    build: () => timeline([track("zoom", [key(0, 1), key(1600, 1.35, "easeInOut")])])
  },
  {
    id: "cameraPullBack",
    category: "camera",
    scope: "camera",
    build: () =>
      timeline([
        // Pulls out from the neutral pose rather than starting at a close-up: a first keyframe
        // away from neutral applies instantly, which would read as a cut, not a move.
        track("zoom", [key(0, 1), key(1500, 0.8, "easeInOut")])
      ])
  },
  {
    id: "cameraPanSweep",
    category: "camera",
    scope: "camera",
    build: () =>
      timeline([
        track("position", [key(0, offset({ x: 0 })), key(1800, offset({ x: -160 }), "easeInOut")])
      ])
  },
  {
    id: "cameraDutchTilt",
    category: "camera",
    scope: "camera",
    build: () => timeline([track("rotation", [key(0, 0), key(900, -4.5, "easeInOut")])])
  },
  {
    id: "cameraZoomPunch",
    category: "camera",
    scope: "camera",
    build: () => zoomPunch(1.12)
  },
  {
    id: "cameraDriftIn",
    category: "camera",
    scope: "camera",
    build: () =>
      timeline([
        track("zoom", [key(0, 1), key(4000, 1.08, "linear")]),
        track("position", [key(0, offset({ x: 0 })), key(4000, offset({ x: -40 }), "linear")])
      ])
  },
  {
    id: "cameraQuake",
    category: "camera",
    scope: "camera",
    config: { repeat: 6 },
    build: () =>
      timeline([
        track("position", [
          key(0, offset({ x: 0, y: 0 })),
          key(60, offset({ x: -8, y: 5 }), "easeInOut"),
          key(120, offset({ x: 8, y: -5 }), "easeInOut"),
          key(180, offset({ x: -5, y: 3 }), "easeInOut"),
          key(240, offset({ x: 0, y: 0 }), "easeInOut")
        ])
      ])
  }
];

export const STORY_MOTION_PRESET_CATEGORIES: readonly StoryMotionPresetCategory[] = [
  "entrance",
  "exit",
  "emphasis",
  "idle",
  "reaction",
  "camera"
];

export function getStoryMotionPreset(id: string): StoryMotionPreset | undefined {
  return STORY_MOTION_PRESETS.find((preset) => preset.id === id);
}

/** The presets worth offering for a motion target — camera shots for the camera, the rest for objects. */
export function storyMotionPresetsForTargetKind(
  targetKind: StoryMotionTargetKind
): StoryMotionPreset[] {
  const scope: StoryMotionPresetScope = targetKind === "camera" ? "camera" : "displayable";
  return STORY_MOTION_PRESETS.filter((preset) => preset.scope === scope);
}

/** The categories that actually have presets for this target, in catalogue order. */
export function storyMotionPresetCategoriesForTargetKind(
  targetKind: StoryMotionTargetKind
): StoryMotionPresetCategory[] {
  const presets = storyMotionPresetsForTargetKind(targetKind);
  return STORY_MOTION_PRESET_CATEGORIES.filter((category) =>
    presets.some((preset) => preset.category === category)
  );
}

export function createStoryMotionPresetTimeline(id: string): StoryAnimationTimeline {
  return (getStoryMotionPreset(id) ?? STORY_MOTION_PRESETS[0]).build();
}

// ── builders ────────────────────────────────────────────────────────────────────────────────────
// Ids are derived from property + time so a preset's timeline is value-stable: two builds of the same
// preset are deep-equal, which is what lets the gallery memoize and the tests pin exact shapes.

function timeline(tracks: StoryAnimationTrack[]): StoryAnimationTimeline {
  const times = tracks.flatMap((item) => item.keyframes.map((keyframe) => keyframe.timeMs));
  return {
    durationMs: times.length > 0 ? Math.max(...times) : 0,
    tracks
  };
}

function track(
  property: StoryAnimationTrackProperty,
  keyframes: StoryAnimationKeyframe[]
): StoryAnimationTrack {
  return {
    id: `track-${property}`,
    property,
    keyframes: keyframes.map((keyframe) => ({
      ...keyframe,
      id: `kf-${property}-${keyframe.timeMs}`
    }))
  };
}

/** `id` is filled in by {@link track}, which is the only place that knows the property. */
function key(
  timeMs: number,
  value: StoryAnimationKeyframeValue,
  easing = "easeOut"
): StoryAnimationKeyframe {
  return { id: "", timeMs, value, easing };
}

/**
 * A position keyframe that moves the target *relative* to wherever it stands (rule 1). Naming the
 * axes `x`/`y` here keeps the preset tables readable; the emitted keys are NLR's `xoffset`/`yoffset`,
 * and alignment is deliberately absent so it is never overwritten.
 */
function offset(delta: { x?: number; y?: number }): StoryAnimationKeyframeValue {
  return {
    ...(delta.x === undefined ? {} : { xoffset: delta.x }),
    ...(delta.y === undefined ? {} : { yoffset: delta.y })
  };
}

function slideIn(fromX: number): StoryAnimationTimeline {
  return timeline([
    track("position", [key(0, offset({ x: fromX })), key(560, offset({ x: 0 }), "circOut")]),
    track("opacity", [key(0, 0), key(260, 1, "easeOut")])
  ]);
}

function zoomPunch(peak: number): StoryAnimationTimeline {
  return timeline([track("zoom", [key(0, 1), key(90, peak, "easeOut"), key(320, 1, "easeInOut")])]);
}
