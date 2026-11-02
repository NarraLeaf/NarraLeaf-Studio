import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryDocument } from "@shared/types/story";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import { walkStoryStageTimeline } from "@/lib/ui-editor/runtime/game/storyStageSnapshot";
import {
    buildStageTimelineModel,
    estimateReadingMs,
    isNeutralCamera,
    sceneBlockOrder,
    STAGE_TIMELINE_EQUAL_PX,
    STAGE_TIMELINE_MIN_PX,
    STAGE_TIMELINE_SECOND_PX,
    stageTimelineColumns,
    stageTimelineCursorColumn,
    stageTimelineThrough,
    type StageTimelineNames,
} from "./stageTimelineModel";

function block(id: string, kind: StoryBlock["kind"], payload: unknown, parentId: string | null = null, childrenIds: string[] = []): StoryBlock {
    return { id, kind, parentId, childrenIds, payload } as StoryBlock;
}

const say = (id: string, value = "Text", parentId: string | null = null) =>
    block(id, "nodeAction", { action: "narration", text: { textId: `${id}-text`, value, role: "narration" } }, parentId);

function documentOf(blocks: StoryBlock[], rootBlockIds: string[]): StoryDocument {
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "story-1",
        name: "Story",
        chapters: [{ id: "chapter-1", name: "Chapter", sceneIds: ["scene-1"] }],
        scenes: {
            "scene-1": {
                id: "scene-1",
                name: "Scene 1",
                runtimeName: "Scene 1",
                rootBlockIds,
                blocks: Object.fromEntries(blocks.map(entry => [entry.id, entry])),
            },
        },
    };
}

const NAMES: StageTimelineNames = {
    asset: assetId => `asset:${assetId}`,
    character: characterId => (characterId === "alice" ? "Alice" : null),
    appearance: (_characterId, appearanceId) => ({ normal: "Normal", smile: "Smile" })[appearanceId] ?? null,
    voiceSeconds: textId => (textId === "voiced-text" ? 2.4 : undefined),
};

function modelOf(document: StoryDocument, through: string[] = []) {
    const scene = document.scenes["scene-1"];
    const walk = walkStoryStageTimeline({ document, sceneId: "scene-1", through });
    return buildStageTimelineModel({ walk, scene, names: NAMES });
}

const enter = (id: string, pose?: string) => block(id, "action", { action: "character", operation: "enter", characterId: "alice", pose });
const face = (id: string, pose: string) => block(id, "action", { action: "character", operation: "expression", characterId: "alice", pose });
const exit = (id: string) => block(id, "action", { action: "character", operation: "exit", characterId: "alice" });

describe("walkStoryStageTimeline", () => {
    it("records the stage after every row that runs, skipping containers and notes", () => {
        const document = documentOf([
            block("bg", "action", { action: "setBackground", assetId: "room" }),
            say("a"),
            block("note", "note", { text: "x" }),
            enter("in"),
        ], ["bg", "a", "note", "in"]);
        const walk = walkStoryStageTimeline({ document, sceneId: "scene-1" });
        expect(walk.frames.map(frame => frame.blockId)).toEqual(["bg", "a", "in"]);
        expect(walk.frames[0].background).toEqual({ assetId: "room" });
        expect(walk.frames[1].displayables).toEqual([]);
        expect(walk.frames[2].displayables.map(record => record.visible)).toEqual([true]);
    });

    it("goes down the first option of a menu, or the one on the path", () => {
        const document = documentOf([
            block("menu", "nodeAction", { action: "choice" }, null, ["opt-1", "opt-2"]),
            block("opt-1", "nodeAction", { action: "choiceOption", text: { textId: "o1", value: "One", role: "choiceText" } }, "menu", ["one"]),
            say("one", "One", "opt-1"),
            block("opt-2", "nodeAction", { action: "choiceOption", text: { textId: "o2", value: "Two", role: "choiceText" } }, "menu", ["two"]),
            say("two", "Two", "opt-2"),
            say("after"),
        ], ["menu", "after"]);
        const first = walkStoryStageTimeline({ document, sceneId: "scene-1" });
        expect(first.frames.map(frame => frame.blockId)).toEqual(["menu", "one", "after"]);
        expect(first.choices).toEqual([{ choiceBlockId: "menu", optionBlockIds: ["opt-1", "opt-2"], takenOptionId: "opt-1" }]);
        const second = walkStoryStageTimeline({ document, sceneId: "scene-1", through: ["opt-2"] });
        expect(second.frames.map(frame => frame.blockId)).toEqual(["menu", "two", "after"]);
        expect(second.choices[0].takenOptionId).toBe("opt-2");
    });

    it("stops where play leaves the scene", () => {
        const document = documentOf([
            say("a"),
            block("jump", "jump", { targetSceneId: "elsewhere" }),
            say("dead"),
        ], ["a", "jump", "dead"]);
        const walk = walkStoryStageTimeline({ document, sceneId: "scene-1" });
        expect(walk.frames.map(frame => frame.blockId)).toEqual(["a", "jump"]);
    });
});

describe("buildStageTimelineModel", () => {
    it("gives every row a column and a character one lane", () => {
        const document = documentOf([
            say("a"),
            enter("in", "normal"),
            say("b"),
            face("smile", "smile"),
            say("c"),
            exit("out"),
            say("d"),
        ], ["a", "in", "b", "smile", "c", "out", "d"]);
        const model = modelOf(document);
        expect(model.blockIds).toEqual(["a", "in", "b", "smile", "c", "out", "d"]);
        expect(model.lineNumbers).toEqual([1, 2, 3, 4, 5, 6, 7]);
        // Only the rows that say something have words; the ruler numbers those.
        expect(model.lines).toEqual(["Text", null, "Text", null, "Text", null, "Text"]);
        expect(model.lanes.map(lane => [lane.kind, lane.name])).toEqual([["character", "Alice"]]);
        const cells = model.lanes[0].cells;
        expect(cells.map(cell => cell.present)).toEqual([false, true, true, true, true, false, false]);
        expect(cells.map(cell => cell.label)).toEqual([null, "Normal", "Normal", "Smile", "Smile", null, null]);
        expect(cells.map(cell => cell.sprite?.poseId ?? null)).toEqual([null, "normal", "normal", "smile", "smile", null, null]);
        // A change of name is a new block, not a mark.
        expect(model.lanes[0].marks).toEqual([]);
    });

    it("marks the row that changes a lane but keeps its name, in that row's column", () => {
        const document = documentOf([
            enter("in", "normal"),
            say("a"),
            block("move", "action", { action: "character", operation: "move", characterId: "alice", transform: { to: { position: { xalign: 0.2 } } } }),
            say("b"),
        ], ["in", "a", "move", "b"]);
        const model = modelOf(document);
        expect(model.lanes[0].marks).toEqual([{ column: 2, at: 0.5 }]);
        expect(model.lanes[0].cells.map(cell => cell.label)).toEqual(["Normal", "Normal", "Normal", "Normal"]);
    });

    it("names backgrounds and music by their assets, and drops lanes that never appear", () => {
        const document = documentOf([
            block("bg", "action", { action: "setBackground", assetId: "room" }),
            block("bgm", "action", { action: "audio", operation: "setBgm", assetId: "theme" }),
            say("a"),
            block("bgm-off", "action", { action: "audio", operation: "setBgm" }),
        ], ["bg", "bgm", "a", "bgm-off"]);
        const model = modelOf(document);
        expect(model.lanes.map(lane => lane.kind)).toEqual(["background", "music"]);
        expect(model.lanes[0].cells.map(cell => cell.label)).toEqual(["asset:room", "asset:room", "asset:room", "asset:room"]);
        expect(model.lanes[0].cells[0].image).toBe("room");
        expect(model.lanes[1].cells.map(cell => cell.present)).toEqual([false, true, true, false]);
        expect(model.lanes[1].cells[1].label).toBe("asset:theme");
        expect(model.lanes[1].cells[1].image).toBeNull();
    });

    it("spans a looping sound and marks a one-shot only where it starts", () => {
        const document = documentOf([
            block("rain", "action", { action: "audio", operation: "playSound", objectName: "rain", assetId: "rain-clip", loop: true }),
            say("a"),
            block("bang", "action", { action: "audio", operation: "playSound", objectName: "bang", assetId: "bang-clip" }),
            say("b"),
            block("rain-off", "action", { action: "audio", operation: "stopSound", objectName: "rain", target: { kind: "audio", name: "rain" } }),
        ], ["rain", "a", "bang", "b", "rain-off"]);
        const model = modelOf(document);
        const rain = model.lanes.find(lane => lane.id === "sound:rain")!;
        const bang = model.lanes.find(lane => lane.id === "sound:bang")!;
        expect(rain.cells.map(cell => cell.present)).toEqual([true, true, true, true, false]);
        expect(bang.cells.map(cell => cell.present)).toEqual([false, false, true, false, false]);
    });

    it("draws the camera only while it is away from its neutral pose", () => {
        const document = documentOf([
            block("push", "action", { action: "camera", operation: "transform", transform: { to: { zoom: 1.5 }, durationMs: 1200 } }),
            say("a"),
            block("reset", "action", { action: "camera", operation: "reset" }),
        ], ["push", "a", "reset"]);
        const model = modelOf(document);
        const camera = model.lanes.find(lane => lane.kind === "camera")!;
        expect(camera.cells.map(cell => cell.present)).toEqual([true, true, false]);
        expect(camera.cells[0].label).toBe("1.5×");
        expect(model.timings[0]).toEqual({ durationMs: 1200, source: "action" });
    });

    it("times a voiced line by its take, an unvoiced one by its words, and an instant row as nothing", () => {
        const document = documentOf([
            block("voiced", "nodeAction", { action: "dialogue", characterId: "alice", text: { textId: "voiced-text", value: "Hi", role: "dialogue" } }),
            say("plain", "今天也结束了"),
            enter("in"),
            block("menu", "nodeAction", { action: "choice" }, null, []),
        ], ["voiced", "plain", "in", "menu"]);
        const model = modelOf(document);
        expect(model.timings.map(timing => timing.source)).toEqual(["voice", "estimate", "instant", "choice"]);
        expect(model.timings[0].durationMs).toBe(2400);
        expect(model.timings[1].durationMs).toBe(estimateReadingMs("今天也结束了"));
        expect(model.timings[2].durationMs).toBe(0);
        expect(model.lines).toEqual(["Hi", "今天也结束了", null, null]);
        expect(model.choices.map(choice => choice.column)).toEqual([3]);
    });
});

describe("timeline helpers", () => {
    it("estimates full-width text slower than Latin letters", () => {
        expect(estimateReadingMs("今天")).toBeGreaterThan(estimateReadingMs("ab"));
        expect(estimateReadingMs("a b")).toBe(estimateReadingMs("ab"));
    });

    it("lays columns out equally or by time, never narrower than the minimum", () => {
        const timings = [
            { durationMs: 1000, source: "voice" as const },
            { durationMs: 0, source: "instant" as const },
        ];
        expect(stageTimelineColumns(timings, "equal", 1)).toEqual([
            { x: 0, width: STAGE_TIMELINE_EQUAL_PX },
            { x: STAGE_TIMELINE_EQUAL_PX, width: STAGE_TIMELINE_EQUAL_PX },
        ]);
        expect(stageTimelineColumns(timings, "timed", 1)).toEqual([
            { x: 0, width: STAGE_TIMELINE_SECOND_PX },
            { x: STAGE_TIMELINE_SECOND_PX, width: STAGE_TIMELINE_MIN_PX },
        ]);
    });

    it("puts a cursor on a row that does not run at the last column before it", () => {
        const document = documentOf([
            say("a"),
            block("note", "note", { text: "x" }),
            say("b"),
        ], ["a", "note", "b"]);
        const order = sceneBlockOrder(document.scenes["scene-1"]);
        expect(stageTimelineCursorColumn(["a", "b"], "b", order)).toBe(1);
        expect(stageTimelineCursorColumn(["a", "b"], "note", order)).toBe(0);
        expect(stageTimelineCursorColumn(["a", "b"], null, order)).toBe(-1);
    });

    it("lets the row being read decide its own menu over a pick", () => {
        const document = documentOf([
            block("menu", "nodeAction", { action: "choice" }, null, ["opt-1", "opt-2"]),
            block("opt-1", "nodeAction", { action: "choiceOption", text: { textId: "o1", value: "One", role: "choiceText" } }, "menu", ["one"]),
            say("one", "One", "opt-1"),
            block("opt-2", "nodeAction", { action: "choiceOption", text: { textId: "o2", value: "Two", role: "choiceText" } }, "menu", []),
        ], ["menu"]);
        const scene = document.scenes["scene-1"];
        expect(stageTimelineThrough(scene, "one", new Map([["menu", "opt-2"]]))).toEqual(["one"]);
        expect(stageTimelineThrough(scene, null, new Map([["menu", "opt-2"]]))).toEqual(["opt-2"]);
        // A cursor outside every option leaves the path alone.
        expect(stageTimelineThrough(scene, "menu", new Map())).toEqual([]);
    });

    it("reads a camera at rest as neutral", () => {
        expect(isNeutralCamera({}, {})).toBe(true);
        expect(isNeutralCamera({ zoom: 1, position: { xoffset: 0 } }, { darkness: 0 })).toBe(true);
        expect(isNeutralCamera({ zoom: 1.2 }, {})).toBe(false);
        expect(isNeutralCamera({}, { darkness: 0.4 })).toBe(false);
    });
});
