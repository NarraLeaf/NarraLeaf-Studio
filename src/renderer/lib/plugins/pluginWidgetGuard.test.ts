import { afterEach, describe, expect, it, vi } from "vitest";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import type { UIInspectorData, UIWidgetModule, WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import type { RuntimePluginGame } from "@/lib/ui-editor/runtime/plugins/runtimePluginApi";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import type { PluginWidgetModule } from "./pluginWidgetApi";
import {
    createPluginWidgetDocumentApi,
    guardInspectorDataForPluginWidget,
    guardPluginWidgetModule,
} from "./pluginWidgetGuard";

const PLUGIN_ID = "acme.widgets";

/**
 * A stand-in with the shape that made the escalation work: the members a widget legitimately uses,
 * plus the inherited `getContext` that returns the workspace service registry.
 */
function fakeDocumentService(): UIDocumentService & { getContext: () => unknown } {
    class FakeService {
        public getContext(): unknown {
            return { services: { get: () => ({ readFile: () => "the whole project" }) } };
        }
        public getDocument(): unknown {
            return { elements: {} };
        }
        public updateElementProps(): void {
            /* recorded by spies in the tests that care */
        }
    }
    return new FakeService() as unknown as UIDocumentService & { getContext: () => unknown };
}

function fakeStateService(): UIEditorStateService {
    return {
        getSelection: () => ({ type: "none" }),
        setUIElementSelection: vi.fn(),
        getEnteredState: () => null,
        setEnteredState: vi.fn(),
        getContext: () => ({ services: { get: () => ({}) } }),
    } as unknown as UIEditorStateService;
}

function guard(module: Partial<PluginWidgetModule>): UIWidgetModule {
    return guardPluginWidgetModule(
        PLUGIN_ID,
        { type: `${PLUGIN_ID}.badge`, displayName: "Badge", ...module } as PluginWidgetModule,
        { log: vi.fn() } as unknown as RuntimePluginGame,
        { documentService: fakeDocumentService(), stateService: fakeStateService() },
    );
}

describe("plugin widget document facade", () => {
    it("refuses the service registry the live document service exposes", () => {
        const live = fakeDocumentService();
        expect(live.getContext()).toBeTruthy();

        const facade = createPluginWidgetDocumentApi(PLUGIN_ID, live);
        expect(() => (facade as unknown as { getContext: () => unknown }).getContext())
            .toThrow(/acme\.widgets.*documentService\.getContext/);
    });

    it("still answers the document reads and element writes a widget is built on", () => {
        const live = fakeDocumentService();
        const spy = vi.spyOn(live, "updateElementProps");
        const facade = createPluginWidgetDocumentApi(PLUGIN_ID, live);

        expect(facade.getDocument()).toEqual({ elements: {} });
        facade.updateElementProps("el-1", { text: "hi" });
        expect(spy).toHaveBeenCalledWith("el-1", { text: "hi" });
    });

    /**
     * Trapping `getContext` alone would not be enough: `Service` extends `Singleton`, whose
     * `instances` static holds every service ever built, so anything that keeps the class's
     * prototype chain still leads back to the registry.
     */
    it("carries no prototype chain back to the service class", () => {
        const live = fakeDocumentService();
        const facade = createPluginWidgetDocumentApi(PLUGIN_ID, live);

        expect(Object.getPrototypeOf(facade)).toBeNull();
        expect((facade as unknown as { constructor: unknown }).constructor).not.toBe(live.constructor);
    });

    it("refuses an unlisted member rather than answering undefined", () => {
        const facade = createPluginWidgetDocumentApi(PLUGIN_ID, fakeDocumentService());
        expect(() => (facade as unknown as { deleteElement: () => void }).deleteElement())
            .toThrow(/documentService\.deleteElement/);
    });

    it("answers undefined for `then` so awaiting it does not reject", async () => {
        const facade = createPluginWidgetDocumentApi(PLUGIN_ID, fakeDocumentService());
        await expect(Promise.resolve(facade)).resolves.toBe(facade);
    });
});

describe("guardPluginWidgetModule", () => {
    it("hands render the runtime's props, with no host adapter on them", () => {
        let seen: Record<string, unknown> | null = null;
        const guarded = guard({
            render: props => {
                seen = props as unknown as Record<string, unknown>;
                return null;
            },
        });

        guarded.render({
            element: { id: "el-1", type: `${PLUGIN_ID}.badge` },
            surface: { id: "surface-1" },
            document: { elements: {} },
            hostAdapter: {
                host: "app",
                editorDocumentService: fakeDocumentService(),
                editorStateService: fakeStateService(),
            },
        } as unknown as WidgetRendererProps);

        expect(seen).not.toBeNull();
        expect(seen!).not.toHaveProperty("hostAdapter");
        expect(seen!.element).toEqual({ id: "el-1", type: `${PLUGIN_ID}.badge` });
        expect(typeof seen!.dispatchEvent).toBe("function");
        expect(seen!.game).toBeTruthy();
    });

    it("binds dispatchEvent to the element and row being drawn", async () => {
        const dispatchElementBlueprintEvent = vi.fn(() => Promise.resolve());
        let dispatch: ((name: string) => Promise<void>) | undefined;
        const guarded = guard({
            render: props => {
                dispatch = props.dispatchEvent;
                return null;
            },
        });

        guarded.render({
            element: { id: "el-1", type: `${PLUGIN_ID}.badge` },
            surface: { id: "surface-1" },
            document: { elements: {} },
            instanceKey: "row-3",
            listItemScope: { index: 3 },
            hostAdapter: { host: "player", blueprintRuntime: { dispatchElementBlueprintEvent } },
        } as unknown as WidgetRendererProps);

        await dispatch!("mouseClick");
        expect(dispatchElementBlueprintEvent).toHaveBeenCalledWith("el-1", "mouseClick", undefined, {
            listItemScope: { index: 3 },
            instanceKey: "row-3",
        });
    });

    it("hands the inspector and docker bar factories facades rather than the live services", () => {
        const seen: Record<string, unknown> = {};
        const guarded = guard({
            createInspector: context => {
                seen.inspector = context.documentService;
                return undefined;
            },
            createDockerBarItems: context => {
                seen.docker = context.documentService;
                seen.dockerState = context.stateService;
                return [];
            },
        });

        guarded.createInspector!({ element: { id: "el-1" } as never, documentService: fakeDocumentService() });
        guarded.createDockerBarItems!({
            element: { id: "el-1" } as never,
            documentService: fakeDocumentService(),
            stateService: fakeStateService(),
        });

        for (const key of ["inspector", "docker", "dockerState"]) {
            expect(() => (seen[key] as { getContext: () => unknown }).getContext()).toThrow(/acme\.widgets/);
        }
    });

    it("leaves optional members the plugin did not write absent", () => {
        const guarded = guard({});
        expect(guarded.createInspector).toBeUndefined();
        expect(guarded.createDockerBarItems).toBeUndefined();
        expect(guarded.createContextMenuItems).toBeUndefined();
        expect(guarded.createFloatingToolbarItems).toBeUndefined();
        expect(guarded.createLayoutSizeField).toBeUndefined();
    });
});

describe("guardInspectorDataForPluginWidget", () => {
    afterEach(() => {
        widgetModuleRegistry.unregister(`${PLUGIN_ID}.badge`);
        widgetModuleRegistry.unregister("nl.fake");
    });

    it("swaps the document service for a plugin-owned element type", () => {
        widgetModuleRegistry.register(
            { type: `${PLUGIN_ID}.badge` } as unknown as UIWidgetModule,
            { ownerPluginId: PLUGIN_ID },
        );
        const live = fakeDocumentService();
        const data = {
            element: { id: "el-1", type: `${PLUGIN_ID}.badge` },
            elements: [],
            documentService: live,
        } as unknown as UIInspectorData;

        const guarded = guardInspectorDataForPluginWidget(data);
        expect(guarded.documentService).not.toBe(live);
        expect(() => (guarded.documentService as unknown as { getContext: () => unknown }).getContext())
            .toThrow(/acme\.widgets/);
    });

    it("leaves a built-in element type untouched", () => {
        widgetModuleRegistry.register({ type: "nl.fake" } as unknown as UIWidgetModule);
        const live = fakeDocumentService();
        const data = {
            element: { id: "el-1", type: "nl.fake" },
            elements: [],
            documentService: live,
        } as unknown as UIInspectorData;

        expect(guardInspectorDataForPluginWidget(data)).toBe(data);
    });
});
