// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "./bootstrap";
import { i18nStore } from "./store";

const reads: Array<(value: unknown) => void> = [];
let localesChanged: () => void;

vi.mock("@/lib/app/bridge", () => ({ getInterface: () => ({
    app: { state: {
        getGlobalState: async (key: string) => ({ success: true, data: { value: key === "app.language" ? "ko" : undefined } }),
        onGlobalStateChanged: () => ({ cancel() {} }),
    } },
    plugins: {
        getLocaleContributions: () => new Promise(resolve => { reads.push(resolve); }),
        onLocalesChanged: (receive: () => void) => { localesChanged = receive; return { cancel() {} }; },
    },
}) }));

describe("locale contribution startup", () => {
    it("waits for a newer contribution list before completing startup", async () => {
        let complete = false;
        const started = initI18n().then(() => { complete = true; });
        localesChanged();
        reads[0]({ success: true, data: { contributions: [] } });
        for (let step = 0; step < 5; step += 1) await Promise.resolve();
        expect(complete).toBe(false);

        reads[1]({ success: true, data: { contributions: [
            { pluginId: "sample.korean", code: "ko", meta: { nativeName: "한국어" }, messages: {} },
        ] } });
        await started;
        expect(i18nStore.getLocale()).toBe("ko");
    });
});
