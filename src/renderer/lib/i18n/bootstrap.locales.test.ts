// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "./bootstrap";
import { i18nStore } from "./store";

const reads: Array<(value: unknown) => void> = [];
let localesChanged: (() => void) | undefined;

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
    it("keeps the latest contribution list when it changes during startup", async () => {
        const started = initI18n();
        localesChanged?.();
        reads[1]?.({ success: true, data: { contributions: [
            { pluginId: "sample.korean", code: "ko", meta: { nativeName: "한국어" }, messages: {} },
        ] } });
        reads[0]({ success: true, data: { contributions: [] } });
        await started;
        expect(i18nStore.getLocale()).toBe("ko");
    });
});
