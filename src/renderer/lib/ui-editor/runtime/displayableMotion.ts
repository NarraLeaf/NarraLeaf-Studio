import type {
    UIDisplayableMotionFromCurrentValue,
    UIDisplayableMotionTransition,
    UIDisplayableMotionValue,
} from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";

export function displayableMotionFromCurrent(to: number): UIDisplayableMotionFromCurrentValue {
    return { from: "current", to };
}

export function isDisplayableMotionFromCurrentValue(
    value: UIDisplayableMotionValue | undefined,
): value is UIDisplayableMotionFromCurrentValue {
    return (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        value.from === "current" &&
        typeof value.to === "number" &&
        Number.isFinite(value.to)
    );
}

export function finalDisplayableMotionValue(value: UIDisplayableMotionValue | undefined): number | undefined {
    const raw = isDisplayableMotionFromCurrentValue(value)
        ? value.to
        : Array.isArray(value)
            ? value[value.length - 1]
            : value;
    return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

export function animateDisplayableMotionValue(
    value: UIDisplayableMotionValue | undefined,
    fallback: number,
): number | number[] {
    return isDisplayableMotionFromCurrentValue(value) ? value.to : value ?? fallback;
}

export function initialDisplayableMotionValue(
    value: UIDisplayableMotionValue | undefined,
    fallback: number,
): number | undefined {
    if (isDisplayableMotionFromCurrentValue(value)) {
        return undefined;
    }
    if (Array.isArray(value)) {
        return value.length > 0 ? Number(value[0]) : fallback;
    }
    return value ?? fallback;
}

function assignAnimateValue(
    target: Record<string, number | number[]>,
    key: string,
    value: UIDisplayableMotionValue | undefined,
    fallback: number,
): void {
    if (value === undefined) {
        return;
    }
    target[key] = animateDisplayableMotionValue(value, fallback);
}

function assignInitialValue(
    target: Record<string, number>,
    key: string,
    value: UIDisplayableMotionValue | undefined,
    fallback: number,
): void {
    if (value === undefined) {
        return;
    }
    const initial = initialDisplayableMotionValue(value, fallback);
    if (initial !== undefined) {
        target[key] = initial;
    }
}

export function buildDisplayableMotionAnimateTarget(
    target: {
        x?: UIDisplayableMotionValue;
        y?: UIDisplayableMotionValue;
        scale?: UIDisplayableMotionValue;
        rotate?: UIDisplayableMotionValue;
        opacity?: UIDisplayableMotionValue;
    },
    fallback: { x: number; y: number; scale: number; rotate: number; opacity: number },
): Record<string, number | number[]> {
    const animate: Record<string, number | number[]> = {};
    assignAnimateValue(animate, "x", target.x, fallback.x);
    assignAnimateValue(animate, "y", target.y, fallback.y);
    assignAnimateValue(animate, "scale", target.scale, fallback.scale);
    assignAnimateValue(animate, "rotate", target.rotate, fallback.rotate);
    assignAnimateValue(animate, "opacity", target.opacity, fallback.opacity);
    return animate;
}

export function buildDisplayableMotionInitialTarget(
    target: {
        x?: UIDisplayableMotionValue;
        y?: UIDisplayableMotionValue;
        scale?: UIDisplayableMotionValue;
        rotate?: UIDisplayableMotionValue;
        opacity?: UIDisplayableMotionValue;
    },
    fallback: { x: number; y: number; scale: number; rotate: number; opacity: number },
): Record<string, number> | false {
    const initial: Record<string, number> = {};
    assignInitialValue(initial, "x", target.x, fallback.x);
    assignInitialValue(initial, "y", target.y, fallback.y);
    assignInitialValue(initial, "scale", target.scale, fallback.scale);
    assignInitialValue(initial, "rotate", target.rotate, fallback.rotate);
    assignInitialValue(initial, "opacity", target.opacity, fallback.opacity);
    return Object.keys(initial).length > 0 ? initial : false;
}

export function toDisplayableMotionTransition(transition: UIDisplayableMotionTransition): Record<string, unknown> {
    if (transition.type === "spring") {
        return {
            type: "spring",
            stiffness: transition.stiffness,
            damping: transition.damping,
            mass: transition.mass,
            delay: Math.max(0, transition.delayMs ?? 0) / 1000,
        };
    }
    return {
        type: "tween",
        duration: Math.max(0, transition.durationMs) / 1000,
        delay: Math.max(0, transition.delayMs ?? 0) / 1000,
        ease: transition.easing ?? "easeOut",
    };
}
