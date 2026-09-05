// @vitest-environment jsdom
/**
 * The seam a plugin widget draws through, and the two things that decide whether it is a feature or
 * a trap: what happens when the plugin is gone, and what happens when its render throws.
 */
import React from "react";
import { Box } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { UIDocument, UIElement, UISurface } from "@shared/types/ui-editor/document";
import { ElementRendererRegistry } from "../runtime/ElementRendererRegistry";
import type { ElementRendererProps } from "../runtime/ElementRendererRegistry";
import { widgetModuleRegistry } from "./registryInstance";
import { listPluginInsertPaletteEntries } from "./insertPalette";
import { guardPluginWidgetModule } from "@/lib/plugins/pluginWidgetGuard";
import { syncPluginElementRenderers } from "./pluginElementRenderers";
import type { UIWidgetModule } from "./types";

const OWNER = "acme.lab";
const DRAWN_TYPE = "acme.lab.badge";
const THROWING_TYPE = "acme.lab.thrower";

function pluginModule(type: string, render: UIWidgetModule["render"]): UIWidgetModule {
    return {
        type,
        displayName: type,
        icon: Box,
        createDefaultElement: () => ({ type }),
        render,
    };
}

function registerPluginWidget(type: string, render: UIWidgetModule["render"], name = "Widget Lab"): void {
    widgetModuleRegistry.register(pluginModule(type, render), {
        ownerPluginId: OWNER,
        ownerPluginName: name,
    });
}

function rendererProps(type: string): ElementRendererProps {
    const element = {
        id: "element-1",
        type,
        parentId: null,
        childrenIds: [],
        layout: { x: 0, y: 0, width: 10, height: 10, visible: true, opacity: 1 },
    } as UIElement;
    const surface = {
        id: "surface-1",
        name: "Page",
        host: "app",
        kind: "appSurface",
        designSize: { width: 100, height: 100 },
        rootElementId: element.id,
    } as UISurface;
    return {
        element,
        surface,
        document: { surfaces: [surface], elements: { [element.id]: element } } as unknown as UIDocument,
        hostAdapter: { host: "app" },
    };
}

afterEach(() => {
    cleanup();
    widgetModuleRegistry.unregister(DRAWN_TYPE);
    widgetModuleRegistry.unregister(THROWING_TYPE);
    vi.restoreAllMocks();
});

describe("plugin element renderers", () => {
    it("puts a plugin's widget type into a renderer registry and takes it back out again", () => {
        const registry = new ElementRendererRegistry();
        registerPluginWidget(DRAWN_TYPE, () => null);

        syncPluginElementRenderers(registry);
        expect(registry.get(DRAWN_TYPE)).toBeDefined();

        widgetModuleRegistry.unregister(DRAWN_TYPE);
        syncPluginElementRenderers(registry);
        expect(registry.get(DRAWN_TYPE)).toBeUndefined();
    });

    it("draws the plugin's own output", () => {
        const registry = new ElementRendererRegistry();
        registerPluginWidget(DRAWN_TYPE, ({ element }) =>
            React.createElement("span", null, `drawn:${element.id}`));
        syncPluginElementRenderers(registry);

        render(registry.get(DRAWN_TYPE)!.render(rendererProps(DRAWN_TYPE))!);

        expect(screen.getByText("drawn:element-1")).toBeTruthy();
    });

    it("keeps a throwing widget inside its own frame", () => {
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        const registry = new ElementRendererRegistry();
        registerPluginWidget(DRAWN_TYPE, () => React.createElement("span", null, "healthy"));
        registerPluginWidget(THROWING_TYPE, () => {
            throw new Error("deliberate");
        });
        syncPluginElementRenderers(registry);

        // Both drawn into one tree, which is what the canvas does: the failure must cost the page
        // one widget, not the page.
        render(React.createElement(
            "div",
            null,
            registry.get(THROWING_TYPE)!.render(rendererProps(THROWING_TYPE)),
            registry.get(DRAWN_TYPE)!.render(rendererProps(DRAWN_TYPE)),
        ));

        expect(screen.getByText("healthy")).toBeTruthy();
        expect(screen.getByText(THROWING_TYPE)).toBeTruthy();
    });

    it("draws through the guarded module, so the plugin still never sees the host adapter", () => {
        // The narrowing lives on the module the registry holds; this closes the loop between the
        // two, because a bridge that reached past the module would hand the plugin `hostAdapter`
        // and every host API behind it - the escalation `pluginWidgetGuard` was written to stop.
        let seen: Record<string, unknown> | null = null;
        const guarded = guardPluginWidgetModule(
            OWNER,
            {
                type: DRAWN_TYPE,
                displayName: "Lab Badge",
                icon: Box,
                createDefaultElement: () => ({ type: DRAWN_TYPE }),
                render: props => {
                    seen = props as unknown as Record<string, unknown>;
                    return null;
                },
            } as unknown as Parameters<typeof guardPluginWidgetModule>[1],
            { log: () => undefined } as unknown as Parameters<typeof guardPluginWidgetModule>[2],
            {
                documentService: { getDocument: () => ({ elements: {} }) } as never,
                stateService: { getSelection: () => ({ type: "none" }) } as never,
            },
        );
        widgetModuleRegistry.register(guarded, { ownerPluginId: OWNER, ownerPluginName: "Widget Lab" });

        const registry = new ElementRendererRegistry();
        syncPluginElementRenderers(registry);
        render(registry.get(DRAWN_TYPE)!.render(rendererProps(DRAWN_TYPE))!);

        expect(seen).not.toBeNull();
        expect(seen!).not.toHaveProperty("hostAdapter");
    });

    it("lists a plugin's widgets in the palette, attributed to the plugin, in the overflow", () => {
        registerPluginWidget(DRAWN_TYPE, () => null, "Widget Lab");

        expect(listPluginInsertPaletteEntries()).toMatchObject([
            { module: { type: DRAWN_TYPE }, placement: "overflow", ownerPluginName: "Widget Lab" },
        ]);
    });

    it("records the owning plugin's name, and falls back to its id", () => {
        registerPluginWidget(DRAWN_TYPE, () => null, "Widget Lab");
        widgetModuleRegistry.register(pluginModule(THROWING_TYPE, () => null), { ownerPluginId: OWNER });

        expect(widgetModuleRegistry.getOwnerName(DRAWN_TYPE)).toBe("Widget Lab");
        expect(widgetModuleRegistry.getOwnerName(THROWING_TYPE)).toBe(OWNER);
        expect(widgetModuleRegistry.getOwnerName("nl.container")).toBeUndefined();
    });

    it("tells subscribers a registration changed", () => {
        const listener = vi.fn();
        const unsubscribe = widgetModuleRegistry.subscribe(listener);

        registerPluginWidget(DRAWN_TYPE, () => null);
        expect(listener).toHaveBeenCalledTimes(1);

        widgetModuleRegistry.unregister(DRAWN_TYPE);
        expect(listener).toHaveBeenCalledTimes(2);

        // Removing something that was never there is not a change.
        widgetModuleRegistry.unregister(DRAWN_TYPE);
        expect(listener).toHaveBeenCalledTimes(2);

        unsubscribe();
    });
});
