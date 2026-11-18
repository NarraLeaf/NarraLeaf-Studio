// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { initAppearance, isReduceMotionEnabled } from "./index";

let listener: ((change: { key: string; value: unknown }) => void) | undefined;
const reads = new Map<string, (value: { success: true; data: { value: unknown } }) => void>();

vi.mock("@/lib/app/bridge", () => ({ getInterface: () => ({ app: { state: {
    getGlobalState: (key: string) => new Promise(resolve => { reads.set(key, resolve); }),
    onGlobalStateChanged: (receive: typeof listener) => { listener = receive; return { cancel() {} }; },
} } }) }));

describe("appearance preference startup", () => {
    it("keeps a change broadcast while the initial values are being read", async () => {
        const started = initAppearance();
        listener?.({ key: "ui.reduceMotion", value: true });
        for (const [key, resolve] of reads) {
            resolve({ success: true, data: { value: key === "ui.reduceMotion" ? false : undefined } });
        }
        await started;
        expect(isReduceMotionEnabled()).toBe(true);
        expect(document.documentElement.classList.contains("nl-reduce-motion")).toBe(true);
    });
});
