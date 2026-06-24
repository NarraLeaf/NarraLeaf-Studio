export const UI_PAGE_ANIMATION_PRESETS = ["none", "fade", "slide", "push", "zoom", "pop", "blur"] as const;
export const UI_PAGE_ANIMATION_DIRECTIONS = ["auto", "left", "right", "up", "down", "angle"] as const;

export type UIPageAnimationPreset = (typeof UI_PAGE_ANIMATION_PRESETS)[number];
export type UIPageAnimationDirection = (typeof UI_PAGE_ANIMATION_DIRECTIONS)[number];

export type UIPageAnimationSettings = {
    enter: UIPageAnimationPreset;
    exit: UIPageAnimationPreset;
    enterDirection: UIPageAnimationDirection;
    exitDirection: UIPageAnimationDirection;
    enterAngleDegrees: number;
    exitAngleDegrees: number;
    enterDurationSeconds: number;
    exitDurationSeconds: number;
    exitBlocking: boolean;
};

const DEFAULT_PAGE_ANIMATION_DURATION_SECONDS = 0.26;
const LEGACY_SPEED_DURATION_SECONDS = {
    fast: 0.16,
    normal: DEFAULT_PAGE_ANIMATION_DURATION_SECONDS,
    slow: 0.42,
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
    exitBlocking: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
    return typeof value === "string" && (options as readonly string[]).includes(value) ? (value as T) : fallback;
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
    const legacyDirection = oneOf(raw.direction, UI_PAGE_ANIMATION_DIRECTIONS, DEFAULT_UI_PAGE_ANIMATION_SETTINGS.enterDirection);
    return {
        enter: oneOf(raw.enter, UI_PAGE_ANIMATION_PRESETS, DEFAULT_UI_PAGE_ANIMATION_SETTINGS.enter),
        exit: oneOf(raw.exit, UI_PAGE_ANIMATION_PRESETS, DEFAULT_UI_PAGE_ANIMATION_SETTINGS.exit),
        enterDirection: oneOf(raw.enterDirection, UI_PAGE_ANIMATION_DIRECTIONS, legacyDirection),
        exitDirection: oneOf(raw.exitDirection, UI_PAGE_ANIMATION_DIRECTIONS, legacyDirection),
        enterAngleDegrees: normalizeAngleDegrees(raw.enterAngleDegrees, DEFAULT_UI_PAGE_ANIMATION_SETTINGS.enterAngleDegrees),
        exitAngleDegrees: normalizeAngleDegrees(raw.exitAngleDegrees, DEFAULT_UI_PAGE_ANIMATION_SETTINGS.exitAngleDegrees),
        enterDurationSeconds: normalizeDurationSeconds(raw.enterDurationSeconds, durationFallback),
        exitDurationSeconds: normalizeDurationSeconds(raw.exitDurationSeconds, durationFallback),
        exitBlocking: typeof raw.exitBlocking === "boolean" ? raw.exitBlocking : DEFAULT_UI_PAGE_ANIMATION_SETTINGS.exitBlocking,
    };
}

export function normalizeOptionalUIPageAnimationSettings(raw: unknown): UIPageAnimationSettings | undefined {
    return isRecord(raw) ? normalizeUIPageAnimationSettings(raw) : undefined;
}

export function isDefaultUIPageAnimationSettings(settings: UIPageAnimationSettings): boolean {
    return (
        settings.enter === DEFAULT_UI_PAGE_ANIMATION_SETTINGS.enter &&
        settings.exit === DEFAULT_UI_PAGE_ANIMATION_SETTINGS.exit &&
        settings.enterDirection === DEFAULT_UI_PAGE_ANIMATION_SETTINGS.enterDirection &&
        settings.exitDirection === DEFAULT_UI_PAGE_ANIMATION_SETTINGS.exitDirection &&
        settings.enterAngleDegrees === DEFAULT_UI_PAGE_ANIMATION_SETTINGS.enterAngleDegrees &&
        settings.exitAngleDegrees === DEFAULT_UI_PAGE_ANIMATION_SETTINGS.exitAngleDegrees &&
        settings.enterDurationSeconds === DEFAULT_UI_PAGE_ANIMATION_SETTINGS.enterDurationSeconds &&
        settings.exitDurationSeconds === DEFAULT_UI_PAGE_ANIMATION_SETTINGS.exitDurationSeconds &&
        settings.exitBlocking === DEFAULT_UI_PAGE_ANIMATION_SETTINGS.exitBlocking
    );
}
