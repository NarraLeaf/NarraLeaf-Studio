// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { storyVars } from "@shared/i18n/catalog/en/storyVars";
import type { LiveVariableOp } from "@shared/live/ops";
import { FsRejectErrorCode, type FsRequestResult } from "@shared/types/os";
import type { StoryDocument, StoryLiteralValue, StoryVariableValueType } from "@shared/types/story";
import { join } from "@shared/utils/path";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { VariableRegistryService } from "@/lib/workspace/services/variables/VariableRegistryService";
import { StoryVariablesPanel } from "./StoryVariablesPanel";
import { STORY_VARIABLES_PANEL_ID, storyVariableReveal, type StoryVariablesPanelPayload } from "./storyVariablesPanelId";

const workspace = vi.hoisted(() => ({ context: null as unknown as WorkspaceContext, isInitialized: true }));
vi.mock("@/apps/workspace/context", () => ({ useWorkspace: () => workspace }));
vi.mock("@/apps/workspace/registry", () => ({
    useRegistry: () => ({ openEditorTab: vi.fn(), setPanelVisibility: vi.fn() }),
}));
vi.mock("@/apps/workspace/components/ui/freezeGuard", () => ({
    useFreezeGuard: () => ({ frozen: false, writes: (disabled = false) => ({ disabled }) }),
}));

async function renderPanel(
    valueType: StoryVariableValueType,
    defaultValue: StoryLiteralValue,
    options?: { story?: StoryDocument; payload?: StoryVariablesPanelPayload },
) {
    const root = join("D:/projects", "my-game");
    const files = new Map<string, string>();
    const ok = <T,>(data: T): FsRequestResult<T> => ({ ok: true, data });
    const variableRegistry = new VariableRegistryService();
    const blueprint = {
        listSavedVariables: () => variableRegistry.listEntriesInScope("saved"),
        listPersistentVariables: () => variableRegistry.listEntriesInScope("persistent"),
        renameSavedRegistryVariable: (_scope: string, id: string, name: string) => variableRegistry.renameEntry(id, name),
        setSavedRegistryVariableDefault: (_scope: string, id: string, value: StoryLiteralValue) => variableRegistry.setEntryDefault(id, value),
    };
    const services: Record<string, unknown> = {
        [Services.FileSystem]: {
            read: async (path: string) => files.has(path)
                ? ok(files.get(path)!)
                : { ok: false, error: { code: FsRejectErrorCode.NOT_FOUND, message: "missing" } },
            writeFileNoFollowOrCreate: async (path: string, data: string) => (files.set(path, data), ok(undefined)),
            createDir: async () => ok(undefined),
        },
        [Services.Project]: {},
        [Services.Uuid]: { generate: () => "v1" },
        [Services.UIGraph]: {},
        [Services.SaveStatus]: { register: () => undefined, reportUnreadableDocument: vi.fn() },
        [Services.Story]: {
            getStoryDocument: () => options?.story,
            onDocumentChanged: () => () => undefined,
        },
        [Services.VariableRegistry]: variableRegistry,
        [Services.LocalBlueprint]: blueprint,
    };
    const context = {
        project: { getConfig: () => ({ projectPath: root }) },
        services: { get: (id: string) => services[id] },
    } as unknown as WorkspaceContext;
    await variableRegistry.initialize(context, async () => undefined);
    const entry = variableRegistry.createEntry("saved", { name: "Player", valueType, defaultValue });
    await variableRegistry.flushPendingChanges();
    workspace.context = context;
    const view = render(<StoryVariablesPanel panelId={STORY_VARIABLES_PANEL_ID} payload={options?.payload} />);
    return { variableRegistry, id: entry.id, view };
}

afterEach(cleanup);

describe("editing a project variable in the panel", () => {
    it("accepts spaces while typing a name", async () => {
        const { variableRegistry, id } = await renderPanel("number", 0);
        const input = screen.getByLabelText(storyVars.row.nameAria) as HTMLInputElement;
        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: "Player " } });
        expect(input.value).toBe("Player ");
        expect(variableRegistry.getEntry(id)?.name).toBe("Player");
        fireEvent.change(input, { target: { value: "Player HP" } });
        expect(variableRegistry.getEntry(id)?.name).toBe("Player HP");
        await variableRegistry.flushPendingChanges();
    });

    it("accepts negative and fractional defaults one character at a time", async () => {
        const { variableRegistry, id } = await renderPanel("number", 0);
        const input = screen.getByLabelText(storyVars.row.defaultAria) as HTMLInputElement;
        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: "-" } });
        expect(input.value).toBe("-");
        expect(variableRegistry.getEntry(id)?.defaultValue).toBe(0);
        fireEvent.change(input, { target: { value: "-2" } });
        expect(variableRegistry.getEntry(id)?.defaultValue).toBe(-2);
        fireEvent.change(input, { target: { value: "1" } });
        fireEvent.change(input, { target: { value: "1." } });
        fireEvent.change(input, { target: { value: "1.0" } });
        expect(input.value).toBe("1.0");
        fireEvent.change(input, { target: { value: "1.05" } });
        expect(variableRegistry.getEntry(id)?.defaultValue).toBe(1.05);
        await variableRegistry.flushPendingChanges();
    });

    it("shows a JSON null default as null", async () => {
        await renderPanel("json", null);
        const input = screen.getByLabelText(storyVars.row.defaultAria) as HTMLInputElement;
        expect(input.value).toBe("null");
    });

    it("waits for the live effect before showing a valid number as the registry value", async () => {
        const { variableRegistry } = await renderPanel("number", 0);
        const operations: LiveVariableOp[] = [];
        variableRegistry.setOperationSink({ handle: op => (operations.push(op), true), canDelete: () => true });
        const input = screen.getByLabelText(storyVars.row.defaultAria) as HTMLInputElement;
        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: "-" } });
        expect(input.value).toBe("-");
        expect(operations).toHaveLength(0);

        fireEvent.change(input, { target: { value: "-2" } });
        expect(operations).toHaveLength(1);
        expect(input.value).toBe("0");
        act(() => variableRegistry.applyLiveOp(operations[0]));
        expect(input.value).toBe("-2");
        await variableRegistry.flushPendingChanges();
    });

    it("keeps a name authoritative while a live rename is pending", async () => {
        const { variableRegistry } = await renderPanel("number", 0);
        const operations: LiveVariableOp[] = [];
        variableRegistry.setOperationSink({ handle: op => (operations.push(op), true), canDelete: () => true });
        const input = screen.getByLabelText(storyVars.row.nameAria) as HTMLInputElement;
        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: "Player " } });
        expect(input.value).toBe("Player ");
        expect(operations).toHaveLength(0);
        fireEvent.change(input, { target: { value: "Player HP" } });
        expect(operations).toHaveLength(1);
        expect(input.value).toBe("Player");
        act(() => variableRegistry.applyLiveOp(operations[0]));
        expect(input.value).toBe("Player HP");
        await variableRegistry.flushPendingChanges();
    });

    it("discards an unfinished number on blur", async () => {
        const { variableRegistry, id } = await renderPanel("number", 0);
        const input = screen.getByLabelText(storyVars.row.defaultAria) as HTMLInputElement;
        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: "-" } });
        fireEvent.blur(input);
        expect(input.value).toBe("0");
        expect(variableRegistry.getEntry(id)?.defaultValue).toBe(0);
    });

    it("scrolls to a scene variable when its scene becomes focused after the reveal request", async () => {
        const declaration = {
            id: "local-b", kind: "declaration", parentId: null, childrenIds: [],
            payload: { scope: "scene", name: "Health", valueType: "number", defaultValue: 0, storageKey: "local-b" },
        };
        const story = {
            id: "story", name: "Main", version: 1,
            chapters: [{ id: "chapter", name: "Chapter", sceneIds: ["a", "b"] }],
            scenes: {
                a: { id: "a", name: "A", runtimeName: "a", rootBlockIds: [], blocks: {} },
                b: { id: "b", name: "B", runtimeName: "b", rootBlockIds: [declaration.id], blocks: { [declaration.id]: declaration } },
            },
        } as unknown as StoryDocument;
        const first = { storyId: "story", sceneId: "a" } as StoryVariablesPanelPayload;
        const second = { storyId: "story", sceneId: "b" } as StoryVariablesPanelPayload;
        const originalScroll = HTMLElement.prototype.scrollIntoView;
        const scroll = vi.fn();
        HTMLElement.prototype.scrollIntoView = scroll;
        try {
            const { view } = await renderPanel("number", 0, { story, payload: first });
            await act(async () => {
                storyVariableReveal.request({ scope: "scene", variableId: "local-b" });
                await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
            });
            view.rerender(<StoryVariablesPanel panelId={STORY_VARIABLES_PANEL_ID} payload={second} />);
            expect(view.container.querySelector('[data-variable-id="local-b"]')).not.toBeNull();
            expect(scroll).toHaveBeenCalledTimes(1);
        } finally {
            HTMLElement.prototype.scrollIntoView = originalScroll;
        }
    });
});
