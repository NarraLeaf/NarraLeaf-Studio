import React, { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument } from "@shared/types/ui-editor/document";
import { UI_FRAME_ELEMENT_TYPE } from "@shared/types/ui-editor/frame";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { EditorNodeWrapper } from "@/lib/ui-editor/runtime/EditorNodeWrapper";
import { SurfaceElementTree } from "./SurfaceElementTree";

function flattenNodes(node: ReactNode): ReactNode[] {
    if (Array.isArray(node)) {
        return node.flatMap(flattenNodes);
    }
    if (isValidElement<{ children?: ReactNode }>(node)) {
        return [node, ...flattenNodes(node.props.children)];
    }
    return [];
}

describe("SurfaceElementTree", () => {
    it("passes the host adapter into element wrappers so Dev Mode widget events can dispatch", () => {
        const document: UIDocument = {
            schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
            id: "doc",
            name: "Doc",
            surfaces: [
                {
                    id: "surface",
                    name: "Surface",
                    host: "player",
                    kind: "stageSurface",
                    designSize: { width: 320, height: 180 },
                    rootElementId: "root",
                    mount: { kind: "slot", slotId: "onStage" },
                },
            ],
            elements: {
                root: {
                    id: "root",
                    type: "test.container",
                    parentId: null,
                    childrenIds: ["button"],
                    layout: { x: 0, y: 0, width: 320, height: 180 },
                },
                button: {
                    id: "button",
                    type: "test.button",
                    parentId: "root",
                    childrenIds: [],
                    layout: { x: 8, y: 8, width: 96, height: 32 },
                },
            },
        };
        const surface = document.surfaces[0]!;
        const hostAdapter: UIHostAdapter = {
            host: "player",
            blueprintRuntime: {
                surfaceId: surface.id,
                setSurfaceState: () => undefined,
                getSurfaceState: () => undefined,
                emitDebug: () => undefined,
                dispatchElementBlueprintEvent: async () => undefined,
            },
        };
        const rendererRegistry = new ElementRendererRegistry([
            {
                type: "test.container",
                render: props => <>{props.children}</>,
            },
            {
                type: "test.button",
                render: () => <button type="button">Click</button>,
            },
        ]);

        const tree = SurfaceElementTree({
            document,
            surface,
            rootElement: document.elements.root!,
            rendererRegistry,
            hostAdapter,
        });

        const wrappers = flattenNodes(tree).filter(
            (node): node is React.ReactElement<React.ComponentProps<typeof EditorNodeWrapper>> =>
                isValidElement(node) && node.type === EditorNodeWrapper,
        );
        const buttonWrapper = wrappers.find(node => node.props.element.id === "button");

        expect(buttonWrapper?.props.hostAdapter).toBe(hostAdapter);
    });

    it("lets widget renderers embed a target Page through renderSurface", () => {
        const document: UIDocument = {
            schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
            id: "doc",
            name: "Doc",
            surfaces: [
                {
                    id: "page-a",
                    name: "Page A",
                    host: "app",
                    kind: "appSurface",
                    designSize: { width: 320, height: 180 },
                    rootElementId: "root-a",
                },
                {
                    id: "page-b",
                    name: "Page B",
                    host: "app",
                    kind: "appSurface",
                    designSize: { width: 200, height: 100 },
                    rootElementId: "root-b",
                },
            ],
            elements: {
                "root-a": {
                    id: "root-a",
                    type: "test.root",
                    parentId: null,
                    childrenIds: ["frame-a"],
                    layout: { x: 0, y: 0, width: 320, height: 180 },
                },
                "frame-a": {
                    id: "frame-a",
                    type: UI_FRAME_ELEMENT_TYPE,
                    parentId: "root-a",
                    childrenIds: [],
                    layout: { x: 0, y: 0, width: 200, height: 100 },
                    props: { targetSurfaceId: "page-b", params: {}, navigationMode: "static" },
                },
                "root-b": {
                    id: "root-b",
                    type: "test.root",
                    parentId: null,
                    childrenIds: ["label-b"],
                    layout: { x: 0, y: 0, width: 200, height: 100 },
                },
                "label-b": {
                    id: "label-b",
                    type: "test.label",
                    parentId: "root-b",
                    childrenIds: [],
                    layout: { x: 0, y: 0, width: 120, height: 24 },
                },
            },
        };
        const surface = document.surfaces[0]!;
        const rendererRegistry = new ElementRendererRegistry([
            { type: "test.root", render: props => <>{props.children}</> },
            {
                type: UI_FRAME_ELEMENT_TYPE,
                render: props => (
                    <>
                        {props.renderSurface?.({
                            targetSurfaceId: "page-b",
                            frameElement: props.element,
                            params: {},
                        })}
                    </>
                ),
            },
            { type: "test.label", render: () => <span>Nested Page</span> },
        ]);

        const markup = renderToStaticMarkup(
            <>
                {SurfaceElementTree({
                    document,
                    surface,
                    rootElement: document.elements["root-a"]!,
                    rendererRegistry,
                    hostAdapter: { host: "app" },
                })}
            </>,
        );

        expect(markup).toContain("Nested Page");
        expect(markup).toContain('data-ui-surface-id="page-b"');
        expect(markup).not.toContain('data-ui-element-id="label-b"');
    });

    it("renders a placeholder instead of recursing when nested Page targets would loop", () => {
        const document: UIDocument = {
            schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
            id: "doc",
            name: "Doc",
            surfaces: [
                {
                    id: "page-a",
                    name: "Page A",
                    host: "app",
                    kind: "appSurface",
                    designSize: { width: 320, height: 180 },
                    rootElementId: "root-a",
                },
                {
                    id: "page-b",
                    name: "Page B",
                    host: "app",
                    kind: "appSurface",
                    designSize: { width: 200, height: 100 },
                    rootElementId: "root-b",
                },
            ],
            elements: {
                "root-a": {
                    id: "root-a",
                    type: "test.root",
                    parentId: null,
                    childrenIds: ["frame-a"],
                    layout: { x: 0, y: 0, width: 320, height: 180 },
                },
                "frame-a": {
                    id: "frame-a",
                    type: UI_FRAME_ELEMENT_TYPE,
                    parentId: "root-a",
                    childrenIds: [],
                    layout: { x: 0, y: 0, width: 200, height: 100 },
                    props: { targetSurfaceId: "page-b", params: {}, navigationMode: "static" },
                },
                "root-b": {
                    id: "root-b",
                    type: "test.root",
                    parentId: null,
                    childrenIds: ["frame-b"],
                    layout: { x: 0, y: 0, width: 200, height: 100 },
                },
                "frame-b": {
                    id: "frame-b",
                    type: UI_FRAME_ELEMENT_TYPE,
                    parentId: "root-b",
                    childrenIds: [],
                    layout: { x: 0, y: 0, width: 200, height: 100 },
                    props: { targetSurfaceId: "page-a", params: {}, navigationMode: "static" },
                },
            },
        };
        const rendererRegistry = new ElementRendererRegistry([
            { type: "test.root", render: props => <>{props.children}</> },
            {
                type: UI_FRAME_ELEMENT_TYPE,
                render: props => {
                    const targetSurfaceId =
                        props.element.id === "frame-a" ? "page-b" : "page-a";
                    return (
                        <>
                            {props.renderSurface?.({
                                targetSurfaceId,
                                frameElement: props.element,
                                params: {},
                            })}
                        </>
                    );
                },
            },
        ]);

        const markup = renderToStaticMarkup(
            <>
                {SurfaceElementTree({
                    document,
                    surface: document.surfaces[0]!,
                    rootElement: document.elements["root-a"]!,
                    rendererRegistry,
                    hostAdapter: { host: "app" },
                })}
            </>,
        );

        expect(markup).toContain("Page loop blocked");
    });
});
