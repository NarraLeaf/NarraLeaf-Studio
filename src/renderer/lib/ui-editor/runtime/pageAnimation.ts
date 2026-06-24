import {
    DEFAULT_UI_PAGE_ANIMATION_SETTINGS,
    normalizeUIPageAnimationSettings,
    type UIPageAnimationDirection,
    type UIPageAnimationPreset,
    type UIPageAnimationSettings,
} from "@shared/types/ui-editor/pageAnimation";
import type { MotionProps } from "motion/react";

export type PageAnimationNavigationDirection = "forward" | "back";
export type PageAnimationPhase = "enter" | "exit";

type MotionTarget = Exclude<NonNullable<MotionProps["initial"]>, boolean | string | string[]>;
type MotionTransition = NonNullable<MotionTarget["transition"]>;

export type PageAnimationMotion = {
    initial: MotionTarget;
    animate: MotionTarget;
    exit: MotionTarget;
    enterDurationMs: number;
    exitDurationMs: number;
    exitBlocking: boolean;
};

const PAGE_ANIMATION_DISTANCE_PX = 48;
const PAGE_ANIMATION_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

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
    const seconds = phase === "enter" ? settings.enterDurationSeconds : settings.exitDurationSeconds;
    return hasMotion(preset) ? Math.max(0, Math.round(seconds * 1000)) : 0;
}

function transitionFor(durationMs: number): MotionTransition {
    return {
        type: "tween",
        duration: durationMs / 1000,
        ease: PAGE_ANIMATION_EASE,
    };
}

function resolveAutoDirection(
    phase: PageAnimationPhase,
    navigationDirection: PageAnimationNavigationDirection,
): Exclude<UIPageAnimationDirection, "auto" | "angle"> {
    if (phase === "enter") {
        return navigationDirection === "back" ? "left" : "right";
    }
    return navigationDirection === "back" ? "right" : "left";
}

function resolveDirection(
    direction: UIPageAnimationDirection,
    angleDegrees: number,
    phase: PageAnimationPhase,
    navigationDirection: PageAnimationNavigationDirection,
): { direction: Exclude<UIPageAnimationDirection, "auto" | "angle"> | null; angleDegrees: number } {
    if (direction === "auto") {
        return { direction: resolveAutoDirection(phase, navigationDirection), angleDegrees };
    }
    if (direction === "angle") {
        return { direction: null, angleDegrees };
    }
    return { direction, angleDegrees };
}

function vectorFor(input: {
    direction: Exclude<UIPageAnimationDirection, "auto" | "angle"> | null;
    angleDegrees: number;
}): { x: number; y: number } {
    if (input.direction === null) {
        const radians = (input.angleDegrees * Math.PI) / 180;
        return {
            x: Math.cos(radians) * PAGE_ANIMATION_DISTANCE_PX,
            y: Math.sin(radians) * PAGE_ANIMATION_DISTANCE_PX,
        };
    }

    const direction = input.direction;
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
            return { ...BASE_TARGET, x: vector.x, y: vector.y };
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

export function shouldBlockPageAnimationExit(
    settings: UIPageAnimationSettings | null | undefined,
    reducedMotion = false,
): boolean {
    const normalized = normalizeUIPageAnimationSettings(settings);
    return normalized.exitBlocking && durationFor(normalized, "exit", reducedMotion) > 0;
}

export function resolvePageAnimationMotion(input: {
    settings?: UIPageAnimationSettings | null;
    navigationDirection?: PageAnimationNavigationDirection;
    reducedMotion?: boolean;
}): PageAnimationMotion {
    const settings = normalizeUIPageAnimationSettings(input.settings ?? DEFAULT_UI_PAGE_ANIMATION_SETTINGS);
    const reducedMotion = input.reducedMotion === true;
    const navigationDirection = input.navigationDirection ?? "forward";
    const enterVector = vectorFor(resolveDirection(
        settings.enterDirection,
        settings.enterAngleDegrees,
        "enter",
        navigationDirection,
    ));
    const exitVector = vectorFor(resolveDirection(
        settings.exitDirection,
        settings.exitAngleDegrees,
        "exit",
        navigationDirection,
    ));
    const enterDurationMs = durationFor(settings, "enter", reducedMotion);
    const exitDurationMs = durationFor(settings, "exit", reducedMotion);
    const exitBlocking = shouldBlockPageAnimationExit(settings, reducedMotion);

    if (reducedMotion || (enterDurationMs <= 0 && exitDurationMs <= 0)) {
        return {
            initial: BASE_TARGET,
            animate: { ...BASE_TARGET, transition: transitionFor(0) },
            exit: { ...BASE_TARGET, transition: transitionFor(0) },
            enterDurationMs,
            exitDurationMs,
            exitBlocking,
        };
    }

    return {
        initial: enterDurationMs > 0 ? enterTarget(settings.enter, enterVector) : BASE_TARGET,
        animate: {
            ...BASE_TARGET,
            transition: transitionFor(enterDurationMs),
        },
        exit: {
            ...(exitDurationMs > 0 ? exitTarget(settings.exit, exitVector) : BASE_TARGET),
            transition: transitionFor(exitDurationMs),
        },
        enterDurationMs,
        exitDurationMs,
        exitBlocking,
    };
}
