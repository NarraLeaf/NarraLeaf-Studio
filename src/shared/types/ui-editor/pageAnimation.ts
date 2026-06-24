export const UI_PAGE_ANIMATION_PRESETS = ["none", "fade", "slide", "push", "zoom", "pop", "blur"] as const;
export const UI_PAGE_ANIMATION_DIRECTIONS = ["auto", "left", "right", "up", "down"] as const;
export const UI_PAGE_ANIMATION_SPEEDS = ["fast", "normal", "slow"] as const;

export type UIPageAnimationPreset = (typeof UI_PAGE_ANIMATION_PRESETS)[number];
export type UIPageAnimationDirection = (typeof UI_PAGE_ANIMATION_DIRECTIONS)[number];
export type UIPageAnimationSpeed = (typeof UI_PAGE_ANIMATION_SPEEDS)[number];

export type UIPageAnimationSettings = {
    enter: UIPageAnimationPreset;
    exit: UIPageAnimationPreset;
    direction: UIPageAnimationDirection;
    speed: UIPageAnimationSpeed;
};

export const DEFAULT_UI_PAGE_ANIMATION_SETTINGS: UIPageAnimationSettings = {
    enter: "none",
    exit: "none",
    direction: "auto",
    speed: "normal",
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
    return typeof value === "string" && (options as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function normalizeUIPageAnimationSettings(raw: unknown): UIPageAnimationSettings {
    if (!isRecord(raw)) {
        return { ...DEFAULT_UI_PAGE_ANIMATION_SETTINGS };
    }
    return {
        enter: oneOf(raw.enter, UI_PAGE_ANIMATION_PRESETS, DEFAULT_UI_PAGE_ANIMATION_SETTINGS.enter),
        exit: oneOf(raw.exit, UI_PAGE_ANIMATION_PRESETS, DEFAULT_UI_PAGE_ANIMATION_SETTINGS.exit),
        direction: oneOf(raw.direction, UI_PAGE_ANIMATION_DIRECTIONS, DEFAULT_UI_PAGE_ANIMATION_SETTINGS.direction),
        speed: oneOf(raw.speed, UI_PAGE_ANIMATION_SPEEDS, DEFAULT_UI_PAGE_ANIMATION_SETTINGS.speed),
    };
}

export function normalizeOptionalUIPageAnimationSettings(raw: unknown): UIPageAnimationSettings | undefined {
    return isRecord(raw) ? normalizeUIPageAnimationSettings(raw) : undefined;
}

export function isDefaultUIPageAnimationSettings(settings: UIPageAnimationSettings): boolean {
    return (
        settings.enter === DEFAULT_UI_PAGE_ANIMATION_SETTINGS.enter &&
        settings.exit === DEFAULT_UI_PAGE_ANIMATION_SETTINGS.exit &&
        settings.direction === DEFAULT_UI_PAGE_ANIMATION_SETTINGS.direction &&
        settings.speed === DEFAULT_UI_PAGE_ANIMATION_SETTINGS.speed
    );
}
