// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SMART_SNAP_DETAIL_SETTINGS } from "@/lib/ui-editor/snapping/types";
import type { UIEditorGridStyle } from "@/lib/ui-editor/snapping/gridSnap";
import type { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import { SurfaceSnapSettingsTrigger } from "./SurfaceSnapSettingsMenu";

vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({
        t: (key: string) => key,
        has: () => false,
        tn: (key: string, count: number) => `${key}(${count})`,
        locale: "en",
    }),
}));

afterEach(cleanup);

function stateService() {
    return {
        getSmartSnapDetailSettings: () => DEFAULT_SMART_SNAP_DETAIL_SETTINGS,
        patchSmartSnapDetailSettings: vi.fn(),
        setGridSpacing: vi.fn(),
        setGridStyle: vi.fn(),
    };
}

function open(gridStyle: UIEditorGridStyle) {
    const service = stateService();
    render(
        <SurfaceSnapSettingsTrigger
            stateService={service as unknown as UIEditorStateService}
            detail={DEFAULT_SMART_SNAP_DETAIL_SETTINGS}
            gridSpacing={20}
            gridStyle={gridStyle}
        />,
    );
    fireEvent.click(document.querySelector("[aria-haspopup=\"dialog\"]")!);
    return service;
}

describe("snap settings grid style", () => {
    it("marks the style in use and switches to the other one", () => {
        const service = open("lines");

        expect(screen.getByText("uiEditor.snap.gridLines").closest("button")?.getAttribute("aria-pressed")).toBe("true");
        expect(screen.getByText("uiEditor.snap.gridDots").closest("button")?.getAttribute("aria-pressed")).toBe("false");

        fireEvent.click(screen.getByText("uiEditor.snap.gridDots"));
        expect(service.setGridStyle).toHaveBeenCalledWith("dots");
    });

    it("sits directly above the grid size", () => {
        open("dots");
        const labels = Array.from(document.querySelectorAll("[data-surface-toolbar-popover] div"))
            .map(node => node.textContent)
            .filter(text => text === "uiEditor.snap.gridStyle" || text === "uiEditor.snap.gridSize");
        expect(labels).toEqual(["uiEditor.snap.gridStyle", "uiEditor.snap.gridSize"]);
    });

    it("still opens with the spacing field focused, not the chosen style", () => {
        open("dots");
        expect(document.activeElement?.getAttribute("aria-label")).toBe("uiEditor.snap.gridSize");
    });
});
