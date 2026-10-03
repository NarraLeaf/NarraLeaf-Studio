import { afterEach, describe, expect, it } from "vitest";
import { i18nStore, translate } from "@/lib/i18n";
import { MAIN_APP_SURFACE_ID } from "@shared/constants/ui-editor";
import type { UIAppSurface, UIDocument, UIStageSurface } from "@shared/types/ui-editor/document";
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
const mainPage: UIAppSurface = { ...page, id: MAIN_APP_SURFACE_ID, name: "Title" };

/** A document that names no entry, so the main page is it. */
const unmoved: Pick<UIDocument, "surfaces" | "entrySurfaceId"> = { surfaces: [mainPage, page, gameUi] };
/** The same pages with the entry moved onto `page`. */
const moved: Pick<UIDocument, "surfaces" | "entrySurfaceId"> = { ...unmoved, entrySurfaceId: page.id };

afterEach(() => {
    i18nStore.setLocale("en");
});

describe("what to call a surface", () => {
    // The rename dialog builds its own sentence from a `dialogs.noun.*` key, so it must be handed
    // the key. It used to be handed the finished English words "Page" / "Game UI", which have no
    // entry, and `nounFor` passes an unknown string through - so a Chinese author read
    // "重命名 Game UI".
    it("hands the rename dialog a noun key it can translate", () => {
        for (const [kind, subject] of [["page", page], ["gameUi", gameUi], ["entryPage", mainPage]] as const) {
            const noun = getSurfaceRenameNoun(subject, unmoved);
            expect(noun, kind).toBe(kind);
            for (const locale of ["en", "zh", "ja"] as const) {
                i18nStore.setLocale(locale);
                expect(i18nStore.getTranslator().has(`dialogs.noun.${noun}`), `${kind}/${locale}`).toBe(true);
            }
        }
    });

    // The page that is set apart is the one the game starts on, wherever that is. It used to be the
    // page with the main id, under its English default name in every language - "重命名 Main Page"
    // for a page the author had named Title.
    it("names the entry page as the entry page, and follows it when it moves", () => {
        expect(getSurfaceDisplayLabel(mainPage, unmoved, translate)).toBe("Entry Page");
        expect(getSurfaceDisplayLabel(page, unmoved, translate)).toBe("Page");

        expect(getSurfaceDisplayLabel(mainPage, moved, translate)).toBe("Page");
        expect(getSurfaceDisplayLabel(page, moved, translate)).toBe("Entry Page");
        expect(getSurfaceRenameNoun(mainPage, moved)).toBe("page");
        expect(getSurfaceRenameNoun(page, moved)).toBe("entryPage");
    });

    it("follows the interface language", () => {
        i18nStore.setLocale("zh");
        expect(getSurfaceDisplayLabel(mainPage, unmoved, translate)).toBe("入口页面");
        expect(getSurfaceDisplayLabel(page, unmoved, translate)).toBe("页面");
        expect(getSurfaceDisplayLabel(gameUi, unmoved, translate)).toBe("游戏 UI");
    });
});
