// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectConfig } from "@/lib/workspace/project/project";
import type { ProjectService } from "@/lib/workspace/services/core/ProjectService";
import { ProjectIconsSection } from "./ProjectIconsSection";

vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({ t: translate }),
}));

vi.mock("@/apps/workspace/components/ui/freezeGuard", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useFreezeGuard: () => ({ frozen: true, writes: () => ({ disabled: true }) }),
    isDeferredWriteAllowed: () => false,
}));

const translate = (key: string) => key;

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe("ProjectIconsSection", () => {
    it("releases a preview that finishes loading after the section unmounts", async () => {
        let releaseRead!: (bytes: Uint8Array) => void;
        const read = vi.fn(() => new Promise<Uint8Array>(resolve => { releaseRead = resolve; }));
        const create = vi.fn(() => "blob:late-preview");
        const revoke = vi.fn();
        vi.stubGlobal("URL", class extends URL {
            static createObjectURL = create;
            static revokeObjectURL = revoke;
        });
        const service = {
            getProjectIconSet: () => ({
                master: { path: "master.png", mediaType: "image/png" },
                baked: {},
                specs: {},
            }),
            getProjectConfig: () => ({}),
            readProjectIconFile: read,
        } as unknown as ProjectService;
        const view = render(
            <ProjectIconsSection
                projectService={service}
                uiService={null}
                config={{} as ProjectConfig}
                onConfigChange={() => undefined}
            />,
        );

        await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
        view.unmount();
        await act(async () => { releaseRead(new Uint8Array([1])); });

        expect(create).toHaveBeenCalledTimes(1);
        expect(revoke).toHaveBeenCalledWith("blob:late-preview");
    });

    it("releases previews already loaded when a later file read fails", async () => {
        const create = vi.fn(() => "blob:master-preview");
        const revoke = vi.fn();
        vi.stubGlobal("URL", class extends URL {
            static createObjectURL = create;
            static revokeObjectURL = revoke;
        });
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const notify = vi.fn();
        const service = {
            getProjectIconSet: () => ({
                master: { path: "master.png", mediaType: "image/png" },
                baked: { windows: { path: "windows.png" } },
                specs: {},
            }),
            getProjectConfig: () => ({}),
            readProjectIconFile: vi.fn()
                .mockResolvedValueOnce(new Uint8Array([1]))
                .mockRejectedValueOnce(new Error("read failed")),
        } as unknown as ProjectService;
        render(
            <ProjectIconsSection
                projectService={service}
                uiService={{ showNotification: notify } as never}
                config={{} as ProjectConfig}
                onConfigChange={() => undefined}
            />,
        );

        await waitFor(() => expect(notify).toHaveBeenCalled());
        expect(revoke).toHaveBeenCalledWith("blob:master-preview");
    });
});
