// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Services } from "@/lib/workspace/services/services";
import { ProjectDlcSection } from "./ProjectDlcSection";
import type { ProjectSectionProps } from "./types";

const mocks = vi.hoisted(() => ({ context: null as unknown }));

vi.mock("@/apps/workspace/context", () => ({
    useWorkspace: () => ({ context: mocks.context, isInitialized: true }),
}));
vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({
        t: (key: string) => key,
        tn: (key: string, count: number) => `${key}:${count}`,
    }),
}));
vi.mock("@/apps/workspace/components/ui/freezeGuard", async importOriginal => {
    const actual = await importOriginal<typeof import("@/apps/workspace/components/ui/freezeGuard")>();
    return { ...actual, useFreezeGuard: () => actual.makeFreezeGuard(false, "frozen") };
});
vi.mock("../configLiveSession", () => ({
    DLC_CLAIMS: {},
    dlcDocumentFreezeScope: () => "dlc",
    useConfigClaim: () => null,
    useConfigClaimHold: () => undefined,
    ConfigClaimMark: () => null,
}));

afterEach(cleanup);

describe("ProjectDlcSection", () => {
    it("counts the stories currently assigned when confirming deletion", async () => {
        const stories: Array<{ dlcId: string }> = [];
        const dlc = { id: "bonus", name: "Bonus", attachTo: "release" };
        const services = {
            [Services.Dlc]: { list: () => [dlc], onDlcChanged: () => () => undefined },
            [Services.AppTags]: { listTags: () => [], onTagsChanged: () => () => undefined },
            [Services.Story]: { listStories: () => stories },
            [Services.UIGraph]: {},
        } as Record<string, unknown>;
        mocks.context = { services: { get: (id: string) => services[id] } };
        const confirm = vi.fn().mockResolvedValue(false);
        render(<ProjectDlcSection {...({ uiService: { showDestructiveConfirm: confirm } } as unknown as ProjectSectionProps)} />);

        fireEvent.click(await screen.findByRole("button", { name: "Bonus" }));
        stories.push({ dlcId: "bonus" });
        fireEvent.click(screen.getByRole("button", { name: "project.dlc.delete" }));

        await waitFor(() => expect(confirm).toHaveBeenCalledWith(
            "project.dlc.deleteConfirm",
            "project.dlc.deleteDetail:1",
            "project.dlc.delete",
        ));
    });

    it("abandons a name edit when Escape blurs the field", async () => {
        const dlc = { id: "bonus", name: "Bonus", attachTo: "release" };
        const rename = vi.fn();
        const services = {
            [Services.Dlc]: { list: () => [dlc], onDlcChanged: () => () => undefined, rename },
            [Services.AppTags]: { listTags: () => [], onTagsChanged: () => () => undefined },
            [Services.Story]: { listStories: () => [] },
            [Services.UIGraph]: {},
        } as Record<string, unknown>;
        mocks.context = { services: { get: (id: string) => services[id] } };
        render(<ProjectDlcSection {...({ uiService: null } as unknown as ProjectSectionProps)} />);

        fireEvent.click(await screen.findByRole("button", { name: "Bonus" }));
        const field = screen.getByLabelText("project.dlc.nameTitle") as HTMLInputElement;
        act(() => field.focus());
        fireEvent.change(field, { target: { value: "Edited" } });
        act(() => { fireEvent.keyDown(field, { key: "Escape" }); });

        expect(document.activeElement).not.toBe(field);
        expect(field.value).toBe("Bonus");
        expect(rename).not.toHaveBeenCalled();
    });

    it("abandons an id edit without asking for confirmation", async () => {
        const dlc = { id: "bonus", name: "Bonus", attachTo: "release" };
        const changeId = vi.fn();
        const services = {
            [Services.Dlc]: { list: () => [dlc], onDlcChanged: () => () => undefined, changeId },
            [Services.AppTags]: { listTags: () => [], onTagsChanged: () => () => undefined },
            [Services.Story]: { listStories: () => [{ dlcId: "bonus" }] },
            [Services.UIGraph]: {},
        } as Record<string, unknown>;
        mocks.context = { services: { get: (id: string) => services[id] } };
        const confirm = vi.fn();
        render(<ProjectDlcSection {...({ uiService: { showDestructiveConfirm: confirm } } as unknown as ProjectSectionProps)} />);

        fireEvent.click(await screen.findByRole("button", { name: "Bonus" }));
        const field = screen.getByLabelText("project.dlc.idTitle") as HTMLInputElement;
        act(() => field.focus());
        fireEvent.change(field, { target: { value: "new-id" } });
        act(() => { fireEvent.keyDown(field, { key: "Escape" }); });

        expect(document.activeElement).not.toBe(field);
        expect(field.value).toBe("bonus");
        expect(confirm).not.toHaveBeenCalled();
        expect(changeId).not.toHaveBeenCalled();
    });
});
