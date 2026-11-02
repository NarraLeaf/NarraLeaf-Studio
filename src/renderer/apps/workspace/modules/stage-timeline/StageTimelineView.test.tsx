// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoryBlock, StoryDocument } from "@shared/types/story";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import { walkStoryStageTimeline } from "@/lib/ui-editor/runtime/game/storyStageSnapshot";
import { buildStageTimelineModel, stageTimelineColumns } from "./stageTimelineModel";
import { StageTimelineView } from "./StageTimelineView";

/**
 * The drawing, against a real walk: a lane per object, a column per row, the state column reading
 * the cursor's column, and a press on a column or on a state's step moving the editor.
 */

function block(id: string, kind: StoryBlock["kind"], payload: unknown, parentId: string | null = null, childrenIds: string[] = []): StoryBlock {
    return { id, kind, parentId, childrenIds, payload } as StoryBlock;
}

const say = (id: string, parentId: string | null = null) =>
    block(id, "nodeAction", { action: "narration", text: { textId: `${id}-text`, value: "Line", role: "narration" } }, parentId);

const document: StoryDocument = {
    schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
    id: "story-1",
    name: "Story",
    chapters: [{ id: "chapter-1", name: "Chapter", sceneIds: ["scene-1"] }],
    scenes: {
        "scene-1": {
            id: "scene-1",
            name: "After school",
            runtimeName: "After school",
            rootBlockIds: ["bg", "in", "a", "menu", "b"],
            blocks: Object.fromEntries([
                block("bg", "action", { action: "setBackground", assetId: "room" }),
                block("in", "action", { action: "character", operation: "enter", characterId: "alice", pose: "normal" }),
                say("a"),
                block("menu", "nodeAction", { action: "choice" }, null, ["opt-1", "opt-2"]),
                block("opt-1", "nodeAction", { action: "choiceOption", text: { textId: "o1", value: "Stay", role: "choiceText" } }, "menu", ["stay"]),
                say("stay", "opt-1"),
                block("opt-2", "nodeAction", { action: "choiceOption", text: { textId: "o2", value: "Leave", role: "choiceText" } }, "menu", []),
                say("b"),
            ].map(entry => [entry.id, entry])),
        },
    },
};

function renderView(cursorColumn: number) {
    const scene = document.scenes["scene-1"];
    const walk = walkStoryStageTimeline({ document, sceneId: "scene-1" });
    const model = buildStageTimelineModel({
        walk,
        scene,
        names: { asset: id => `Picture ${id}`, character: () => "Alice", appearance: () => "Normal", voiceSeconds: () => undefined },
    });
    const onStepTo = vi.fn();
    const onPick = vi.fn();
    const view = render(
        <StageTimelineView
            scene={scene}
            model={model}
            columns={stageTimelineColumns(model.timings, "equal", 1)}
            cursorColumn={cursorColumn}
            layout="equal"
            onLayoutChange={() => undefined}
            zoom={1}
            onZoomChange={() => undefined}
            paints={new Map()}
            onStepTo={onStepTo}
            onPick={onPick}
        />,
    );
    return { view, model, onStepTo, onPick };
}

afterEach(cleanup);

describe("StageTimelineView", () => {
    it("names a lane per object and reads each lane's state at the cursor", () => {
        const { model } = renderView(2);
        expect(model.blockIds).toEqual(["bg", "in", "a", "menu", "stay", "b"]);
        // Columns carry the editor's own row numbers: the options take numbers but run no column.
        expect(model.lineNumbers).toEqual([1, 2, 3, 4, 6, 8]);
        expect(screen.getAllByText("Alice").length).toBeGreaterThan(0);
        // The state column: Alice's pose at column 3, set on row 2.
        expect(screen.getAllByText("Normal").length).toBeGreaterThan(0);
        expect(screen.getByRole("button", { name: "Row 2" })).toBeTruthy();
    });

    it("moves the editor to a column's row, and to the row that set a state", () => {
        const { view, onStepTo } = renderView(2);
        fireEvent.click(screen.getByRole("button", { name: "Row 1" }));
        expect(onStepTo).toHaveBeenLastCalledWith("bg");
        const hitAreas = view.container.querySelectorAll<HTMLDivElement>("div.z-10");
        fireEvent.mouseDown(hitAreas[5], { button: 0 });
        expect(onStepTo).toHaveBeenLastCalledWith("b");
    });

    it("offers a menu's options from the ruler", () => {
        const { onPick } = renderView(0);
        fireEvent.click(screen.getByRole("button", { name: "Choose a branch" }));
        fireEvent.click(screen.getByText("Leave"));
        expect(onPick).toHaveBeenCalledWith("menu", "opt-2");
    });
});
