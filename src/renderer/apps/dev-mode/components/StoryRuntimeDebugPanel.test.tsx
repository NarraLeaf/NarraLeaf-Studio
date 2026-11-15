// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DevModeBundle } from "@shared/types/devMode";
import type { ScopeStoreBridge } from "@/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";
import type { GameAppStoryRuntimeBridge } from "@/lib/ui-editor/runtime/app/GameAppHost";
import { DevModeReadOnlyContext } from "../devModeReadOnly";
import { StoryRuntimeDebugPanel } from "./StoryRuntimeDebugPanel";

vi.mock("@/apps/workspace/modules/story-flow/SceneFlowCanvas", () => ({
    SceneFlowCanvas: ({ onOpenScene }: { onOpenScene: (id: string) => void }) => (
        <button type="button" onClick={() => onOpenScene("scene-1")}>Open scene</button>
    ),
}));

const scene = { id: "scene-1", name: "Opening", runtimeName: "opening", rootBlockIds: [], blocks: {} };
const document = { id: "story", name: "Story", chapters: [{ id: "chapter", name: "Chapter", sceneIds: [scene.id] }], scenes: { [scene.id]: scene } };
const bundle = {
    ui: {
        savedVariables: { title: { id: "title", name: "Title", scope: "saved", storageKey: "title", valueType: "string" } },
        persistentVariables: {},
        localBlueprints: { blueprints: {}, ownerRecords: {} },
    },
    storyLibrary: { documents: { story: document }, characters: [], assetNames: {} },
} as unknown as DevModeBundle;
const bindings: never[] = [];
const write = vi.fn();
const relaunch = vi.fn(async () => undefined);
const storyRuntime = {
    getStoryContext: () => ({ storyId: "story", sceneId: "scene-1" }),
    getActionIdBindings: () => bindings,
    getCurrentActionId: () => null,
    subscribeCurrentAction: () => () => undefined,
    getVariableNamespaces: () => ({ saved: "saved", visited: null, sceneLocal: {} }),
    readStorableNamespace: () => ({ title: "Original" }),
    writeStorableValue: write,
    relaunch,
} as unknown as GameAppStoryRuntimeBridge;
const scopeBridge = {
    subscribePersistence: () => () => undefined,
} as unknown as ScopeStoreBridge;

function panel(readOnly: boolean) {
    return <DevModeReadOnlyContext.Provider value={readOnly}>
        <StoryRuntimeDebugPanel storyRuntime={storyRuntime} scopeBridge={scopeBridge} bundle={bundle} projectPath={null} />
    </DevModeReadOnlyContext.Provider>;
}

beforeEach(() => { write.mockClear(); relaunch.mockClear(); });
afterEach(cleanup);

describe("StoryRuntimeDebugPanel during an agent hold", () => {
    it("does not commit a draft when a hold begins before the field blurs", () => {
        const view = render(panel(false));
        const input = screen.getByDisplayValue("Original");
        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: "Edited" } });
        view.rerender(panel(true));
        expect((input as HTMLInputElement).value).toBe("Original");
        fireEvent.blur(input);
        expect(write).not.toHaveBeenCalled();
        expect((input as HTMLInputElement).value).toBe("Original");
        view.rerender(panel(false));
        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: "Later" } });
        fireEvent.blur(input);
        expect(write).toHaveBeenCalledWith("saved", "title", "Later");
    });

    it("opens a scene only when the author controls the session", async () => {
        const view = render(panel(true));
        fireEvent.click(screen.getByRole("tab", { name: "Scenes" }));
        fireEvent.click(await screen.findByRole("button", { name: "Open scene" }));
        expect(relaunch).not.toHaveBeenCalled();

        view.rerender(panel(false));
        fireEvent.click(screen.getByRole("button", { name: "Open scene" }));
        expect(relaunch).toHaveBeenCalledWith({ sceneId: "scene-1" });
    });
});
