// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectSectionProps } from "./types";
import { ProjectDistributionSection } from "./ProjectDistributionSection";

let frozen = false;
const rotate = vi.hoisted(() => vi.fn());
vi.mock("../distributionKeyAction", () => ({ rotateDistributionKey: rotate }));
vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/apps/workspace/components/ui/freezeGuard", async importOriginal => {
    const actual = await importOriginal<typeof import("@/apps/workspace/components/ui/freezeGuard")>();
    return { ...actual, useFreezeGuard: () => actual.makeFreezeGuard(frozen, "frozen") };
});

afterEach(() => { cleanup(); frozen = false; rotate.mockReset(); });

describe("ProjectDistributionSection", () => {
    it("disables distribution key changes while the project is frozen", () => {
        frozen = true;
        render(<ProjectDistributionSection {...({
            projectService: {}, uiService: null, config: { app: {} }, onConfigChange: vi.fn(),
        } as unknown as ProjectSectionProps)} />);
        const button = screen.getByRole("button", { name: "project.distribution.createAction" });
        expect(button.matches(":disabled")).toBe(true);
        fireEvent.click(button);
        expect(rotate).not.toHaveBeenCalled();
    });

    it("updates the displayed configuration after creating a key", async () => {
        const updated = { app: {} };
        rotate.mockResolvedValue(updated);
        const onConfigChange = vi.fn();
        render(<ProjectDistributionSection {...({
            projectService: {}, uiService: null, config: { app: {} }, onConfigChange,
        } as unknown as ProjectSectionProps)} />);
        fireEvent.click(screen.getByRole("button", { name: "project.distribution.createAction" }));
        await waitFor(() => expect(onConfigChange).toHaveBeenCalledWith(updated));
    });
});
