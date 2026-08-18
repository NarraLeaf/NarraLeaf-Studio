export const UI_PAGE_ANIMATION_PRESETS = [
  "none",
  "fade",
  "slide",
  "push",
  "zoom",
  "pop",
  "blur"
] as const;
export const UI_PAGE_ANIMATION_DIRECTIONS = [
  "auto",
  "left",
  "right",
  "up",
  "down",
  "angle"
] as const;

export type UIPageAnimationPreset = (typeof UI_PAGE_ANIMATION_PRESETS)[number];
export type UIPageAnimationDirection = (typeof UI_PAGE_ANIMATION_DIRECTIONS)[number];

/**
 * One animation record, used by every host that can enter and leave: a Surface, a Page component's
 * override of the Surface it shows, and any element on a Surface.
 *
 * They share the type because they share the mental model - pick a preset, a direction, how long it
 * takes, and when it starts. What differs is only which fields a host offers: an element has no
 * navigation to block, so it does not offer {@link exitBlocking}, and only a host that owns children
 * offers {@link childStaggerSeconds} / {@link exitWaitsForChildren}. The fields are always present in
 * the record so a hand-edited or older document reads back the same way whichever host wrote it.
 */
export type UIPageAnimationSettings = {
  enter: UIPageAnimationPreset;
  exit: UIPageAnimationPreset;
  enterDirection: UIPageAnimationDirection;
  exitDirection: UIPageAnimationDirection;
  enterAngleDegrees: number;
  exitAngleDegrees: number;
  enterDurationSeconds: number;
  exitDurationSeconds: number;
  /** Held before this host's own enter starts, counted from the moment its subtree begins entering. */
  enterDelaySeconds: number;
  /** Held before this host's own exit starts, counted from the moment its subtree begins exiting. */
  exitDelaySeconds: number;
  /** Added to each successive direct child, so a row of children arrives (and leaves) one after another. */
  childStaggerSeconds: number;
  /** Hold this host's own exit until every child has finished leaving. Chains through nested parents. */
  exitWaitsForChildren: boolean;
  /** Surfaces only: hold the incoming Page until this exit has finished. */
  exitBlocking: boolean;
};

const DEFAULT_PAGE_ANIMATION_DURATION_SECONDS = 0.26;
const LEGACY_SPEED_DURATION_SECONDS = {
  fast: 0.16,
  normal: DEFAULT_PAGE_ANIMATION_DURATION_SECONDS,
  slow: 0.42
} as const;
const MAX_PAGE_ANIMATION_DURATION_SECONDS = 10;

export const DEFAULT_UI_PAGE_ANIMATION_SETTINGS: UIPageAnimationSettings = {
  enter: "none",
  exit: "none",
  enterDirection: "auto",
  exitDirection: "auto",
  enterAngleDegrees: 0,
  exitAngleDegrees: 180,
  enterDurationSeconds: DEFAULT_PAGE_ANIMATION_DURATION_SECONDS,
  exitDurationSeconds: DEFAULT_PAGE_ANIMATION_DURATION_SECONDS,
  enterDelaySeconds: 0,
  exitDelaySeconds: 0,
  childStaggerSeconds: 0,
  // True by default, and free: a host whose children animate nothing waits zero. It is the reading
  // of "the Page left" an author already has - the Page is what its contents are, so it has not
  // left while they are still on screen. Turning it off is the deliberate choice.
  exitWaitsForChildren: true,
  exitBlocking: true
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return typeof value === "string" && (options as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function legacyDurationForSpeed(value: unknown): number | undefined {
  return typeof value === "string" && value in LEGACY_SPEED_DURATION_SECONDS
    ? LEGACY_SPEED_DURATION_SECONDS[value as keyof typeof LEGACY_SPEED_DURATION_SECONDS]
    : undefined;
}

function normalizeDurationSeconds(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  const clamped = Math.min(MAX_PAGE_ANIMATION_DURATION_SECONDS, Math.max(0, value));
  return Math.round(clamped * 100) / 100;
}

function normalizeAngleDegrees(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  const wrapped = ((value % 360) + 360) % 360;
  return Math.round(wrapped * 100) / 100;
}

export function normalizeUIPageAnimationSettings(raw: unknown): UIPageAnimationSettings {
  if (!isRecord(raw)) {
    return { ...DEFAULT_UI_PAGE_ANIMATION_SETTINGS };
  }
  const legacyDuration = legacyDurationForSpeed(raw.speed);
  const durationFallback = legacyDuration ?? DEFAULT_PAGE_ANIMATION_DURATION_SECONDS;
  const legacyDirection = oneOf(
    raw.direction,
    UI_PAGE_ANIMATION_DIRECTIONS,
    DEFAULT_UI_PAGE_ANIMATION_SETTINGS.enterDirection
  );
  return {
    enter: oneOf(raw.enter, UI_PAGE_ANIMATION_PRESETS, DEFAULT_UI_PAGE_ANIMATION_SETTINGS.enter),
    exit: oneOf(raw.exit, UI_PAGE_ANIMATION_PRESETS, DEFAULT_UI_PAGE_ANIMATION_SETTINGS.exit),
    enterDirection: oneOf(raw.enterDirection, UI_PAGE_ANIMATION_DIRECTIONS, legacyDirection),
    exitDirection: oneOf(raw.exitDirection, UI_PAGE_ANIMATION_DIRECTIONS, legacyDirection),
    enterAngleDegrees: normalizeAngleDegrees(
      raw.enterAngleDegrees,
      DEFAULT_UI_PAGE_ANIMATION_SETTINGS.enterAngleDegrees
    ),
    exitAngleDegrees: normalizeAngleDegrees(
      raw.exitAngleDegrees,
      DEFAULT_UI_PAGE_ANIMATION_SETTINGS.exitAngleDegrees
    ),
    enterDurationSeconds: normalizeDurationSeconds(raw.enterDurationSeconds, durationFallback),
    exitDurationSeconds: normalizeDurationSeconds(raw.exitDurationSeconds, durationFallback),
    enterDelaySeconds: normalizeDurationSeconds(
      raw.enterDelaySeconds,
      DEFAULT_UI_PAGE_ANIMATION_SETTINGS.enterDelaySeconds
    ),
    exitDelaySeconds: normalizeDurationSeconds(
      raw.exitDelaySeconds,
      DEFAULT_UI_PAGE_ANIMATION_SETTINGS.exitDelaySeconds
    ),
    childStaggerSeconds: normalizeDurationSeconds(
      raw.childStaggerSeconds,
      DEFAULT_UI_PAGE_ANIMATION_SETTINGS.childStaggerSeconds
    ),
    exitWaitsForChildren:
      typeof raw.exitWaitsForChildren === "boolean"
        ? raw.exitWaitsForChildren
        : DEFAULT_UI_PAGE_ANIMATION_SETTINGS.exitWaitsForChildren,
    exitBlocking:
      typeof raw.exitBlocking === "boolean"
        ? raw.exitBlocking
        : DEFAULT_UI_PAGE_ANIMATION_SETTINGS.exitBlocking
  };
}

export function normalizeOptionalUIPageAnimationSettings(
  raw: unknown
): UIPageAnimationSettings | undefined {
  return isRecord(raw) ? normalizeUIPageAnimationSettings(raw) : undefined;
}

/**
 * Compared key by key over the default record rather than field by field, so a field added to
 * {@link UIPageAnimationSettings} later cannot quietly fall out of the comparison - which for an
 * element is the difference between "this animation is worth storing" and losing it on the next edit.
 */
export function isDefaultUIPageAnimationSettings(settings: UIPageAnimationSettings): boolean {
  return (
    Object.keys(DEFAULT_UI_PAGE_ANIMATION_SETTINGS) as (keyof UIPageAnimationSettings)[]
  ).every((key) => settings[key] === DEFAULT_UI_PAGE_ANIMATION_SETTINGS[key]);
}
