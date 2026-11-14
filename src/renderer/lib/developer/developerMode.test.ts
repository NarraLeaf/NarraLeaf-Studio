import { describe, expect, it, vi } from "vitest";
import { initDeveloperMode, isDeveloperModeEnabled } from "./developerMode";

let resolveRead: (value: { success: true; data: { value: boolean } }) => void;
let listener: ((change: { key: string; value: unknown }) => void) | undefined;

vi.mock("@/lib/app/bridge", () => ({ getInterface: () => ({ app: { state: {
    getGlobalState: () => new Promise(resolve => { resolveRead = resolve; }),
    onGlobalStateChanged: (receive: typeof listener) => { listener = receive; return { cancel() {} }; },
} } }) }));

describe("developer preference startup", () => {
    it("keeps a change broadcast while the initial value is being read", async () => {
        const started = initDeveloperMode();
        listener?.({ key: "app.developerMode", value: true });
        resolveRead({ success: true, data: { value: false } });
        await started;
        expect(isDeveloperModeEnabled()).toBe(true);
    });
});
