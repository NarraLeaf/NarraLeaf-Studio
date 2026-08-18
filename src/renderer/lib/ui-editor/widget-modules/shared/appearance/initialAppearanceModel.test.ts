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
  isUsableAppearanceModel
} from "./initialAppearanceModel";

const bare = { props: {} };

function createAll() {
  return {
    container: createInitialContainerAppearance(getContainerProps(bare as never)),
    button: createInitialButtonAppearance(getButtonProps(bare as never)),
    text: createInitialTextAppearance(getTextProps(bare as never)),
    image: createInitialImageAppearance(getRectangleLikeProps(bare as never))
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
