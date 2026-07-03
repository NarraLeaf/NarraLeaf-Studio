import type {
    AppearanceFieldTransition,
    AppearanceModel,
    AppearancePropertyKey,
    AppearanceTransitionTweenEasing,
    AppearanceVariant,
    ButtonAppearancePropertyKey,
    ContainerAppearancePropertyKey,
    TextAppearancePropertyKey,
} from "@shared/types/ui-editor/appearance";

export const APPEARANCE_TRANSITION_TYPE_OPTIONS = [
    { value: "tween", label: "Tween" },
    { value: "spring", label: "Spring" },
] as const;

export const APPEARANCE_TWEEN_EASING_OPTIONS: { value: AppearanceTransitionTweenEasing; label: string }[] = [
    { value: "linear", label: "Linear" },
    { value: "easeIn", label: "Ease in" },
    { value: "easeOut", label: "Ease out" },
    { value: "easeInOut", label: "Ease in-out" },
    { value: "circIn", label: "Circ in" },
    { value: "circOut", label: "Circ out" },
    { value: "circInOut", label: "Circ in-out" },
];

export const DEFAULT_TWEEN_TRANSITION: AppearanceFieldTransition = {
    type: "tween",
    durationMs: 180,
    delayMs: 0,
    easing: "easeOut",
};

export const DEFAULT_SPRING_TRANSITION: AppearanceFieldTransition = {
    type: "spring",
    delayMs: 0,
    stiffness: 320,
    damping: 28,
    mass: 1,
};

export const CONTAINER_ANIMATABLE_KEYS: readonly ContainerAppearancePropertyKey[] = [
    "backgroundColor",
    "fillOpacity",
    "fillVisible",
    "borderWidth",
    "borderColor",
    "strokeOpacity",
    "strokeVisible",
    "borderRadius",
    "borderRadiusTL",
    "borderRadiusTR",
    "borderRadiusBL",
    "borderRadiusBR",
    "transformOffsetX",
    "transformOffsetY",
    "transformScale",
    "transformRotation",
    "transformOpacity",
    "effectBlur",
    "effectBackgroundBlur",
    "effectShadow",
    "effectInnerShadow",
    "effectBlend",
    "effectGlow",
    "effectFilter",
];

export const BUTTON_ANIMATABLE_KEYS: readonly ButtonAppearancePropertyKey[] = [
    "backgroundColor",
    "fillOpacity",
    "fillVisible",
    "borderRadius",
    "borderWidth",
    "borderColor",
    "strokeOpacity",
    "strokeSide",
    "borderJoin",
    "strokeAlign",
    "paddingX",
    "paddingY",
    "transformOffsetX",
    "transformOffsetY",
    "transformScale",
    "transformRotation",
    "transformOpacity",
    "effectBlur",
    "effectBackgroundBlur",
    "effectShadow",
    "effectTextShadow",
    "effectInnerShadow",
    "effectBlend",
    "effectGlow",
    "effectFilter",
];

export const TEXT_ANIMATABLE_KEYS: readonly TextAppearancePropertyKey[] = [
    "fontSize",
    "color",
    "lineHeight",
    "transformOffsetX",
    "transformOffsetY",
    "transformScale",
    "transformRotation",
    "transformOpacity",
    "effectBlur",
    "effectTextShadow",
    "effectBlend",
    "effectFilter",
];

function findPropertyGroup(variant: AppearanceVariant, key: string) {
    return variant.propertyGroups.find(group => group.key === key);
}

export function isMotionCapableContainerAppearanceKey(key: string): key is ContainerAppearancePropertyKey {
    return (CONTAINER_ANIMATABLE_KEYS as readonly string[]).includes(key);
}

export function isMotionCapableButtonAppearanceKey(key: string): key is ButtonAppearancePropertyKey {
    return (BUTTON_ANIMATABLE_KEYS as readonly string[]).includes(key);
}

export function isMotionCapableTextAppearanceKey(key: string): key is TextAppearancePropertyKey {
    return (TEXT_ANIMATABLE_KEYS as readonly string[]).includes(key);
}

export function isMotionCapableAppearanceKey(key: string): key is AppearancePropertyKey {
    return (
        isMotionCapableContainerAppearanceKey(key) ||
        isMotionCapableButtonAppearanceKey(key) ||
        isMotionCapableTextAppearanceKey(key)
    );
}

export function listAnimatableKeysForModule(keys: readonly string[]): AppearancePropertyKey[] {
    return keys.filter(isMotionCapableAppearanceKey);
}

export function getAppearanceGroupTransition(
    variant: AppearanceVariant,
    key: string
): AppearanceFieldTransition | null | undefined {
    return findPropertyGroup(variant, key)?.transition;
}

export function hasAppearanceGroupTransition(variant: AppearanceVariant, key: string): boolean {
    return Boolean(getAppearanceGroupTransition(variant, key));
}

export function moduleHasAnyAppearanceTransition(variant: AppearanceVariant, keys: readonly string[]): boolean {
    return listAnimatableKeysForModule(keys).some(key => hasAppearanceGroupTransition(variant, key));
}

/** True if any variant has a transition on any animatable key in the module. */
export function moduleHasAnyAppearanceTransitionInModel(model: AppearanceModel, keys: readonly string[]): boolean {
    const animatable = listAnimatableKeysForModule(keys);
    return model.variants.some(v => animatable.some(key => hasAppearanceGroupTransition(v, key)));
}

export function countModuleAppearanceTransitions(variant: AppearanceVariant, keys: readonly string[]): number {
    return listAnimatableKeysForModule(keys).filter(key => hasAppearanceGroupTransition(variant, key)).length;
}

export function getDefaultAppearanceTransition(type: AppearanceFieldTransition["type"] = "tween"): AppearanceFieldTransition {
    return JSON.parse(JSON.stringify(type === "spring" ? DEFAULT_SPRING_TRANSITION : DEFAULT_TWEEN_TRANSITION));
}

export function getAppearanceFieldLabel(key: AppearancePropertyKey): string {
    switch (key) {
        case "backgroundColor":
            return "Background color";
        case "fillOpacity":
            return "Fill opacity";
        case "fillVisible":
            return "Fill visibility";
        case "borderWidth":
            return "Border width";
        case "borderColor":
            return "Border color";
        case "strokeOpacity":
            return "Border opacity";
        case "strokeVisible":
            return "Border visibility";
        case "strokeAlign":
            return "Border align";
        case "strokeSide":
            return "Border sides";
        case "borderJoin":
            return "Corner join";
        case "borderRadius":
            return "Corner radius";
        case "borderRadiusTL":
            return "Top-left radius";
        case "borderRadiusTR":
            return "Top-right radius";
        case "borderRadiusBL":
            return "Bottom-left radius";
        case "borderRadiusBR":
            return "Bottom-right radius";
        case "paddingX":
            return "Horizontal padding";
        case "paddingY":
            return "Vertical padding";
        case "fontSize":
            return "Font size";
        case "color":
            return "Text color";
        case "lineHeight":
            return "Line height";
        case "effectTextShadow":
            return "Text shadow";
        case "transformOffsetX":
            return "Offset X";
        case "transformOffsetY":
            return "Offset Y";
        case "transformScale":
            return "Zoom";
        case "transformRotation":
            return "Rotation";
        case "transformOpacity":
            return "Transform opacity";
        case "effectBlur":
            return "Blur";
        case "effectBackgroundBlur":
            return "Backdrop blur";
        case "effectShadow":
            return "Shadow";
        case "effectInnerShadow":
            return "Inner shadow";
        case "effectBlend":
            return "Blend mode";
        case "effectGlow":
            return "Glow";
        case "effectFilter":
            return "Filter";
        default:
            return key;
    }
}

export function formatAppearanceTransitionSummary(transition: AppearanceFieldTransition | null | undefined): string {
    if (!transition) {
        return "Off";
    }
    if (transition.type === "tween") {
        return `${transition.durationMs}ms ${transition.easing}`;
    }
    return `Spring ${transition.stiffness}/${transition.damping}`;
}

export function toRuntimeMotionTransition(transition: AppearanceFieldTransition): Record<string, unknown> {
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
        ease: transition.easing,
    };
}
