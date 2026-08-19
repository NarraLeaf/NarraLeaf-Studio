import { describe, expect, it } from "vitest";
import type { AppearanceModel } from "@shared/types/ui-editor/appearance";
import { UI_SWITCH_ON_VARIANT_ID, type UISwitchChildSlot } from "@shared/types/ui-editor/switch";
import { getStateMotions } from "@shared/types/ui-editor/stateMotion";
import { resolveContainerAppearanceTransitions } from "@/lib/ui-editor/runtime/appearance/AppearanceResolver";
import { DEFAULT_SYSTEM_INTERACTION_SIGNALS } from "@/lib/ui-editor/runtime/appearance/SystemInteractionState";
import { SwitchWidgetModule } from "../switch";
import { createSwitchPartProps } from "./helpers";

function appearanceOf(kind: UISwitchChildSlot, travel = 0): AppearanceModel {
    return createSwitchPartProps(kind, travel).appearance as AppearanceModel;
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

    it("puts the thumb's travel in its on state, with the trip animated both ways", () => {
        const model = appearanceOf("thumb", 24);

        // Where a part sits in a state belongs to that state, the same way the track's colour does:
        // it is what an author edits by dragging the thumb while looking at the on state.
        expect(groupIn(model, model.defaultVariantId, "transformOffsetX")?.rows[0]?.value).toBe(0);
        expect(groupIn(model, UI_SWITCH_ON_VARIANT_ID, "transformOffsetX")?.rows[0]?.value).toBe(24);
        expect(groupIn(model, model.defaultVariantId, "transformOffsetX")?.transition).toEqual(
            groupIn(model, UI_SWITCH_ON_VARIANT_ID, "transformOffsetX")?.transition,
        );
        expect(groupIn(model, UI_SWITCH_ON_VARIANT_ID, "transformOffsetX")?.transition).toBeDefined();
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

    it("gives the thumb its travel and leaves the switch holding no motion of its own", () => {
        let next = 0;
        const result = SwitchWidgetModule.createDefaultChildElements?.({
            element: element as never,
            generateId: () => `id-${++next}`,
        });
        const thumb = result?.children.find(child => child.extra?.switchSlot === "thumb");
        const thumbModel = (thumb?.props as { appearance?: AppearanceModel } | undefined)?.appearance;

        expect(thumb).toBeDefined();
        expect(thumbModel).toBeDefined();
        // The travel is the thumb's position in the on state, not something the switch layers over
        // it: one owner, editable by dragging, animated by the field's own transition.
        expect(groupIn(thumbModel!, UI_SWITCH_ON_VARIANT_ID, "transformOffsetX")?.rows[0]?.value).toBe(24);
        expect(groupIn(thumbModel!, thumbModel!.defaultVariantId, "transformOffsetX")?.rows[0]?.value).toBe(0);
        expect(getStateMotions(result?.elementPatch?.props as Record<string, unknown>)).toHaveLength(0);
    });
});
