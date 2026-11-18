// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { freezeProjectWrites, thawProjectWrites } from "@/lib/app/writeFreeze";
import { Services } from "@/lib/workspace/services/services";
import { useStoryScriptIo } from "./useStoryScriptIo";

const scene = { id: "scene-1", name: "Scene", runtimeName: "Scene", rootBlockIds: [], blocks: {} };
const plan = {
    storyMatches: true,
    diagnostics: [],
    scenes: [{
        sceneId: scene.id,
        sceneName: scene.name,
        scene,
        stats: { unchanged: 0, edited: 1, added: 0, removed: 0, cloned: 0, moved: 0 },
        stale: false,
        missing: false,
        diagnostics: [],
    }],
};
const commitSceneReplacement = vi.fn(() => true);
const showError = vi.fn();
const showNotification = vi.fn();

const services = {
    get(id: unknown) {
        if (id === Services.Story) return { loadStory: async () => ({ id: "story-1", scenes: { [scene.id]: scene } }), commitSceneReplacement };
        if (id === Services.Character) return { listCharacter: () => [] };
        if (id === Services.Uuid) return { generate: () => "00000000-0000-4000-8000-000000000001" };
        if (id === Services.FileSystem) return { read: async () => ({ ok: true, data: "script" }) };
        if (id === Services.UI) return { showError, showNotification };
        if (id === Services.Live) return { ownsStory: () => false };
        return null;
    },
};

vi.mock("../../../context", () => ({ useWorkspace: () => ({ context: { services }, isInitialized: true }) }));
vi.mock("@/lib/i18n", async importOriginal => ({
    ...await importOriginal<typeof import("@/lib/i18n")>(),
    useTranslation: () => ({ t: (key: string) => key, tn: (key: string) => key }),
}));
vi.mock("@/lib/app/privilegedFacade", () => ({
    appPrivilegedFacade: { fs: { selectFile: async () => ({ success: true, data: { ok: true, data: ["/tmp/story.txt"] } }) } },
}));
vi.mock("@/lib/story/script/storyScriptCodec", () => ({
    exportStoryScript: vi.fn(),
    parseStoryScript: () => ({ ok: true, script: {} }),
    planStoryScriptImport: () => plan,
}));
vi.mock("./StoryScriptExportModal", () => ({ StoryScriptExportModal: () => null }));
vi.mock("./StoryScriptImportModal", () => ({
    StoryScriptImportModal: (props: { plan: unknown; onImport: () => void }) => (
        props.plan ? <button onClick={props.onImport}>Confirm import</button> : null
    ),
}));

let beginImport: (storyId: string) => void;
function ImportSurface({ onReady }: { onReady: (begin: (storyId: string) => void) => void }) {
    const io = useStoryScriptIo();
    useEffect(() => onReady(io.beginImport), [io.beginImport, onReady]);
    return <>{io.dialogs}</>;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
    cleanup();
    thawProjectWrites();
});

async function openImport() {
    render(<ImportSurface onReady={begin => { beginImport = begin; }} />);
    await act(async () => beginImport("story-1"));
    return screen.findByText("Confirm import");
}

describe("story script import", () => {
    it("commits the confirmed scene while the project is writable", async () => {
        fireEvent.click(await openImport());
        expect(commitSceneReplacement).toHaveBeenCalledOnce();
        expect(showNotification).toHaveBeenCalledOnce();
    });

    it("does not replace a scene when the project freezes before confirmation", async () => {
        const confirm = await openImport();
        freezeProjectWrites({ projectPath: "/tmp/project", reason: { kind: "manual" } });
        fireEvent.click(confirm);

        expect(commitSceneReplacement).not.toHaveBeenCalled();
        expect(showNotification).not.toHaveBeenCalled();
        expect(showError).toHaveBeenCalledOnce();
    });

});
