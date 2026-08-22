// @vitest-environment jsdom
/**
 * The named-key row's draft form, on a workspace that froze after it was opened.
 *
 * Guarding the collapsed "+" only decides whether the form appears. Once it is on screen it has two
 * Enter keys and a tick of its own, none of which consult a button that is no longer rendered - so a
 * freeze arriving mid-draft (a session opening on the project is enough) left a form that accepted a
 * key name, a source string and a keystroke, and answered with nothing.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddKeyRow } from "./TranslationRows";

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

afterEach(() => {
    cleanup();
    frozen = false;
});

/** Open the draft form the way the author does, then fill it in. */
function openAndFill(): void {
    fireEvent.click(screen.getByRole("button", { name: "workspace.localization.table.addKey" }));
    fireEvent.change(screen.getByLabelText("workspace.localization.table.keyNamePlaceholder"), {
        target: { value: "menu.start" },
    });
    fireEvent.change(screen.getByLabelText("workspace.localization.table.keySourcePlaceholder"), {
        target: { value: "Start" },
    });
}

describe("AddKeyRow while the workspace is frozen", () => {
    it("declares the key when nothing is frozen", () => {
        const onSubmit = vi.fn(() => true);
        render(<AddKeyRow onSubmit={onSubmit} />);
        openAndFill();

        fireEvent.click(screen.getByRole("button", { name: "workspace.localization.table.addKey" }));
        expect(onSubmit).toHaveBeenCalledWith("menu.start", "Start");
    });

    it("keeps the collapsed row from opening a form it cannot honour", () => {
        frozen = true;
        render(<AddKeyRow onSubmit={() => true} />);

        const opener = screen.getByRole("button", { name: "workspace.localization.table.addKey" });
        // `:disabled` rather than `.disabled`: a control switched off by an ancestor `fieldset`
        // reports `.disabled === false`, so the property is the wrong question everywhere.
        expect(opener.matches(":disabled")).toBe(true);
        expect(opener.getAttribute("data-tip")).toBe(FREEZE_REASON);
    });

    it("refuses a draft that was already open when the freeze arrived", () => {
        const onSubmit = vi.fn(() => true);
        const view = render(<AddKeyRow onSubmit={onSubmit} />);
        openAndFill();

        // The freeze arms with the form on screen, exactly as a session starting mid-edit would.
        frozen = true;
        view.rerender(<AddKeyRow onSubmit={onSubmit} />);

        const confirm = screen.getByRole("button", { name: "workspace.localization.table.addKey" });
        expect(confirm.matches(":disabled")).toBe(true);
        expect(confirm.getAttribute("data-tip")).toBe(FREEZE_REASON);

        fireEvent.click(confirm);
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it("refuses the Enter key too, which no greyed button can speak for", () => {
        const onSubmit = vi.fn(() => true);
        const view = render(<AddKeyRow onSubmit={onSubmit} />);
        openAndFill();

        frozen = true;
        view.rerender(<AddKeyRow onSubmit={onSubmit} />);

        fireEvent.keyDown(screen.getByLabelText("workspace.localization.table.keyNamePlaceholder"), {
            key: "Enter",
        });
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it("leaves the draft readable, so the author's typing is not thrown away by the refusal", () => {
        const view = render(<AddKeyRow onSubmit={() => true} />);
        openAndFill();

        frozen = true;
        view.rerender(<AddKeyRow onSubmit={() => true} />);

        const name = screen.getByLabelText("workspace.localization.table.keyNamePlaceholder");
        expect((name as HTMLInputElement).value).toBe("menu.start");
    });
});
