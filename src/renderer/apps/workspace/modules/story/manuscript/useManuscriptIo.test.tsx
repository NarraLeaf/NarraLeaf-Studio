// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { freezeProjectWrites, thawProjectWrites } from "@/lib/app/writeFreeze";
import { Services } from "@/lib/workspace/services/services";
import { useManuscriptIo } from "./useManuscriptIo";

const STORY_ID = "story-1";
const source = { kind: "structured" as const, scenes: [{ lines: [{ speaker: "Alice", text: "Hello" }] }] };
const plan = {
    rows: [{ kind: "dialogue" as const, text: "Hello", pendingCharacterName: "Alice" }],
    charactersToCreate: ["Alice"],
    counts: { dialogue: 1, narration: 0 },
};

let finishLoading: (() => void) | null = null;
const loadStory = vi.fn(() => new Promise<void>(resolve => { finishLoading = resolve; }));
const createCharacter = vi.fn(() => ({ profile: { getId: () => "character-1" } }));
const createScene = vi.fn(() => ({ id: "scene-1", name: "Scene" }));
const insertBlocks = vi.fn();
const runAgentOutlineStep = vi.fn((_id: string, _label: unknown, action: () => void) => action());
const showError = vi.fn();
const showNotification = vi.fn();
const openEditorTab = vi.fn();
let nextId = 0;

const services = {
    get(id: unknown) {
        if (id === Services.Story) return { loadStory, createScene, insertBlocks, runAgentOutlineStep };
        if (id === Services.Character) return { createCharacter, listCharacter: () => [] };
        if (id === Services.Uuid) return { generate: () => `00000000-0000-4000-8000-${(++nextId).toString(16).padStart(12, "0")}` };
        if (id === Services.FileSystem) return { read: async () => ({ ok: true, data: "A line of narration." }) };
        if (id === Services.PanelState) return { getPanelState: () => undefined, setPanelState: vi.fn() };
        if (id === Services.UI) return { showError, showNotification };
        if (id === Services.Live) return { ownsStory: () => false };
        return null;
    },
};

vi.mock("../../../context", () => ({ useWorkspace: () => ({ context: { services }, isInitialized: true }) }));
vi.mock("../../../registry", () => ({ useRegistry: () => ({ openEditorTab }) }));
vi.mock("@/lib/i18n", async importOriginal => ({
    ...await importOriginal<typeof import("@/lib/i18n")>(),
    useTranslation: () => ({ t: (key: string) => key, tn: (key: string) => key }),
}));
vi.mock("./ManuscriptImportModal", () => ({
    ManuscriptImportModal: (props: { onConfirm: (source: unknown, plan: unknown, mappings: unknown) => void }) => (
        <button onClick={() => props.onConfirm(source, plan, {})}>Confirm import</button>
    ),
}));

let importPath: (storyId: string, path: string) => Promise<void>;
function ImportSurface({ onReady }: { onReady: (path: (storyId: string, filePath: string) => Promise<void>) => void }) {
    const io = useManuscriptIo();
    useEffect(() => onReady(io.importPath), [io.importPath, onReady]);
    return <>{io.dialogs}</>;
}

beforeEach(() => {
    finishLoading = null;
    nextId = 0;
    vi.clearAllMocks();
});

afterEach(() => {
    cleanup();
    thawProjectWrites();
});

async function startImport() {
    render(<ImportSurface onReady={path => { importPath = path; }} />);
    await act(() => importPath(STORY_ID, "/tmp/script.fountain"));
    fireEvent.click(screen.getByText("Confirm import"));
    expect(loadStory).toHaveBeenCalledOnce();
}

describe("manuscript import", () => {
    it("creates its character and scene after the story loads", async () => {
        await startImport();
        await act(async () => finishLoading?.());

        expect(createCharacter).toHaveBeenCalledWith("Alice");
        expect(createScene).toHaveBeenCalledOnce();
        expect(insertBlocks).toHaveBeenCalledOnce();
        expect(showNotification).toHaveBeenCalledOnce();
        expect(openEditorTab).toHaveBeenCalledOnce();
    });

    it("does not create characters or scenes when the project freezes while loading", async () => {
        await startImport();
        freezeProjectWrites({ projectPath: "/tmp/project", reason: { kind: "manual" } });
        await act(async () => finishLoading?.());

        expect(createCharacter).not.toHaveBeenCalled();
        expect(runAgentOutlineStep).not.toHaveBeenCalled();
        expect(showNotification).not.toHaveBeenCalled();
        expect(openEditorTab).not.toHaveBeenCalled();
        await waitFor(() => expect(showError).toHaveBeenCalled());
    });
});
