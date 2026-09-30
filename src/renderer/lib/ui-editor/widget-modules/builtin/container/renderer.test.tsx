import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import { defaultContainerWidgetProps } from "@shared/types/ui-editor/container";
import { ContainerRenderer } from "./renderer";

vi.mock("@/apps/workspace/modules/properties/framework/utils/colorUtils", () => ({
    parseColorValue: (_raw: string | undefined, fallback: { hex: string; alpha?: number }) => fallback,
    colorValueToCss: (value: { hex: string; alpha?: number }) => value.hex,
}));

vi.mock("@/lib/workspace/hooks/useAssetObjectUrl", () => ({
    useAssetObjectUrl: () => ({ url: null, metadata: null, loading: false, error: null }),
}));

function createDocument(): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [
            {
                id: "surface",
                name: "Surface",
                host: "app",
                kind: "appSurface",
                designSize: { width: 320, height: 180 },
                rootElementId: "root",
            },
        ],
        elements: {
            root: {
                id: "root",
                type: "nl.root",
                parentId: null,
                childrenIds: ["container"],
                layout: { x: 0, y: 0, width: 320, height: 180 },
            },
            container: {
                id: "container",
                type: "nl.container",
                parentId: "root",
                childrenIds: ["child"],
                layout: { x: 0, y: 0, width: 100, height: 80 },
                props: {
                    ...defaultContainerWidgetProps,
                    layoutKind: "free",
                    transformOffsetX: 12,
                    transformOffsetY: -3,
                    transformScale: 1.5,
                    transformRotation: 10,
                },
            },
            child: {
                id: "child",
                type: "test.child",
                parentId: "container",
                childrenIds: [],
                layout: { x: 8, y: 8, width: 20, height: 20 },
            },
        },
    };
}

function renderContainer(document: UIDocument): string {
    const element = document.elements.container as UIElement;
    return renderToStaticMarkup(
        <ContainerRenderer
            element={element}
            document={document}
            surface={document.surfaces[0]!}
            hostAdapter={{ host: "app" }}
        >
            <span data-child-marker="true">Child</span>
        </ContainerRenderer>,
    );
}

describe("ContainerRenderer", () => {
    it("applies free layout transforms to chrome and absolute children together", () => {
        const markup = renderContainer(createDocument());

        expect(markup).toContain("translate(12px, -3px) scale(1.5) rotate(10deg)");
        expect(markup).toContain("data-child-marker=\"true\"");
    });

    it("paints a plain colour fill on the chrome root, with no fill layer", () => {
        const markup = renderContainer(createDocument());

        // The common case costs no extra DOM: no layer, and no stacking context forced on the root.
        expect(markup).not.toContain("data-ui-fill-layer");
        expect(markup).not.toContain("isolation:isolate");
    });

    it("paints a gradient fill on a layer, beneath the children", () => {
        const document = createDocument();
        const container = document.elements.container as UIElement;
        container.props = {
            ...container.props,
            fillType: "gradient",
            gradientFill: {
                kind: "linear",
                angle: 90,
                stops: [
                    { offset: 0, color: "#ff0000" },
                    { offset: 1, color: "#0000ff" },
                ],
            },
        };

        const markup = renderContainer(document);

        expect(markup).toContain("data-ui-fill-layer=\"current\"");
        expect(markup).toContain("data-ui-fill-layer-kind=\"gradient\"");
        // The stacking rule, asserted at the widget level too: an absolutely positioned layer paints
        // above in-flow children whatever the DOM order, so it takes a negative z-index inside a root
        // that is a stacking context. Either half alone puts the fill over the children, or behind an
        // ancestor.
        expect(markup).toContain("z-index:-1");
        expect(markup).toContain("isolation:isolate");
        expect(markup).toContain("data-child-marker=\"true\"");
    });
});

const IMAGE_FILL_URL = "file:///fills/stone.png";
const IMAGE_TAG = "data-ui-image-fill=\"true\"";
const CROP_MASK = "ui-image-crop-mask";

/**
 * A stack container is the plainest widget that puts author content inside the chrome: the image
 * fill and the children are siblings under one chrome root, which is exactly where the fill used to
 * paint over the content.
 */
function createStackDocument(props: Record<string, unknown>): UIDocument {
    const document = createDocument();
    document.elements.container.props = {
        ...defaultContainerWidgetProps,
        layoutKind: "stack",
        fillType: "image",
        backgroundImage: IMAGE_FILL_URL,
        ...props,
    };
    return document;
}

/** The inline style React serialised onto the first tag carrying `marker`. */
function inlineStyleOf(markup: string, marker: string): string {
    const tag = new RegExp(`<[^>]*${marker}[^>]*>`).exec(markup)?.[0] ?? "";
    return /style="([^"]*)"/.exec(tag)?.[1] ?? "";
}

function renderStack(document: UIDocument, editorStateService?: unknown): string {
    return renderToStaticMarkup(
        <ContainerRenderer
            element={document.elements.container as UIElement}
            document={document}
            surface={document.surfaces[0]!}
            hostAdapter={{ host: "app", editorStateService: editorStateService as never }}
        >
            <span data-child-marker="true">Child</span>
        </ContainerRenderer>,
    );
}

/** Stand-in for the singleton `UIEditorStateService`: only the members the chrome touches. */
function cropStateService(elementId: string | null) {
    return {
        getInteractionOverride: () =>
            elementId ? { kind: "imageCrop", surfaceId: "surface", elementId, source: "test" } : null,
        on: () => () => undefined,
    };
}

describe("RectangleChromeRenderer image fill stacking", () => {
    it("paints an image fill below the widget's own content", () => {
        const markup = renderStack(createStackDocument({}));

        // A positioned `<img>` paints above in-flow content whatever the DOM order, so only a
        // negative z-index puts the fill where a background belongs.
        expect(inlineStyleOf(markup, IMAGE_TAG)).toContain("z-index:-1");
        // ...and a negative z-index escapes any ancestor that is not a stacking context, which is
        // what `isolation` on the chrome root prevents.
        expect(inlineStyleOf(markup, "data-ui-image-crop-active")).toContain("isolation:isolate");
        expect(markup).toContain("data-child-marker=\"true\"");
    });

    it("leaves tile mode painting on the root rather than through an image", () => {
        const markup = renderStack(createStackDocument({ imageFill: { mode: "tile", assetId: null } }));

        expect(markup).not.toContain(IMAGE_TAG);
        expect(inlineStyleOf(markup, "data-ui-image-crop-active")).toContain(`url(${IMAGE_FILL_URL})`);
    });

    it("hands crop editing an interactive image the mask still paints over", () => {
        const markup = renderStack(
            createStackDocument({ imageFill: { mode: "crop", assetId: null } }),
            cropStateService("container"),
        );
        const imageStyle = inlineStyleOf(markup, IMAGE_TAG);

        expect(markup).toContain("data-ui-image-crop-active=\"true\"");
        expect(imageStyle).toContain("pointer-events:auto");
        // The author drags this image over the widget's content, so it keeps `z-index: auto`. Any
        // explicit value - `0` included - would lift it over the mask that dims what falls outside
        // the box, because the mask is a later sibling at `auto` and nothing else orders the two.
        expect(imageStyle).not.toContain("z-index");
        expect(markup.indexOf(CROP_MASK)).toBeGreaterThan(markup.indexOf(IMAGE_TAG));
    });

    it("keeps the fill behind the content while another element is being cropped", () => {
        const markup = renderStack(createStackDocument({}), cropStateService("elsewhere"));

        expect(inlineStyleOf(markup, IMAGE_TAG)).toContain("z-index:-1");
        expect(markup).not.toContain(CROP_MASK);
    });
});

const STACK_TAG = "data-nl-stack";

describe("container stack wrap", () => {
    it("keeps children on one line unless the author asked for wrap", () => {
        const style = inlineStyleOf(renderStack(createStackDocument({})), STACK_TAG);

        expect(style).toContain("flex-wrap:nowrap");
        // Line packing is meaningless on one line, and stating it would suggest it were readable.
        expect(style).not.toContain("align-content");
    });

    it("packs wrapped lines from the start of the cross axis, at the authored gap", () => {
        const style = inlineStyleOf(
            renderStack(createStackDocument({ stackDirection: "horizontal", stackWrap: true, stackGap: 24 })),
            STACK_TAG,
        );

        expect(style).toContain("flex-wrap:wrap");
        // Without this the two lines sit at opposite ends of the box rather than 24px apart.
        expect(style).toContain("align-content:flex-start");
        expect(style).toContain("gap:24px");
    });

    it("has no sibling overlap to draw once children wrap", () => {
        const overlapping = renderStack(createStackDocument({ stackGap: -12 }));
        const wrapped = renderStack(createStackDocument({ stackWrap: true, stackGap: -12 }));

        // The overlap is drawn with a margin on every child after the first, which under wrap would
        // land on the first child of each new line as well and pull it back out of the box.
        expect(overlapping).toContain("margin-top: -12px !important");
        expect(wrapped).not.toContain("!important");
        expect(inlineStyleOf(wrapped, STACK_TAG)).toContain("gap:0;");
    });

    it("gives a wrapping column of children a main size to break against in a scroll viewport", () => {
        const wrapped = createStackDocument({ layoutKind: "scroll", scrollAxis: "x", stackWrap: true });
        const plain = createStackDocument({ layoutKind: "scroll", scrollAxis: "x" });

        // Logical, because a stack inside a vertical writing mode inherits it and its column of
        // children runs across the screen; a block box only fills the inline axis on its own.
        expect(inlineStyleOf(renderStack(wrapped), STACK_TAG)).toContain("block-size:100%");
        expect(inlineStyleOf(renderStack(plain), STACK_TAG)).not.toContain("block-size");
    });
});
