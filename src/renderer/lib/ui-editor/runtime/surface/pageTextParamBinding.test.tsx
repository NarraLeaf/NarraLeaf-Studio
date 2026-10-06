// @vitest-environment jsdom
/**
 * A text on a page shows the words the page was opened with, through one of its text parameters.
 *
 * The confirm page's question used to reach its text through a two-node value blueprint (Get Page
 * Param -> Return Value). A `pageParam` binding is the same read with no graph: words given when the
 * page is opened are shown as given, a Page widget's words are translated through the widget's unit,
 * and the declared default through the page's. The page's own canvas, which nobody opened, draws the
 * default - or the element's own words, as sample text, while the default is empty.
 *
 * Drawn through the real tree, with a text widget that resolves its words the way the shipped one does.
 *
 * Comments in English per project convention.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { GameLocalizationBundle } from "@shared/types/localization";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement, type UISurface } from "@shared/types/ui-editor/document";
import { resolveUIPageTextParams, type UIPageTextValues } from "@shared/types/ui-editor/pageTextParams";
import { uiTextRuntimeOriginOf, uiTextRuntimeUnitOf, uiTextSiteOf } from "@shared/types/ui-editor/textSource";
import { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { WidgetRuntimeStateProvider } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import {
    GameLocalizationContext,
    useLocalizedWidgetText,
    type GameLocalizationRuntime,
} from "@/lib/ui-editor/runtime/localization/GameLocalizationContext";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { SurfaceElementTree } from "./SurfaceElementTree";

const surface: UISurface = {
    id: "confirm",
    name: "Confirm",
    host: "app",
    kind: "appSurface",
    designSize: { width: 1920, height: 1080 },
    rootElementId: "root",
    params: [
        { id: "message", name: "message", type: "text", defaultValue: "确定吗？" },
        { id: "note", name: "note", type: "text" },
    ],
};

function element(id: string, type: string, parentId: string | null, childrenIds: string[], more?: Partial<UIElement>): UIElement {
    return { id, type, parentId, childrenIds, layout: { x: 0, y: 0, width: 400, height: 80 }, ...more };
}

const document: UIDocument = {
    schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
    id: "doc",
    name: "Doc",
    surfaces: [surface],
    elements: {
        root: element("root", "nl.root", null, ["msg", "note", "gone"]),
        msg: element("msg", "nl.text", "root", [], {
            props: { text: "示例问题" },
            valueBindings: { text: { kind: "pageParam", paramId: "message" } },
        }),
        note: element("note", "nl.text", "root", [], {
            props: { text: "示例备注" },
            valueBindings: { text: { kind: "pageParam", paramId: "note" } },
        }),
        // Bound to a parameter the page no longer declares.
        gone: element("gone", "nl.text", "root", [], {
            props: { text: "示例" },
            valueBindings: { text: { kind: "pageParam", paramId: "removed" } },
        }),
    },
};

const bundle: GameLocalizationBundle = {
    sourceLocale: "zh",
    locales: [{ code: "zh" }, { code: "en" }] as never,
    tables: {
        en: {
            "ui:confirm.param.message": "Are you sure?",
            "ui:embed.param.message": "Leave the game?",
            // The sample's own unit: never read.
            "ui:msg.text": "Sample question",
        },
    },
    keys: {},
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
    { type: "nl.text", render: props => <Words element={props.element} /> },
]);

function drawn(container: HTMLElement, elementId: string): string {
    return container.querySelector(`[data-ui-element-id="${elementId}"] [data-words]`)?.textContent ?? "(nothing)";
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
    cleanup();
});

function draw(pageTexts: UIPageTextValues | undefined, locale?: string) {
    const hostAdapter = { host: "app" } as UIHostAdapter;
    const tree = (
        <WidgetRuntimeStateProvider>
            <SurfaceElementTree
                document={document}
                surface={surface}
                rootElement={document.elements.root!}
                rendererRegistry={registry}
                hostAdapter={hostAdapter}
                pageTexts={pageTexts}
            />
        </WidgetRuntimeStateProvider>
    );
    if (!locale) {
        return render(tree);
    }
    const runtime: GameLocalizationRuntime = { bundle, getLocale: () => locale, subscribe: () => () => undefined };
    return render(<GameLocalizationContext.Provider value={runtime}>{tree}</GameLocalizationContext.Provider>);
}

const TEXTS = ["msg", "note", "gone"];

describe("a page's text parameter on the page's own canvas", () => {
    it("draws the default, and the sample words while the default is empty", () => {
        const { container } = draw(undefined);
        expect(TEXTS.map(id => drawn(container, id))).toEqual(["确定吗？", "示例备注", "示例"]);
    });
});

describe("a page's text parameter on an opened page", () => {
    it("shows words given at the opening as given, in every language", () => {
        const opened = resolveUIPageTextParams(surface, { message: "退出游戏？" }, { opened: true });
        const { container } = draw(opened, "en");
        // A parameter the page no longer declares shows nothing, as a placement's does.
        expect(TEXTS.map(id => drawn(container, id))).toEqual(["退出游戏？", "", ""]);
    });

    it("translates the default through the page's unit when nothing was given", () => {
        const opened = resolveUIPageTextParams(surface, {}, { opened: true });
        expect(drawn(draw(opened, "zh").container, "msg")).toBe("确定吗？");
        cleanup();
        expect(drawn(draw(opened, "en").container, "msg")).toBe("Are you sure?");
    });

    it("translates words a Page widget gives through the widget's own unit", () => {
        const opened = resolveUIPageTextParams(surface, { message: "要离开游戏吗？" }, { opened: true, giverId: "embed" });
        expect(drawn(draw(opened, "zh").container, "msg")).toBe("要离开游戏吗？");
        cleanup();
        expect(drawn(draw(opened, "en").container, "msg")).toBe("Leave the game?");
    });
});
