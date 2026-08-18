import { describe, expect, it } from "vitest";
import type { AppearanceModel } from "@shared/types/ui-editor/appearance";
import { UI_SWITCH_ON_VARIANT_ID, type UISwitchChildSlot } from "@shared/types/ui-editor/switch";
import { resolveContainerAppearanceTransitions } from "@/lib/ui-editor/runtime/appearance/AppearanceResolver";
import { DEFAULT_SYSTEM_INTERACTION_SIGNALS } from "@/lib/ui-editor/runtime/appearance/SystemInteractionState";
import { createSwitchPartProps } from "./helpers";

const ANIMATED_KEY: Record<UISwitchChildSlot, string> = {
    track: "backgroundColor",
    thumb: "transformOffsetX",
};

function appearanceOf(kind: UISwitchChildSlot, travel: number): AppearanceModel {
    return createSwitchPartProps(kind, travel).appearance as AppearanceModel;
}

function transitionOn(model: AppearanceModel, variantId: string, key: string) {
    return model.variants.find(variant => variant.id === variantId)
        ?.propertyGroups.find(group => group.key === key)?.transition;
}

describe("switch part appearance", () => {
    it.each(["track", "thumb"] as const)("gives %s the same transition in both states", kind => {
        const model = appearanceOf(kind, 24);
        const key = ANIMATED_KEY[kind];

        // Both, not just `on`: a transition on the state it flips to alone would take the part one
        // way and let it snap back.
        expect(transitionOn(model, model.defaultVariantId, key)).toBeDefined();
        expect(transitionOn(model, UI_SWITCH_ON_VARIANT_ID, key)).toEqual(
            transitionOn(model, model.defaultVariantId, key)
        );
    });

    it.each(["track", "thumb"] as const)("resolves %s motion in both directions", kind => {
        const model = appearanceOf(kind, 24);
        const key = ANIMATED_KEY[kind];
        const resolve = (variantOverrideId: string | null) =>
            resolveContainerAppearanceTransitions(model, {
                variantOverrideId,
                signals: DEFAULT_SYSTEM_INTERACTION_SIGNALS,
            })[key as "transformOffsetX"];

        expect(resolve(UI_SWITCH_ON_VARIANT_ID)).toBeDefined();
        expect(resolve(null)).toBeDefined();
    });

    it("puts the travel on the thumb's on state only", () => {
        const model = appearanceOf("thumb", 24);
        const offsetIn = (variantId: string) =>
            model.variants.find(variant => variant.id === variantId)
                ?.propertyGroups.find(group => group.key === "transformOffsetX")?.rows[0]?.value;

        expect(offsetIn(UI_SWITCH_ON_VARIANT_ID)).toBe(24);
        expect(offsetIn(model.defaultVariantId)).toBe(0);
    });
});
