// @vitest-environment jsdom
/**
 * The tagging dialog is raised into the window's overlay layer, so it has no ancestor inside the
 * assets panel at all: nothing the panel switches off can reach it, and the greyed menu row that
 * opened it stopped being on screen the moment it did. Meanwhile the pass itself is a conversation -
 * a category per filename segment - which is long enough for a session to open on the project.
 *
 * So the dialog asks about the freeze itself, and Apply is what goes off. Reading the segments, the
 * detected delimiters and the preview is inspection and stays.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MagicTagTemplate } from "@/lib/workspace/services/core/MagicTagManager";
import { MagicTagDialog } from "./MagicTagDialog";

/** Flipped per case; read by the mocked hook below. */
let frozen = false;
const FREEZE_REASON = "frozen-reason";

// Keys, not prose: what is asserted is which control is off, and English wording is free to change
// without this file having an opinion.
vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({ t: (key: string) => key, locale: "en" }),
}));

// The real hook reads the workspace freeze service through a provider this test has no business
// standing up, so the decision is supplied directly - the same decision the service would produce.
vi.mock("@/apps/workspace/components/ui/freezeGuard", async () => {
    const actual = await vi.importActual<typeof import("@/apps/workspace/components/ui/freezeGuard")>(
        "@/apps/workspace/components/ui/freezeGuard",
    );
    return { ...actual, useFreezeGuard: () => actual.makeFreezeGuard(frozen, FREEZE_REASON) };
});

const TEMPLATE: MagicTagTemplate = {
    example: "hero_happy",
    exampleSegments: ["hero", "happy"],
    mode: "auto",
    delimiters: [{ char: "_", count: 2, frequency: 1 }],
    fileSegments: [["hero", "happy"]],
    filenames: ["hero_happy"],
};

afterEach(() => {
    cleanup();
    frozen = false;
});

/** Render the dialog and name one segment, which is what enables Apply. */
function openAndMap(onApply: () => Promise<void>): ReturnType<typeof render> {
    const view = render(
        <MagicTagDialog
            visible
            assets={[]}
            template={TEMPLATE}
            onClose={() => undefined}
            onApply={onApply}
        />,
    );
    const [first] = screen.getAllByPlaceholderText("assets.magicTag.categoryPlaceholder");
    fireEvent.change(first, { target: { value: "character" } });
    return view;
}

function applyButton(): HTMLElement {
    return screen.getByRole("button", { name: /assets\.magicTag\.applyTags/ });
}

describe("MagicTagDialog while the workspace is frozen", () => {
    it("applies the tags when nothing is frozen", () => {
        const onApply = vi.fn(async () => undefined);
        openAndMap(onApply);

        expect(applyButton().matches(":disabled")).toBe(false);
        fireEvent.click(applyButton());
        expect(onApply).toHaveBeenCalledTimes(1);
    });

    it("refuses a dialog the freeze reached after it opened", () => {
        const onApply = vi.fn(async () => undefined);
        const view = openAndMap(onApply);

        // The freeze arms with the dialog on screen, exactly as a session starting mid-pass would.
        frozen = true;
        view.rerender(
            <MagicTagDialog
                visible
                assets={[]}
                template={TEMPLATE}
                onClose={() => undefined}
                onApply={onApply}
            />,
        );

        const apply = applyButton();
        // `:disabled` rather than `.disabled`: a control switched off by an ancestor `fieldset`
        // reports `.disabled === false`, so the property is the wrong question everywhere.
        expect(apply.matches(":disabled")).toBe(true);
        expect(apply.getAttribute("data-tip")).toBe(FREEZE_REASON);

        fireEvent.click(apply);
        expect(onApply).not.toHaveBeenCalled();
    });

    it("leaves the way out open, so a frozen dialog is not a trapped one", () => {
        frozen = true;
        openAndMap(async () => undefined);

        expect(screen.getByRole("button", { name: "common.cancel" }).matches(":disabled")).toBe(false);
    });
});
