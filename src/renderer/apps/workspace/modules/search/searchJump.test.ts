import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { EditorTabDefinition } from "../../registry/types";
import { consumeAssetSetReveal } from "../assets/assetSetReveal";
import { storyVariableReveal, STORY_VARIABLES_PANEL_ID } from "../story-variables/storyVariablesPanelId";
import { STORY_PANEL_ID, storyPanelReveal } from "../story/panel/storyPanelReveal";
import { PROJECT_PANEL_ID } from "../project";
import { jumpToSearchTarget } from "./searchJump";

/**
 * The jumps that land on a row rather than on a document: a translation, a take, a variable, a
 * story's own entry, a file with no preview tab, a part of a Project page.
 *
 * Each is asked both ways. Where the thing it names is there, the jump has to open the editor or
 * panel that holds it AND hand that editor the row - the half that was missing when a jump "worked"
 * by showing a panel with nothing in it selected. Where it is gone, the jump answers false and opens
 * nothing, so the caller can say so instead of leaving the author looking at an unrelated page.
 */

const ASSETS_PANEL_ID = "narraleaf-studio:assets";
const LOCALIZATION_PANEL_ID = "narraleaf-studio:localization";

type Opened = EditorTabDefinition<{ reveal?: { unitId: string; storyId?: string; token: number } } & Record<string, unknown>>;

function harness(services: Partial<Record<Services, unknown>>) {
    const opened: Opened[] = [];
    const panels: Record<string, boolean> = {};
    const selections: unknown[] = [];
    const panelPayloads: Record<string, unknown> = {};
    const ui = {
        getStore: () => ({ setSelection: (selection: unknown) => selections.push(selection) }),
        panels: {
            updatePayload: (id: string, payload: unknown) => { panelPayloads[id] = payload; },
            show: (id: string) => { panels[id] = true; },
        },
        editor: { get: () => undefined },
    };
    const context = {
        services: {
            get: (id: Services) => {
                if (id === Services.UI) {
                    return ui;
                }
                if (!(id in services)) {
                    throw new Error(`no ${id} service`);
                }
                return services[id];
            },
        },
    } as unknown as WorkspaceContext;
    return {
        context,
        opened,
        panels,
        selections,
        panelPayloads,
        deps: {
            openEditorTab: (tab: EditorTabDefinition<any>) => opened.push(tab as Opened),
            setPanelVisibility: (id: string, visible: boolean) => { panels[id] = visible; },
            context,
        },
    };
}

const localizationService = (options: { locales?: string[]; source?: string; keys?: Record<string, unknown> | null } = {}) => ({
    getConfiguration: () => ({
        sourceLocale: options.source ?? "en",
        locales: (options.locales ?? ["en", "ja"]).map(code => ({ code, displayName: code === "ja" ? "日本語" : code })),
    }),
    getKeysIfLoaded: () => (options.keys === null ? undefined : { schemaVersion: 1, keys: options.keys ?? {} }),
});

beforeEach(() => {
    // The panel reveals are dispatched on the next frame; the pending slot is what these read.
    vi.stubGlobal("requestAnimationFrame", () => 0);
});

afterEach(() => {
    vi.unstubAllGlobals();
    storyVariableReveal.consume();
    storyPanelReveal.consume();
    consumeAssetSetReveal(ASSETS_PANEL_ID);
});

describe("translation", () => {
    it("opens the language's table with the row to reveal, and a fresh token each time", () => {
        const { deps, opened } = harness({ [Services.Localization]: localizationService() });
        const target = { kind: "translation" as const, locale: "ja", unitId: "t-1", storyId: "s1" };

        expect(jumpToSearchTarget(target, deps)).toBe(true);
        expect(jumpToSearchTarget(target, deps)).toBe(true);

        expect(opened.map(tab => tab.id)).toEqual(["localization:table:ja", "localization:table:ja"]);
        expect(opened[0]!.title).toBe("日本語");
        expect(opened[0]!.payload?.reveal).toMatchObject({ unitId: "t-1", storyId: "s1" });
        // Asking for the same row twice is two requests: the table re-reveals on the second.
        expect(opened[1]!.payload?.reveal?.token).not.toBe(opened[0]!.payload?.reveal?.token);
    });

    it("opens just the table when no row is named", () => {
        const { deps, opened } = harness({ [Services.Localization]: localizationService() });
        expect(jumpToSearchTarget({ kind: "translation", locale: "ja" }, deps)).toBe(true);
        expect(opened[0]!.payload?.reveal).toBeUndefined();
    });

    it("declines a language the project no longer has", () => {
        const { deps, opened } = harness({ [Services.Localization]: localizationService({ locales: ["en"] }) });
        expect(jumpToSearchTarget({ kind: "translation", locale: "ja", unitId: "t-1" }, deps)).toBe(false);
        expect(opened).toEqual([]);
    });
});

describe("localizationKey", () => {
    it("opens the first translated language's table at the key's row", () => {
        const { deps, opened } = harness({ [Services.Localization]: localizationService({ keys: { "menu.start": { sourceText: "Start" } } }) });
        expect(jumpToSearchTarget({ kind: "localizationKey", keyName: "menu.start" }, deps)).toBe(true);
        expect(opened[0]!.id).toBe("localization:table:ja");
        // The interface source: no story named.
        expect(opened[0]!.payload?.reveal).toMatchObject({ unitId: "key:menu.start" });
        expect(opened[0]!.payload?.reveal?.storyId).toBeUndefined();
    });

    it("declines a key the registry no longer has", () => {
        const { deps, opened } = harness({ [Services.Localization]: localizationService({ keys: {} }) });
        expect(jumpToSearchTarget({ kind: "localizationKey", keyName: "menu.gone" }, deps)).toBe(false);
        expect(opened).toEqual([]);
    });

    it("shows the Localization panel when the project translates into nothing", () => {
        const { deps, opened, panels } = harness({ [Services.Localization]: localizationService({ locales: ["en"], keys: { k: {} } }) });
        expect(jumpToSearchTarget({ kind: "localizationKey", keyName: "k" }, deps)).toBe(true);
        expect(opened).toEqual([]);
        expect(panels[LOCALIZATION_PANEL_ID]).toBe(true);
    });
});

describe("voiceLine", () => {
    const voiceService = { getConfiguration: () => ({ voicedLocales: [{ code: "ja", displayName: "日本語" }], namingPattern: "", cast: {} }) };

    it("opens the language's voice table with the line to reveal", () => {
        const { deps, opened } = harness({ [Services.Voice]: voiceService });
        expect(jumpToSearchTarget({ kind: "voiceLine", locale: "ja", unitId: "t-1" }, deps)).toBe(true);
        expect(opened[0]!.id).toBe("voice:table:ja");
        expect(opened[0]!.payload?.reveal).toMatchObject({ unitId: "t-1" });
    });

    it("declines a language that is no longer voiced", () => {
        const { deps, opened } = harness({ [Services.Voice]: voiceService });
        expect(jumpToSearchTarget({ kind: "voiceLine", locale: "fr", unitId: "t-1" }, deps)).toBe(false);
        expect(opened).toEqual([]);
    });
});

describe("storyVariable", () => {
    const registry = { getEntry: (id: string) => (id === "reg-1" ? { id, scope: "persistent" } : undefined) };

    it("shows the Variables panel and asks it for the variable's row", () => {
        const { deps, panels } = harness({ [Services.VariableRegistry]: registry, [Services.Story]: { listStories: () => [] } });
        expect(jumpToSearchTarget({ kind: "storyVariable", scope: "persistent", variableId: "reg-1" }, deps)).toBe(true);
        expect(panels[STORY_VARIABLES_PANEL_ID]).toBe(true);
        expect(storyVariableReveal.consume()).toEqual({ scope: "persistent", variableId: "reg-1" });
    });

    it("declines a variable nothing declares any more", () => {
        const { deps, panels } = harness({ [Services.VariableRegistry]: registry, [Services.Story]: { listStories: () => [] } });
        expect(jumpToSearchTarget({ kind: "storyVariable", scope: "saved", variableId: "gone" }, deps)).toBe(false);
        expect(panels[STORY_VARIABLES_PANEL_ID]).toBeUndefined();
        expect(storyVariableReveal.consume()).toBeNull();
    });
});

describe("storyEntry", () => {
    const stories = { listStories: () => [{ id: "s1", name: "Main" }] };

    it("shows the Story panel and asks it to select the story's row", () => {
        const { deps, panels } = harness({ [Services.Story]: stories });
        expect(jumpToSearchTarget({ kind: "storyEntry", storyId: "s1", storyName: "Main" }, deps)).toBe(true);
        expect(panels[STORY_PANEL_ID]).toBe(true);
        expect(storyPanelReveal.consume()).toEqual({ storyId: "s1" });
    });

    it("declines a story the library no longer lists", () => {
        const { deps } = harness({ [Services.Story]: stories });
        expect(jumpToSearchTarget({ kind: "storyEntry", storyId: "gone", storyName: "Gone" }, deps)).toBe(false);
        expect(storyPanelReveal.consume()).toBeNull();
    });
});

describe("storyMotion", () => {
    it("opens the motion's editor", () => {
        const { deps, opened } = harness({ [Services.Story]: { listAnimationAssets: () => [{ id: "shake" }] } });
        expect(jumpToSearchTarget({ kind: "storyMotion", animationId: "shake" }, deps)).toBe(true);
        expect(opened[0]!.id).toBe("story-motion:shake");
    });

    it("declines a motion that is gone, and one it cannot look up yet", () => {
        const { deps, opened } = harness({ [Services.Story]: { listAnimationAssets: () => [] } });
        expect(jumpToSearchTarget({ kind: "storyMotion", animationId: "shake" }, deps)).toBe(false);
        const unread = harness({ [Services.Story]: { listAnimationAssets: () => { throw new Error("not read"); } } });
        expect(jumpToSearchTarget({ kind: "storyMotion", animationId: "shake" }, unread.deps)).toBe(false);
        expect([...opened, ...unread.opened]).toEqual([]);
    });
});

describe("projectPage", () => {
    it("opens the Project panel on the page, at the part", () => {
        const { deps, panels, panelPayloads } = harness({});
        expect(jumpToSearchTarget({ kind: "projectPage", page: "design", part: "fonts" }, deps)).toBe(true);
        expect(panels[PROJECT_PANEL_ID]).toBe(true);
        expect(panelPayloads[PROJECT_PANEL_ID]).toEqual({ section: "design", part: "fonts" });
    });
});

describe("asset", () => {
    const font = { id: "font-1", type: AssetType.Font, name: "Serif.ttf" };
    const assets = { getAssets: () => ({ [AssetType.Font]: { [font.id]: font } }) };

    it("reveals a file with no preview tab in the library, selected", () => {
        const { deps, panels, selections } = harness({ [Services.Assets]: assets });
        expect(jumpToSearchTarget({ kind: "asset", assetId: "font-1", assetType: "font" }, deps)).toBe(true);
        expect(panels[ASSETS_PANEL_ID]).toBe(true);
        expect(selections).toEqual([{ type: "asset", data: font }]);
        expect(consumeAssetSetReveal(ASSETS_PANEL_ID)).toEqual({ kind: "asset", id: "font-1" });
    });

    it("declines a file the library no longer has", () => {
        const { deps, panels } = harness({ [Services.Assets]: assets });
        expect(jumpToSearchTarget({ kind: "asset", assetId: "gone", assetType: "font" }, deps)).toBe(false);
        expect(panels[ASSETS_PANEL_ID]).toBeUndefined();
        expect(consumeAssetSetReveal(ASSETS_PANEL_ID)).toBeNull();
    });
});

describe("without a workspace", () => {
    it("declines every target that has to be looked up", () => {
        const deps = { openEditorTab: vi.fn(), setPanelVisibility: vi.fn() };
        for (const target of [
            { kind: "translation", locale: "ja" },
            { kind: "localizationKey", keyName: "k" },
            { kind: "voiceLine", locale: "ja" },
            { kind: "storyVariable", scope: "saved", variableId: "v" },
            { kind: "storyEntry", storyId: "s", storyName: "S" },
            { kind: "storyMotion", animationId: "m" },
            { kind: "projectPage", page: "design" },
            { kind: "asset", assetId: "a", assetType: "font" },
        ] as const) {
            expect(jumpToSearchTarget(target, deps), target.kind).toBe(false);
        }
        expect(deps.openEditorTab).not.toHaveBeenCalled();
        expect(deps.setPanelVisibility).not.toHaveBeenCalled();
    });
});
