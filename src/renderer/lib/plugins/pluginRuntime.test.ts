import { afterEach, describe, expect, it, vi } from "vitest";
import { definePlugin, type PluginApp } from "@/plugin";
import { createPluginApp, exposePluginModule, resolvePluginDefinition } from "./pluginRuntime";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import type { WorkspacePluginDescriptor } from "@shared/types/plugins";
import type { UIWidgetModule } from "@/lib/ui-editor/widget-modules";

describe("plugin runtime", () => {
    it("accepts default exported definePlugin definitions", () => {
        const setup = vi.fn();
        const definition = definePlugin({ setup });

        expect(resolvePluginDefinition({ default: definition })).toBe(definition);
    });

    it("accepts named plugin definitions for compatibility", () => {
        const setup = vi.fn();
        const definition = definePlugin({ setup });

        expect(resolvePluginDefinition({ plugin: definition })).toBe(definition);
    });

    it("rejects entries that do not export definePlugin definitions", () => {
        expect(() => resolvePluginDefinition({ default: {} })).toThrow("default-export definePlugin");
    });
});

describe("exposePluginModule", () => {
    it("defines a frozen, non-writable, non-configurable global exactly once", () => {
        exposePluginModule();
        const g = globalThis as typeof globalThis & { __NLS_PLUGIN_MODULE__?: unknown };
        const first = g.__NLS_PLUGIN_MODULE__;
        expect(first).toBeDefined();
        expect(Object.isFrozen(first)).toBe(true);

        const descriptor = Object.getOwnPropertyDescriptor(globalThis, "__NLS_PLUGIN_MODULE__");
        expect(descriptor?.writable).toBe(false);
        expect(descriptor?.configurable).toBe(false);

        // Idempotent: second call keeps the same object.
        exposePluginModule();
        expect(g.__NLS_PLUGIN_MODULE__).toBe(first);

        // Tampering must throw in strict mode (vitest modules are strict).
        expect(() => {
            (globalThis as any).__NLS_PLUGIN_MODULE__ = {};
        }).toThrow();
        expect(() => {
            (first as any).definePlugin = null;
        }).toThrow();
        expect(g.__NLS_PLUGIN_MODULE__).toBe(first);
    });
});

describe("createPluginApp disposal", () => {
    const descriptor = {
        plugin: { id: "test-plugin", version: "1.0.0" },
        manifest: { manifestVersion: 1, id: "test-plugin", name: "Test", version: "1.0.0", entry: "main.js", permissions: [] },
        entryUrl: "app://plugins/test-plugin/main.js",
    } as unknown as WorkspacePluginDescriptor;

    function createFakeContext() {
        const calls: string[] = [];
        const store = {
            registerAction: vi.fn(() => calls.push("registerAction")),
            unregisterAction: vi.fn(() => calls.push("unregisterAction")),
            registerActionGroup: vi.fn(() => calls.push("registerActionGroup")),
            unregisterActionGroup: vi.fn(() => calls.push("unregisterActionGroup")),
            closeEditorTabInGroup: vi.fn(),
        };
        const panelDisposer = vi.fn(() => calls.push("panelDisposer"));
        const keybindingDisposer = vi.fn(() => calls.push("keybindingDisposer"));
        const dynamicSourceDisposer = vi.fn(() => calls.push("dynamicSourceDisposer"));
        const uiService = {
            panels: {
                register: vi.fn(() => panelDisposer),
                unregister: vi.fn(),
            },
            getStore: () => store,
            editor: { open: vi.fn() },
            keybindings: {
                register: vi.fn(() => keybindingDisposer),
                registerMany: vi.fn(() => keybindingDisposer),
            },
            notifications: {
                info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn(),
            },
        };
        const blueprintNodesService = {
            register: vi.fn(),
            registerMany: vi.fn(),
            registerDynamicSelectOptionsSource: vi.fn(() => dynamicSourceDisposer),
            notifyDynamicSelectOptionsChanged: vi.fn(),
        };
        const services = new Map<Services, unknown>([
            [Services.UI, uiService],
            [Services.Assets, { getAssets: vi.fn(() => ({})), fetch: vi.fn() }],
            [Services.ServiceAssets, { readStore: vi.fn(), writeStore: vi.fn() }],
            [Services.BlueprintNodeCatalog, blueprintNodesService],
        ]);
        const ctx = {
            services: {
                get: (service: Services) => services.get(service),
            },
        } as unknown as WorkspaceContext;
        return { ctx, calls, store, uiService, panelDisposer, keybindingDisposer, dynamicSourceDisposer };
    }

    afterEach(() => {
        widgetModuleRegistry.unregister("test-widget");
    });

    it("reclaims panel, action, group, keybinding, widget, and dynamic-source registrations in reverse order", () => {
        const { ctx, calls, store, panelDisposer, keybindingDisposer, dynamicSourceDisposer } = createFakeContext();
        const { app, dispose } = createPluginApp(ctx, descriptor, {} as PluginApp["privileged"]);

        app.services.ui.panels.register({ id: "p1" } as any);
        app.services.ui.actions.register({ id: "a1" } as any);
        app.services.ui.actions.registerGroup({ id: "g1" } as any);
        app.services.ui.keybindings.register({ id: "k1" } as any);
        const widget = { type: "test-widget" } as unknown as UIWidgetModule;
        app.services.widgets.register(widget);
        app.services.blueprintNodes.registerDynamicSelectOptionsSource("s1", () => []);

        expect(widgetModuleRegistry.get("test-widget")).toBe(widget);

        dispose();

        expect(panelDisposer).toHaveBeenCalledTimes(1);
        expect(store.unregisterAction).toHaveBeenCalledWith("a1");
        expect(store.unregisterActionGroup).toHaveBeenCalledWith("g1");
        expect(keybindingDisposer).toHaveBeenCalledTimes(1);
        expect(dynamicSourceDisposer).toHaveBeenCalledTimes(1);
        expect(widgetModuleRegistry.has("test-widget")).toBe(false);

        // Reverse registration order: dynamic source disposed first, panel last.
        const disposalOrder = calls.filter(c =>
            ["panelDisposer", "unregisterAction", "unregisterActionGroup", "keybindingDisposer", "dynamicSourceDisposer"].includes(c),
        );
        expect(disposalOrder).toEqual([
            "dynamicSourceDisposer",
            "keybindingDisposer",
            "unregisterActionGroup",
            "unregisterAction",
            "panelDisposer",
        ]);

        // Second dispose is a no-op.
        dispose();
        expect(panelDisposer).toHaveBeenCalledTimes(1);
    });

    it("keeps disposing after one disposer throws", () => {
        const { ctx, uiService, panelDisposer } = createFakeContext();
        const { app, dispose } = createPluginApp(ctx, descriptor, {} as PluginApp["privileged"]);

        app.services.ui.panels.register({ id: "p1" } as any);
        // Registered after the panel, so it throws first during reversed disposal.
        uiService.keybindings.register.mockReturnValueOnce(vi.fn(() => {
            throw new Error("disposer failure");
        }) as any);
        app.services.ui.keybindings.register({ id: "k1" } as any);

        expect(() => dispose()).not.toThrow();
        expect(panelDisposer).toHaveBeenCalledTimes(1);
    });

    it("does not overwrite a widget replacement made after registration", () => {
        const { ctx } = createFakeContext();
        const { app, dispose } = createPluginApp(ctx, descriptor, {} as PluginApp["privileged"]);

        const widget = { type: "test-widget" } as unknown as UIWidgetModule;
        const replacement = { type: "test-widget" } as unknown as UIWidgetModule;
        app.services.widgets.register(widget);
        widgetModuleRegistry.register(replacement);

        dispose();

        // The replacement (not owned by the plugin) must survive.
        expect(widgetModuleRegistry.get("test-widget")).toBe(replacement);
    });
});
