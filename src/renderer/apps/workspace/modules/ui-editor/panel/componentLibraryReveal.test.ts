import { afterEach, describe, expect, it, vi } from "vitest";
import { onComponentLibraryReveal, requestComponentLibraryReveal } from "./componentLibraryReveal";
import { onInputActionPanelFocus, requestInputActionPanelFocus } from "../input/inputActionPanelFocus";

afterEach(() => {
    vi.useRealTimers();
});

describe("requestComponentLibraryReveal", () => {
    it("reaches a library that is listening, once", () => {
        const heard = vi.fn();
        const off = onComponentLibraryReveal(heard);
        requestComponentLibraryReveal("saveSlot");
        expect(heard).toHaveBeenCalledTimes(1);
        expect(heard).toHaveBeenCalledWith("saveSlot");
        off();
        // Delivered, so a library that mounts afterwards is not handed it a second time.
        const late = vi.fn();
        const offLate = onComponentLibraryReveal(late);
        expect(late).not.toHaveBeenCalled();
        offLate();
    });

    it("waits for a library the rail is still mounting", () => {
        requestComponentLibraryReveal("titleButton");
        const heard = vi.fn();
        const off = onComponentLibraryReveal(heard);
        expect(heard).toHaveBeenCalledWith("titleButton");
        off();
    });

    it("does not wait long", () => {
        vi.useFakeTimers();
        requestComponentLibraryReveal("titleButton");
        vi.advanceTimersByTime(5000);
        const heard = vi.fn();
        const off = onComponentLibraryReveal(heard);
        expect(heard).not.toHaveBeenCalled();
        off();
    });
});

describe("requestInputActionPanelFocus", () => {
    it("carries the action asked about, or none for the section", () => {
        const heard = vi.fn();
        const off = onInputActionPanelFocus(heard);
        requestInputActionPanelFocus("advance");
        requestInputActionPanelFocus();
        expect(heard.mock.calls).toEqual([["advance"], [undefined]]);
        off();
    });

    it("waits for a panel the rail is still mounting", () => {
        requestInputActionPanelFocus("dismiss");
        const heard = vi.fn();
        const off = onInputActionPanelFocus(heard);
        expect(heard).toHaveBeenCalledWith("dismiss");
        off();
    });
});
