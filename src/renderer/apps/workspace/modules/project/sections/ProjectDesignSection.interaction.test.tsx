// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Services } from "@/lib/workspace/services/services";
import { ProjectDesignSection } from "./ProjectDesignSection";
import type { ProjectSectionProps } from "./types";

const mocks = vi.hoisted(() => ({ context: null as unknown }));
vi.mock("@/apps/workspace/context", () => ({ useWorkspace: () => ({ context: mocks.context, isInitialized: true }) }));
vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({ t: (key: string) => key, tn: (key: string) => key, has: () => false }),
}));
vi.mock("@/apps/workspace/components/ui/freezeGuard", async importOriginal => {
    const actual = await importOriginal<typeof import("@/apps/workspace/components/ui/freezeGuard")>();
    return { ...actual, useFreezeGuard: () => actual.makeFreezeGuard(false, "frozen") };
});
vi.mock("@/apps/workspace/modules/assets/components/AssetSelector", () => ({ AssetSelector: () => null }));
vi.mock("../configLiveSession", () => ({
    BRAND_COLOR_CLAIMS: {}, brandDocumentFreezeScope: () => "brand", useConfigClaim: () => null,
    useConfigClaimHold: () => undefined, ConfigClaimMark: () => null,
}));

afterEach(cleanup);

describe("ProjectDesignSection", () => {
    it("abandons a colour rename on Escape", async () => {
        const renameColor = vi.fn();
        const color = { id: "custom", name: "Accent", value: "#40A8C4" };
        const services = {
            [Services.Brand]: {
                listColors: () => [color], onColorsChanged: () => () => undefined,
                listFonts: () => [], onFontsChanged: () => () => undefined,
                getPalette: () => null, renameColor,
            },
        } as Record<string, unknown>;
        mocks.context = { services: { get: (id: string) => services[id] } };
        render(<ProjectDesignSection {...({ uiService: null } as unknown as ProjectSectionProps)} />);

        const field = await screen.findByDisplayValue("Accent") as HTMLInputElement;
        act(() => field.focus());
        fireEvent.change(field, { target: { value: "Edited" } });
        act(() => { fireEvent.keyDown(field, { key: "Escape" }); });

        expect(field.value).toBe("Accent");
        expect(document.activeElement).not.toBe(field);
        expect(renameColor).not.toHaveBeenCalled();
    });
});
