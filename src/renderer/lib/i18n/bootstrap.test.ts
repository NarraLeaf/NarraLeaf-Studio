// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "./bootstrap";
import { i18nStore } from "./store";

let listener: ((change: { key: string; value: unknown }) => void) | undefined;
let resolveLocales: (value: unknown) => void;

vi.mock("@/lib/app/bridge", () => ({ getInterface: () => ({
    app: { state: {
        getGlobalState: async (key: string) => ({ success: true, data: { value: key === "app.language" ? "en" : undefined } }),
        onGlobalStateChanged: (receive: typeof listener) => { listener = receive; return { cancel() {} }; },
    } },
    plugins: {
        getLocaleContributions: () => new Promise(resolve => { resolveLocales = resolve; }),
        onLocalesChanged: () => ({ cancel() {} }),
    },
}) }));

describe("language preference startup", () => {
    it("keeps a plugin language broadcast while contributions are loading", async () => {
        const started = initI18n();
        listener?.({ key: "app.language", value: "ko" });
        resolveLocales({ success: true, data: { contributions: [
            { pluginId: "sample.korean", code: "ko", meta: { nativeName: "한국어" }, messages: {} },
        ] } });
        await started;
        expect(i18nStore.getLocale()).toBe("ko");
    });
});
