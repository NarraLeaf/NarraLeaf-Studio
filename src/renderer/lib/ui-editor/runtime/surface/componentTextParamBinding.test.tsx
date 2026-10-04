// @vitest-environment jsdom
/**
 * A text inside a component shows the words each placement gives the component's text parameter.
 *
 * Five placements of one nav item draw five labels - on the editing canvas, which runs no graph, as in
 * the game - and the game translates each through the placement's own unit, reads the key a placement
 * names, and translates a default once through the component's unit. Before this, a parameter reached
 * the words only through `Get Component Param` -> `Set Text`, so the canvas drew the definition's words
 * on every placement and nothing was translated.
 *
 * Drawn through the real tree, with a text widget that resolves its words the way the shipped one does.
 *
 * Comments in English per project convention.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { GameLocalizationBundle } from "@shared/types/localization";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement, type UISurface } from "@shared/types/ui-editor/document";
import { uiTextRuntimeOriginOf, uiTextRuntimeUnitOf, uiTextSiteOf } from "@shared/types/ui-editor/textSource";
import { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { WidgetRuntimeStateProvider } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import {
    GameLocalizationContext,
    useLocalizedWidgetText,
    type GameLocalizationRuntime,
} from "@/lib/ui-editor/runtime/localization/GameLocalizationContext";
import { setDesignTimeLocalizationKeys } from "@/lib/ui-editor/runtime/localization/designTimeKeys";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { SurfaceElementTree } from "./SurfaceElementTree";

const surface: UISurface = {
    id: "title",
    name: "Title",
    host: "app",
    kind: "appSurface",
    designSize: { width: 1920, height: 1080 },
    rootElementId: "root",
};

function element(id: string, type: string, parentId: string | null, childrenIds: string[], more?: Partial<UIElement>): UIElement {
    return { id, type, parentId, childrenIds, layout: { x: 0, y: 0, width: 400, height: 80 }, ...more };
}

function placement(id: string, link: Record<string, unknown>): UIElement {
    return element(id, "nl.container", "root", [], {
        extra: { componentLink: { componentId: "nav", linked: true, ...link } },
    });
}

/** One nav item placed five times - four written, one keyed - and once more relying on the default. */
const document: UIDocument = {
    schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
    id: "doc",
    name: "Doc",
    surfaces: [surface],
    elements: {
        root: element("root", "nl.root", null, ["p1", "p2", "p3", "p4", "p5", "p6"]),
        p1: placement("p1", { params: { label: "开始旅程" } }),
        p2: placement("p2", { params: { label: "继续冒险" } }),
        p3: placement("p3", { params: { label: "图鉴" } }),
        p4: placement("p4", { params: { label: "制作人员" } }),
        p5: placement("p5", { paramKeys: { label: "nav.title" } }),
        p6: placement("p6", {}),
    },
    components: [
        {
            id: "nav",
            name: "Nav item",
            rootElementId: "nav-root",
            params: [{ id: "label", name: "Label", type: "text", defaultValue: "项目" }],
            elements: {
                "nav-root": element("nav-root", "nl.container", null, ["nav-label"]),
                "nav-label": element("nav-label", "nl.text", "nav-root", [], {
                    props: { text: "示例" },
                    valueBindings: { text: { kind: "componentParam", paramId: "label" } },
                }),
            },
        },
    ],
};

const bundle: GameLocalizationBundle = {
    sourceLocale: "zh",
    locales: [{ code: "zh" }, { code: "en" }] as never,
    tables: {
        en: {
            "ui:p1.param.label": "Begin the journey",
            "ui:p2.param.label": "Continue the adventure",
            "ui:p3.param.label": "Gallery",
            "ui:p4.param.label": "Credits",
            "ui:nav.param.label": "Item",
            "key:nav.title": "Title",
            // The sample's own unit, left over from before it was bound: never read.
            "ui:nav-label.text": "Sample",
        },
    },
    keys: { "nav.title": "标题" },
};

/** A text widget that resolves its words the way the shipped text renderer does. */
function Words(props: { element: UIElement }) {
    const elementProps = (props.element.props ?? {}) as Record<string, unknown>;
    const words = useLocalizedWidgetText({
        site: uiTextSiteOf("nl.text")!,
        elementId: props.element.id,
        sourceText: String(elementProps.text ?? ""),
        localizationKey: typeof elementProps.localizationKey === "string" ? elementProps.localizationKey : undefined,
        origin: uiTextRuntimeOriginOf(props.element),
        unitId: uiTextRuntimeUnitOf(props.element),
    });
    return <span data-words="">{words}</span>;
}

const registry = new ElementRendererRegistry([
    { type: "nl.root", render: props => <>{props.children}</> },
    { type: "nl.container", render: props => <div>{props.children}</div> },
    { type: "nl.text", render: props => <Words element={props.element} /> },
]);

function drawn(container: HTMLElement, placementId: string): string {
    return container.querySelector(`[data-ui-element-id="${placementId}"] [data-words]`)?.textContent ?? "(nothing)";
}

beforeAll(() => {
    if (typeof globalThis.ResizeObserver === "undefined") {
        globalThis.ResizeObserver = class {
            public observe(): void {}
            public unobserve(): void {}
            public disconnect(): void {}
        } as unknown as typeof ResizeObserver;
    }
});

afterEach(() => {
    setDesignTimeLocalizationKeys(null);
    cleanup();
});

function drawCanvas() {
    const hostAdapter = { host: "app" } as UIHostAdapter;
    return render(
        <WidgetRuntimeStateProvider>
            <SurfaceElementTree
                document={document}
                surface={surface}
                rootElement={document.elements.root!}
                rendererRegistry={registry}
                hostAdapter={hostAdapter}
            />
        </WidgetRuntimeStateProvider>,
    );
}

function drawGame(locale: string) {
    const runtime: GameLocalizationRuntime = { bundle, getLocale: () => locale, subscribe: () => () => undefined };
    const hostAdapter = { host: "app" } as UIHostAdapter;
    return render(
        <GameLocalizationContext.Provider value={runtime}>
            <WidgetRuntimeStateProvider>
                <SurfaceElementTree
                    document={document}
                    surface={surface}
                    rootElement={document.elements.root!}
                    rendererRegistry={registry}
                    hostAdapter={hostAdapter}
                />
            </WidgetRuntimeStateProvider>
        </GameLocalizationContext.Provider>,
    );
}

const PLACEMENTS = ["p1", "p2", "p3", "p4", "p5", "p6"];

describe("a component's text parameter on the editing canvas", () => {
    it("draws each placement with its own words, with no graph run", () => {
        setDesignTimeLocalizationKeys({ "nav.title": "标题" });
        const { container } = drawCanvas();
        expect(PLACEMENTS.map(id => drawn(container, id))).toEqual([
            "开始旅程",
            "继续冒险",
            "图鉴",
            "制作人员",
            "标题",
            "项目",
        ]);
    });

    it("never draws the definition's sample words on a placement", () => {
        const { container } = drawCanvas();
        expect(container.textContent).not.toContain("示例");
    });
});

describe("a component's text parameter in a game", () => {
    it("shows each placement's words in the source language", () => {
        const { container } = drawGame("zh");
        expect(PLACEMENTS.map(id => drawn(container, id))).toEqual([
            "开始旅程",
            "继续冒险",
            "图鉴",
            "制作人员",
            "标题",
            "项目",
        ]);
    });

    it("translates each through the placement's unit, the key through the key, the default through the component's unit", () => {
        const { container } = drawGame("en");
        expect(PLACEMENTS.map(id => drawn(container, id))).toEqual([
            "Begin the journey",
            "Continue the adventure",
            "Gallery",
            "Credits",
            "Title",
            "Item",
        ]);
    });
});
