// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Services } from "@/lib/workspace/services/services";
import { ProjectAudioSection } from "./ProjectAudioSection";
import type { ProjectSectionProps } from "./types";

const mocks = vi.hoisted(() => ({ context: null as unknown }));
vi.mock("@/apps/workspace/context", () => ({ useWorkspace: () => ({ context: mocks.context, isInitialized: true }) }));
vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({ t: (key: string) => key, tn: (key: string, count: number) => `${key}:${count}`, has: () => false }),
}));
vi.mock("@/apps/workspace/components/ui/freezeGuard", async importOriginal => {
    const actual = await importOriginal<typeof import("@/apps/workspace/components/ui/freezeGuard")>();
    return { ...actual, useFreezeGuard: () => actual.makeFreezeGuard(false, "frozen") };
});

afterEach(cleanup);

describe("ProjectAudioSection", () => {
    it("abandons a track rename on Escape", async () => {
        const renameTrack = vi.fn();
        const track = { id: "sound", name: "Sound", volume: 1, loop: false, parentId: null };
        const services = {
            [Services.AudioTracks]: { listTracks: () => [track], onTracksChanged: () => () => undefined, renameTrack },
            [Services.Story]: { listStories: () => [] },
            [Services.UIGraph]: { getDocument: () => ({}) },
            [Services.UIDocument]: { getDocument: () => ({}) },
        } as Record<string, unknown>;
        mocks.context = { services: { get: (id: string) => services[id] } };
        render(<ProjectAudioSection {...({ uiService: null } as unknown as ProjectSectionProps)} />);

        fireEvent.click(await screen.findByRole("button", { name: /Sound/ }));
        const field = screen.getByLabelText("project.audio.nameTitle") as HTMLInputElement;
        act(() => field.focus());
        fireEvent.change(field, { target: { value: "Edited" } });
        act(() => { fireEvent.keyDown(field, { key: "Escape" }); });

        expect(field.value).toBe("Sound");
        expect(document.activeElement).not.toBe(field);
        expect(renameTrack).not.toHaveBeenCalled();
    });

    it("counts current references before confirming track deletion", async () => {
        const track = { id: "sound", name: "Sound", volume: 1, loop: false, parentId: null };
        const graph: { trackId?: string } = {};
        const services = {
            [Services.AudioTracks]: { listTracks: () => [track], onTracksChanged: () => () => undefined },
            [Services.Story]: { listStories: () => [] },
            [Services.UIGraph]: { getDocument: () => graph },
            [Services.UIDocument]: { getDocument: () => ({}) },
        } as Record<string, unknown>;
        mocks.context = { services: { get: (id: string) => services[id] } };
        const confirm = vi.fn().mockResolvedValue(false);
        render(<ProjectAudioSection {...({ uiService: { showDestructiveConfirm: confirm } } as unknown as ProjectSectionProps)} />);

        fireEvent.click(await screen.findByRole("button", { name: /Sound/ }));
        await screen.findByText("project.audio.usedBy:0");
        graph.trackId = "sound";
        fireEvent.click(screen.getByRole("button", { name: "project.audio.delete" }));

        await waitFor(() => expect(confirm).toHaveBeenCalledWith(
            "project.audio.deleteConfirm", "project.audio.deleteDetail:1", "project.audio.delete",
        ));
    });
});
