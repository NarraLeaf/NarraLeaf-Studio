import type { TranslationKey } from "@shared/i18n";
import { formatStorySecondsLabel } from "@shared/utils/storyTime";
import { translate } from "@/lib/i18n";
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
    { value: "tween", labelKey: "widgetAppearance.motion.typeTween" },
    { value: "spring", labelKey: "widgetAppearance.motion.typeSpring" },
] as const satisfies readonly { value: string; labelKey: TranslationKey }[];

export const APPEARANCE_TWEEN_EASING_OPTIONS: { value: AppearanceTransitionTweenEasing; labelKey: TranslationKey }[] = [
    { value: "linear", labelKey: "widgetAppearance.motion.easingLinear" },
    { value: "easeIn", labelKey: "widgetAppearance.motion.easingIn" },
    { value: "easeOut", labelKey: "widgetAppearance.motion.easingOut" },
    { value: "easeInOut", labelKey: "widgetAppearance.motion.easingInOut" },
    { value: "circIn", labelKey: "widgetAppearance.motion.easingCircIn" },
    { value: "circOut", labelKey: "widgetAppearance.motion.easingCircOut" },
    { value: "circInOut", labelKey: "widgetAppearance.motion.easingCircInOut" },
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

const APPEARANCE_FIELD_LABEL_KEYS: Partial<Record<AppearancePropertyKey, TranslationKey>> = {
    backgroundColor: "widgetAppearance.fieldLabels.backgroundColor",
    fillOpacity: "widgetAppearance.fieldLabels.fillOpacity",
    fillVisible: "widgetAppearance.fieldLabels.fillVisibility",
    borderWidth: "widgetAppearance.fieldLabels.borderWidth",
    borderColor: "widgetAppearance.fieldLabels.borderColor",
    strokeOpacity: "widgetAppearance.fieldLabels.borderOpacity",
    strokeVisible: "widgetAppearance.fieldLabels.borderVisibility",
    strokeAlign: "widgetAppearance.fieldLabels.borderAlign",
    strokeSide: "widgetAppearance.fieldLabels.borderSides",
    borderJoin: "widgetAppearance.fieldLabels.cornerJoin",
    borderRadius: "widgetAppearance.fieldLabels.cornerRadius",
    borderRadiusTL: "widgetAppearance.fieldLabels.topLeftRadius",
    borderRadiusTR: "widgetAppearance.fieldLabels.topRightRadius",
    borderRadiusBL: "widgetAppearance.fieldLabels.bottomLeftRadius",
    borderRadiusBR: "widgetAppearance.fieldLabels.bottomRightRadius",
    paddingX: "widgetAppearance.fieldLabels.horizontalPadding",
    paddingY: "widgetAppearance.fieldLabels.verticalPadding",
    fontSize: "widgetAppearance.fieldLabels.fontSize",
    color: "widgetAppearance.fieldLabels.textColor",
    lineHeight: "widgetAppearance.fieldLabels.lineHeight",
    effectTextShadow: "widgetAppearance.fieldLabels.textShadow",
    transformOffsetX: "widgetAppearance.fieldLabels.offsetX",
    transformOffsetY: "widgetAppearance.fieldLabels.offsetY",
    transformScale: "widgetAppearance.fieldLabels.zoom",
    transformRotation: "widgetAppearance.fieldLabels.rotation",
    transformOpacity: "widgetAppearance.fieldLabels.transformOpacity",
    effectBlur: "widgetAppearance.fieldLabels.blur",
    effectBackgroundBlur: "widgetAppearance.fieldLabels.backdropBlur",
    effectShadow: "widgetAppearance.fieldLabels.shadow",
    effectInnerShadow: "widgetAppearance.fieldLabels.innerShadow",
    effectBlend: "widgetAppearance.fieldLabels.blendMode",
    effectGlow: "widgetAppearance.fieldLabels.glow",
    effectFilter: "widgetAppearance.fieldLabels.filter",
};

export function getAppearanceFieldLabel(key: AppearancePropertyKey): string {
    const labelKey = APPEARANCE_FIELD_LABEL_KEYS[key];
    return labelKey ? translate(labelKey) : key;
}

export function formatAppearanceTransitionSummary(transition: AppearanceFieldTransition | null | undefined): string {
    if (!transition) {
        return translate("widgetAppearance.motion.summaryOff");
    }
    if (transition.type === "tween") {
        return `${formatStorySecondsLabel(transition.durationMs)} ${transition.easing}`;
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
