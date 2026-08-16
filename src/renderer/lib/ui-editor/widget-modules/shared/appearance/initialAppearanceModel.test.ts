import { afterEach, describe, expect, it } from "vitest";
import { i18nStore } from "@/lib/i18n";
import { getRectangleLikeProps } from "@/lib/ui-editor/widget-modules/shared/chrome/rectangleHelpers";
import { getContainerProps } from "@/lib/ui-editor/widget-modules/builtin/container/helpers";
import { getButtonProps } from "@/lib/ui-editor/widget-modules/builtin/button/helpers";
import { getTextProps } from "@/lib/ui-editor/widget-modules/builtin/text/helpers";
import {
    DEFAULT_APPEARANCE_VARIANT_NAME,
    createInitialButtonAppearance,
    createInitialContainerAppearance,
    createInitialImageAppearance,
    createInitialTextAppearance,
    ensureContainerAppearanceHasAllKeys,
    isUsableAppearanceModel,
} from "./initialAppearanceModel";

const bare = { props: {} };

function createAll() {
    return {
        container: createInitialContainerAppearance(getContainerProps(bare as never)),
        button: createInitialButtonAppearance(getButtonProps(bare as never)),
        text: createInitialTextAppearance(getTextProps(bare as never)),
        image: createInitialImageAppearance(getRectangleLikeProps(bare as never)),
    };
}

afterEach(() => {
    i18nStore.setLocale("en");
});

describe("initial appearance models", () => {
    // The name is written into the project file, so it must not follow the Studio's UI language:
    // the bundled skeleton template shipped 204 variants named "默认" because it was authored on a
    // Chinese Studio, and every author who opened it read that.
    it("names the default variant in English whatever the UI locale is", () => {
        i18nStore.setLocale("zh");
        for (const [kind, model] of Object.entries(createAll())) {
            expect(model.variants[0]?.name, kind).toBe(DEFAULT_APPEARANCE_VARIANT_NAME);
            expect(model.variants[0]?.name, kind).toBe("Default");
        }
    });

    // Every element authored through the services - the whole of a bundled template - carries flat
    // props and no appearance. The synthesized model is what makes those elements editable, so it
    // has to pass the panel's own gate.
    it("synthesizes a usable model from flat props alone", () => {
        for (const [kind, model] of Object.entries(createAll())) {
            expect(isUsableAppearanceModel(model), kind).toBe(true);
            expect(model.variants[0]?.id, kind).toBe(model.defaultVariantId);
            expect(model.variants[0]?.propertyGroups.length, kind).toBeGreaterThan(0);
        }
    });
});

/**
 * A key absent from the seed is not a type error anywhere - the model is a list of groups, not a
 * record - so the only thing standing between "gradientFill is registered" and "the row never
 * appears and a variant can never hold one" is a test that asks for it by name.
 */
describe("gradient fill is a seeded appearance key", () => {
    function groupKeys(model: { variants: { propertyGroups: { key: string }[] }[] }): string[] {
        return model.variants[0]?.propertyGroups.map(group => group.key) ?? [];
    }

    it("seeds a gradientFill group on every chrome-bearing widget", () => {
        const { container, button, image } = createAll();
        for (const [kind, model] of Object.entries({ container, button, image })) {
            expect(groupKeys(model), kind).toContain("gradientFill");
        }
    });

    it("seeds it as absent rather than as a gradient nobody authored", () => {
        const { container, button, image } = createAll();
        for (const [kind, model] of Object.entries({ container, button, image })) {
            const group = model.variants[0]?.propertyGroups.find(g => g.key === "gradientFill");
            expect(group?.rows[0]?.value, kind).toBeNull();
        }
    });

    it("appends it to a model saved before gradients existed", () => {
        const flat = getContainerProps(bare as never);
        const before = createInitialContainerAppearance(flat);
        const withoutGradient = {
            ...before,
            variants: before.variants.map(variant => ({
                ...variant,
                propertyGroups: variant.propertyGroups.filter(group => group.key !== "gradientFill"),
            })),
        };

        expect(groupKeys(ensureContainerAppearanceHasAllKeys(withoutGradient, flat))).toContain("gradientFill");
    });
});
