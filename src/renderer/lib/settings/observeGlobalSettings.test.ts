import { describe, expect, it, vi } from "vitest";
import { observeGlobalSettings } from "./observeGlobalSettings";

const failure = new Error("read failed");
vi.mock("@/lib/app/bridge", () => ({ getInterface: () => ({ app: { state: {
    getGlobalState: async (key: string) => {
        if (key === "ui.zoomPercent") throw failure;
        return { success: true, data: { value: true } };
    },
    onGlobalStateChanged: () => ({ cancel() {} }),
} } }) }));

describe("global preference observation", () => {
    it("reports a failed read while retaining the other initial values", async () => {
        const receive = vi.fn();
        const onError = vi.fn();
        const observed = observeGlobalSettings(["ui.zoomPercent", "ui.reduceMotion"], receive, onError);
        await observed.ready;
        expect(onError).toHaveBeenCalledWith("ui.zoomPercent", failure);
        expect(receive).toHaveBeenCalledWith("ui.reduceMotion", true);
        observed.dispose();
    });
});
