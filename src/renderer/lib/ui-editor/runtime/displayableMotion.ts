import type { UIDisplayableMotionTransition } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";

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
