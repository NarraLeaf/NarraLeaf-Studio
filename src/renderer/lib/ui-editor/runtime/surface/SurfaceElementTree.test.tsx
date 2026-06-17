import React, { isValidElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument } from "@shared/types/ui-editor/document";
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
});
