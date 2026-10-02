import { describe, expect, it } from "vitest";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { flattenBlueprintOwner, parseBlueprintOwnerKey } from "@/lib/workspace/services/search/blueprintOwnerKey";
import {
    GLOBAL_MAIN_OWNER_KEY,
    componentWidgetMainOwnerKey,
    surfaceMainOwnerKey,
} from "@/lib/workspace/services/ui-editor/blueprint/ownerKeys";
import { getBlueprintEntryTabId } from "../blueprint-lite/blueprintEntryTabId";
import { getComponentEditorSurfaceId } from "../ui-editor/editors/componentEditorAdapter";
import { blueprintJumpOpenTarget, blueprintOwnerOpenTarget } from "./blueprintJumpTarget";

/**
 * A workspace holding the tabs in `openTabs` (id -> title) and the blueprints in `names` (id -> name),
 * which is all a jump asks of it.
 */
function workspace(openTabs: Record<string, string>, names: Record<string, string>): WorkspaceContext {
    const services: Partial<Record<Services, unknown>> = {
        [Services.UI]: {
            editor: { get: (id: string) => (id in openTabs ? { id, title: openTabs[id] } : undefined) },
        },
        [Services.LocalBlueprint]: {
            getBlueprintDocument: () => ({
                blueprints: Object.fromEntries(Object.entries(names).map(([id, name]) => [id, { id, name }])),
            }),
        },
    };
    return { services: { get: (id: Services) => services[id] } } as unknown as WorkspaceContext;
}

function jump(ownerKey: string, context: WorkspaceContext | null, extra: { focusNodeId?: string } = {}) {
    const owner = parseBlueprintOwnerKey(ownerKey);
    if (!owner) {
        throw new Error(`unreadable owner key ${ownerKey}`);
    }
    return blueprintJumpOpenTarget({ kind: "blueprint", blueprintId: "bp", ownerKey, ...extra }, owner, context);
}

/** The tab a target opens - the id `createBlueprintEntryEditorTab` gives it. */
function tabIdOf(target: ReturnType<typeof jump>): string {
    return getBlueprintEntryTabId(target);
}

describe("a deep link into a blueprint", () => {
    it("names a tab it opens after the blueprint", () => {
        const target = jump(surfaceMainOwnerKey("title"), workspace({}, { bp: "标题" }));
        expect(target.title).toBe("标题");
    });

    // The reported failure: the link replaced the open tab's definition, name included, so a tab
    // called "页面逻辑 - 标题" came back from a search hit as "Blueprint".
    it("keeps the name of a tab that is already open", () => {
        const tabId = getBlueprintEntryTabId({ blueprintId: "bp", surfaceId: "title" });
        const target = jump(surfaceMainOwnerKey("title"), workspace({ [tabId]: "页面逻辑 - 标题" }, { bp: "标题" }));
        expect(tabIdOf(target)).toBe(tabId);
        expect(target.title).toBe("页面逻辑 - 标题");
    });

    it("leaves the name to the tab's generic one when the blueprint has none, or there is no workspace", () => {
        expect(jump(surfaceMainOwnerKey("title"), workspace({}, { bp: "" })).title).toBeUndefined();
        expect(jump(surfaceMainOwnerKey("title"), null).title).toBeUndefined();
    });

    // The UI panel opens the global blueprint keyed by the `globalMain` sentinel. A link that left the
    // slot empty had a key of its own, and opened a second editor beside the one already open.
    it("lands on the global blueprint's tab under the key the UI panel opens it with", () => {
        const panelTabId = getBlueprintEntryTabId({ blueprintId: "bp", surfaceId: GLOBAL_MAIN_OWNER_KEY });
        const target = jump(GLOBAL_MAIN_OWNER_KEY, workspace({ [panelTabId]: "应用逻辑" }, { bp: "全局" }));
        expect(tabIdOf(target)).toBe(panelTabId);
        expect(target.title).toBe("应用逻辑");
    });

    it("lands on a component control's tab under its component editor's surface, as the inspector opens it", () => {
        const inspectorTabId = getBlueprintEntryTabId({
            blueprintId: "bp",
            surfaceId: getComponentEditorSurfaceId("card"),
            elementId: "label",
        });
        const target = jump(componentWidgetMainOwnerKey("card", "label"), workspace({}, { bp: "标签" }));
        expect(tabIdOf(target)).toBe(inspectorTabId);
        expect(target).toMatchObject({ ownerKind: "componentWidgetMain", componentId: "card", elementId: "label" });
    });

    it("still carries what to focus", () => {
        const target = jump(surfaceMainOwnerKey("title"), workspace({}, { bp: "标题" }), { focusNodeId: "n1" });
        expect(target.focusNodeId).toBe("n1");
    });
});

describe("a blueprint opened from the owner itself", () => {
    // The project scripts list holds a blueprint's owner rather than its key, and passed on only the
    // owner's kind - so a script bound to a page control opened a tab keyed by nothing, beside the one
    // the inspector had open.
    it("lands on a page control's tab under its page and element, as the inspector opens it", () => {
        const owner = flattenBlueprintOwner({
            kind: "widgetMain",
            surfaceId: "narraleaf-studio:main-surface",
            elementId: "start",
        });
        const target = blueprintOwnerOpenTarget("bp", owner, workspace({}, { bp: "Button" }));
        expect(tabIdOf(target)).toBe(
            getBlueprintEntryTabId({ blueprintId: "bp", surfaceId: "narraleaf-studio:main-surface", elementId: "start" }),
        );
        expect(target.title).toBe("Button");
    });

    it("lands on the global and component tabs under the same keys a deep link does", () => {
        const global = blueprintOwnerOpenTarget("bp", flattenBlueprintOwner({ kind: "globalMain" }), null);
        expect(tabIdOf(global)).toBe(tabIdOf(jump(GLOBAL_MAIN_OWNER_KEY, null)));
        const control = blueprintOwnerOpenTarget(
            "bp",
            flattenBlueprintOwner({ kind: "componentWidgetMain", componentId: "card", elementId: "label" }),
            null,
        );
        expect(tabIdOf(control)).toBe(tabIdOf(jump(componentWidgetMainOwnerKey("card", "label"), null)));
    });
});
