// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryDocument } from "@shared/types/story";
import { Services } from "@/lib/workspace/services/services";
import { StoryPanel } from "./StoryPanel";

/**
 * The cast faces on an outline scene row, in both layouts and with the faces turned off.
 *
 * The face itself is stubbed: what it draws is `StoryCastMark`'s business and needs the asset library.
 * What is tested here is which faces a row asks for, and which line of the row they land on.
 */

const STORY = "story";

const document = {
    id: STORY,
    name: STORY,
    entrySceneId: "scene",
    chapters: [{ id: "chapter", name: "Chapter", sceneIds: ["scene"] }],
    scenes: {
        scene: {
            id: "scene",
            name: "Rooftop",
            rootBlockIds: ["a", "b", "c", "d", "e"],
            blocks: Object.fromEntries(["aoi", "narra", "kaede", "mio", "aoi"].map((name, index) => {
                const id = "abcde"[index];
                return [id, {
                    id,
                    kind: "nodeAction",
                    parentId: null,
                    childrenIds: [],
                    payload: { action: "dialogue", characterId: `char-${name}`, text: { textId: `t-${id}`, role: "dialogue", value: "Hi" } },
                }];
            })),
        },
    },
} as unknown as StoryDocument;

function character(id: string, name: string) {
    return { profile: { getId: () => id, getName: () => name, getColor: () => null } };
}

const characters = [
    character("char-aoi", "Aoi"),
    character("char-narra", "Narra"),
    character("char-kaede", "Kaede"),
    character("char-mio", "Mio"),
];

let savedPanelState: unknown;

vi.mock("@/apps/workspace/hooks/useWorkspaceFrozen", () => ({
    useWorkspaceFreeze: () => null,
}));

vi.mock("../scene-editor/StoryCastMark", () => ({
    StoryCastMark: (props: { identity: { name: string } }) => <span data-cast-face={props.identity.name} />,
}));

const workspace = {
    isInitialized: true,
    context: {
        services: {
            get: (id: unknown) => {
                if (id === Services.Live) return { ownsStory: () => false, onChanged: () => () => undefined };
                if (id === Services.Story) {
                    return {
                        listStories: () => [{ id: STORY, name: "Story" }],
                        getDefaultStoryId: () => STORY,
                        onLibraryChanged: () => () => undefined,
                        onDocumentChanged: () => () => undefined,
                        loadStory: async () => document,
                    };
                }
                if (id === Services.Character) return { subscribe: () => () => undefined, listCharacter: () => characters };
                if (id === Services.PanelState) {
                    return {
                        getPanelState: () => savedPanelState,
                        setPanelState: (_panelId: string, state: unknown) => {
                            savedPanelState = state;
                        },
                    };
                }
                if (id === Services.UI) return { showError: vi.fn(), showNotification: vi.fn() };
                return null;
            },
        },
    },
};

vi.mock("@/apps/workspace/context", () => ({
    useWorkspace: () => workspace,
}));

vi.mock("@/apps/workspace/registry", () => ({
    useRegistry: () => ({ openEditorTab: vi.fn() }),
}));

vi.mock("../script/useStoryScriptIo", () => ({
    useStoryScriptIo: () => ({ beginExport: vi.fn(), beginImport: vi.fn(), dialogs: null }),
}));
vi.mock("../narralang/useNarralangExport", () => ({
    useNarralangExport: () => ({ beginExport: vi.fn(), dialogs: null }),
}));

async function sceneRow(): Promise<HTMLElement> {
    const name = await screen.findByText("Rooftop");
    return name.closest(".group\\/scene") as HTMLElement;
}

function facesIn(element: Element): string[] {
    return Array.from(element.querySelectorAll("[data-cast-face]")).map(face => face.getAttribute("data-cast-face") ?? "");
}

beforeEach(() => {
    savedPanelState = undefined;
});

afterEach(cleanup);

describe("the cast on an outline scene row", () => {
    it("is on by default, on one line with the name and the count, three faces and the rest as +N", async () => {
        render(<StoryPanel panelId="story" />);
        const row = await sceneRow();

        expect(facesIn(row)).toEqual(["Aoi", "Narra", "Kaede"]);
        expect(row.textContent).toContain("+1");
        expect(row.querySelector("[aria-label='Cast: Aoi, Narra, Kaede, Mio']")).not.toBeNull();
        // One line: the name, the faces and the count are all children of the row itself.
        const name = screen.getByText("Rooftop");
        expect(name.parentElement).toBe(row);
        expect(screen.getByText("5 lines").closest(".group\\/scene")).toBe(row);
    });

    it("puts the faces on the second line, beside the count, in the comfortable layout", async () => {
        savedPanelState = { selectedStoryId: STORY, outlineDensity: "comfortable" };
        render(<StoryPanel panelId="story" />);
        const row = await sceneRow();

        const count = screen.getByText("5 lines");
        expect(facesIn(count.parentElement as Element)).toEqual(["Aoi", "Narra", "Kaede", "Mio"]);
        expect(screen.getByText("Rooftop").parentElement?.parentElement?.parentElement).toBe(row);
    });

    it("draws no faces in either layout once they are turned off", async () => {
        savedPanelState = { selectedStoryId: STORY, outlineDensity: "comfortable", outlineCastAvatars: false };
        render(<StoryPanel panelId="story" />);
        const row = await sceneRow();

        expect(facesIn(row)).toEqual([]);
        expect(screen.getByText("5 lines")).toBeTruthy();
    });

    it("writes both choices back from the view menu", async () => {
        render(<StoryPanel panelId="story" />);
        await sceneRow();

        fireEvent.click(screen.getByLabelText("Outline display"));
        fireEvent.click(await screen.findByText("Comfortable"));
        fireEvent.click(screen.getByLabelText("Outline display"));
        fireEvent.click(await screen.findByText("Show Cast Avatars"));

        const state = savedPanelState as { outlineDensity?: string; outlineCastAvatars?: boolean };
        expect(state.outlineDensity).toBe("comfortable");
        expect(state.outlineCastAvatars).toBe(false);
        expect(facesIn(await sceneRow())).toEqual([]);
    });
});
