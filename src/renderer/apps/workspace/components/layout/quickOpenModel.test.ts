import { describe, expect, it, vi } from "vitest";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import {
    GLOBAL_MAIN_OWNER_KEY,
    componentWidgetMainOwnerKey,
    surfaceMainOwnerKey,
} from "@/lib/workspace/services/ui-editor/blueprint/ownerKeys";
import { getBlueprintEntryTabId } from "../../modules/blueprint-lite/blueprintEntryTabId";
import { getComponentEditorSurfaceId } from "../../modules/ui-editor/editors/componentEditorAdapter";
import { collectQuickOpenEntries } from "./quickOpenModel";

/**
 * A project holding three blueprints - the global one, a page's, and a component control's - with
 * the editor tabs in `openTabs` (id -> title) already open. Everything else quick open lists is empty.
 */
function workspace(openTabs: Record<string, string>) {
    const open = vi.fn();
    const services: Partial<Record<Services, unknown>> = {
        [Services.UI]: {
            editor: { open, get: (id: string) => (id in openTabs ? { id, title: openTabs[id] } : undefined) },
        },
        [Services.Story]: { listStories: () => [] },
        [Services.Character]: { listCharacter: () => [] },
        [Services.UIDocument]: { getDocument: () => ({ surfaces: [], components: [], elements: {} }) },
        [Services.Assets]: { getAssets: () => ({}) },
        [Services.LocalBlueprint]: {
            getBlueprintDocument: () => ({
                ownerRecords: {
                    [GLOBAL_MAIN_OWNER_KEY]: { blueprintId: "bp-app" },
                    [surfaceMainOwnerKey("title")]: { blueprintId: "bp-title" },
                    [componentWidgetMainOwnerKey("card", "label")]: { blueprintId: "bp-label" },
                },
                blueprints: {
                    "bp-app": { id: "bp-app", name: "Global" },
                    "bp-title": { id: "bp-title", name: "Title" },
                    "bp-label": { id: "bp-label", name: "Text" },
                },
            }),
        },
    };
    const context = { services: { get: (id: Services) => services[id] } } as unknown as WorkspaceContext;
    return { context, open };
}

/** Pick `blueprintId` in quick open and answer the tab it opened. */
function quickOpen(blueprintId: string, openTabs: Record<string, string> = {}): { id: string; title: string } {
    const { context, open } = workspace(openTabs);
    const entry = collectQuickOpenEntries(context).find(candidate => candidate.key === `blueprint:${blueprintId}`);
    if (!entry) {
        throw new Error(`quick open does not list ${blueprintId}`);
    }
    entry.open(context);
    expect(open).toHaveBeenCalledTimes(1);
    return open.mock.calls[0]![0];
}

describe("quick open on a blueprint", () => {
    // The reported failure: with App logic open from the interface panel, picking it in quick open
    // added a second tab, because the global blueprint's tab is keyed by the `globalMain` sentinel and
    // quick open left that slot empty.
    it("lands on the global blueprint's tab under the key the interface panel opens it with, keeping its name", () => {
        const panelTabId = getBlueprintEntryTabId({ blueprintId: "bp-app", surfaceId: GLOBAL_MAIN_OWNER_KEY });
        const tab = quickOpen("bp-app", { [panelTabId]: "App logic" });
        expect(tab.id).toBe(panelTabId);
        expect(tab.title).toBe("App logic");
    });

    it("lands on a component control's tab under its component editor's surface, as the inspector opens it", () => {
        const inspectorTabId = getBlueprintEntryTabId({
            blueprintId: "bp-label",
            surfaceId: getComponentEditorSurfaceId("card"),
            elementId: "label",
        });
        expect(quickOpen("bp-label").id).toBe(inspectorTabId);
    });

    it("lands on a page's tab under the page's own id", () => {
        expect(quickOpen("bp-title").id).toBe(getBlueprintEntryTabId({ blueprintId: "bp-title", surfaceId: "title" }));
    });

    it("names a tab it opens after the blueprint", () => {
        expect(quickOpen("bp-app").title).toBe("Global");
    });
});

/**
 * A blueprint is named after what it hangs on, so a project's pages each carry a "Config" button
 * blueprint and the picker listed them as identical rows. The detail says whose each one is, in the
 * words the search panel uses for the same blueprint.
 */
describe("quick open names a blueprint's owner", () => {
    function entriesWithDocument() {
        const services: Partial<Record<Services, unknown>> = {
            [Services.UI]: { editor: { open: vi.fn(), get: () => undefined } },
            [Services.Story]: { listStories: () => [] },
            [Services.Character]: { listCharacter: () => [] },
            [Services.UIDocument]: {
                getDocument: () => ({
                    surfaces: [{ id: "log", name: "Log" }, { id: "config", name: "Config" }],
                    components: [{ id: "card", name: "Card", elements: { label: { id: "label", name: "Caption", type: "text" } } }],
                    elements: {},
                }),
            },
            [Services.Assets]: { getAssets: () => ({}) },
            [Services.LocalBlueprint]: {
                getBlueprintDocument: () => ({
                    ownerRecords: {
                        [GLOBAL_MAIN_OWNER_KEY]: { blueprintId: "bp-app" },
                        [surfaceMainOwnerKey("config")]: { blueprintId: "bp-config" },
                        [componentWidgetMainOwnerKey("card", "label")]: { blueprintId: "bp-label" },
                    },
                    blueprints: {
                        "bp-app": { id: "bp-app", name: "Global" },
                        "bp-config": { id: "bp-config", name: "Config" },
                        "bp-label": { id: "bp-label", name: "Caption" },
                    },
                }),
            },
        };
        const context = { services: { get: (id: Services) => services[id] } } as unknown as WorkspaceContext;
        return collectQuickOpenEntries(context);
    }

    const detailOf = (blueprintId: string) =>
        entriesWithDocument().find(entry => entry.key === `blueprint:${blueprintId}`)?.detail;

    it("names a page's blueprint by its page", () => {
        expect(detailOf("bp-config")).toBe("Config");
    });

    it("names a component control's blueprint by its component and control", () => {
        expect(detailOf("bp-label")).toBe("Card › Caption");
    });

    it("names the project's own blueprint as the global one", () => {
        expect(detailOf("bp-app")).toBe("Global");
    });
});
