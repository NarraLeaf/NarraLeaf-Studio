import { afterEach, describe, expect, it } from "vitest";
import { i18nStore, translate } from "@/lib/i18n";
import { DEFAULT_APP_SURFACE_NAME, MAIN_APP_SURFACE_ID } from "@shared/constants/ui-editor";
import type { UIAppSurface, UIStageSurface } from "@shared/types/ui-editor/document";
import { getSurfaceDisplayLabel, getSurfaceRenameNoun } from "./surfaceDisplayLabel";

const common = {
    name: "Title",
    designSize: { width: 1280, height: 720 },
    rootElementId: "root",
};

const page: UIAppSurface = { ...common, id: "surface-1", host: "app", kind: "appSurface" };
const gameUi: UIStageSurface = {
    ...common,
    id: "surface-2",
    host: "player",
    kind: "stageSurface",
    mount: { kind: "slot", slotId: "dialog" },
};
const mainPage: UIAppSurface = { ...page, id: MAIN_APP_SURFACE_ID, name: DEFAULT_APP_SURFACE_NAME };

afterEach(() => {
    i18nStore.setLocale("en");
});

describe("what to call a surface", () => {
    // The rename dialog builds its own sentence from a `dialogs.noun.*` key, so it must be handed
    // the key. It used to be handed the finished English words "Page" / "Game UI", which have no
    // entry, and `nounFor` passes an unknown string through - so a Chinese author read
    // "重命名 Game UI".
    it("hands the rename dialog a noun key it can translate", () => {
        for (const [kind, subject] of [["page", page], ["gameUi", gameUi]] as const) {
            const noun = getSurfaceRenameNoun(subject);
            expect(noun, kind).toBe(kind);
            for (const locale of ["en", "zh"] as const) {
                i18nStore.setLocale(locale);
                expect(i18nStore.getTranslator().has(`dialogs.noun.${noun}`), `${kind}/${locale}`).toBe(true);
            }
        }
    });

    // The one surface an author knows by name rather than by kind: "Rename Main Page", not
    // "Rename page". An unknown noun reaching `nounFor` unchanged is what makes that read right.
    it("names the main page instead of typing it", () => {
        expect(getSurfaceRenameNoun(mainPage)).toBe(DEFAULT_APP_SURFACE_NAME);
        expect(i18nStore.getTranslator().has(`dialogs.noun.${DEFAULT_APP_SURFACE_NAME}`)).toBe(false);
        expect(getSurfaceDisplayLabel(mainPage, translate)).toBe(DEFAULT_APP_SURFACE_NAME);
    });

    it("follows the interface language everywhere else", () => {
        i18nStore.setLocale("zh");
        expect(getSurfaceDisplayLabel(page, translate)).toBe("页面");
        expect(getSurfaceDisplayLabel(gameUi, translate)).toBe("游戏 UI");
    });
});
