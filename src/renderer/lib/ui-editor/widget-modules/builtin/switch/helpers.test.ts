import { describe, expect, it } from "vitest";
import type { AppearanceModel } from "@shared/types/ui-editor/appearance";
import { UI_SWITCH_ON_VARIANT_ID, type UISwitchChildSlot } from "@shared/types/ui-editor/switch";
import { getStateMotions, resolveStateMotionOffset } from "@shared/types/ui-editor/stateMotion";
import { resolveContainerAppearanceTransitions } from "@/lib/ui-editor/runtime/appearance/AppearanceResolver";
import { DEFAULT_SYSTEM_INTERACTION_SIGNALS } from "@/lib/ui-editor/runtime/appearance/SystemInteractionState";
import { SwitchWidgetModule } from "../switch";
import { createSwitchPartProps } from "./helpers";

function appearanceOf(kind: UISwitchChildSlot): AppearanceModel {
    return createSwitchPartProps(kind).appearance as AppearanceModel;
}

function groupIn(model: AppearanceModel, variantId: string, key: string) {
    return model.variants.find(variant => variant.id === variantId)?.propertyGroups.find(group => group.key === key);
}

describe("switch part appearance", () => {
    it("gives the track the same colour transition in both states", () => {
        const model = appearanceOf("track");

        // Both, not just `on`: a transition on the state it flips to alone would take the colour one
        // way and let it snap back.
        expect(groupIn(model, model.defaultVariantId, "backgroundColor")?.transition).toBeDefined();
        expect(groupIn(model, UI_SWITCH_ON_VARIANT_ID, "backgroundColor")?.transition).toEqual(
            groupIn(model, model.defaultVariantId, "backgroundColor")?.transition,
        );
    });

    it("resolves the track's colour in both directions", () => {
        const model = appearanceOf("track");
        const resolve = (variantOverrideId: string | null) =>
            resolveContainerAppearanceTransitions(model, {
                variantOverrideId,
                signals: DEFAULT_SYSTEM_INTERACTION_SIGNALS,
            }).backgroundColor;

        expect(resolve(UI_SWITCH_ON_VARIANT_ID)).toBeDefined();
        expect(resolve(null)).toBeDefined();
    });

    it("leaves the thumb's position out of its states entirely", () => {
        const model = appearanceOf("thumb");

        // Where the thumb sits is the thumb's own geometry, dragged like anything else. A state that
        // carried a position would be a second owner of it.
        for (const variant of model.variants) {
            expect(groupIn(model, variant.id, "transformOffsetX")?.rows[0]?.value).toBe(0);
        }
    });
});

describe("switch default children", () => {
    const element = {
        id: "switch",
        type: "nl.switch",
        name: "Switch",
        parentId: null,
        childrenIds: [],
        layout: { x: 0, y: 0, width: 52, height: 28 },
        props: {},
    } as const;

    it("puts the travel on the switch as the motion it applies while on", () => {
        let next = 0;
        const result = SwitchWidgetModule.createDefaultChildElements?.({
            element: element as never,
            generateId: () => `id-${++next}`,
        });
        const motions = getStateMotions(result?.elementPatch?.props as Record<string, unknown>);
        const thumb = result?.children.find(child => child.extra?.switchSlot === "thumb");

        expect(thumb).toBeDefined();
        expect(motions).toHaveLength(1);
        expect(resolveStateMotionOffset(motions, UI_SWITCH_ON_VARIANT_ID, thumb!.id)).toMatchObject({ x: 24, y: 0 });
        // Off is the same motion with nowhere to go, which is what makes the way back move too.
        expect(resolveStateMotionOffset(motions, null, thumb!.id)).toMatchObject({ x: 0, y: 0 });
    });
});
