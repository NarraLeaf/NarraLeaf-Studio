// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectRuntimesSection } from "./ProjectRuntimesSection";
import type { ProjectSectionProps } from "./types";

const mocks = vi.hoisted(() => ({ remove: vi.fn(), context: { project: {} } }));
vi.mock("@/apps/workspace/context", () => ({ useWorkspace: () => ({ context: mocks.context }) }));
vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/apps/workspace/components/ui/freezeGuard", async importOriginal => {
    const actual = await importOriginal<typeof import("@/apps/workspace/components/ui/freezeGuard")>();
    return { ...actual, useFreezeGuard: () => actual.makeFreezeGuard(false, "frozen") };
});
vi.mock("@/lib/workspace/services/puppet/projectPuppetRuntimes", () => ({
    listProjectPuppetRuntimes: () => Promise.resolve([]),
    readPuppetRuntimeInstallState: () => Promise.resolve({ status: "installed" }),
}));
vi.mock("@/lib/workspace/services/puppet/installPuppetRuntime", () => ({ removePuppetRuntime: mocks.remove }));
vi.mock("@/apps/workspace/modules/characters/editors/components/PuppetRuntimeInstaller", () => ({ PuppetRuntimeInstaller: () => null }));

afterEach(() => { cleanup(); mocks.remove.mockReset(); });

describe("ProjectRuntimesSection", () => {
    it("reports when removing an installed runtime fails", async () => {
        mocks.remove.mockRejectedValue(new Error("access denied"));
        const notify = vi.fn();
        const confirm = vi.fn().mockResolvedValue(true);
        render(<ProjectRuntimesSection {...({
            uiService: { showDestructiveConfirm: confirm, showNotification: notify },
        } as unknown as ProjectSectionProps)} />);

        await screen.findAllByText("characters.editor.puppet.runtimeInstalled");
        fireEvent.click(screen.getAllByRole("button", { name: "characters.editor.runtime.remove" })[0]);

        await waitFor(() => expect(notify).toHaveBeenCalledWith("assets.delete.failedTitle", "error"));
    });
});
