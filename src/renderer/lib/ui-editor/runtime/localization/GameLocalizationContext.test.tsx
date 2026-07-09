// @vitest-environment jsdom
import { render, cleanup } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { GameLocalizationBundle } from "@shared/types/localization";
import {
    GameLocalizationContext,
    useLocalizedWidgetText,
    type GameLocalizationRuntime,
    type LocalizedWidgetTextInput,
} from "./GameLocalizationContext";

const bundle: GameLocalizationBundle = {
    sourceLocale: "en",
    locales: [
        { code: "en", displayName: "English" },
        { code: "zh-CN", displayName: "简体中文" },
        { code: "yue", displayName: "粵語", fallback: "zh-CN" },
    ],
    tables: {
        "zh-CN": {
            "ui:el-1.text": "开始",
            "key:menu.quit": "退出",
        },
    },
    keys: { "menu.quit": "Quit" },
};

/** Minimal reactive locale store mimicking the persistence snapshot. */
function createRuntime(initialLocale: string): GameLocalizationRuntime & { setLocale: (code: string) => void } {
    let locale = initialLocale;
    const listeners = new Set<() => void>();
    return {
        bundle,
        getLocale: () => locale,
        subscribe: listener => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        setLocale: code => {
            locale = code;
            listeners.forEach(listener => listener());
        },
    };
}

function Probe(props: { input: LocalizedWidgetTextInput }) {
    return <span data-testid="text">{useLocalizedWidgetText(props.input)}</span>;
}

function renderProbe(runtime: GameLocalizationRuntime | null, input: LocalizedWidgetTextInput) {
    return render(
        <GameLocalizationContext.Provider value={runtime}>
            <Probe input={input} />
        </GameLocalizationContext.Provider>,
    );
}

afterEach(cleanup);

describe("useLocalizedWidgetText", () => {
    const localizableInput: LocalizedWidgetTextInput = {
        elementId: "el-1",
        prop: "text",
        sourceText: "Start",
        localizable: true,
    };

    it("returns the source text without a provider (editor canvas)", () => {
        const { getByTestId } = renderProbe(null, localizableInput);
        expect(getByTestId("text").textContent).toBe("Start");
    });

    it("resolves the implicit unit and re-renders on locale switches", () => {
        const runtime = createRuntime("zh-CN");
        const { getByTestId } = renderProbe(runtime, localizableInput);
        expect(getByTestId("text").textContent).toBe("开始");
        act(() => runtime.setLocale("en"));
        expect(getByTestId("text").textContent).toBe("Start");
        act(() => runtime.setLocale("zh-CN"));
        expect(getByTestId("text").textContent).toBe("开始");
    });

    it("walks the fallback chain for locales without their own table", () => {
        const runtime = createRuntime("yue");
        const { getByTestId } = renderProbe(runtime, localizableInput);
        expect(getByTestId("text").textContent).toBe("开始");
    });

    it("keeps the source text for widgets that never opted in", () => {
        const runtime = createRuntime("zh-CN");
        const { getByTestId } = renderProbe(runtime, { ...localizableInput, localizable: false });
        expect(getByTestId("text").textContent).toBe("Start");
    });

    it("prefers a named key over the implicit unit, falling back to its source text", () => {
        const runtime = createRuntime("zh-CN");
        const { getByTestId } = renderProbe(runtime, {
            elementId: "el-2",
            prop: "label",
            sourceText: "authored label",
            localizationKey: "menu.quit",
        });
        expect(getByTestId("text").textContent).toBe("退出");
        act(() => runtime.setLocale("en"));
        expect(getByTestId("text").textContent).toBe("Quit");
    });
});
