// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoryBlock, StoryDocument } from "@shared/types/story";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import { walkStoryStageTimeline } from "@/lib/ui-editor/runtime/game/storyStageSnapshot";
import { buildStageTimelineModel, stageTimelineColumns, type StageTimelineNames } from "./stageTimelineModel";
import { StageTimelineView } from "./StageTimelineView";

/**
 * The drawing, against a real walk: a lane per object, a column per row, and a press on a column
 * moving the editor.
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

const names: StageTimelineNames = {
    asset: id => `Picture ${id}`,
    character: () => "Alice",
    appearance: () => "Normal",
    voiceSeconds: () => undefined,
};

function renderView(cursorColumn: number, storyDocument = document, timelineNames = names, showAllRows = false) {
    const scene = storyDocument.scenes["scene-1"];
    const walk = walkStoryStageTimeline({ document: storyDocument, sceneId: "scene-1" });
    const model = buildStageTimelineModel({
        walk,
        scene,
        names: timelineNames,
    });
    const onStepTo = vi.fn();
    const onPick = vi.fn();
    const view = render(
        <StageTimelineView
            scene={scene}
            model={model}
            columns={stageTimelineColumns(model.lines.map(line => (line === null ? null : 40)), 1)}
            cursorColumn={cursorColumn}
            showAllRows={showAllRows}
            onShowAllRowsChange={() => undefined}
            zoom={1}
            onZoomChange={() => undefined}
            paints={new Map()}
            characters={[]}
            onStepTo={onStepTo}
            onPick={onPick}
        />,
    );
    return { view, model, onStepTo, onPick };
}

afterEach(cleanup);

describe("StageTimelineView", () => {
    it("shows localised placeholders for missing image and character names", () => {
        const imageId = "a3247f0e-5f4b-4567-88bb-cdef01234567";
        const characterId = "b3247f0e-5f4b-4567-88bb-cdef01234567";
        const original = document.scenes["scene-1"];
        const scene = {
            ...original,
            rootBlockIds: ["image", "character"],
            blocks: Object.fromEntries([
                block("image", "action", { action: "image", operation: "show", objectName: imageId, assetId: "missing" }),
                block("character", "action", { action: "character", operation: "enter", characterId }),
            ].map(entry => [entry.id, entry])),
        };
        const storyDocument = { ...document, scenes: { ...document.scenes, "scene-1": scene } };
        const { view } = renderView(0, storyDocument, { ...names, asset: () => null, character: () => null });

        expect(screen.getByText("(unnamed)")).toBeTruthy();
        expect(screen.getByText("Unnamed character")).toBeTruthy();
        expect(view.container.textContent).not.toContain(imageId);
        expect(view.container.textContent).not.toContain(characterId);
    });

    it("uses the unnamed placeholder when the scene name is a generated ID", () => {
        const id = "a3247f0e-5f4b-4567-88bb-cdef01234567";
        const scene = { ...document.scenes["scene-1"], name: id };
        const storyDocument = { ...document, scenes: { ...document.scenes, "scene-1": scene } };
        const { view } = renderView(0, storyDocument);

        expect(screen.getByText("(unnamed)")).toBeTruthy();
        expect(view.container.textContent).not.toContain(id);
    });

    it("gives every row a column and labels each block", () => {
        const { model } = renderView(2);
        expect(model.blockIds).toEqual(["bg", "in", "a", "menu", "stay", "b"]);
        // Columns carry the editor's own row numbers; the options take numbers but run no column.
        expect(model.lineNumbers).toEqual([1, 2, 3, 4, 6, 8]);
        expect(screen.getAllByText("Alice").length).toBeGreaterThan(0);
        expect(screen.getByText("Normal")).toBeTruthy();
        expect(screen.getByText("Picture room")).toBeTruthy();
        // The dialogue strip says what each line says.
        expect(screen.getAllByText("Line").length).toBe(3);
        expect(screen.getByText("Dialogue")).toBeTruthy();
        // The header reads the cursor's row by the editor's number.
        expect(screen.getByText(/Row 3/)).toBeTruthy();
    });

    it("moves the editor to a column's row", () => {
        const { view, onStepTo } = renderView(2);
        const hitAreas = view.container.querySelectorAll<HTMLDivElement>("div.z-10");
        expect(hitAreas.length).toBe(6);
        fireEvent.mouseDown(hitAreas[0], { button: 0 });
        expect(onStepTo).toHaveBeenLastCalledWith("bg");
        fireEvent.mouseDown(hitAreas[5], { button: 0 });
        expect(onStepTo).toHaveBeenLastCalledWith("b");
    });

    it("draws consecutive one-shot starts as separate blocks", () => {
        const scene = {
            ...document.scenes["scene-1"],
            rootBlockIds: ["first", "second"],
            blocks: Object.fromEntries([
                block("first", "action", { action: "audio", operation: "playSound", objectName: "bell", assetId: "bell-clip" }),
                block("second", "action", { action: "audio", operation: "playSound", objectName: "bell" }),
            ].map(entry => [entry.id, entry])),
        };
        const storyDocument = { ...document, scenes: { ...document.scenes, "scene-1": scene } };
        const { view, model } = renderView(0, storyDocument);

        expect(model.lanes[0].cells.map(cell => cell.present)).toEqual([true, true]);
        expect(view.container.querySelectorAll("div.absolute.top-1.bottom-1.border")).toHaveLength(2);
    });

    it("offers a menu's options from the ruler", () => {
        const { onPick } = renderView(0);
        fireEvent.click(screen.getByRole("button", { name: "Choose a branch" }));
        fireEvent.click(screen.getByText("Leave"));
        expect(onPick).toHaveBeenCalledWith("menu", "opt-2");
    });

    it("shows the row number for a menu with no branch button", () => {
        const scene = {
            ...document.scenes["scene-1"],
            rootBlockIds: ["menu"],
            blocks: Object.fromEntries([
                block("menu", "nodeAction", { action: "choice" }, null, ["option"]),
                block("option", "nodeAction", { action: "choiceOption", text: { textId: "option-text", value: "Only", role: "choiceText" } }, "menu", ["line"]),
                say("line", "option"),
            ].map(entry => [entry.id, entry])),
        };
        const storyDocument = { ...document, scenes: { ...document.scenes, "scene-1": scene } };
        renderView(0, storyDocument, names, true);

        expect(screen.queryByRole("button", { name: "Choose a branch" })).toBeNull();
        expect(screen.getByText("1")).toBeTruthy();
    });
});
