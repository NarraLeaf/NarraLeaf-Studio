// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { HostVisibility } from "../layout/hostVisibility";
import { HintPopover } from "./HintPopover";

afterEach(cleanup);

describe("HintPopover in a kept-alive panel", () => {
    it.each(["hover", "focus"] as const)("dismisses a %s hint when the panel is hidden", (trigger) => {
        const panel = (visible: boolean) => (
            <HostVisibility visible={visible}>
                <HintPopover text="Field explanation" />
            </HostVisibility>
        );
        const view = render(panel(true));
        const button = screen.getByRole("button", { name: "Field explanation" });
        if (trigger === "hover") fireEvent.mouseEnter(button);
        else fireEvent.focus(button);
        expect(screen.getByRole("tooltip").textContent).toBe("Field explanation");

        view.rerender(panel(false));
        expect(screen.queryByRole("tooltip")).toBeNull();

        view.rerender(panel(true));
        expect(screen.queryByRole("tooltip")).toBeNull();
        fireEvent.mouseEnter(button);
        expect(screen.getByRole("tooltip").textContent).toBe("Field explanation");
    });
});
