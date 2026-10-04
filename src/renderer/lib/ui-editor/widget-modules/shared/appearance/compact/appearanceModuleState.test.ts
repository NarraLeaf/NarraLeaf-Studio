import { describe, expect, it } from "vitest";
import type { AppearanceVariant } from "@shared/types/ui-editor/appearance";
import {
    BUTTON_MODULE_KEYS,
    listModuleExclusiveStatesPresent,
    moduleHasExclusiveState,
    removeModuleExclusiveState,
    updateRowValueForModuleEditOrEnsure,
} from "./appearanceModuleState";

/** The shape of the shipped title buttons' Transform module: one hovered row, on X offset alone. */
function transformWithHoveredOffset(): AppearanceVariant {
    return {
        id: "default",
        name: "Default",
        propertyGroups: [
            { key: "transformOffsetX", rows: [{ conditions: null, value: 0 }, { conditions: { hovered: true }, value: -8 }] },
            { key: "transformOffsetY", rows: [{ conditions: null, value: 0 }] },
            { key: "transformScale", rows: [{ conditions: null, value: 1 }] },
            { key: "transformRotation", rows: [{ conditions: null, value: 0 }] },
            { key: "transformOpacity", rows: [{ conditions: null, value: 1 }] },
        ],
    } as AppearanceVariant;
}

function rowsOf(variant: AppearanceVariant, key: string) {
    return variant.propertyGroups.find(group => group.key === key)?.rows ?? [];
}

describe("appearance module states", () => {
    it("offers a state as soon as one property of the module has a row for it", () => {
        const variant = transformWithHoveredOffset();

        expect(moduleHasExclusiveState(variant, BUTTON_MODULE_KEYS.transform, "hovered")).toBe(true);
        expect(listModuleExclusiveStatesPresent(variant, BUTTON_MODULE_KEYS.transform)).toEqual(["hovered"]);
        expect(listModuleExclusiveStatesPresent(variant, BUTTON_MODULE_KEYS.effects)).toEqual([]);
    });

    it("writes only the edited property's row in a module that already has the state", () => {
        const next = updateRowValueForModuleEditOrEnsure(
            transformWithHoveredOffset(),
            BUTTON_MODULE_KEYS.transform,
            "transformScale",
            "hovered",
            1.05,
        );

        expect(rowsOf(next, "transformScale")).toEqual([
            { conditions: null, value: 1 },
            { conditions: { hovered: true }, value: 1.05 },
        ]);
        expect(rowsOf(next, "transformOffsetX")[1]).toEqual({ conditions: { hovered: true }, value: -8 });
        // The rest still follow the default rather than being pinned to a copy of it.
        expect(rowsOf(next, "transformOffsetY")).toHaveLength(1);
        expect(rowsOf(next, "transformOpacity")).toHaveLength(1);
    });

    it("gives a module the whole state when it had none of it", () => {
        const next = updateRowValueForModuleEditOrEnsure(
            transformWithHoveredOffset(),
            BUTTON_MODULE_KEYS.transform,
            "transformScale",
            "active",
            0.95,
        );

        expect(rowsOf(next, "transformScale").at(-1)).toEqual({ conditions: { active: true }, value: 0.95 });
        expect(rowsOf(next, "transformOffsetY").at(-1)).toEqual({ conditions: { active: true }, value: 0 });
    });

    it("removes every row of the state, however few properties carried one", () => {
        const next = removeModuleExclusiveState(transformWithHoveredOffset(), BUTTON_MODULE_KEYS.transform, "hovered");

        expect(moduleHasExclusiveState(next, BUTTON_MODULE_KEYS.transform, "hovered")).toBe(false);
        expect(rowsOf(next, "transformOffsetX")).toEqual([{ conditions: null, value: 0 }]);
    });
});
