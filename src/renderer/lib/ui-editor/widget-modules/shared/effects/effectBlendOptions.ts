import type { TranslationKey } from "@shared/i18n";

export const BLEND_MODE_SELECT_OPTIONS: readonly { value: string; labelKey: TranslationKey }[] = [
    { value: "", labelKey: "widgetAppearance.blend.normal" },
    { value: "multiply", labelKey: "widgetAppearance.blend.multiply" },
    { value: "screen", labelKey: "widgetAppearance.blend.screen" },
    { value: "overlay", labelKey: "widgetAppearance.blend.overlay" },
    { value: "darken", labelKey: "widgetAppearance.blend.darken" },
    { value: "lighten", labelKey: "widgetAppearance.blend.lighten" },
    { value: "color-dodge", labelKey: "widgetAppearance.blend.colorDodge" },
    { value: "color-burn", labelKey: "widgetAppearance.blend.colorBurn" },
    { value: "hard-light", labelKey: "widgetAppearance.blend.hardLight" },
    { value: "soft-light", labelKey: "widgetAppearance.blend.softLight" },
    { value: "difference", labelKey: "widgetAppearance.blend.difference" },
    { value: "exclusion", labelKey: "widgetAppearance.blend.exclusion" },
    { value: "plus-lighter", labelKey: "widgetAppearance.blend.plusLighter" },
];
