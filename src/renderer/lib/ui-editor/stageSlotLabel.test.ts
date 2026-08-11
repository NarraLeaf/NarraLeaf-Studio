import { afterEach, describe, expect, it } from "vitest";
import { i18nStore, translate } from "@/lib/i18n";
import { UI_STAGE_SLOT_IDS } from "@shared/types/ui-editor/stageSlots";
import { getStageSlotLabel, getStageSlotOptions } from "./stageSlotLabel";

afterEach(() => {
    i18nStore.setLocale("en");
});

describe("stage slot labels", () => {
    // The Create Game UI dialog offers these five cards, name and explanation. Both used to be
    // English literals sitting beside the slot ids, so the dialog read English under a Chinese
    // interface - nothing about them ever passed through the translator, and no test noticed
    // because the two catalogues agreed: neither had the keys.
    it("names and describes every slot from the catalogue in the active locale", () => {
        const english = getStageSlotOptions(translate);
        i18nStore.setLocale("zh");
        const chinese = getStageSlotOptions(translate);

        UI_STAGE_SLOT_IDS.forEach((slotId, index) => {
            // A key with no entry resolves to the key itself.
            expect(chinese[index]!.label, slotId).not.toContain("uiEditor.stageSlot");
            expect(chinese[index]!.description, slotId).not.toContain("uiEditor.stageSlot");
            expect(chinese[index]!.description, slotId).not.toBe(english[index]!.description);
            if (slotId !== "nvl") {
                // "NVL" is the same word in both catalogues; the other four are not.
                expect(chinese[index]!.label, slotId).not.toBe(english[index]!.label);
            }
        });
    });

    it("falls back to the raw id for a slot the interface no longer knows", () => {
        expect(getStageSlotLabel("menu", translate)).toBe("menu");
    });
});
