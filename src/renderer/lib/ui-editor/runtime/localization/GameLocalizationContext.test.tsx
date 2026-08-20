// @vitest-environment jsdom
import { render, cleanup } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { GameLocalizationBundle } from "@shared/types/localization";
import {
    GameLocalizationContext,
    useLocalizedAssetId,
    useLocalizedWidgetText,
    type GameLocalizationRuntime,
    type LocalizedWidgetTextInput,
} from "./GameLocalizationContext";
import type { AssetVariantCarrier } from "@shared/types/assetSet";

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

/**
 * The picture half of the same mechanism. The cases that matter are the two hosts: an editor canvas
 * with no provider hands the id back untouched (the workspace hook resolves the set there), and a
 * running game answers from the record's own map and follows a language change without remounting.
 */
describe("useLocalizedAssetId", () => {
    const SET = "set-1";
    const EN_ASSET = "asset-en";
    const ZH_ASSET = "asset-zh";
    const carrier = { assetVariants: { [SET]: { en: EN_ASSET, "zh-CN": ZH_ASSET } } };

    function AssetProbe(props: { carrier: AssetVariantCarrier | null; assetId: string | null }) {
        return <span data-testid="asset">{useLocalizedAssetId(props.carrier, props.assetId) ?? "(none)"}</span>;
    }

    function renderAsset(runtime: GameLocalizationRuntime | null, input: { carrier: AssetVariantCarrier | null; assetId: string | null }) {
        return render(
            <GameLocalizationContext.Provider value={runtime}>
                <AssetProbe carrier={input.carrier} assetId={input.assetId} />
            </GameLocalizationContext.Provider>,
        );
    }

    it("hands the id back untouched without a provider (editor canvas)", () => {
        const { getByTestId } = renderAsset(null, { carrier, assetId: SET });
        expect(getByTestId("asset").textContent).toBe(SET);
    });

    it("answers from the record's own map, and follows a language change", () => {
        const runtime = createRuntime("en");
        const { getByTestId } = renderAsset(runtime, { carrier, assetId: SET });
        expect(getByTestId("asset").textContent).toBe(EN_ASSET);
        act(() => runtime.setLocale("zh-CN"));
        expect(getByTestId("asset").textContent).toBe(ZH_ASSET);
    });

    it("hands back an ordinary asset id, which no map mentions", () => {
        const runtime = createRuntime("zh-CN");
        const { getByTestId } = renderAsset(runtime, { carrier, assetId: "asset-plain" });
        expect(getByTestId("asset").textContent).toBe("asset-plain");
    });

    /**
     * Defence, not policy: materialization fills every locale, so a language with no entry means the
     * package and the project it was built from disagree - and one language's picture beats none.
     */
    it("falls back to the source language when a locale has no entry", () => {
        const runtime = createRuntime("yue");
        const { getByTestId } = renderAsset(runtime, { carrier, assetId: SET });
        expect(getByTestId("asset").textContent).toBe(EN_ASSET);
    });

    it("keeps a null id null", () => {
        const runtime = createRuntime("en");
        const { getByTestId } = renderAsset(runtime, { carrier, assetId: null });
        expect(getByTestId("asset").textContent).toBe("(none)");
    });
});
