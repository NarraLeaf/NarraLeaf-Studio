// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Services } from "@/lib/workspace/services/services";
import { ProjectAppTagsSection } from "./ProjectAppTagsSection";
import type { ProjectSectionProps } from "./types";

const mocks = vi.hoisted(() => ({ context: null as unknown }));
vi.mock("@/apps/workspace/context", () => ({ useWorkspace: () => ({ context: mocks.context, isInitialized: true }) }));
vi.mock("@/lib/app/bridge", () => ({ getInterface: () => ({ plugins: { list: () => Promise.resolve({ success: true, data: { plugins: [] } }) } }) }));
vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({ t: (key: string) => key, tn: (key: string, count: number) => `${key}:${count}`, has: () => false }),
}));
vi.mock("@/apps/workspace/components/ui/freezeGuard", async importOriginal => {
    const actual = await importOriginal<typeof import("@/apps/workspace/components/ui/freezeGuard")>();
    return { ...actual, useFreezeGuard: () => actual.makeFreezeGuard(false, "frozen") };
});
vi.mock("../configLiveSession", () => ({
    APP_TAG_CLAIMS: {}, appTagsDocumentFreezeScope: () => "app-tags", useConfigClaim: () => null,
    useConfigClaimHold: () => undefined, ConfigClaimMark: () => null,
}));

afterEach(cleanup);

describe("ProjectAppTagsSection", () => {
    it("abandons a variant rename on Escape", async () => {
        const renameTag = vi.fn();
        const tag = { id: "demo", name: "Demo", overrides: {} };
        const services = {
            [Services.AppTags]: {
                listTags: () => [tag], onTagsChanged: () => () => undefined,
                getProjectEndingSurfaceId: () => "", renameTag,
            },
            [Services.AssetSets]: { listSets: () => [] },
            [Services.UIGraph]: { getDocument: () => ({ blueprintDocument: {} }) },
            [Services.UIDocument]: { getDocument: () => ({ surfaces: [] }), onDocumentChanged: () => () => undefined },
            [Services.Story]: { listStories: () => [], getLibraryIndex: () => ({ stories: [] }) },
        } as Record<string, unknown>;
        mocks.context = { services: { get: (id: string) => services[id] } };
        render(<ProjectAppTagsSection {...({ config: { metadata: {} }, uiService: null } as unknown as ProjectSectionProps)} />);

        fireEvent.click(await screen.findByRole("button", { name: "Demo" }));
        const field = screen.getByLabelText("project.appTags.nameTitle") as HTMLInputElement;
        act(() => field.focus());
        fireEvent.change(field, { target: { value: "Edited" } });
        act(() => { fireEvent.keyDown(field, { key: "Escape" }); });

        expect(field.value).toBe("Demo");
        expect(document.activeElement).not.toBe(field);
        expect(renameTag).not.toHaveBeenCalled();
    });

    it("counts current references before confirming variant deletion", async () => {
        const tag = { id: "demo", name: "Demo", overrides: {} };
        const graph: { appTagId?: string } = {};
        const services = {
            [Services.AppTags]: { listTags: () => [tag], onTagsChanged: () => () => undefined, getProjectEndingSurfaceId: () => "" },
            [Services.AssetSets]: { listSets: () => [] },
            [Services.UIGraph]: { getDocument: () => ({ blueprintDocument: {}, graph }) },
            [Services.UIDocument]: { getDocument: () => ({ surfaces: [] }), onDocumentChanged: () => () => undefined },
            [Services.Story]: { listStories: () => [], getLibraryIndex: () => ({ stories: [] }) },
        } as Record<string, unknown>;
        mocks.context = { services: { get: (id: string) => services[id] } };
        const confirm = vi.fn().mockResolvedValue(false);
        render(<ProjectAppTagsSection {...({ config: { metadata: {} }, uiService: { showDestructiveConfirm: confirm } } as unknown as ProjectSectionProps)} />);

        fireEvent.click(await screen.findByRole("button", { name: "Demo" }));
        await screen.findByText("project.appTags.usedBy:0");
        graph.appTagId = "demo";
        fireEvent.click(screen.getByRole("button", { name: "project.appTags.delete" }));

        await waitFor(() => expect(confirm).toHaveBeenCalledWith(
            "project.appTags.deleteConfirm", "project.appTags.deleteDetail:1", "project.appTags.delete",
        ));
    });
});
