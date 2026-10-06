// @vitest-environment jsdom
/**
 * What the tree draws where a page or a component cannot be drawn is read by the player in a game,
 * so it is worded in the game's language - and in the author's on the editing canvas.
 *
 * Every placeholder here used to be English in a Chinese or Japanese game: the Page widget's
 * placeholders and the unknown-widget badge followed the interface's language (Studio's in Dev Mode,
 * the machine's in a shipped game), and the tree's own were English literals. Drawn through the real
 * tree, the real Page widget renderer and the real badge, under the language source a game provides.
 *
 * Comments in English per project convention.
 */
import { act, cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { GameLocalizationBundle } from "@shared/types/localization";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement, type UISurface } from "@shared/types/ui-editor/document";
import { UI_FRAME_ELEMENT_TYPE } from "@shared/types/ui-editor/frame";
import { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { WidgetRuntimeStateProvider } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import {
    GameLocalizationContext,
    type GameLocalizationRuntime,
} from "@/lib/ui-editor/runtime/localization/GameLocalizationContext";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { renderUnknownWidgetTypeContent } from "@/lib/ui-editor/runtime/unknownWidgetTypeUi";
import { FrameRenderer } from "@/lib/ui-editor/widget-modules/builtin/frame/renderer";
import { SurfaceElementTree } from "./SurfaceElementTree";

const bundle: GameLocalizationBundle = {
    sourceLocale: "zh",
    locales: [
        { code: "zh", displayName: "中文" },
        { code: "en", displayName: "English" },
        { code: "ja", displayName: "日本語" },
        { code: "fr", displayName: "Français" },
    ],
    tables: {},
};

function element(id: string, type: string, parentId: string | null, childrenIds: string[], more?: Partial<UIElement>): UIElement {
    return { id, type, parentId, childrenIds, layout: { x: 0, y: 0, width: 400, height: 200 }, ...more };
}

function page(id: string, rootElementId: string): UISurface {
    return { id, name: id, host: "app", kind: "appSurface", designSize: { width: 400, height: 200 }, rootElementId };
}

/**
 * Two pages whose Page widgets show each other (the tree draws "Page loop blocked" on the second
 * hop), a component that places itself ("Component loop blocked"), a placement of a component the
 * project no longer has ("Missing component"), and a widget whose type nothing registers.
 */
const document: UIDocument = {
    schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
    id: "doc",
    name: "Doc",
    surfaces: [page("page-a", "root-a"), page("page-b", "root-b")],
    elements: {
        "root-a": element("root-a", "test.root", null, ["frame-a", "self-place", "gone-place", "unknown"]),
        "frame-a": element("frame-a", UI_FRAME_ELEMENT_TYPE, "root-a", [], { props: { targetSurfaceId: "page-b" } }),
        "self-place": element("self-place", "test.box", "root-a", [], {
            extra: { componentLink: { componentId: "card", linked: true } },
        }),
        "gone-place": element("gone-place", "test.box", "root-a", [], {
            extra: { componentLink: { componentId: "deleted", linked: true } },
        }),
        unknown: element("unknown", "acme.gauge", "root-a", []),
        "root-b": element("root-b", "test.root", null, ["frame-b"]),
        "frame-b": element("frame-b", UI_FRAME_ELEMENT_TYPE, "root-b", [], { props: { targetSurfaceId: "page-a" } }),
    },
    components: [
        {
            id: "card",
            name: "Card",
            rootElementId: "card-root",
            elements: {
                "card-root": element("card-root", "test.box", null, ["card-self"]),
                "card-self": element("card-self", "test.box", "card-root", [], {
                    extra: { componentLink: { componentId: "card", linked: true } },
                }),
            },
        },
    ],
};

/** A Page widget that asks the tree for its page, as the shipped one does. */
const registry = new ElementRendererRegistry([
    { type: "test.root", render: props => <>{props.children}</> },
    { type: "test.box", render: props => <div>{props.children}</div> },
    {
        type: UI_FRAME_ELEMENT_TYPE,
        render: props => (
            <>
                {props.renderSurface?.({
                    targetSurfaceId: (props.element.props as { targetSurfaceId: string }).targetSurfaceId,
                    frameElement: props.element,
                    params: {},
                })}
            </>
        ),
    },
]);

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

/** A game's language source whose language the test can change, as a player does. */
function gameLanguage(initial: string) {
    let locale = initial;
    const listeners = new Set<() => void>();
    const runtime: GameLocalizationRuntime = {
        bundle,
        getLocale: () => locale,
        subscribe: listener => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
    return {
        runtime,
        set(next: string) {
            locale = next;
            listeners.forEach(listener => listener());
        },
    };
}

function inGame(runtime: GameLocalizationRuntime | null, children: ReactNode) {
    return render(
        <GameLocalizationContext.Provider value={runtime}>
            <WidgetRuntimeStateProvider>{children}</WidgetRuntimeStateProvider>
        </GameLocalizationContext.Provider>,
    );
}

function tree() {
    return (
        <SurfaceElementTree
            document={document}
            surface={document.surfaces[0]!}
            rootElement={document.elements["root-a"]!}
            rendererRegistry={registry}
            hostAdapter={{ host: "app" } as UIHostAdapter}
        />
    );
}

function placeholders(container: HTMLElement) {
    const text = (id: string) => container.querySelector(`[data-ui-element-id="${id}"]`)?.textContent ?? "(nothing)";
    return {
        loop: text("frame-a"),
        component: text("self-place"),
        gone: text("gone-place"),
        unknown: container.textContent?.includes("acme.gauge") ? text("unknown").replace("acme.gauge", "") : "(nothing)",
    };
}

describe("placeholders in a game", () => {
    it("are worded in the language the game is read in, and follow it when it changes", () => {
        const language = gameLanguage("ja");
        const { container } = inGame(language.runtime, tree());
        expect(placeholders(container)).toEqual({
            loop: "ページの循環を止めた",
            component: "コンポーネントの循環を止めた",
            gone: "コンポーネントが見つからない",
            unknown: "不明なウィジェット",
        });
        act(() => language.set("zh"));
        expect(placeholders(container)).toEqual({
            loop: "已阻止页面循环",
            component: "已阻止组件循环",
            gone: "缺少组件",
            unknown: "未知控件",
        });
    });

    it("are in the project's source language, not English, for a language Studio has no words in", () => {
        const { container } = inGame(gameLanguage("fr").runtime, tree());
        expect(placeholders(container).component).toBe("已阻止组件循环");
    });

    it("draw the Page widget's own placeholder in the game's language", () => {
        const frame = element("frame", UI_FRAME_ELEMENT_TYPE, null, [], { props: { targetSurfaceId: "page-gone" } });
        const { container } = inGame(
            gameLanguage("ja").runtime,
            <FrameRenderer
                element={frame}
                surface={document.surfaces[0]!}
                document={document}
                hostAdapter={{ host: "app" } as UIHostAdapter}
            />,
        );
        expect(container.textContent).toBe("ページが見つからない");
    });

    it("draw the unknown-widget badge in the game's language outside the tree too", () => {
        const { container } = inGame(gameLanguage("ja").runtime, <>{renderUnknownWidgetTypeContent(document.elements.unknown!, [])}</>);
        expect(container.textContent).toBe("不明なウィジェットacme.gauge");
    });
});

describe("placeholders on the editing canvas", () => {
    it("are worded in the interface's language", () => {
        const { container } = inGame(null, tree());
        expect(placeholders(container)).toEqual({
            loop: "Page loop blocked",
            component: "Component loop blocked",
            gone: "Missing component",
            unknown: "Unknown widget",
        });
    });
});
