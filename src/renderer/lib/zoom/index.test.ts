// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { initZoom } from "./index";

let resolveRead: (value: { success: true; data: { value: number } }) => void;
let listener: ((change: { key: string; value: unknown }) => void) | undefined;

vi.mock("@/lib/app/bridge", () => ({ getInterface: () => ({ app: { state: {
    getGlobalState: () => new Promise(resolve => { resolveRead = resolve; }),
    onGlobalStateChanged: (receive: typeof listener) => { listener = receive; return { cancel() {} }; },
} } }) }));

describe("zoom preference startup", () => {
    it("keeps a change broadcast while the initial value is being read", async () => {
        const started = initZoom();
        listener?.({ key: "ui.zoomPercent", value: 150 });
        resolveRead({ success: true, data: { value: 100 } });
        await started;
        expect(document.documentElement.style.getPropertyValue("--nl-zoom")).toBe("1.5");
    });
});
