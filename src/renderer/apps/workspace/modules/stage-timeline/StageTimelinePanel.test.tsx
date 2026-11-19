// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { STORY_DOCUMENT_SCHEMA_VERSION, type StoryAnimationAsset, type StoryBlock, type StoryDocument } from "@shared/types/story";
import { createEmptyVoiceDocument, type VoiceDocument } from "@shared/types/voice";
import { buildSavedRuntimeTable, createEmptyVariableRegistry } from "@shared/variables/variableRegistryModel";
import { resolveTakenConditionBranch } from "@/lib/ui-editor/runtime/game/storyStageSnapshot";
import { EventEmitter } from "@/lib/workspace/services/ui/EventEmitter";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { getStoryPreviewHub } from "../story/scene-editor/preview/storyPreviewHub";
import type { StageTimelineModel } from "./stageTimelineModel";
import { StageTimelinePanel } from "./StageTimelinePanel";

const mocked = vi.hoisted(() => ({
    workspace: null as unknown,
    document: null as unknown,
}));

vi.mock("@/apps/workspace/context", () => ({
    useWorkspace: () => mocked.workspace,
    useOptionalWorkspace: () => mocked.workspace,
}));

vi.mock("../story/scene-editor/preview/StoryScenePreviewFloatHost", () => ({
    useStoryDocument: () => mocked.document,
}));

vi.mock("./StageTimelineView", () => ({
    StageTimelineView: ({ model, onPick }: { model: StageTimelineModel; onPick: (choiceId: string, optionId: string) => void }) => (
        <>
            <output data-testid="labels">{JSON.stringify(model.lanes.map(lane => lane.cells.map(cell => cell.label)))}</output>
            <output data-testid="timings">{JSON.stringify(model.timings)}</output>
            <output data-testid="path">{JSON.stringify(model.blockIds)}</output>
            <button onClick={() => onPick("menu", "option-2")}>Pick second option</button>
        </>
    ),
}));

function story(assetId: string): StoryDocument {
    const blocks = [
        { id: "background", kind: "action", parentId: null, childrenIds: [], payload: { action: "setBackground", assetId } },
        { id: "line", kind: "nodeAction", parentId: null, childrenIds: [], payload: { action: "narration", text: { textId: "line-text", value: "Hello", role: "narration" } } },
    ] as StoryBlock[];
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "story-1",
        name: "Story",
        chapters: [{ id: "chapter-1", name: "Chapter", sceneIds: ["scene-1"] }],
        scenes: {
            "scene-1": {
                id: "scene-1", name: "Scene", runtimeName: "Scene",
                rootBlockIds: blocks.map(block => block.id),
                blocks: Object.fromEntries(blocks.map(block => [block.id, block])),
            },
        },
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}

function voiceDocument(locale: string, duration: number): VoiceDocument {
    return {
        ...createEmptyVoiceDocument(locale),
        units: { "line-text": { assetId: "voice-clip", sourceHash: "hash", status: "linked", duration } },
    };
}

function makeWorkspace(assetId: string) {
    const assetsEvents = new EventEmitter<{ updated: unknown; deleted: unknown; groupsUpdated: unknown }>();
    const setEvents = new EventEmitter<{ changed: void }>();
    const voiceEvents = new EventEmitter<{ config: void; document: { locale: string; document: VoiceDocument } }>();
    const registryEvents = new EventEmitter<{ changed: void }>();
    const registry = createEmptyVariableRegistry();
    const animationEvents = new EventEmitter<{ changed: void }>();
    const animations = new Map<string, StoryAnimationAsset>();
    const assets: Record<string, { id: string; name: string }> = {};
    const sets: Record<string, { id: string; name: string }> = {};
    const voice = {
        locale: "",
        pending: new Map<string, ReturnType<typeof deferred<VoiceDocument>>>(),
        getConfiguration() { return { voicedLocales: this.locale ? [{ code: this.locale }] : [] }; },
        getDocumentIfLoaded: () => undefined,
        loadDocument(locale: string) { return this.pending.get(locale)!.promise; },
        onConfigChanged: (callback: () => void) => voiceEvents.on("config", callback),
        onDocumentChanged: (callback: (event: { locale: string; document: VoiceDocument }) => void) => voiceEvents.on("document", callback),
    };
    const storyService = {
        loadAnimationAsset: async (id: string) => {
            const animation = animations.get(id);
            if (!animation) { throw new Error("Missing animation"); }
            return animation;
        },
        onAnimationsChanged: (callback: () => void) => animationEvents.on("changed", callback),
    };
    const serviceMap = new Map<unknown, unknown>([
        [Services.PanelState, { getPanelState: () => undefined, setPanelState: () => undefined }],
        [Services.Character, { listCharacter: () => [], subscribe: () => () => undefined }],
        [Services.Assets, { getAssets: () => ({ image: assets }), getEvents: () => assetsEvents }],
        [Services.AssetSets, { getSet: (id: string) => sets[id], onSetsChanged: (callback: () => void) => setEvents.on("changed", callback) }],
        [Services.Voice, voice],
        [Services.VariableRegistry, { getRegistry: () => registry, onRegistryChanged: (callback: () => void) => registryEvents.on("changed", callback) }],
        [Services.Story, storyService],
    ]);
    const context = {
        services: { get: (key: unknown) => {
            if (!serviceMap.has(key)) { throw new Error("Missing service"); }
            return serviceMap.get(key);
        } },
    } as unknown as WorkspaceContext;
    const hub = getStoryPreviewHub(context);
    const stepTo = vi.fn((blockId: string) => hub.publishCursor("scene-1", blockId));
    hub.registerTab({ tabId: "tab", storyId: "story-1", sceneId: "scene-1", stepTo, isRowShown: () => true, editorBody: () => null });
    hub.noteFocused("tab");
    hub.publishCursor("scene-1", "line");
    mocked.workspace = { context, isInitialized: true };
    mocked.document = story(assetId);
    return { assets, sets, assetsEvents, setEvents, voice, voiceEvents, registry, registryEvents, animations, animationEvents, storyService, hub, stepTo };
}

const canvasContext = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "getContext")!;
beforeAll(() => { Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { configurable: true, value: () => null }); });
afterEach(cleanup);
afterAll(() => { Object.defineProperty(HTMLCanvasElement.prototype, "getContext", canvasContext); });

describe("StageTimelinePanel", () => {
    it("refreshes an asset name when the library renames or deletes it", () => {
        const workspace = makeWorkspace("room");
        workspace.assets.room = { id: "room", name: "Room" };
        render(<StageTimelinePanel panelId="timeline" />);
        expect(screen.getByTestId("labels").textContent).toContain("Room");

        act(() => {
            workspace.assets.room.name = "Hall";
            workspace.assetsEvents.emit("updated", workspace.assets.room);
        });
        expect(screen.getByTestId("labels").textContent).toContain("Hall");

        act(() => {
            const removed = workspace.assets.room;
            delete workspace.assets.room;
            workspace.assetsEvents.emit("deleted", removed);
        });
        expect(screen.getByTestId("labels").textContent).not.toContain("Hall");
    });

    it("resolves and refreshes asset set names", () => {
        const workspace = makeWorkspace("set-1");
        workspace.sets["set-1"] = { id: "set-1", name: "Daylight" };
        render(<StageTimelinePanel panelId="timeline" />);
        expect(screen.getByTestId("labels").textContent).toContain("Daylight");

        act(() => {
            workspace.sets["set-1"].name = "Sunset";
            workspace.setEvents.emit("changed", undefined);
        });
        expect(screen.getByTestId("labels").textContent).toContain("Sunset");
    });

    it("keeps the current voice language when an earlier load finishes late", async () => {
        const workspace = makeWorkspace("room");
        const english = deferred<VoiceDocument>();
        const japanese = deferred<VoiceDocument>();
        workspace.voice.pending.set("en", english);
        workspace.voice.pending.set("ja", japanese);
        workspace.voice.locale = "en";
        render(<StageTimelinePanel panelId="timeline" />);

        act(() => { workspace.voice.locale = "ja"; workspace.voiceEvents.emit("config", undefined); });
        await act(async () => japanese.resolve(voiceDocument("ja", 2)));
        expect(screen.getByTestId("timings").textContent).toContain('"durationMs":2000');

        await act(async () => english.resolve(voiceDocument("en", 7)));
        expect(screen.getByTestId("timings").textContent).toContain('"durationMs":2000');
    });

    it("keeps an updated voice document when its earlier load finishes", async () => {
        const workspace = makeWorkspace("room");
        const pending = deferred<VoiceDocument>();
        workspace.voice.pending.set("en", pending);
        workspace.voice.locale = "en";
        render(<StageTimelinePanel panelId="timeline" />);

        act(() => workspace.voiceEvents.emit("document", { locale: "en", document: voiceDocument("en", 2) }));
        await act(async () => pending.resolve(voiceDocument("en", 7)));
        expect(screen.getByTestId("timings").textContent).toContain('"durationMs":2000');
    });

    it("picks another branch when the editor cursor is inside the first option", () => {
        const workspace = makeWorkspace("room");
        const document = story("room");
        const scene = document.scenes["scene-1"];
        const blocks = [
            { id: "menu", kind: "nodeAction", parentId: null, childrenIds: ["option-1", "option-2"], payload: { action: "choice" } },
            { id: "option-1", kind: "nodeAction", parentId: "menu", childrenIds: ["first"], payload: { action: "choiceOption", text: { textId: "o1", value: "First", role: "choiceText" } } },
            { id: "first", kind: "nodeAction", parentId: "option-1", childrenIds: [], payload: { action: "narration", text: { textId: "first-text", value: "First", role: "narration" } } },
            { id: "option-2", kind: "nodeAction", parentId: "menu", childrenIds: ["second"], payload: { action: "choiceOption", text: { textId: "o2", value: "Second", role: "choiceText" } } },
            { id: "second", kind: "nodeAction", parentId: "option-2", childrenIds: [], payload: { action: "narration", text: { textId: "second-text", value: "Second", role: "narration" } } },
        ] as StoryBlock[];
        scene.rootBlockIds = ["menu"];
        scene.blocks = Object.fromEntries(blocks.map(block => [block.id, block]));
        mocked.document = document;
        workspace.hub.publishCursor("scene-1", "first");
        render(<StageTimelinePanel panelId="timeline" />);
        expect(screen.getByTestId("path").textContent).toContain("first");

        fireEvent.click(screen.getByText("Pick second option"));
        expect(workspace.stepTo).toHaveBeenCalledWith("menu");
        expect(screen.getByTestId("path").textContent).toContain("second");
        expect(screen.getByTestId("path").textContent).not.toContain('"first"');

        act(() => workspace.hub.publishCursor("scene-1", "first"));
        expect(screen.getByTestId("path").textContent).toContain("first");
    });

    it("follows the preview's saved-variable condition and updates when its default changes", () => {
        const workspace = makeWorkspace("room");
        workspace.registry.entries.flag = { id: "flag", name: "Flag", scope: "saved", valueType: "boolean", defaultValue: true, storageKey: "flag" };
        const document = story("room");
        const scene = document.scenes["scene-1"];
        const blocks = [
            { id: "condition", kind: "control", parentId: null, childrenIds: ["yes", "otherwise"], payload: { control: "condition" } },
            { id: "yes", kind: "control", parentId: "condition", childrenIds: ["first"], payload: { control: "conditionBranch", branch: "if", condition: { kind: "variable", target: { scope: "saved", variableId: "flag" }, operator: "isTrue" } } },
            { id: "first", kind: "nodeAction", parentId: "yes", childrenIds: [], payload: { action: "narration", text: { textId: "first-text", value: "First", role: "narration" } } },
            { id: "otherwise", kind: "control", parentId: "condition", childrenIds: ["second"], payload: { control: "conditionBranch", branch: "else" } },
            { id: "second", kind: "nodeAction", parentId: "otherwise", childrenIds: [], payload: { action: "narration", text: { textId: "second-text", value: "Second", role: "narration" } } },
        ] as StoryBlock[];
        scene.rootBlockIds = ["condition"];
        scene.blocks = Object.fromEntries(blocks.map(block => [block.id, block]));
        mocked.document = document;
        workspace.hub.publishCursor("scene-1", "condition");
        expect(resolveTakenConditionBranch({ document, sceneId: "scene-1", conditionBlockId: "condition", savedVariables: buildSavedRuntimeTable(workspace.registry) })).toBe("yes");
        render(<StageTimelinePanel panelId="timeline" />);
        expect(screen.getByTestId("path").textContent).toContain("first");

        act(() => {
            workspace.registry.entries.flag.defaultValue = false;
            workspace.registryEvents.emit("changed", undefined);
        });
        expect(screen.getByTestId("path").textContent).toContain("second");
    });

    it("uses the final pose of a referenced camera motion and refreshes it after edits", async () => {
        const workspace = makeWorkspace("room");
        const animation: StoryAnimationAsset = {
            schemaVersion: 1, id: "motion", name: "Zoom", targetKind: "camera",
            sequences: [{ id: "sequence", props: { zoom: 1.2 }, options: { durationMs: 200 } }],
        };
        workspace.animations.set(animation.id, animation);
        const document = story("room");
        const scene = document.scenes["scene-1"];
        const blocks = [
            { id: "zoom", kind: "action", parentId: null, childrenIds: [], payload: { action: "camera", operation: "transform", transform: { mode: "props", to: { zoom: 2 } } } },
            { id: "motion", kind: "action", parentId: null, childrenIds: [], payload: { action: "camera", operation: "transform", transform: { mode: "animation", animationId: "motion" } } },
        ] as StoryBlock[];
        scene.rootBlockIds = blocks.map(block => block.id);
        scene.blocks = Object.fromEntries(blocks.map(block => [block.id, block]));
        mocked.document = document;
        render(<StageTimelinePanel panelId="timeline" />);
        await waitFor(() => expect(screen.getByTestId("labels").textContent).toContain("1.2×"));

        act(() => {
            workspace.animations.set(animation.id, { ...animation, sequences: [{ id: "sequence", props: { zoom: 1.5 }, options: { durationMs: 200 } }] });
            workspace.animationEvents.emit("changed", undefined);
        });
        await waitFor(() => expect(screen.getByTestId("labels").textContent).toContain("1.5×"));

        const slow = deferred<StoryAnimationAsset>();
        const loadAnimation = workspace.storyService.loadAnimationAsset;
        workspace.storyService.loadAnimationAsset = () => slow.promise;
        act(() => workspace.animationEvents.emit("changed", undefined));
        workspace.storyService.loadAnimationAsset = loadAnimation;
        act(() => {
            workspace.animations.set(animation.id, { ...animation, sequences: [{ id: "sequence", props: { zoom: 1.8 }, options: { durationMs: 200 } }] });
            workspace.animationEvents.emit("changed", undefined);
        });
        await waitFor(() => expect(screen.getByTestId("labels").textContent).toContain("1.8×"));
        await act(async () => slow.resolve(animation));
        expect(screen.getByTestId("labels").textContent).toContain("1.8×");
    });
});
