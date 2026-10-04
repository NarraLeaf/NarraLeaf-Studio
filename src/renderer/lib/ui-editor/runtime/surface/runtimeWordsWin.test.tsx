// @vitest-environment jsdom
/**
 * Words a blueprint writes while the game runs are the words on screen, in every language.
 *
 * Before this, a `Set Text` on a text read from a translation key showed nothing: the key's words were
 * resolved after the write and replaced it, in every language. On a widget whose own words were
 * translated, the write showed in the source language and the old translation came back in any other;
 * on a bound widget the binding wrote over it. A write now wins over all three until the page is drawn
 * afresh, and `Get Text` / `Get Label` answer with what the player sees.
 *
 * Drawn through the real tree with the game's localization context, the patch table a game keeps, and
 * the host API a game builds.
 *
 * Comments in English per project convention.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { LOCALE_STORAGE_KEY, type GameLocalizationBundle } from "@shared/types/localization";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement, type UISurface } from "@shared/types/ui-editor/document";
import {
    resolveUITextWords,
    uiTextRuntimeOriginOf,
    uiTextSiteOf,
    withUITextRuntimeWords,
} from "@shared/types/ui-editor/textSource";
import { mergeElementWithBlueprintValues } from "@/lib/ui-editor/blueprint-runtime/BlueprintValueRuntimeStore";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import {
    createDevModeBlueprintHostApi,
    mergeWidgetPatch,
    type DevModeWidgetRuntimePatch,
} from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import { ScopeStoreBridge } from "@/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";
import { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import {
    GameLocalizationContext,
    useLocalizedWidgetText,
    type GameLocalizationRuntime,
} from "@/lib/ui-editor/runtime/localization/GameLocalizationContext";
import { setRuntimeLocaleSource } from "@/lib/ui-editor/runtime/localization/runtimeLocale";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { SurfaceElementTree } from "./SurfaceElementTree";

const PAGE = "page";

const localization: GameLocalizationBundle = {
    sourceLocale: "en",
    locales: [
        { code: "en", displayName: "English" },
        { code: "zh-CN", displayName: "简体中文" },
    ],
    tables: {
        "zh-CN": { "key:menu.start": "开始", "ui:title.text": "你的游戏", "ui:bound.text": "旧的示例译文" },
    },
    keys: { "menu.start": "Start" },
};

const surface = {
    id: PAGE,
    name: PAGE,
    host: "app",
    kind: "appSurface",
    designSize: { width: 640, height: 360 },
    rootElementId: "root",
} as UISurface;

function text(id: string, props: Record<string, unknown>, extra: Partial<UIElement> = {}): UIElement {
    return {
        id,
        type: "nl.text",
        parentId: "root",
        childrenIds: [],
        layout: { x: 0, y: 0, width: 200, height: 20 },
        props,
        ...extra,
    };
}

const document = {
    schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
    id: "doc",
    name: "Doc",
    surfaces: [surface],
    elements: {
        root: { id: "root", type: "nl.root", parentId: null, childrenIds: ["keyed", "title"], layout: { x: 0, y: 0, width: 640, height: 360 } },
        keyed: text("keyed", { localizationKey: "menu.start" }),
        title: text("title", { text: "Your Game" }),
    },
} as unknown as UIDocument;

/** A text widget that draws its words the way the shipped one does. */
function GameText(props: { element: UIElement }) {
    const elementProps = (props.element.props ?? {}) as Record<string, unknown>;
    const words = useLocalizedWidgetText({
        site: uiTextSiteOf("nl.text")!,
        elementId: props.element.id,
        sourceText: String(elementProps.text ?? ""),
        localizationKey: typeof elementProps.localizationKey === "string" ? elementProps.localizationKey : undefined,
        origin: uiTextRuntimeOriginOf(props.element),
    });
    return <span data-text={props.element.id}>{words}</span>;
}

beforeAll(() => {
    registerCoreBlueprintNodes();
});

let release: (() => void) | null = null;

afterEach(() => {
    release?.();
    release = null;
    cleanup();
});

/** One running game in `locale`, with the patch table and host API a game keeps. */
function runningGame(locale: string) {
    const scope = new ScopeStoreBridge();
    scope.persistenceSetSessionOnly(LOCALE_STORAGE_KEY, locale);
    const readLocale = () => String(scope.persistenceGet(LOCALE_STORAGE_KEY) ?? localization.sourceLocale);
    release = setRuntimeLocaleSource({ getLocale: readLocale, sourceLocale: localization.sourceLocale });
    const runtime: GameLocalizationRuntime = {
        bundle: localization,
        getLocale: readLocale,
        subscribe: listener => scope.subscribePersistence(listener),
    };
    let patches: Record<string, DevModeWidgetRuntimePatch> = {};
    const hostApi = createDevModeBlueprintHostApi({
        document,
        scope,
        activeSurfaceId: PAGE,
        runtimeScopeId: PAGE,
        pageProps: {},
        emit: () => undefined,
        onOpenSurface: () => undefined,
        onPageBack: () => undefined,
        onWidgetPatch: (address: string, patch: DevModeWidgetRuntimePatch) => {
            patches = { ...patches, [address]: mergeWidgetPatch(patches[address], patch) };
        },
        readWidgetPatches: () => patches,
        widgetRuntimeStore: new WidgetRuntimeStateStore(),
        localizationConfig: localization,
    } as unknown as Parameters<typeof createDevModeBlueprintHostApi>[0]);
    const registry = new ElementRendererRegistry([
        { type: "nl.root", render: props => <>{props.children}</> },
        { type: "nl.text", render: props => <GameText element={props.element} /> },
    ]);
    const draw = () => {
        cleanup();
        const view = render(
            <GameLocalizationContext.Provider value={runtime}>
                <SurfaceElementTree
                    document={document}
                    surface={surface}
                    rootElement={document.elements.root!}
                    rendererRegistry={registry}
                    hostAdapter={{} as UIHostAdapter}
                    blueprintBindingContext={null}
                    widgetRuntimePatches={patches}
                    editorChrome={false}
                />
            </GameLocalizationContext.Provider>,
        );
        return (id: string) => view.container.querySelector(`[data-text="${id}"]`)?.textContent ?? null;
    };
    return { hostApi, draw, setLocale: (code: string) => scope.persistenceSetSessionOnly(LOCALE_STORAGE_KEY, code) };
}

describe("words written while the game runs", () => {
    it("leave a widget's key and translation showing until something is written", () => {
        const game = runningGame("zh-CN");
        const shown = game.draw();
        expect(shown("keyed")).toBe("开始");
        expect(shown("title")).toBe("你的游戏");
    });

    it("show as written in every language, ahead of a key, a translation and a binding", async () => {
        const game = runningGame("zh-CN");
        await game.hostApi.widget.setTextProperties("keyed", { text: "3 s" });
        await game.hostApi.widget.setTextProperties("title", { text: "Chapter 2" });

        let shown = game.draw();
        expect(shown("keyed")).toBe("3 s");
        expect(shown("title")).toBe("Chapter 2");

        game.setLocale("en");
        shown = game.draw();
        expect(shown("keyed")).toBe("3 s");
        expect(shown("title")).toBe("Chapter 2");
    });

    it("count as written even when they are the words already shown", async () => {
        const game = runningGame("en");
        await game.hostApi.widget.setTextProperties("keyed", { text: "Start" });
        game.setLocale("zh-CN");
        expect(game.draw()("keyed")).toBe("Start");
    });

    it("are not written by Set All Properties when its text pin is left empty", async () => {
        const game = runningGame("zh-CN");
        const current = game.hostApi.widget.getTextProperties("keyed");
        await game.hostApi.widget.setTextProperties("keyed", { fontSize: current.fontSize + 2 });
        expect(game.draw()("keyed")).toBe("开始");
    });
});

describe("Get Text", () => {
    it("answers with what is on screen, in the player's language", async () => {
        const game = runningGame("zh-CN");
        expect(game.hostApi.widget.getTextProperties("keyed").text).toBe("开始");
        expect(game.hostApi.widget.getTextProperties("title").text).toBe("你的游戏");
        game.setLocale("en");
        expect(game.hostApi.widget.getTextProperties("keyed").text).toBe("Start");

        await game.hostApi.widget.setTextProperties("keyed", { text: "3 s" });
        expect(game.hostApi.widget.getTextProperties("keyed").text).toBe("3 s");
    });
});

describe("words a binding gives", () => {
    const row = {
        item: { name: "Narra" },
        index: 0,
        count: 1,
        key: "0",
        struct: { id: "row", fields: [{ id: "name", key: "name", type: "string" as const }] },
    };
    const bound = text("bound", { text: "" }, { valueBindings: { text: { kind: "listItemField", fieldId: "name" } } });

    it("are shown as the binding gives them, without the element's own unit", () => {
        const merged = mergeElementWithBlueprintValues(bound, PAGE, null, row);
        expect(merged.props?.text).toBe("Narra");
        expect(uiTextRuntimeOriginOf(merged)).toBe("bound");
        const site = uiTextSiteOf("nl.text")!;
        expect(resolveUITextWords(
            { site, elementId: "bound", sourceText: "Narra", origin: "bound" },
            { kind: "game", bundle: localization, locale: "zh-CN" },
        )).toBe("Narra");
    });

    it("give way to words written at run time", () => {
        const written = withUITextRuntimeWords(bound, uiTextSiteOf("nl.text")!, "Aoi", "written");
        const merged = mergeElementWithBlueprintValues(written, PAGE, null, row);
        expect(merged.props?.text).toBe("Aoi");
        expect(uiTextRuntimeOriginOf(merged)).toBe("written");
    });
});
