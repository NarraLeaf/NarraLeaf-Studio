import { afterEach, describe, expect, it, vi } from "vitest";
import type { UIDocument, UIStageSlotId, UISurface } from "@shared/types/ui-editor/document";
import { UI_STAGE_SLOT_IDS } from "@shared/types/ui-editor/stageSlots";
import { findStageSurfaceForSlot } from "@/lib/ui-editor/runtime/app/stageSlots";
import {
    GAME_UI_SLOT_STACK_ORDER,
    listGameUiReferenceCandidates,
    normalizeGameUiReferenceSlotIds,
    planGameUiReferenceLayers,
    withGameUiReferenceSlot,
} from "./gameUiReferenceLayers";

function gameUi(id: string, slotId: UIStageSlotId, size = { width: 1920, height: 1080 }): UISurface {
    return {
        id,
        name: id,
        host: "player",
        kind: "stageSurface",
        designSize: size,
        rootElementId: `${id}-root`,
        mount: { kind: "slot", slotId },
    };
}

function page(id: string): UISurface {
    return {
        id,
        name: id,
        host: "app",
        kind: "appSurface",
        designSize: { width: 1920, height: 1080 },
        rootElementId: `${id}-root`,
    };
}

function docWith(surfaces: UISurface[]): UIDocument {
    return { surfaces, elements: {} } as unknown as UIDocument;
}

const dialog = gameUi("Dialogue", "dialog");
const quickMenu = gameUi("Quick menu", "onStage");
const choice = gameUi("Choices", "choice");
const toast = gameUi("Toasts", "notification");
const title = page("Title");

afterEach(() => {
    vi.restoreAllMocks();
});

describe("GAME_UI_SLOT_STACK_ORDER", () => {
    // The engine's Player draws the slots in this document order with no z-index of its own:
    // SceneDialogs (box, then menus), the NVL page, the Player's children (On Stage), notifications.
    it("is the order a running game stacks its slots, bottom first", () => {
        expect(GAME_UI_SLOT_STACK_ORDER).toEqual(["dialog", "choice", "nvl", "onStage", "notification"]);
    });

    it("names every slot exactly once", () => {
        expect([...GAME_UI_SLOT_STACK_ORDER].sort()).toEqual([...UI_STAGE_SLOT_IDS].sort());
    });
});

describe("listGameUiReferenceCandidates", () => {
    it("offers a page nothing", () => {
        expect(listGameUiReferenceCandidates(docWith([title, dialog, quickMenu]), title)).toEqual([]);
    });

    it("offers the other slots that have a surface, in the editor's slot order, by name", () => {
        const doc = docWith([title, toast, choice, dialog, quickMenu]);
        const candidates = listGameUiReferenceCandidates(doc, dialog);
        expect(candidates.map(c => [c.slotId, c.surfaceId, c.name])).toEqual([
            ["onStage", "Quick menu", "Quick menu"],
            ["notification", "Toasts", "Toasts"],
            ["choice", "Choices", "Choices"],
        ]);
    });

    it("never offers the edited surface's own slot, even when another surface names it", () => {
        const otherDialog = gameUi("Dialogue B", "dialog");
        const doc = docWith([dialog, otherDialog, quickMenu]);
        expect(listGameUiReferenceCandidates(doc, otherDialog).map(c => c.slotId)).toEqual(["onStage"]);
    });

    it("picks, for each slot, the surface the game itself draws there", () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const secondQuickMenu = gameUi("Quick menu 2", "onStage");
        const doc = docWith([dialog, secondQuickMenu, quickMenu, choice]);
        for (const candidate of listGameUiReferenceCandidates(doc, dialog)) {
            expect(candidate.surfaceId).toBe(findStageSurfaceForSlot(doc, candidate.slotId, "test")?.id);
        }
        expect(listGameUiReferenceCandidates(doc, dialog).find(c => c.slotId === "onStage")?.surfaceId)
            .toBe("Quick menu 2");
    });
});

describe("planGameUiReferenceLayers", () => {
    const doc = docWith([title, dialog, quickMenu, choice, toast]);

    it("draws nothing until a slot is switched on", () => {
        expect(planGameUiReferenceLayers(doc, dialog, [])).toEqual({ below: [], above: [] });
    });

    it("draws nothing on a page, whatever is switched on", () => {
        expect(planGameUiReferenceLayers(doc, title, ["onStage", "dialog"])).toEqual({ below: [], above: [] });
    });

    it("puts the quick menu over the dialogue box, as the game does", () => {
        const plan = planGameUiReferenceLayers(doc, dialog, ["onStage"]);
        expect(plan.below).toEqual([]);
        expect(plan.above.map(layer => layer.slotId)).toEqual(["onStage"]);
    });

    it("puts the dialogue box under the quick menu, as the game does", () => {
        const plan = planGameUiReferenceLayers(doc, quickMenu, ["dialog", "notification", "choice"]);
        expect(plan.below.map(layer => layer.slotId)).toEqual(["dialog", "choice"]);
        expect(plan.above.map(layer => layer.slotId)).toEqual(["notification"]);
    });

    it("skips a switched-on slot that has no surface in this project", () => {
        const plan = planGameUiReferenceLayers(doc, dialog, ["nvl", "notification"]);
        expect([...plan.below, ...plan.above].map(layer => layer.slotId)).toEqual(["notification"]);
    });

    it("never draws the edited surface's own slot", () => {
        const plan = planGameUiReferenceLayers(doc, dialog, ["dialog"]);
        expect(plan).toEqual({ below: [], above: [] });
    });

    it("marks a reference that is not the edited surface's size", () => {
        const smallMenu = gameUi("Small menu", "onStage", { width: 1280, height: 720 });
        const plan = planGameUiReferenceLayers(docWith([dialog, smallMenu, choice]), dialog, ["onStage", "choice"]);
        expect(plan.above.map(layer => [layer.slotId, layer.sizeDiffers])).toEqual([
            ["choice", false],
            ["onStage", true],
        ]);
    });
});

describe("stored slot lists", () => {
    it("reads anything that is not a list as none", () => {
        expect(normalizeGameUiReferenceSlotIds(undefined)).toEqual([]);
        expect(normalizeGameUiReferenceSlotIds(null)).toEqual([]);
        expect(normalizeGameUiReferenceSlotIds("onStage")).toEqual([]);
        expect(normalizeGameUiReferenceSlotIds({ onStage: true })).toEqual([]);
    });

    it("drops unknown ids and repeats and keeps the editor's slot order", () => {
        expect(normalizeGameUiReferenceSlotIds(["nvl", "bogus", "onStage", 3, "nvl", "dialog"])).toEqual([
            "onStage",
            "dialog",
            "nvl",
        ]);
    });

    it("switches one slot on or off and leaves the rest", () => {
        const on = withGameUiReferenceSlot(["dialog"], "onStage", true);
        expect(on).toEqual(["onStage", "dialog"]);
        expect(withGameUiReferenceSlot(on, "onStage", true)).toEqual(["onStage", "dialog"]);
        expect(withGameUiReferenceSlot(on, "dialog", false)).toEqual(["onStage"]);
        expect(withGameUiReferenceSlot([], "choice", false)).toEqual([]);
    });
});
