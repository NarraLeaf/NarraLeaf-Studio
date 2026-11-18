// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoryDocument, StoryVariableRef } from "@shared/types/story";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { VariableReferenceList } from "./VariableReferenceList";

const workspace = vi.hoisted(() => ({ context: null as unknown as WorkspaceContext }));
vi.mock("@/apps/workspace/context", () => ({ useWorkspace: () => workspace }));
vi.mock("@/apps/workspace/registry", () => ({
    useRegistry: () => ({ openEditorTab: vi.fn(), setPanelVisibility: vi.fn() }),
}));

const ref: StoryVariableRef = { scope: "saved", variableId: "v1" };
const entry = { id: "v1", storageKey: "v1", name: "Gold", scope: "saved", valueType: "number" };

function storyDocument(withReference: boolean): StoryDocument {
    const block = {
        id: "set-gold", kind: "action", parentId: null, childrenIds: [],
        payload: { action: "setVariable", target: ref, value: null },
    };
    return {
        id: "story", name: "Main", version: 1,
        chapters: [{ id: "chapter", name: "Chapter", sceneIds: ["scene"] }],
        scenes: { scene: {
            id: "scene", name: "Room", runtimeName: "scene",
            rootBlockIds: withReference ? [block.id] : [],
            blocks: withReference ? { [block.id]: block } : {},
        } },
    } as unknown as StoryDocument;
}

function createHarness(loadStory?: () => Promise<StoryDocument>) {
    let blueprints: unknown = { blueprints: {}, ownerRecords: {} };
    const storyListeners = new Set<() => void>();
    const graphListeners = new Set<() => void>();
    const subscribe = (listeners: Set<() => void>) => (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
    };
    const services: Record<string, unknown> = {
        [Services.Story]: {
            listStories: () => loadStory ? [{ id: "story", name: "Main" }] : [],
            loadStory,
            onDocumentChanged: subscribe(storyListeners),
        },
        [Services.VariableRegistry]: { listEntries: () => [entry], onRegistryChanged: () => () => undefined },
        [Services.LocalBlueprint]: { getBlueprintDocument: () => blueprints },
        [Services.UIGraph]: { onGraphsChanged: subscribe(graphListeners) },
    };
    workspace.context = { services: { get: (id: string) => services[id] } } as unknown as WorkspaceContext;
    return {
        setBlueprintReference(present: boolean) {
            blueprints = {
                blueprints: { bp1: {
                    id: "bp1", name: "Shop",
                    graphs: { events: { ev: { graph: { nodes: present ? {
                        n1: { id: "n1", type: "blueprint.saved.set", params: { savedVariableId: "v1" } },
                    } : {} } } } },
                } },
                ownerRecords: { "surfaceMain:s1": { blueprintId: "bp1" } },
            };
            graphListeners.forEach(listener => listener());
        },
        storyChanged: () => storyListeners.forEach(listener => listener()),
        graphListenerCount: () => graphListeners.size,
    };
}

afterEach(cleanup);

describe("the variable reference list", () => {
    it("updates blueprint reads and writes when the graph changes while the list is open", async () => {
        const harness = createHarness();
        const view = render(<VariableReferenceList variableRef={ref} />);
        await waitFor(() => expect(view.container.querySelector("[data-variable-references]")).not.toBeNull());
        expect(screen.queryByText("blueprint.saved.set")).toBeNull();

        act(() => harness.setBlueprintReference(true));
        await waitFor(() => expect(screen.queryByText("blueprint.saved.set")).not.toBeNull());

        act(() => harness.setBlueprintReference(false));
        await waitFor(() => expect(screen.queryByText("blueprint.saved.set")).toBeNull());
        view.unmount();
        expect(harness.graphListenerCount()).toBe(0);
    });

    it("keeps a newer story result when an older read finishes later", async () => {
        let finishFirst!: (document: StoryDocument) => void;
        const first = new Promise<StoryDocument>(resolve => { finishFirst = resolve; });
        const loadStory = vi.fn()
            .mockImplementationOnce(() => first)
            .mockResolvedValue(storyDocument(false));
        const harness = createHarness(loadStory);
        const view = render(<VariableReferenceList variableRef={ref} />);
        await waitFor(() => expect(loadStory).toHaveBeenCalledTimes(1));

        act(() => harness.storyChanged());
        await waitFor(() => expect(loadStory).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(view.container.querySelector("[data-variable-references]")).not.toBeNull());
        await act(async () => finishFirst(storyDocument(true)));

        expect(view.container.textContent).not.toContain("Room");
    });
});
