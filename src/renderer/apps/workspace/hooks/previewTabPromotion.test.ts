import { describe, expect, it } from "vitest";
import { PROPERTIES_PANEL_ID } from "@/apps/workspace/modules/properties/propertiesPanelId";
import { blueprintHistoryScope, projectHistoryScope } from "@/lib/workspace/services/history/historyScopes";
import { FocusArea } from "@/lib/workspace/services/ui/types";
import { EDITOR_TAB_BODY_ATTRIBUTE, editorTabOfEventTarget, resolveEditedTabId } from "./previewTabPromotion";

const BLUEPRINT = blueprintHistoryScope("bp-1");
const PAGE_BLUEPRINT = blueprintHistoryScope("bp-page");

describe("resolveEditedTabId", () => {
    it("follows the event that made the edit before anything focus says", () => {
        // A variable name committed on blur, after the author clicked the tab strip.
        expect(resolveEditedTabId({
            scopeId: PAGE_BLUEPRINT,
            focus: { area: FocusArea.EditorTabs, targetId: "main" },
            eventTabId: "blueprint-tab",
            lastFocusedEditorTabId: "surface-tab",
        })).toBe("blueprint-tab");
        // ... or a side panel, which is not an editor at all.
        expect(resolveEditedTabId({
            scopeId: PAGE_BLUEPRINT,
            focus: { area: FocusArea.LeftPanel, targetId: "story" },
            eventTabId: "blueprint-tab",
            lastFocusedEditorTabId: null,
        })).toBe("blueprint-tab");
    });

    it("promotes the focused editor", () => {
        expect(resolveEditedTabId({
            scopeId: BLUEPRINT,
            focus: { area: FocusArea.Editor, targetId: "blueprint-tab" },
            eventTabId: null,
            lastFocusedEditorTabId: "other",
        })).toBe("blueprint-tab");
    });

    it("gives the inspector's edits to the editor behind it", () => {
        expect(resolveEditedTabId({
            scopeId: BLUEPRINT,
            focus: { area: FocusArea.RightPanel, targetId: PROPERTIES_PANEL_ID },
            eventTabId: null,
            lastFocusedEditorTabId: "blueprint-tab",
        })).toBe("blueprint-tab");
    });

    it.each([
        ["no area", { area: FocusArea.None }],
        ["a dialog", { area: FocusArea.Dialog, targetId: "dialog-2" }],
        ["the tab strip", { area: FocusArea.EditorTabs, targetId: "main" }],
    ])("gives an edit made with focus in %s to the editor last worked in", (_label, focus) => {
        // A variable created through its dialog lands after the dialog closed.
        expect(resolveEditedTabId({
            scopeId: PAGE_BLUEPRINT,
            focus,
            eventTabId: null,
            lastFocusedEditorTabId: "blueprint-tab",
        })).toBe("blueprint-tab");
    });

    it("never hands a project-wide edit to an editor that happened to be focused last", () => {
        expect(resolveEditedTabId({
            scopeId: projectHistoryScope(),
            focus: { area: FocusArea.Dialog, targetId: "dialog-1" },
            eventTabId: null,
            lastFocusedEditorTabId: "blueprint-tab",
        })).toBeNull();
    });

    it("promotes nothing for an edit made from a side panel", () => {
        expect(resolveEditedTabId({
            scopeId: BLUEPRINT,
            focus: { area: FocusArea.LeftPanel, targetId: "assets" },
            eventTabId: null,
            lastFocusedEditorTabId: "blueprint-tab",
        })).toBeNull();
    });
});

describe("editorTabOfEventTarget", () => {
    /** Just enough of an element for `closest`, which is all the lookup uses. */
    function element(tabId: string | null): Element {
        const body = tabId === null ? null : {
            getAttribute: (name: string) => (name === EDITOR_TAB_BODY_ATTRIBUTE ? tabId : null),
        };
        return {
            closest: (selector: string) => (selector === `[${EDITOR_TAB_BODY_ATTRIBUTE}]` ? body : null),
        } as unknown as Element;
    }

    it("reads the tab off the box the editor is drawn in", () => {
        expect(editorTabOfEventTarget(element("blueprint-tab"))).toBe("blueprint-tab");
    });

    it("answers null outside every tab, and for no event at all", () => {
        expect(editorTabOfEventTarget(element(null))).toBeNull();
        expect(editorTabOfEventTarget(null)).toBeNull();
        expect(editorTabOfEventTarget(undefined)).toBeNull();
    });

    it("climbs from a text node to its element", () => {
        const text = { parentElement: element("blueprint-tab") } as unknown as Node;
        expect(editorTabOfEventTarget(text)).toBe("blueprint-tab");
    });
});
