import {
    DEFAULT_UI_PAGE_ANIMATION_SETTINGS,
    normalizeUIPageAnimationSettings,
    type UIPageAnimationDirection,
    type UIPageAnimationPreset,
    type UIPageAnimationSettings,
} from "@shared/types/ui-editor/pageAnimation";

export type PageAnimationNavigationDirection = "forward" | "back";
export type PageAnimationPhase = "enter" | "exit";

export type PageAnimationMotion = {
    initial: Record<string, string | number>;
    animate: Record<string, string | number>;
    exit: Record<string, string | number>;
    transition: Record<string, unknown>;
    enterDurationMs: number;
    exitDurationMs: number;
};

const PAGE_ANIMATION_DISTANCE_PX = 48;
const PAGE_ANIMATION_EASE = [0.22, 1, 0.36, 1] as const;

const SPEED_DURATION_MS: Record<UIPageAnimationSettings["speed"], number> = {
    fast: 160,
    normal: 260,
    slow: 420,
};

const BASE_TARGET = {
    opacity: 1,
    x: 0,
    y: 0,
    scale: 1,
    filter: "blur(0px)",
};

function hasMotion(preset: UIPageAnimationPreset): boolean {
    return preset !== "none";
}

function durationFor(settings: UIPageAnimationSettings, phase: PageAnimationPhase, reducedMotion: boolean): number {
    if (reducedMotion) {
        return 0;
    }
    const preset = phase === "enter" ? settings.enter : settings.exit;
    return hasMotion(preset) ? SPEED_DURATION_MS[settings.speed] : 0;
}

function resolveDirection(
    direction: UIPageAnimationDirection,
    navigationDirection: PageAnimationNavigationDirection,
): Exclude<UIPageAnimationDirection, "auto"> {
    if (direction !== "auto") {
        return direction;
    }
    return navigationDirection === "back" ? "left" : "right";
}

function vectorFor(direction: Exclude<UIPageAnimationDirection, "auto">): { x: number; y: number } {
    switch (direction) {
        case "left":
            return { x: -PAGE_ANIMATION_DISTANCE_PX, y: 0 };
        case "right":
            return { x: PAGE_ANIMATION_DISTANCE_PX, y: 0 };
        case "up":
            return { x: 0, y: -PAGE_ANIMATION_DISTANCE_PX };
        case "down":
            return { x: 0, y: PAGE_ANIMATION_DISTANCE_PX };
    }
}

function enterTarget(preset: UIPageAnimationPreset, vector: { x: number; y: number }) {
    switch (preset) {
        case "fade":
            return { ...BASE_TARGET, opacity: 0 };
        case "slide":
            return { ...BASE_TARGET, opacity: 0, x: vector.x, y: vector.y };
        case "push":
            return { ...BASE_TARGET, x: vector.x, y: vector.y };
        case "zoom":
            return { ...BASE_TARGET, opacity: 0, scale: 0.96 };
        case "pop":
            return { ...BASE_TARGET, opacity: 0, scale: 0.9 };
        case "blur":
            return { ...BASE_TARGET, opacity: 0, filter: "blur(14px)" };
        case "none":
            return BASE_TARGET;
    }
}

function exitTarget(preset: UIPageAnimationPreset, vector: { x: number; y: number }) {
    switch (preset) {
        case "fade":
            return { ...BASE_TARGET, opacity: 0 };
        case "slide":
            return { ...BASE_TARGET, opacity: 0, x: vector.x, y: vector.y };
        case "push":
            return { ...BASE_TARGET, x: -vector.x, y: -vector.y };
        case "zoom":
            return { ...BASE_TARGET, opacity: 0, scale: 0.96 };
        case "pop":
            return { ...BASE_TARGET, opacity: 0, scale: 1.05 };
        case "blur":
            return { ...BASE_TARGET, opacity: 0, filter: "blur(14px)" };
        case "none":
            return BASE_TARGET;
    }
}

export function getPageAnimationDurationMs(
    settings: UIPageAnimationSettings | null | undefined,
    phase: PageAnimationPhase,
    reducedMotion = false,
): number {
    return durationFor(normalizeUIPageAnimationSettings(settings), phase, reducedMotion);
}

export function resolvePageAnimationMotion(input: {
    settings?: UIPageAnimationSettings | null;
    navigationDirection?: PageAnimationNavigationDirection;
    reducedMotion?: boolean;
}): PageAnimationMotion {
    const settings = normalizeUIPageAnimationSettings(input.settings ?? DEFAULT_UI_PAGE_ANIMATION_SETTINGS);
    const reducedMotion = input.reducedMotion === true;
    const vector = vectorFor(resolveDirection(settings.direction, input.navigationDirection ?? "forward"));
    const enterDurationMs = durationFor(settings, "enter", reducedMotion);
    const exitDurationMs = durationFor(settings, "exit", reducedMotion);
    const durationMs = Math.max(enterDurationMs, exitDurationMs);

    if (reducedMotion || durationMs <= 0) {
        return {
            initial: BASE_TARGET,
            animate: BASE_TARGET,
            exit: BASE_TARGET,
            transition: { type: "tween", duration: 0 },
            enterDurationMs,
            exitDurationMs,
        };
    }

    return {
        initial: enterDurationMs > 0 ? enterTarget(settings.enter, vector) : BASE_TARGET,
        animate: BASE_TARGET,
        exit: exitDurationMs > 0 ? exitTarget(settings.exit, vector) : BASE_TARGET,
        transition: {
            type: "tween",
            duration: durationMs / 1000,
            ease: PAGE_ANIMATION_EASE,
        },
        enterDurationMs,
        exitDurationMs,
    };
}
