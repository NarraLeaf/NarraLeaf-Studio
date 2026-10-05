import { afterEach, describe, expect, it } from "vitest";
import type { GameLocalizationBundle } from "../localization";
import { registerContributedWidgetSource } from "./contributedWidgets";
import type { UIElement } from "./document";
import {
    uiTextSiteLabel,
    uiTextSitesFromPluginDeclaration,
    uiTextSitesOf,
    uiTextSourceOf,
    uiTextUnitBindingOf,
    withUITextSitesResolved,
} from "./textSource";

/**
 * A plugin widget's words, as the host reads them: the sites its manifest declares, the readers' one
 * lookup for them, and the words its renderer is handed in the game and on the canvas.
 */

const TYPE = "acme.badges.badge";
const SITES = uiTextSitesFromPluginDeclaration(TYPE, [
    { prop: "caption", keyProp: "captionKey", label: "Caption", localized: { zh: "说明" } },
    { prop: "hint", multiline: true },
]);

let removeSource: (() => void) | null = null;

function contribute(): void {
    removeSource = registerContributedWidgetSource({
        get: type => (type === TYPE ? { type, ownerPluginId: "acme.badges", textSites: SITES } : undefined),
        list: () => [{ type: TYPE, ownerPluginId: "acme.badges", textSites: SITES }],
    });
}

afterEach(() => {
    removeSource?.();
    removeSource = null;
});

function badge(props: Record<string, unknown>): UIElement {
    return { id: "badge-1", type: TYPE, parentId: "root", childrenIds: [], layout: { x: 0, y: 0, width: 1, height: 1 }, props };
}

const BUNDLE: GameLocalizationBundle = {
    sourceLocale: "en",
    locales: [{ code: "en", displayName: "English" }, { code: "zh", displayName: "中文" }],
    tables: { zh: { "key:menu.treasure": "宝箱", "ui:badge-1.hint": "按下打开" } },
    keys: { "menu.treasure": "Treasure" },
};

describe("plugin text sites", () => {
    it("builds one site a player reads per declared prop, with the key prop the validator settled", () => {
        expect(SITES).toEqual([
            {
                widgetType: TYPE,
                textProp: "caption",
                role: "words",
                keyProp: "captionKey",
                canvasDrawsKey: true,
                typedOnCanvas: false,
                valueBinding: "none",
                label: "Caption",
                localizedLabel: { zh: "说明" },
            },
            {
                widgetType: TYPE,
                textProp: "hint",
                role: "words",
                keyProp: "hintLocalizationKey",
                canvasDrawsKey: true,
                typedOnCanvas: false,
                valueBinding: "none",
                multiline: true,
            },
        ]);
    });

    it("answers a plugin widget's sites only while its plugin is loaded", () => {
        expect(uiTextSitesOf(TYPE)).toEqual([]);
        contribute();
        expect(uiTextSitesOf(TYPE)).toBe(SITES);
        removeSource?.();
        removeSource = null;
        expect(uiTextSitesOf(TYPE)).toEqual([]);
    });

    it("reads each site's source and unit the way a text's are read", () => {
        const element = badge({ caption: "", captionKey: "menu.treasure", hint: "Press to open" });
        expect(SITES.map(site => uiTextSourceOf(element, site))).toEqual(["key", "literal"]);
        expect(SITES.map(site => uiTextUnitBindingOf(element, site))).toEqual([
            { kind: "key", keyName: "menu.treasure" },
            { kind: "implicit", unitId: "ui:badge-1.hint", sourceText: "Press to open" },
        ]);
    });

    it("hands the renderer every site's words in the player's language", () => {
        const element = badge({ captionKey: "menu.treasure", hint: "Press to open", tone: "gold" });
        const zh = withUITextSitesResolved(element, SITES, { kind: "game", bundle: BUNDLE, locale: "zh" });
        expect(zh.props).toEqual({ captionKey: "menu.treasure", caption: "宝箱", hint: "按下打开", tone: "gold" });
        const en = withUITextSitesResolved(element, SITES, { kind: "game", bundle: BUNDLE, locale: "en" });
        expect(en.props).toMatchObject({ caption: "Treasure", hint: "Press to open" });
    });

    it("draws a key's source words on the canvas, and the element untouched when nothing changes", () => {
        const keyed = badge({ captionKey: "menu.treasure", hint: "Press" });
        expect(withUITextSitesResolved(keyed, SITES, { kind: "canvas", keys: { "menu.treasure": "Treasure" } }).props)
            .toMatchObject({ caption: "Treasure", hint: "Press" });
        const plain = badge({ caption: "Gold", hint: "Press" });
        expect(withUITextSitesResolved(plain, SITES, { kind: "canvas", keys: {} })).toBe(plain);
    });

    it("names a site by its label in the editor's language, else its label, else its prop", () => {
        expect(uiTextSiteLabel(SITES[0], "zh")).toBe("说明");
        expect(uiTextSiteLabel(SITES[0], "ja")).toBe("Caption");
        expect(uiTextSiteLabel(SITES[1], "zh")).toBe("hint");
    });
});
