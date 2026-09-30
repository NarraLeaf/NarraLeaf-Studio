// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { storySnapshot as en } from "@shared/i18n/catalog/en/storySnapshot";
import { Services } from "@/lib/workspace/services/services";
import { makeFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import type { StoryDocument } from "@shared/types/story";
import { DECLARED_DEFAULTS_ENTRY } from "./storySnapshotSelection";
import { StorySnapshotPanel } from "./StorySnapshotPanel";

/**
 * The first entry of the snapshot list, and what selecting it means.
 *
 * The list used to select the scene's first snapshot whenever the author had chosen nothing, so a
 * snapshot made once and forgotten went on pinning its values behind the row play control, with the
 * panel showing a name that told the author nothing about the fact that it was being applied. The
 * list now opens on an entry that says what happens when no snapshot is applied, and that entry is
 * pickable back.
 *
 * Two things are asserted together throughout, because the whole point is that they agree: what the
 * panel shows, and what it publishes for the launcher to read. And nothing here may reach the story
 * document - the entry is workspace state, and a snapshot minted to represent "no snapshot" would be
 * the edit this whole change exists to remove.
 */

const STORY_ID = "chapter-one";
const SCENE_ID = "rooftop";
const SNAPSHOT_ID = "snapshot-a";

let panelState: Record<string, Record<string, string>>;
let document: StoryDocument;

const writes = {
    createSceneSnapshot: vi.fn(() => "made-one"),
    setSceneSnapshotValue: vi.fn(),
    clearSceneSnapshotValue: vi.fn(),
    deleteSceneSnapshot: vi.fn(),
    renameSceneSnapshot: vi.fn(),
};

vi.mock("@/apps/workspace/components/ui/freezeGuard", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    useFreezeGuard: () => makeFreezeGuard(false, ""),
}));

// One workspace object for the whole file, not one per call: the panel memoizes its services on the
// context's identity, and a fresh context per render restarts the effect that reads the document,
// which re-renders. The real context is stable.
vi.mock("@/apps/workspace/context", () => {
    const services = {
        get: (id: unknown) => {
            if (id === Services.Story) {
                return { getStoryDocument: () => document, onDocumentChanged: () => () => undefined, ...writes };
            }
            if (id === Services.LocalBlueprint) {
                return {
                    listSavedVariables: () => [],
                    listPersistentVariables: () => [],
                    onBlueprintHistoryChanged: () => () => undefined,
                };
            }
            if (id === Services.PanelState) {
                return {
                    getPanelState: (key: string) => panelState[key],
                    setPanelState: (key: string, partial: Record<string, string>) => {
                        panelState[key] = { ...(panelState[key] ?? {}), ...partial };
                    },
                };
            }
            return null;
        },
    };
    const workspace = { isInitialized: true, context: { services } };
    return { useWorkspace: () => workspace };
});

/** What the launcher will read back for this scene. */
const published = () => panelState["story:snapshot:selected"]?.[`${STORY_ID}::${SCENE_ID}`];

/** The Select's trigger is the panel's first button; its text is the entry on show. */
const shownEntry = () => screen.getAllByRole("button")[0]!.textContent;

function renderPanel() {
    render(<StorySnapshotPanel panelId="test" payload={{ storyId: STORY_ID as never, sceneId: SCENE_ID as never }} />);
}

beforeEach(() => {
    panelState = {};
    for (const write of Object.values(writes)) write.mockClear();
    document = {
        id: STORY_ID,
        name: "My Game",
        scenes: {
            [SCENE_ID]: {
                id: SCENE_ID,
                name: "Rooftop",
                rootBlockIds: [],
                blocks: {},
                sceneSnapshots: [{ id: SNAPSHOT_ID, name: "Snapshot 1", values: {} }],
            },
        },
    } as unknown as StoryDocument;
});

afterEach(cleanup);

describe("the snapshot list's declared-defaults entry", () => {
    it("is what a scene nobody has chosen for shows, even holding a snapshot", () => {
        renderPanel();

        expect(shownEntry()).toBe(en.defaults);
        expect(screen.getByText(en.defaultsDetail)).toBeTruthy();
        expect(published()).toBe(DECLARED_DEFAULTS_ENTRY);
    });

    it("is what a scene holding no snapshots shows, rather than nothing at all", () => {
        (document.scenes[SCENE_ID] as { sceneSnapshots?: unknown }).sceneSnapshots = [];

        renderPanel();

        expect(shownEntry()).toBe(en.defaults);
        expect(published()).toBe(DECLARED_DEFAULTS_ENTRY);
    });

    it("gives way to a snapshot the author picks, and takes the selection back", () => {
        renderPanel();

        fireEvent.click(screen.getAllByRole("button")[0]!);
        fireEvent.click(screen.getByText("Snapshot 1"));
        expect(shownEntry()).toBe("Snapshot 1");
        expect(published()).toBe(SNAPSHOT_ID);

        fireEvent.click(screen.getAllByRole("button")[0]!);
        fireEvent.click(screen.getByText(en.defaults));
        expect(shownEntry()).toBe(en.defaults);
        expect(published()).toBe(DECLARED_DEFAULTS_ENTRY);
    });

    it("is not a snapshot: none of it reaches the story document", () => {
        renderPanel();

        fireEvent.click(screen.getAllByRole("button")[0]!);
        fireEvent.click(screen.getByText("Snapshot 1"));
        fireEvent.click(screen.getAllByRole("button")[0]!);
        fireEvent.click(screen.getByText(en.defaults));

        for (const [name, write] of Object.entries(writes)) {
            expect(write, `${name} was called`).not.toHaveBeenCalled();
        }
    });
});
