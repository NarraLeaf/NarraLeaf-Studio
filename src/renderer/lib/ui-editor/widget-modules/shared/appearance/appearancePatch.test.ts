import { describe, expect, it } from "vitest";
import type { AppearanceModel } from "@shared/types/ui-editor/appearance";
import { renameVariant } from "./appearancePatch";

function createModel(): AppearanceModel {
    return {
        defaultVariantId: "variant-default",
        variants: [
            {
                id: "variant-default",
                name: "Default",
                propertyGroups: [],
            },
        ],
    };
}

describe("appearancePatch", () => {
    it("allows clearing a variant name", () => {
        const next = renameVariant(createModel(), "variant-default", "");

        expect(next.variants[0].name).toBe("");
    });

    it("trims variant names without falling back to the previous name", () => {
        const next = renameVariant(createModel(), "variant-default", "  Hover  ");

        expect(next.variants[0].name).toBe("Hover");
    });
});
