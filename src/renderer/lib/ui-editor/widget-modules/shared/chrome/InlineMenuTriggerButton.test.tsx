// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InlineMenuTriggerButton } from "./InlineMenuTriggerButton";

/**
 * The trigger is only a toggle: the menu dismisses itself. What the trigger has to get right is that
 * pressing it while the menu is open closes the menu - the menu's own outside-press handling closes
 * it first, and the trigger's click must not then open it straight back up.
 */

vi.mock("@/lib/i18n", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({
        t: (key: string) => key,
        has: () => false,
        tn: (key: string) => key,
        locale: "en",
    }),
}));

afterEach(cleanup);

const MENU = [{ id: "one", label: "One", onClick: () => undefined }];

/** A real press: pointerdown, mousedown, click - each a separate event, as the browser sends them. */
function press(element: HTMLElement) {
    fireEvent.pointerDown(element);
    fireEvent.mouseDown(element);
    fireEvent.click(element);
}

/** The menu arms its outside-press listener one tick after it opens. */
async function settle() {
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
    });
}

function menuOpen(): boolean {
    return document.querySelector('[data-context-menu="true"]') !== null;
}

describe.each([false, true])("InlineMenuTriggerButton (inspectOnly: %s)", (inspectOnly) => {
    it("closes on a second press of the trigger instead of reopening", async () => {
        render(<InlineMenuTriggerButton menu={MENU} ariaLabel="More" inspectOnly={inspectOnly} />);
        const trigger = screen.getByRole("button", { name: "More" });

        press(trigger);
        await settle();
        expect(menuOpen()).toBe(true);

        press(trigger);
        await settle();
        expect(menuOpen()).toBe(false);

        press(trigger);
        await settle();
        expect(menuOpen()).toBe(true);
    });

    it("closes on Escape and keeps focus on the trigger", async () => {
        render(<InlineMenuTriggerButton menu={MENU} ariaLabel="More" inspectOnly={inspectOnly} />);
        const trigger = screen.getByRole("button", { name: "More" });
        trigger.focus();

        press(trigger);
        await settle();
        fireEvent.keyDown(trigger, { key: "Escape" });

        expect(menuOpen()).toBe(false);
        expect(document.activeElement).toBe(trigger);
    });
});
