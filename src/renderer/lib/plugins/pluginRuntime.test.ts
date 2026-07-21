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
        manifest: {
            manifestVersion: 2,
            id: "test-plugin",
            name: "Test",
            version: "1.0.0",
            entries: { studio: "main.js" },
            contributes: { blueprintNodes: ["test-plugin.node"], widgets: ["test-plugin.widget"], locales: [] },
            permissions: [],
        },
        entryUrl: "app://plugins/test-plugin/main.js",
    } as unknown as WorkspacePluginDescriptor;

    function createFakeContext() {
        const calls: string[] = [];
        const store = {
            registerAction: vi.fn(() => calls.push("registerAction")),
            unregisterAction: vi.fn(() => calls.push("unregisterAction")),
            registerActionGroup: vi.fn((_group: any) => calls.push("registerActionGroup")),
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
        const storyActionDisposer = vi.fn(() => calls.push("storyActionDisposer"));
        const storyService = {
            registerPluginAction: vi.fn(() => storyActionDisposer),
        };
        const services = new Map<Services, unknown>([
            [Services.UI, uiService],
            [Services.Assets, { getAssets: vi.fn(() => ({})), fetch: vi.fn() }],
            [Services.ServiceAssets, { readStore: vi.fn(), writeStore: vi.fn() }],
            [Services.BlueprintNodeCatalog, blueprintNodesService],
            [Services.Story, storyService],
        ]);
        const ctx = {
            services: {
                get: (service: Services) => services.get(service),
            },
        } as unknown as WorkspaceContext;
        return { ctx, calls, store, uiService, panelDisposer, keybindingDisposer, dynamicSourceDisposer, storyService, storyActionDisposer, blueprintNodesService };
    }

    afterEach(() => {
        widgetModuleRegistry.unregister("test-plugin.widget");
    });

    it("reclaims panel, action, group, keybinding, widget, and dynamic-source registrations in reverse order", () => {
        const { ctx, calls, store, panelDisposer, keybindingDisposer, dynamicSourceDisposer } = createFakeContext();
        const { app, dispose } = createPluginApp(ctx, descriptor, {} as PluginApp["privileged"]);

        app.services.ui.panels.register({ id: "test-plugin.p1" } as any);
        app.services.ui.actions.register({ id: "test-plugin.a1" } as any);
        app.services.ui.actions.registerGroup({ id: "test-plugin.g1" } as any);
        app.services.ui.keybindings.register({ id: "test-plugin.k1" } as any);
        const widget = { type: "test-plugin.widget" } as unknown as UIWidgetModule;
        app.services.widgets.register(widget);
        app.services.blueprintNodes.registerDynamicSelectOptionsSource("s1", () => []);

        expect(widgetModuleRegistry.get("test-plugin.widget")).toBe(widget);

        dispose();

        expect(panelDisposer).toHaveBeenCalledTimes(1);
        expect(store.unregisterAction).toHaveBeenCalledWith("test-plugin.a1");
        expect(store.unregisterActionGroup).toHaveBeenCalledWith("test-plugin.g1");
        expect(keybindingDisposer).toHaveBeenCalledTimes(1);
        expect(dynamicSourceDisposer).toHaveBeenCalledTimes(1);
        expect(widgetModuleRegistry.has("test-plugin.widget")).toBe(false);

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

    it("registers prefixed story actions and reclaims them on dispose", () => {
        const { ctx, storyService, storyActionDisposer } = createFakeContext();
        const { app, dispose } = createPluginApp(ctx, descriptor, {} as PluginApp["privileged"]);

        app.services.story.actions.register({
            id: "test-plugin.insert-thing",
            label: "Insert Thing",
            createBlock: () => ({ id: "b1", kind: "note", parentId: null, childrenIds: [], payload: { text: { value: "" } } }) as any,
        });
        expect(storyService.registerPluginAction).toHaveBeenCalledTimes(1);

        expect(() => app.services.story.actions.register({
            id: "other.insert-thing",
            label: "Bad",
            createBlock: () => ({}) as any,
        })).toThrow(/must be prefixed with/);

        dispose();
        expect(storyActionDisposer).toHaveBeenCalledTimes(1);
    });

    it("rejects blueprint node registrations not declared in manifest contributes", () => {
        const { ctx, blueprintNodesService } = createFakeContext();
        const { app } = createPluginApp(ctx, descriptor, {} as PluginApp["privileged"]);

        expect(() => app.services.blueprintNodes.register({ type: "test-plugin.undeclared" } as any))
            .toThrow(/contributes\.blueprintNodes/);
        expect(blueprintNodesService.register).not.toHaveBeenCalled();

        app.services.blueprintNodes.register({ type: "test-plugin.node" } as any);
        expect(blueprintNodesService.register).toHaveBeenCalledTimes(1);
    });

    it("confines a plugin's action group to a menu of its own", () => {
        const { ctx, store } = createFakeContext();
        const { app } = createPluginApp(ctx, descriptor, {} as PluginApp["privileged"]);

        // A group asking to merge into the native Edit menu and stand in for Paste - i.e. to
        // become what Cmd+V does across the window.
        app.services.ui.actions.registerGroup({
            id: "test-plugin.group",
            label: "Evil",
            menuSlot: "edit",
            actions: [
                { id: "test-plugin:paste", label: "Paste", menuRole: "paste", onClick: vi.fn() },
            ],
        } as any);

        const registered = store.registerActionGroup.mock.calls[0][0];
        expect(registered.menuSlot).toBe("top-level");
        expect(registered.actions[0].menuRole).toBeUndefined();
    });

    it("strips menuRole from a plugin's nested submenu items", () => {
        const { ctx, store } = createFakeContext();
        const { app } = createPluginApp(ctx, descriptor, {} as PluginApp["privileged"]);

        app.services.ui.actions.registerGroup({
            id: "test-plugin.group",
            label: "Evil",
            items: [
                {
                    id: "test-plugin:submenu",
                    label: "More",
                    items: [
                        { id: "test-plugin:copy", label: "Copy", menuRole: "copy", onClick: vi.fn() },
                    ],
                },
            ],
        } as any);

        const registered = store.registerActionGroup.mock.calls[0][0];
        expect(registered.items[0].items[0].menuRole).toBeUndefined();
    });

    it("rejects widget registrations not declared in manifest contributes", () => {
        const { ctx } = createFakeContext();
        const { app } = createPluginApp(ctx, descriptor, {} as PluginApp["privileged"]);

        expect(() => app.services.widgets.register({ type: "test-plugin.undeclared-widget" } as unknown as UIWidgetModule))
            .toThrow(/contributes\.widgets/);
        expect(widgetModuleRegistry.has("test-plugin.undeclared-widget")).toBe(false);
    });

    it("keeps disposing after one disposer throws", () => {
        const { ctx, uiService, panelDisposer } = createFakeContext();
        const { app, dispose } = createPluginApp(ctx, descriptor, {} as PluginApp["privileged"]);

        app.services.ui.panels.register({ id: "test-plugin.p1" } as any);
        // Registered after the panel, so it throws first during reversed disposal.
        uiService.keybindings.register.mockReturnValueOnce(vi.fn(() => {
            throw new Error("disposer failure");
        }) as any);
        app.services.ui.keybindings.register({ id: "test-plugin.k1" } as any);

        expect(() => dispose()).not.toThrow();
        expect(panelDisposer).toHaveBeenCalledTimes(1);
    });

    it("does not overwrite a widget replacement made after registration", () => {
        const { ctx } = createFakeContext();
        const { app, dispose } = createPluginApp(ctx, descriptor, {} as PluginApp["privileged"]);

        const widget = { type: "test-plugin.widget" } as unknown as UIWidgetModule;
        const replacement = { type: "test-plugin.widget" } as unknown as UIWidgetModule;
        app.services.widgets.register(widget);
        widgetModuleRegistry.register(replacement);

        dispose();

        // The replacement (not owned by the plugin) must survive.
        expect(widgetModuleRegistry.get("test-plugin.widget")).toBe(replacement);
    });
});
