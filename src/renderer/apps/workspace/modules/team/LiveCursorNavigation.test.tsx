// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { i18nStore } from "@/lib/i18n";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { goToCursor, LiveSessionChat } from "./LiveCursorAndChat";

const nav = vi.hoisted(() => ({
    context: { services: { get: vi.fn() } },
    open: vi.fn(),
    readStory: vi.fn(),
}));

vi.mock("../../context", () => ({ useWorkspace: () => ({ context: nav.context, isInitialized: true }) }));
vi.mock("../../hooks/useUIService", () => ({ useActiveEditorTab: () => ({ tab: null }) }));
vi.mock("../agent/revealAgentWrite", () => ({ revealAgentWrite: vi.fn() }));
vi.mock("../story/scene-editor/StorySceneEditorTab", () => ({ StorySceneEditorTab: () => null }));

const storyId = "11111111-1111-4111-8111-111111111111";
const sceneId = "22222222-2222-4222-8222-222222222222";
const blockId = "33333333-3333-4333-8333-333333333333";
const cursor = { document: `story:${storyId}`, element: `${sceneId}/${blockId}` };
const context = nav.context as unknown as WorkspaceContext;

beforeEach(() => {
    nav.open.mockReset();
    nav.readStory.mockReset();
    nav.context.services.get.mockReset();
    nav.context.services.get.mockImplementation((service: string) => {
        if (service === Services.Story) return { getLoadedStoryDocument: nav.readStory };
        if (service === Services.UI) return { editor: { open: nav.open } };
        if (service === Services.Live) return {
            getView: () => ({ phase: "active", self: "me", session: { members: [{ instance: "peer", account: "Bob" }] } }),
            onChanged: () => () => undefined,
            getPresence: () => ({ chat: [], cursors: [{ ...cursor, instance: "peer", account: "Bob", at: 1 }] }),
            onPresenceChanged: () => () => undefined,
        };
        throw new Error(`Unexpected service: ${service}`);
    });
    i18nStore.setLocale("en");
});

afterEach(() => {
    cleanup();
    i18nStore.setLocale("en");
});

describe("following a story cursor", () => {
    it("opens the real scene tab with a localised title and the peer's actual target", async () => {
        nav.readStory.mockReturnValue(undefined);
        render(<LiveSessionChat />);
        fireEvent.click(screen.getByLabelText("Open session chat"));
        fireEvent.click(screen.getByRole("button", { name: "Bob" }));

        await waitFor(() => expect(nav.open).toHaveBeenCalledTimes(1));
        const tab = nav.open.mock.calls[0]![0];
        expect(tab.title).toBe("Unknown scene");
        expect(tab.id).toBe(`story:scene:${storyId}:${sceneId}`);
        expect(tab.payload).toEqual({ storyId, sceneId, activeBlockId: blockId, revealToken: 1 });
        expect(nav.readStory).toHaveBeenCalledWith(storyId);
    });

    it.each([
        ["en", "Unknown scene"],
        ["zh", "未知场景"],
        ["ja", "不明なシーン"],
    ] as const)("uses the existing %s placeholder when the scene is absent", (locale, expected) => {
        i18nStore.setLocale(locale);
        nav.readStory.mockReturnValue({ scenes: {} });
        goToCursor(context, cursor, 9);
        expect(nav.open.mock.calls[0]![0]).toMatchObject({
            title: expected,
            payload: { storyId, sceneId, activeBlockId: blockId, revealToken: 9 },
        });
    });

    it("uses the scene's actual name when available", () => {
        nav.readStory.mockReturnValue({ scenes: { [sceneId]: { name: "Harbour" } } });
        goToCursor(context, cursor, 4);
        expect(nav.open.mock.calls[0]![0]).toMatchObject({
            title: "Harbour",
            payload: { storyId, sceneId, activeBlockId: blockId, revealToken: 4 },
        });
    });

    it("uses the placeholder for a blank name or an unavailable story service", () => {
        nav.readStory.mockReturnValueOnce({ scenes: { [sceneId]: { name: "  " } } }).mockImplementationOnce(() => { throw new Error("unavailable"); });
        goToCursor(context, cursor, 1);
        goToCursor(context, cursor, 2);
        expect(nav.open.mock.calls.map(([tab]) => tab.title)).toEqual(["Unknown scene", "Unknown scene"]);
        expect(nav.open.mock.calls.map(([tab]) => tab.payload.sceneId)).toEqual([sceneId, sceneId]);
    });
});
