// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectSectionProps } from "./types";
import { ProjectLetterboxSection } from "./ProjectLetterboxSection";

let frozen = false;
vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/apps/workspace/components/ui/freezeGuard", async importOriginal => {
    const actual = await importOriginal<typeof import("@/apps/workspace/components/ui/freezeGuard")>();
    return { ...actual, useFreezeGuard: () => actual.makeFreezeGuard(frozen, "frozen") };
});
vi.mock("@/lib/workspace/hooks/useAssetObjectUrl", () => ({ useAssetObjectUrl: () => ({ url: null }) }));
vi.mock("@/apps/workspace/modules/assets/components/AssetSelector", () => ({
    AssetSelector: ({ visible, onConfirm }: { visible: boolean; onConfirm: (assets: { id: string }[]) => void }) => (
        visible ? <button onClick={() => onConfirm([{ id: "picture" }])}>Choose picture</button> : null
    ),
}));
vi.mock("@/apps/workspace/modules/properties/framework/fields/ColorPickerField", () => ({
    ColorPickerTrigger: ({ onCommit }: { onCommit: (value: { hex: string }) => void }) => (
        <button onClick={() => onCommit({ hex: "#FFFFFF" })}>Choose colour</button>
    ),
}));

afterEach(() => { cleanup(); frozen = false; });

describe("ProjectLetterboxSection", () => {
    it.each(["picture", "colour"])("refuses an open %s picker after the workspace freezes", choice => {
        const update = vi.fn().mockResolvedValue({ app: {} });
        const props = {
            projectService: { updateLetterboxConfiguration: update },
            uiService: null,
            config: { app: {} },
            onConfigChange: vi.fn(),
        } as unknown as ProjectSectionProps;
        const view = render(<ProjectLetterboxSection {...props} />);
        if (choice === "picture") {
            fireEvent.click(screen.getByRole("button", { name: "project.settings.letterboxImageTitle" }));
        }
        frozen = true;
        view.rerender(<ProjectLetterboxSection {...props} />);
        fireEvent.click(screen.getByRole("button", { name: choice === "picture" ? "Choose picture" : "Choose colour" }));
        expect(update).not.toHaveBeenCalled();
    });

    it.each(["picture", "colour"])("writes the selected %s while the project is editable", choice => {
        const update = vi.fn().mockResolvedValue({ app: {} });
        render(<ProjectLetterboxSection {...({
            projectService: { updateLetterboxConfiguration: update },
            uiService: null, config: { app: {} }, onConfigChange: vi.fn(),
        } as unknown as ProjectSectionProps)} />);
        if (choice === "picture") {
            fireEvent.click(screen.getByRole("button", { name: "project.settings.letterboxImageTitle" }));
        }
        fireEvent.click(screen.getByRole("button", { name: choice === "picture" ? "Choose picture" : "Choose colour" }));
        expect(update).toHaveBeenCalledWith(choice === "picture"
            ? { image: { assetId: "picture", fillMode: "cover" } }
            : { color: "#FFFFFF" });
    });
});
